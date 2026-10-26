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

const settlePaymentOnTermination = (order, req) => {
  if (order.paymentStatus === 'PAID') {
    pushPayment(order, 'REFUND_PENDING', req, 'Order did not complete; refund due');
    order.refundAmount = order.totalAmount;
  } else if (order.paymentStatus === 'PENDING' || order.paymentStatus === 'FAILED') {
    pushPayment(order, 'CANCELLED', req, 'No payment due');
  }
  // AWAITING_VERIFICATION stays as-is: the admin still verifies whether money arrived; if it did,
  // verification moves it straight to REFUND_PENDING.
  order.expectedCollection = 0;
  if (order.collectionStatus === 'PENDING') order.collectionStatus = 'NOT_APPLICABLE';
};

const clearAssignment = (order) => {
  order.assignedPartnerId = null;
  order.assignedPartnerName = '';
  order.assignedPartnerPhone = '';
  order.assignedAt = null;
  order.assignedBy = '';
  order.assignedByName = '';
};

// ─── Farmer: place order ─────────────────────────────────────────────────────

// UPI transaction reference (UTR / RRN) is always 12 digits.
const PAYMENT_REF_RE = /^\d{12}$/;

const normalizeReference = (value) => cleanText(value, 60).replace(/\s+/g, '').toUpperCase();

const assertReferenceUnused = async (reference, excludeOrderId) => {
  const filter = { paymentReference: reference };
  if (excludeOrderId) filter._id = { $ne: excludeOrderId };
  if (await Order.exists(filter)) throw new AppError(400, 'PAYMENT_REFERENCE_USED');
};

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
  if ((paymentMethod === 'COD' && !settings.codEnabled) || (paymentMethod === 'ONLINE' && !settings.onlineEnabled)) {
    throw new AppError(400, 'PAYMENT_METHOD_DISABLED');
  }

  let paymentReference = '';
  if (paymentMethod === 'ONLINE') {
    paymentReference = normalizeReference(body.paymentReference);
    if (!paymentReference) throw new AppError(400, 'PAYMENT_REFERENCE_REQUIRED');
    if (!PAYMENT_REF_RE.test(paymentReference)) throw new AppError(400, 'PAYMENT_REFERENCE_INVALID');
    await assertReferenceUnused(paymentReference);
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
      paymentStatus: paymentMethod === 'ONLINE' ? 'AWAITING_VERIFICATION' : 'PENDING',
      paymentReference,
      paymentSubmittedAt: paymentMethod === 'ONLINE' ? now : null,
      paymentHistory: [{
        status: paymentMethod === 'ONLINE' ? 'AWAITING_VERIFICATION' : 'PENDING',
        at: now,
        ...actorOf(req),
        note: paymentMethod === 'ONLINE' ? `Reference ${paymentReference} submitted` : 'Cash on delivery',
      }],
      expectedCollection: paymentMethod === 'COD' ? quote.totalAmount : 0,
      collectionStatus: paymentMethod === 'COD' ? 'PENDING' : 'NOT_APPLICABLE',
      settlementStatus: 'NOT_APPLICABLE',
      idempotencyKey,
    });
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

  if (order.paymentMethod === 'COD') {
    const collected = Number(body.amountCollected);
    if (body.amountCollected === undefined || body.amountCollected === null || body.amountCollected === '' || !Number.isFinite(collected) || collected < 0) {
      throw new AppError(400, 'COLLECTION_AMOUNT_INVALID');
    }
    order.amountCollected = toMoney(collected);
    order.collectedAt = now;
    order.collectionNote = cleanText(body.collectionNote, 300);
    if (order.amountCollected === toMoney(order.expectedCollection)) {
      order.collectionStatus = 'COLLECTED';
      pushPayment(order, 'PAID', req, `Cash ₹${order.amountCollected} collected`);
      order.paidAt = now;
    } else {
      // Short or excess collection is flagged for the admin to reconcile.
      order.collectionStatus = 'DISPUTED';
      if (order.amountCollected >= order.totalAmount) {
        pushPayment(order, 'PAID', req, `Cash ₹${order.amountCollected} collected (expected ₹${order.expectedCollection})`);
        order.paidAt = now;
      } else {
        order.paymentHistory.push({ status: order.paymentStatus, at: now, ...actorOf(req), note: `Short collection: ₹${order.amountCollected} of ₹${order.expectedCollection}` });
      }
    }
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

const submitPaymentReference = async (req, id, { paymentReference }) => {
  const order = await loadOrder(id);
  if (String(order.farmerId) !== String(req.user._id)) throw new AppError(404, 'ORDER_NOT_FOUND');
  if (order.paymentMethod !== 'ONLINE' || !['PENDING', 'FAILED'].includes(order.paymentStatus)
    || ['REJECTED', 'CANCELLED'].includes(order.status)) {
    throw new AppError(409, 'ORDER_TRANSITION_INVALID', { status: order.paymentStatus });
  }
  const reference = normalizeReference(paymentReference);
  if (!reference) throw new AppError(400, 'PAYMENT_REFERENCE_REQUIRED');
  if (!PAYMENT_REF_RE.test(reference)) throw new AppError(400, 'PAYMENT_REFERENCE_INVALID');
  await assertReferenceUnused(reference, order._id);
  const from = order.paymentStatus;
  order.paymentReference = reference;
  order.paymentSubmittedAt = new Date();
  order.paymentFailureReason = '';
  pushPayment(order, 'AWAITING_VERIFICATION', req, `Reference ${reference} submitted`);
  await saveOrder(order);
  await auditOrder(req, order, 'PAYMENT_REFERENCE_SUBMITTED', { fromStatus: from, toStatus: 'AWAITING_VERIFICATION', metadata: { reference } });
  return order;
};

const verifyPayment = async (req, id, { approved, reason }) => {
  const order = await loadOrder(id);
  if (order.paymentStatus !== 'AWAITING_VERIFICATION') throw new AppError(409, 'PAYMENT_NOT_AWAITING');
  const now = new Date();
  if (approved === true || approved === 'true') {
    order.paymentVerifiedBy = String(req.user._id);
    order.paymentVerifiedByName = req.user.name || req.user.username;
    order.paidAt = now;
    if (['REJECTED', 'CANCELLED'].includes(order.status)) {
      order.refundAmount = order.totalAmount;
      pushPayment(order, 'REFUND_PENDING', req, 'Payment verified on a cancelled order; refund due');
    } else {
      pushPayment(order, 'PAID', req, `Verified reference ${order.paymentReference}`);
    }
    await saveOrder(order);
    await auditOrder(req, order, 'PAYMENT_VERIFIED', { fromStatus: 'AWAITING_VERIFICATION', toStatus: order.paymentStatus, metadata: { reference: order.paymentReference } });
  } else {
    const clean = requireReason(reason);
    order.paymentFailureReason = clean;
    order.paymentVerifiedBy = String(req.user._id);
    order.paymentVerifiedByName = req.user.name || req.user.username;
    const terminal = ['REJECTED', 'CANCELLED'].includes(order.status);
    pushPayment(order, terminal ? 'CANCELLED' : 'FAILED', req, clean);
    await saveOrder(order);
    await auditOrder(req, order, 'PAYMENT_REJECTED', { fromStatus: 'AWAITING_VERIFICATION', toStatus: order.paymentStatus, reason: clean });
  }
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
  recordRefund,
  loadOrder,
  saveOrder,
  actorOf,
  pushStatus,
  pushPayment,
};
