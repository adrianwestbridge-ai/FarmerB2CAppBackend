// Payment ledger for orders.
//
// A farmer may pay any part of the order total by scanning the Super Admin's QR (one or more
// times, also after delivery) and reports each payment with its UTR. The Accounts team confirms
// how much of each payment actually arrived (or rejects it). Whatever is not paid online is
// collected in cash by the delivery partner. Order totals, the cash to collect and the payment
// status are always recomputed from the ledger, so every role sees the same numbers.

const Order = require('../models/Order');
const { AppError } = require('../utils/i18n');
const { actorRoleOf } = require('../utils/audit');
const { cleanText, toMoney } = require('../utils/validators');

const TERMINATED = ['REJECTED', 'CANCELLED'];

// UPI transaction reference (UTR / RRN) is always 12 digits.
const PAYMENT_REF_RE = /^\d{12}$/;
const normalizeReference = (value) => cleanText(value, 60).replace(/\s+/g, '').toUpperCase();

const actor = (req) => ({
  id: req.user ? String(req.user._id) : null,
  role: actorRoleOf(req.user),
  name: req.user ? (req.user.name || req.user.username || '') : '',
});

const sum = (list, fn) => toMoney(list.reduce((s, x) => s + fn(x), 0));

/** Cash the delivery partner actually took (only once the order is delivered). */
const cashReceived = (order) => (['COLLECTED', 'DISPUTED'].includes(order.collectionStatus) ? toMoney(order.amountCollected) : 0);

/** Money still open for new QR payments: total − confirmed − waiting for confirmation − cash taken. */
const openBalance = (order) => Math.max(0, toMoney(order.totalAmount - order.amountPaidOnline - order.amountPendingOnline - cashReceived(order)));

/** What is still owed once everything received is counted (pending QR payments not included). */
const balanceDue = (order) => (TERMINATED.includes(order.status) ? 0 : Math.max(0, toMoney(order.totalAmount - order.amountPaidOnline - cashReceived(order))));

/**
 * Recompute ledger totals, cash to collect and payment status. Adds a payment-history entry
 * whenever the status changes (or a note is given).
 */
const recomputePayment = (order, req, note = '') => {
  const entries = order.payments || [];
  const confirmed = sum(entries, (p) => (p.status === 'CONFIRMED' ? p.confirmedAmount : 0));
  const pending = sum(entries, (p) => (p.status === 'PENDING' ? p.amount : 0));
  order.amountPaidOnline = confirmed;
  order.amountPendingOnline = pending;
  const received = toMoney(confirmed + cashReceived(order));
  const last = entries.length ? entries[entries.length - 1] : null;

  let next;
  if (TERMINATED.includes(order.status)) {
    if (order.paymentStatus === 'REFUNDED' && confirmed <= toMoney(order.refundAmount)) next = 'REFUNDED';
    else if (confirmed > 0) { next = 'REFUND_PENDING'; order.refundAmount = confirmed; }
    else if (pending > 0) next = 'AWAITING_VERIFICATION';
    else next = 'CANCELLED';
    order.expectedCollection = 0;
    if (order.collectionStatus === 'PENDING') order.collectionStatus = 'NOT_APPLICABLE';
  } else {
    if (received >= toMoney(order.totalAmount) && order.totalAmount > 0) next = 'PAID';
    else if (pending > 0) next = 'AWAITING_VERIFICATION';
    else if (received > 0) next = 'PARTIALLY_PAID';
    else if (last && last.status === 'REJECTED') next = 'FAILED';
    else next = 'PENDING';
    if (order.status !== 'DELIVERED') {
      // The partner collects in cash whatever is not covered by QR payments (reported ones included,
      // so the farmer is never asked to pay twice; a rejected QR payment raises it again).
      order.expectedCollection = Math.max(0, toMoney(order.totalAmount - confirmed - pending));
      order.collectionStatus = order.expectedCollection > 0 ? 'PENDING' : 'NOT_APPLICABLE';
    } else if (order.collectionStatus === 'DISPUTED' && next === 'PAID') {
      // Short cash at the door that the farmer later paid by QR: nothing is missing any more,
      // so it no longer counts as a short collection against the delivery partner.
      order.collectionStatus = 'COLLECTED';
    }
  }

  // The most recent reference still standing (kept for older app versions and searches).
  const standing = [...entries].reverse().find((p) => p.status !== 'REJECTED' && p.reference);
  order.paymentReference = standing ? standing.reference : '';
  if (next === 'PAID' && !order.paidAt) order.paidAt = new Date();

  if (next !== order.paymentStatus || note) {
    const a = actor(req);
    order.paymentHistory.push({ status: next, at: new Date(), byId: a.id, byRole: a.role, byName: a.name, note });
    order.paymentStatus = next;
  }
  return order;
};

const assertReferenceUnused = async (reference, order) => {
  const live = { $elemMatch: { reference, status: { $ne: 'REJECTED' } } };
  const other = await Order.exists({ _id: { $ne: order ? order._id : null }, $or: [{ payments: live }, { paymentReference: reference }] });
  const own = order && (order.payments || []).some((p) => p.reference === reference && p.status !== 'REJECTED');
  if (other || own) throw new AppError(400, 'PAYMENT_REFERENCE_USED');
};

const parseAmount = (value, { max, fallback }) => {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return toMoney(fallback);
    throw new AppError(400, 'PAYMENT_AMOUNT_INVALID');
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new AppError(400, 'PAYMENT_AMOUNT_INVALID');
  const amount = toMoney(n);
  if (max !== undefined && amount > toMoney(max)) throw new AppError(400, 'PAYMENT_AMOUNT_TOO_HIGH', { max: toMoney(max) });
  return amount;
};

const findEntry = (order, entryId) => {
  const entry = order.payments.id(String(entryId || ''));
  if (!entry) throw new AppError(404, 'PAYMENT_ENTRY_NOT_FOUND');
  return entry;
};

/** Farmer reports a QR / UPI payment (at checkout or later from the order). Does not save. */
const addFarmerPayment = async (req, order, { paymentReference, amount }) => {
  const reference = normalizeReference(paymentReference);
  if (!reference) throw new AppError(400, 'PAYMENT_REFERENCE_REQUIRED');
  if (!PAYMENT_REF_RE.test(reference)) throw new AppError(400, 'PAYMENT_REFERENCE_INVALID');
  const open = openBalance(order);
  if (!(open > 0)) throw new AppError(409, 'PAYMENT_NOTHING_DUE');
  const value = parseAmount(amount, { max: open, fallback: open });
  await assertReferenceUnused(reference, order);
  const a = actor(req);
  order.payments.push({
    amount: value, reference, source: 'FARMER_QR', status: 'PENDING', submittedAt: new Date(),
    submittedById: a.id, submittedByRole: a.role, submittedByName: a.name,
  });
  order.paymentSubmittedAt = new Date();
  order.paymentFailureReason = '';
  recomputePayment(order, req, `QR payment ₹${value} reported (UTR ${reference})`);
  return order.payments[order.payments.length - 1];
};

/** Accounts team confirms (with the amount that arrived) or rejects a reported payment. */
const reviewEntry = (req, order, entry, { approved, amount, reason }) => {
  if (entry.status !== 'PENDING') throw new AppError(409, 'PAYMENT_NOT_AWAITING');
  const a = actor(req);
  entry.reviewedAt = new Date();
  entry.reviewedById = a.id;
  entry.reviewedByRole = a.role;
  entry.reviewedByName = a.name;
  let note;
  if (approved === true || approved === 'true') {
    // Never more than the order still needs (the rest of the total minus other money received).
    const room = toMoney(order.totalAmount - order.amountPaidOnline - cashReceived(order));
    const value = parseAmount(amount, { max: Math.max(room, 0), fallback: Math.min(entry.amount, Math.max(room, 0)) || entry.amount });
    entry.status = 'CONFIRMED';
    entry.confirmedAmount = value;
    entry.rejectReason = '';
    note = value === entry.amount
      ? `QR payment ₹${value} confirmed (UTR ${entry.reference || '—'})`
      : `QR payment confirmed: ₹${value} received of ₹${entry.amount} reported (UTR ${entry.reference || '—'})`;
    order.paymentVerifiedBy = a.id;
    order.paymentVerifiedByName = a.name;
  } else {
    const clean = cleanText(reason, 500);
    if (clean.length < 3) throw new AppError(400, 'ORDER_REASON_REQUIRED');
    entry.status = 'REJECTED';
    entry.confirmedAmount = 0;
    entry.rejectReason = clean;
    order.paymentFailureReason = clean;
    order.paymentVerifiedBy = a.id;
    order.paymentVerifiedByName = a.name;
    note = `QR payment ₹${entry.amount} rejected: ${clean}`;
  }
  recomputePayment(order, req, note);
  return entry;
};

/** Super Admin corrects an entry (amount and/or status). Every change is kept on the entry. */
const editEntry = (req, order, entry, { amount, status, reason }) => {
  const clean = cleanText(reason, 500);
  if (clean.length < 3) throw new AppError(400, 'ORDER_REASON_REQUIRED');
  const nextStatus = status ? String(status).toUpperCase() : (entry.status === 'PENDING' ? 'CONFIRMED' : entry.status);
  if (!Order.PAYMENT_ENTRY_STATUSES.includes(nextStatus)) throw new AppError(400, 'VALIDATION_FAILED');
  const fromAmount = entry.status === 'CONFIRMED' ? entry.confirmedAmount : entry.amount;
  const fromStatus = entry.status;

  let toAmount = fromAmount;
  if (nextStatus === 'CONFIRMED') {
    const othersConfirmed = toMoney(order.amountPaidOnline - (entry.status === 'CONFIRMED' ? entry.confirmedAmount : 0));
    const room = Math.max(0, toMoney(order.totalAmount - othersConfirmed - cashReceived(order)));
    toAmount = parseAmount(amount, { max: room, fallback: Math.min(fromAmount, room) || fromAmount });
    entry.confirmedAmount = toAmount;
    entry.rejectReason = '';
  } else if (nextStatus === 'REJECTED') {
    entry.confirmedAmount = 0;
    entry.rejectReason = clean;
    toAmount = 0;
  } else {
    if (amount !== undefined && amount !== '') entry.amount = parseAmount(amount, { max: order.totalAmount });
    entry.confirmedAmount = 0;
    toAmount = entry.amount;
  }
  const a = actor(req);
  // The original reviewer stays credited in the Accounts team report; corrections are kept in `edits`.
  if (fromStatus === 'PENDING' && nextStatus !== 'PENDING') {
    entry.reviewedAt = new Date();
    entry.reviewedById = a.id;
    entry.reviewedByRole = a.role;
    entry.reviewedByName = a.name;
  }
  entry.status = nextStatus;
  entry.edits.push({ at: new Date(), byId: a.id, byRole: a.role, byName: a.name, fromAmount, toAmount, fromStatus, toStatus: nextStatus, reason: clean });
  recomputePayment(order, req, `Payment entry corrected by ${a.name}: ${fromStatus} ₹${fromAmount} → ${nextStatus} ₹${toAmount} (${clean})`);
  return entry;
};

/** Super Admin records a payment received outside the app flow (e.g. farmer paid and phoned the helpline). */
const addManualEntry = async (req, order, { amount, paymentReference, note }) => {
  const clean = cleanText(note, 500);
  if (clean.length < 3) throw new AppError(400, 'ORDER_REASON_REQUIRED');
  const reference = paymentReference ? normalizeReference(paymentReference) : '';
  if (reference && !PAYMENT_REF_RE.test(reference)) throw new AppError(400, 'PAYMENT_REFERENCE_INVALID');
  if (reference) await assertReferenceUnused(reference, order);
  const room = Math.max(0, toMoney(order.totalAmount - order.amountPaidOnline - cashReceived(order)));
  if (!(room > 0)) throw new AppError(409, 'PAYMENT_NOTHING_DUE');
  const value = parseAmount(amount, { max: room });
  const a = actor(req);
  const now = new Date();
  order.payments.push({
    amount: value, confirmedAmount: value, reference, source: 'MANUAL', status: 'CONFIRMED', note: clean,
    submittedAt: now, submittedById: a.id, submittedByRole: a.role, submittedByName: a.name,
    reviewedAt: now, reviewedById: a.id, reviewedByRole: a.role, reviewedByName: a.name,
  });
  recomputePayment(order, req, `Payment ₹${value} recorded by ${a.name}: ${clean}`);
  return order.payments[order.payments.length - 1];
};

/** Fields every role needs to see the money position of an order. */
const paymentSummary = (order) => ({
  totalAmount: order.totalAmount,
  amountPaidOnline: order.amountPaidOnline || 0,
  amountPendingOnline: order.amountPendingOnline || 0,
  cashCollected: cashReceived(order),
  balanceDue: balanceDue(order),
  openBalance: openBalance(order),
});

module.exports = {
  PAYMENT_REF_RE,
  normalizeReference,
  assertReferenceUnused,
  recomputePayment,
  addFarmerPayment,
  reviewEntry,
  editEntry,
  addManualEntry,
  findEntry,
  paymentSummary,
  openBalance,
  balanceDue,
  cashReceived,
};
