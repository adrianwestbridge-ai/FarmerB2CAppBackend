const Order = require('../models/Order');
const Product = require('../models/Product');
const Partner = require('../models/Partner');
const CartItem = require('../models/CartItem');
const { nextNumber } = require('../models/Counter');
const { AppError } = require('../utils/i18n');
const { audit, actorRoleOf } = require('../utils/audit');
const { getSettings } = require('../utils/settings');
const { cleanText, cleanImage, toMoney, requireValidId } = require('../utils/validators');
const { priceCart } = require('./pricingService');
const payments = require('./paymentService');

// Statuses from which the reserved stock is still held by the order (goods not handed over).
const STOCK_HELD = ['PENDING_APPROVAL', 'APPROVED', 'ASSIGNED', 'DELIVERY_FAILED'];

const actorOf = (req) => ({
  byId: req.user ? String(req.user._id) : null,
  byRole: actorRoleOf(req.user),
  byName: req.user ? (req.user.name || req.user.username || '') : '',
});

const pushStatus = (order, status, req, note = '') => {
  order.statusHistory.push({ status, at: new Date(), ...actorOf(req), note });
  order.status = status;
};

const pushPayment = (order, paymentStatus, req, note = '') => {
  order.paymentHistory.push({ status: paymentStatus, at: new Date(), ...actorOf(req), note });
  order.paymentStatus = paymentStatus;
};

const assertStatus = (order, allowed) => {
  if (!allowed.includes(order.status)) {
    throw new AppError(409, 'ORDER_TRANSITION_INVALID', { status: order.status });
  }
};

const requireReason = (reason) => {
  const clean = cleanText(reason, 500);
  if (clean.length < 3) throw new AppError(400, 'ORDER_REASON_REQUIRED');
  return clean;
};

const saveOrder = async (order) => {
  try {
    return await order.save();
  } catch (err) {
    if (err && err.name === 'VersionError') throw new AppError(409, 'ORDER_CHANGED');
    throw err;
  }
};

const loadOrder = async (id) => {
  requireValidId(id);
  const order = await Order.findById(id);
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND');
  return order;
};

const auditOrder = (req, order, action, extra = {}) => audit(req, {
  action,
  entityType: 'ORDER',
  entityId: order._id,
  entityRef: order.orderNumber,
  ...extra,
});

// ─── Stock ───────────────────────────────────────────────────────────────────

const reserveStock = async (lines) => {
  const reserved = [];
  try {
    for (const line of lines) {
      // eslint-disable-next-line no-await-in-loop
      const result = await Product.updateOne(
        { _id: line.productId, isActive: true, quantityAvailable: { $gte: line.quantity } },
        { $inc: { quantityAvailable: -line.quantity } },
      );
      if (result.modifiedCount !== 1) {
        // eslint-disable-next-line no-await-in-loop
        const p = await Product.findById(line.productId).select('name quantityAvailable');
        throw new AppError(400, 'PRODUCT_OUT_OF_STOCK', { name: p ? p.name : line.productName, available: p ? p.quantityAvailable : 0 });
      }
      reserved.push(line);
    }
  } catch (err) {
    await releaseStock(reserved);
    throw err;
  }
};

const releaseStock = async (lines) => {
  await Promise.all(lines.map((line) => Product.updateOne(
    { _id: line.productId },
    { $inc: { quantityAvailable: line.quantity } },
  )));
};

// ─── Payment side effects of an order ending without delivery ───────────────

// Recomputed from the payment ledger: confirmed QR money becomes a refund, nothing else is owed.
const settlePaymentOnTermination = (order, req) => payments.recomputePayment(order, req);

const clearAssignment = (order) => {
  order.assignedPartnerId = null;
  order.assignedPartnerName = '';
  order.assignedPartnerPhone = '';
  order.assignedAt = null;
  order.assignedBy = '';
  order.assignedByName = '';
};

// ─── Farmer: place order ─────────────────────────────────────────────────────

const { PAYMENT_REF_RE, normalizeReference } = payments;

const placeOrder = async (req, body) => {
  const farmer = req.user;
  const idempotencyKey = body.idempotencyKey ? cleanText(body.idempotencyKey, 80) : null;

  if (idempotencyKey) {
    const existing = await Order.findOne({ farmerId: farmer._id, idempotencyKey });
    if (existing) return { order: existing, duplicate: true };
  }

  const deliveryAddress = cleanText(body.deliveryAddress, 500);
  if (!deliveryAddress) throw new AppError(400, 'ADDRESS_REQUIRED');

  const paymentMethod = String(body.paymentMethod || '').toUpperCase();
  if (!['COD', 'ONLINE'].includes(paymentMethod)) throw new AppError(400, 'PAYMENT_METHOD_INVALID');
  const settings = await getSettings();
  if ((paymentMethod === 'COD' && !settings.codEnabled) || (paymentMethod === 'ONLINE' && (!settings.onlineEnabled || !settings.upiQrImage))) {
    throw new AppError(400, 'PAYMENT_METHOD_DISABLED');
  }

  let paymentReference = '';
  if (paymentMethod === 'ONLINE') {
    paymentReference = normalizeReference(body.paymentReference);
    if (!paymentReference) throw new AppError(400, 'PAYMENT_REFERENCE_REQUIRED');
    if (!PAYMENT_REF_RE.test(paymentReference)) throw new AppError(400, 'PAYMENT_REFERENCE_INVALID');
    await payments.assertReferenceUnused(paymentReference, null);
  }

  const quote = await priceCart(body.items, { strict: true });

  // The farmer confirmed a specific final amount; refuse silently charging something else.
  if (body.expectedTotal !== undefined && body.expectedTotal !== null) {
    if (toMoney(body.expectedTotal) !== quote.totalAmount) {
      const err = new AppError(409, 'PRICE_CHANGED');
      err.data = quote;
      throw err;
    }
  }

  await reserveStock(quote.items);

  const now = new Date();
  let order;
  try {
    order = new Order({
      orderNumber: await nextNumber('ORD'),
      farmerId: farmer._id,
      owner_id: farmer.owner_id,
      farmerName: farmer.name || farmer.username || '',
      farmerPhone: farmer.phoneNumber || '',
      deliveryAddress,
      items: quote.items.map(({ availableStock, ...line }) => line),
      mrpTotal: quote.mrpTotal,
      subtotal: quote.subtotal,
      discount: quote.discount,
      deliveryCharge: quote.deliveryCharge,
      totalAmount: quote.totalAmount,
      status: 'PENDING_APPROVAL',
      statusHistory: [{ status: 'PENDING_APPROVAL', at: now, ...actorOf(req), note: 'Order placed' }],
      trackingNote: 'Waiting for admin approval',
      paymentMethod,
      paymentStatus: 'PENDING',
      paymentHistory: [],
      settlementStatus: 'NOT_APPLICABLE',
      idempotencyKey,
    });
    if (paymentMethod === 'ONLINE') {
      // The farmer may pay only part by QR (paidAmount); the rest is collected in cash on delivery.
      await payments.addFarmerPayment(req, order, { paymentReference, amount: body.paidAmount });
    } else {
      payments.recomputePayment(order, req, 'Cash on delivery');
    }
    await order.save();
  } catch (err) {
    await releaseStock(quote.items);
    if (err && err.code === 11000) {
      if (idempotencyKey && err.keyPattern && err.keyPattern.idempotencyKey) {
        const existing = await Order.findOne({ farmerId: farmer._id, idempotencyKey });
        if (existing) return { order: existing, duplicate: true };
      }
      if (err.keyPattern && err.keyPattern.paymentReference) throw new AppError(400, 'PAYMENT_REFERENCE_USED');
    }
    throw err;
  }

  // Remove the ordered products from the farmer's cart.
  await CartItem.deleteMany({ owner_id: farmer.owner_id, productId: { $in: quote.items.map((l) => l.productId) } });

  await auditOrder(req, order, 'ORDER_PLACED', {
    toStatus: 'PENDING_APPROVAL',
    metadata: { totalAmount: order.totalAmount, discount: order.discount, paymentMethod, items: order.items.length },
  });

  return { order, duplicate: false };
};

// ─── Admin: verification, approval, rejection ───────────────────────────────

const recordVerification = async (req, id, { outcome, note }) => {
  const order = await loadOrder(id);
  assertStatus(order, ['PENDING_APPROVAL']);
  if (!Order.VERIFICATION_OUTCOMES.includes(outcome)) throw new AppError(400, 'ORDER_VERIFICATION_INVALID');
  order.verificationCalls.push({ outcome, note: cleanText(note, 500), at: new Date(), byId: String(req.user._id), byName: req.user.name || req.user.username });
  order.verificationOutcome = outcome;
  await saveOrder(order);
  await auditOrder(req, order, 'ORDER_VERIFICATION_RECORDED', { reason: cleanText(note, 500), metadata: { outcome } });
  return order;
};

const approveOrder = async (req, id, { note } = {}) => {
  const order = await loadOrder(id);
  assertStatus(order, ['PENDING_APPROVAL']);
  if (order.verificationOutcome !== 'CONFIRMED') throw new AppError(400, 'ORDER_VERIFICATION_REQUIRED');
  const now = new Date();
  pushStatus(order, 'APPROVED', req, cleanText(note, 500) || 'Approved after phone verification');
  order.decisionBy = String(req.user._id);
  order.decisionByName = req.user.name || req.user.username;
  order.decisionAt = now;
  order.approvedAt = now;
  order.trackingNote = 'Order accepted. Waiting for a delivery partner.';
  await saveOrder(order);
  await auditOrder(req, order, 'ORDER_APPROVED', { fromStatus: 'PENDING_APPROVAL', toStatus: 'APPROVED' });
  return order;
};

const rejectOrder = async (req, id, { reason }) => {
  const clean = requireReason(reason);
  const order = await loadOrder(id);
  assertStatus(order, ['PENDING_APPROVAL']);
  pushStatus(order, 'REJECTED', req, clean);
  order.decisionBy = String(req.user._id);
  order.decisionByName = req.user.name || req.user.username;
  order.decisionAt = new Date();
  order.rejectionReason = clean;
  order.trackingNote = `Order rejected: ${clean}`;
  settlePaymentOnTermination(order, req);
  await saveOrder(order);
  await releaseStock(order.items);
  await auditOrder(req, order, 'ORDER_REJECTED', { fromStatus: 'PENDING_APPROVAL', toStatus: 'REJECTED', reason: clean });
  return order;
};

// Farmers may cancel their own order until a delivery partner has it; admins (with approval
// permission) may cancel at any point before the goods leave with a partner.
const cancelOrder = async (req, id, { reason }) => {
  const clean = requireReason(reason);
  const order = await loadOrder(id);
  const isFarmer = req.userType === 'farmer';
  if (isFarmer) {
    if (String(order.farmerId) !== String(req.user._id)) throw new AppError(404, 'ORDER_NOT_FOUND');
    if (!(order.status === 'PENDING_APPROVAL' || (order.status === 'APPROVED' && !order.assignedPartnerId))) {
      throw new AppError(409, 'ORDER_TRANSITION_INVALID', { status: order.status });
    }
  } else {
    assertStatus(order, ['PENDING_APPROVAL', 'APPROVED', 'ASSIGNED', 'DELIVERY_FAILED']);
  }
  const fromStatus = order.status;
  const hadPartner = order.assignedPartnerId;
  pushStatus(order, 'CANCELLED', req, clean);
  order.cancelledBy = String(req.user._id);
  order.cancelledByRole = actorRoleOf(req.user);
  order.cancelledByName = req.user.name || req.user.username || '';
  order.cancelledAt = new Date();
  order.cancelReason = clean;
  order.trackingNote = `Order cancelled: ${clean}`;
  if (hadPartner) {
    order.assignmentHistory.push({ action: 'RELEASED_BY_ADMIN', partnerId: String(hadPartner), partnerName: order.assignedPartnerName, reason: 'Order cancelled', ...actorOf(req) });
    clearAssignment(order);
  }
  settlePaymentOnTermination(order, req);
  await saveOrder(order);
  await releaseStock(order.items);
  await auditOrder(req, order, 'ORDER_CANCELLED', { fromStatus, toStatus: 'CANCELLED', reason: clean });
  return order;
};

// ─── Delivery assignment ─────────────────────────────────────────────────────

const assignTo = (order, partner, req, byAdmin) => {
  const now = new Date();
  order.assignedPartnerId = partner._id;
  order.assignedPartnerName = partner.name || '';
  order.assignedPartnerPhone = partner.phoneNumber || '';
  order.assignedAt = now;
  order.assignedBy = byAdmin ? String(req.user._id) : 'SELF';
  order.assignedByName = byAdmin ? (req.user.name || req.user.username) : (partner.name || '');
  order.assignmentHistory.push({
    action: byAdmin ? 'ASSIGNED_BY_ADMIN' : 'ACCEPTED',
    partnerId: String(partner._id),
    partnerName: partner.name || '',
    ...actorOf(req),
  });
  pushStatus(order, 'ASSIGNED', req, `Delivery partner: ${partner.name || ''}`);
  order.trackingNote = `Delivery partner ${partner.name || ''} assigned.`;
};

// Partner accepts an approved order from the open pool (confirms availability).
const acceptFromPool = async (req, id) => {
  const partner = req.user;
  if (partner.online === false) throw new AppError(400, 'PARTNER_OFFLINE');
  const order = await loadOrder(id);
  if (order.status !== 'APPROVED') {
    if (['ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status)) throw new AppError(409, 'ORDER_ALREADY_TAKEN');
    throw new AppError(409, 'ORDER_TRANSITION_INVALID', { status: order.status });
  }
  assignTo(order, partner, req, false);
  try {
    await saveOrder(order);
  } catch (err) {
    if (err instanceof AppError && err.key === 'ORDER_CHANGED') throw new AppError(409, 'ORDER_ALREADY_TAKEN');
    throw err;
  }
  await auditOrder(req, order, 'DELIVERY_ACCEPTED', { fromStatus: 'APPROVED', toStatus: 'ASSIGNED', metadata: { partnerId: String(partner._id) } });
  return order;
};

// Admin assigns / reassigns a specific partner.
const adminAssign = async (req, id, { partnerId }) => {
  requireValidId(partnerId);
  const partner = await Partner.findById(partnerId);
  if (!partner || partner.status !== 'Active') throw new AppError(400, 'PARTNER_NOT_AVAILABLE');
  const order = await loadOrder(id);
  assertStatus(order, ['APPROVED', 'ASSIGNED', 'DELIVERY_FAILED']);
  const fromStatus = order.status;
  const previous = order.assignedPartnerId ? { id: String(order.assignedPartnerId), name: order.assignedPartnerName } : null;
  if (previous) {
    order.assignmentHistory.push({ action: 'RELEASED_BY_ADMIN', partnerId: previous.id, partnerName: previous.name, reason: 'Reassigned by admin', ...actorOf(req) });
  }
  assignTo(order, partner, req, true);
  await saveOrder(order);
  await auditOrder(req, order, previous ? 'DELIVERY_REASSIGNED' : 'DELIVERY_ASSIGNED', {
    fromStatus,
    toStatus: 'ASSIGNED',
    metadata: { partnerId: String(partner._id), partnerName: partner.name, previousPartnerId: previous && previous.id },
  });
  return order;
};

// Admin returns an order to the open pool.
const adminRelease = async (req, id, { reason }) => {
  const clean = requireReason(reason);
  const order = await loadOrder(id);
  assertStatus(order, ['ASSIGNED', 'DELIVERY_FAILED']);
  const fromStatus = order.status;
  if (order.assignedPartnerId) {
    order.assignmentHistory.push({ action: 'RELEASED_BY_ADMIN', partnerId: String(order.assignedPartnerId), partnerName: order.assignedPartnerName, reason: clean, ...actorOf(req) });
  }
  clearAssignment(order);
  pushStatus(order, 'APPROVED', req, `Returned to delivery pool: ${clean}`);
  order.trackingNote = 'Waiting for a delivery partner.';
  await saveOrder(order);
  await auditOrder(req, order, 'DELIVERY_RELEASED', { fromStatus, toStatus: 'APPROVED', reason: clean });
  return order;
};

const assertOwnAssignment = (order, partner) => {
  if (!order.assignedPartnerId || String(order.assignedPartnerId) !== String(partner._id)) {
    throw new AppError(403, 'ORDER_NOT_ASSIGNED_TO_YOU');
  }
};

// Partner reports they cannot do an accepted delivery → back to the pool for someone else.
const partnerUnavailable = async (req, id, { reason }) => {
  const clean = requireReason(reason);
  const order = await loadOrder(id);
  assertOwnAssignment(order, req.user);
  assertStatus(order, ['ASSIGNED']);
  order.assignmentHistory.push({ action: 'UNAVAILABLE', partnerId: String(req.user._id), partnerName: req.user.name, reason: clean, ...actorOf(req) });
  clearAssignment(order);
  pushStatus(order, 'APPROVED', req, `Delivery partner unavailable: ${clean}`);
  order.trackingNote = 'Waiting for a delivery partner.';
  await saveOrder(order);
  await auditOrder(req, order, 'DELIVERY_UNAVAILABLE', { fromStatus: 'ASSIGNED', toStatus: 'APPROVED', reason: clean });
  return order;
};

const partnerPickup = async (req, id) => {
  const order = await loadOrder(id);
  assertOwnAssignment(order, req.user);
  assertStatus(order, ['ASSIGNED']);
  order.pickedUpAt = new Date();
  order.assignmentHistory.push({ action: 'PICKED_UP', partnerId: String(req.user._id), partnerName: req.user.name, ...actorOf(req) });
  pushStatus(order, 'OUT_FOR_DELIVERY', req, 'Picked up');
  order.trackingNote = 'Out for delivery.';
  await saveOrder(order);
  await auditOrder(req, order, 'DELIVERY_PICKED_UP', { fromStatus: 'ASSIGNED', toStatus: 'OUT_FOR_DELIVERY' });
  return order;
};

const partnerDeliver = async (req, id, body) => {
  const order = await loadOrder(id);
  assertOwnAssignment(order, req.user);
  assertStatus(order, ['OUT_FOR_DELIVERY']);
  const now = new Date();

  // Cash is collected for whatever QR payments do not cover (full total for COD orders).
  if (order.expectedCollection > 0) {
    const collected = Number(body.amountCollected);
    if (body.amountCollected === undefined || body.amountCollected === null || body.amountCollected === '' || !Number.isFinite(collected) || collected < 0) {
      throw new AppError(400, 'COLLECTION_AMOUNT_INVALID');
    }
    order.amountCollected = toMoney(collected);
    order.collectedAt = now;
    order.collectionNote = cleanText(body.collectionNote, 300);
    // Short or excess collection is flagged for the admin to reconcile.
    order.collectionStatus = order.amountCollected === toMoney(order.expectedCollection) ? 'COLLECTED' : 'DISPUTED';
    order.settlementStatus = order.amountCollected > 0 ? 'PENDING' : 'NOT_APPLICABLE';
  } else if (body.markAsPaid || (body.amountCollected !== undefined && Number(body.amountCollected) > 0)) {
    throw new AppError(403, 'COLLECTION_ONLINE_FORBIDDEN');
  }

  order.deliveredAt = now;
  order.deliveredBy = req.user._id;
  order.deliveryProofUrl = cleanImage(body.deliveryProofUrl);
  order.deliveryNote = cleanText(body.deliveryNote, 500);
  order.assignmentHistory.push({ action: 'DELIVERED', partnerId: String(req.user._id), partnerName: req.user.name, ...actorOf(req) });
  pushStatus(order, 'DELIVERED', req, order.deliveryNote || 'Delivered');
  order.trackingNote = 'Delivered.';
  if (order.expectedCollection > 0) {
    const short = order.amountCollected < order.expectedCollection;
    payments.recomputePayment(order, req, short
      ? `Short collection: cash ₹${order.amountCollected} of ₹${order.expectedCollection}`
      : `Cash ₹${order.amountCollected} collected`);
  } else {
    payments.recomputePayment(order, req);
  }
  await saveOrder(order);
  await auditOrder(req, order, 'ORDER_DELIVERED', {
    fromStatus: 'OUT_FOR_DELIVERY',
    toStatus: 'DELIVERED',
    metadata: { amountCollected: order.amountCollected, expected: order.expectedCollection, collectionStatus: order.collectionStatus },
  });
  return order;
};

const partnerFail = async (req, id, { reason }) => {
  const clean = requireReason(reason);
  const order = await loadOrder(id);
  assertOwnAssignment(order, req.user);
  assertStatus(order, ['OUT_FOR_DELIVERY']);
  order.failureReason = clean;
  order.failedAt = new Date();
  order.assignmentHistory.push({ action: 'FAILED', partnerId: String(req.user._id), partnerName: req.user.name, reason: clean, ...actorOf(req) });
  pushStatus(order, 'DELIVERY_FAILED', req, clean);
  order.trackingNote = `Delivery attempt failed: ${clean}`;
  await saveOrder(order);
  await auditOrder(req, order, 'DELIVERY_FAILED', { fromStatus: 'OUT_FOR_DELIVERY', toStatus: 'DELIVERY_FAILED', reason: clean });
  return order;
};

/** Return every not-yet-picked-up order of a partner to the pool (offline / suspended). */
const releaseOrdersOfPartner = async (req, partner, reason) => {
  const orders = await Order.find({ assignedPartnerId: partner._id, status: 'ASSIGNED' });
  for (const order of orders) {
    order.assignmentHistory.push({ action: 'UNAVAILABLE', partnerId: String(partner._id), partnerName: partner.name, reason, ...actorOf(req) });
    clearAssignment(order);
    pushStatus(order, 'APPROVED', req, reason);
    order.trackingNote = 'Waiting for a delivery partner.';
    // eslint-disable-next-line no-await-in-loop
    await saveOrder(order);
    // eslint-disable-next-line no-await-in-loop
    await auditOrder(req, order, 'DELIVERY_RELEASED', { fromStatus: 'ASSIGNED', toStatus: 'APPROVED', reason });
  }
  return orders.length;
};

// ─── Payments ────────────────────────────────────────────────────────────────

const assertOnlinePaymentsOpen = async () => {
  const settings = await getSettings();
  if (!settings.onlineEnabled || !settings.upiQrImage) throw new AppError(400, 'PAYMENT_METHOD_DISABLED');
};

/** Farmer reports a (further) QR payment for an order: any amount up to what is still open. */
const submitPaymentReference = async (req, id, { paymentReference, amount }) => {
  const order = await loadOrder(id);
  if (String(order.farmerId) !== String(req.user._id)) throw new AppError(404, 'ORDER_NOT_FOUND');
  if (['REJECTED', 'CANCELLED'].includes(order.status)) throw new AppError(409, 'ORDER_TRANSITION_INVALID', { status: order.status });
  await assertOnlinePaymentsOpen();
  const from = order.paymentStatus;
  const entry = await payments.addFarmerPayment(req, order, { paymentReference, amount });
  await saveOrder(order);
  await auditOrder(req, order, 'PAYMENT_REFERENCE_SUBMITTED', { fromStatus: from, toStatus: order.paymentStatus, metadata: { reference: entry.reference, amount: entry.amount, entryId: String(entry._id) } });
  return order;
};

/** Accounts team: confirm (with the amount received) or reject one reported QR payment. */
const reviewPaymentEntry = async (req, id, entryId, body) => {
  const order = await loadOrder(id);
  const entry = payments.findEntry(order, entryId);
  const from = order.paymentStatus;
  payments.reviewEntry(req, order, entry, body || {});
  await saveOrder(order);
  await auditOrder(req, order, entry.status === 'CONFIRMED' ? 'PAYMENT_VERIFIED' : 'PAYMENT_REJECTED', {
    fromStatus: from,
    toStatus: order.paymentStatus,
    reason: entry.rejectReason || '',
    metadata: { entryId: String(entry._id), reference: entry.reference, reported: entry.amount, confirmed: entry.confirmedAmount },
  });
  return order;
};

/** Older clients: review the oldest waiting payment of the order. */
const verifyPayment = async (req, id, body) => {
  const order = await loadOrder(id);
  const entry = (order.payments || []).find((p) => p.status === 'PENDING');
  if (!entry) throw new AppError(409, 'PAYMENT_NOT_AWAITING');
  return reviewPaymentEntry(req, id, entry._id, body);
};

/** Super Admin: correct an entry (amount / status) with a reason. */
const editPaymentEntry = async (req, id, entryId, body) => {
  const order = await loadOrder(id);
  const entry = payments.findEntry(order, entryId);
  const from = order.paymentStatus;
  payments.editEntry(req, order, entry, body || {});
  await saveOrder(order);
  const edit = entry.edits[entry.edits.length - 1];
  await auditOrder(req, order, 'PAYMENT_EDITED', {
    fromStatus: from,
    toStatus: order.paymentStatus,
    reason: edit.reason,
    metadata: { entryId: String(entry._id), fromAmount: edit.fromAmount, toAmount: edit.toAmount, fromEntryStatus: edit.fromStatus, toEntryStatus: edit.toStatus },
  });
  return order;
};

/** Super Admin: record a payment received outside the app (e.g. reported on the helpline). */
const addManualPayment = async (req, id, body) => {
  const order = await loadOrder(id);
  if (['REJECTED', 'CANCELLED'].includes(order.status)) throw new AppError(409, 'ORDER_TRANSITION_INVALID', { status: order.status });
  const from = order.paymentStatus;
  const entry = await payments.addManualEntry(req, order, body || {});
  await saveOrder(order);
  await auditOrder(req, order, 'PAYMENT_RECORDED', { fromStatus: from, toStatus: order.paymentStatus, reason: entry.note, metadata: { entryId: String(entry._id), amount: entry.confirmedAmount, reference: entry.reference } });
  return order;
};

const recordRefund = async (req, id, { refundReference, amount, reason }) => {
  const order = await loadOrder(id);
  if (order.paymentStatus !== 'REFUND_PENDING') throw new AppError(409, 'REFUND_NOT_APPLICABLE');
  const refundAmount = amount !== undefined && amount !== '' ? toMoney(amount) : order.refundAmount || order.totalAmount;
  if (!(refundAmount > 0)) throw new AppError(400, 'VALIDATION_FAILED');
  order.refundAmount = refundAmount;
  order.refundReference = cleanText(refundReference, 60);
  order.refundReason = cleanText(reason, 300);
  order.refundedAt = new Date();
  order.refundedBy = String(req.user._id);
  pushPayment(order, 'REFUNDED', req, `Refund ₹${refundAmount}${order.refundReference ? ` ref ${order.refundReference}` : ''}`);
  await saveOrder(order);
  await auditOrder(req, order, 'PAYMENT_REFUNDED', { fromStatus: 'REFUND_PENDING', toStatus: 'REFUNDED', reason: order.refundReason, metadata: { amount: refundAmount, reference: order.refundReference } });
  return order;
};

module.exports = {
  STOCK_HELD,
  placeOrder,
  recordVerification,
  approveOrder,
  rejectOrder,
  cancelOrder,
  acceptFromPool,
  adminAssign,
  adminRelease,
  partnerUnavailable,
  partnerPickup,
  partnerDeliver,
  partnerFail,
  releaseOrdersOfPartner,
  submitPaymentReference,
  verifyPayment,
  reviewPaymentEntry,
  editPaymentEntry,
  addManualPayment,
  recordRefund,
  loadOrder,
  saveOrder,
  actorOf,
  pushStatus,
  pushPayment,
};
