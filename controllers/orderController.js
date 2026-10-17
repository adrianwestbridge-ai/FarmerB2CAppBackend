const Order = require('../models/Order');
const { AppError, t } = require('../utils/i18n');
const { hasPermission, PERMISSIONS } = require('../utils/permissions');
const { requireValidId, escapeRegex, parseDate, cleanText } = require('../utils/validators');
const { priceCart } = require('../services/pricingService');
const svc = require('../services/orderService');

// ─── Role-aware serialization ────────────────────────────────────────────────

const stripActor = (entry) => {
  const { byId, byName, ...rest } = entry;
  return rest;
};

const serializeOrder = (order, userType) => {
  const o = typeof order.toObject === 'function' ? order.toObject() : { ...order };
  delete o.idempotencyKey;
  delete o.__v;
  if (userType === 'farmer') {
    delete o.verificationCalls;
    delete o.assignmentHistory;
    delete o.decisionBy;
    delete o.paymentVerifiedBy;
    delete o.refundedBy;
    delete o.cancelledBy;
    delete o.settlementId;
    o.statusHistory = (o.statusHistory || []).map(stripActor);
    o.paymentHistory = (o.paymentHistory || []).map(stripActor);
  } else if (userType === 'partner') {
    delete o.verificationCalls;
    delete o.decisionBy;
    delete o.paymentVerifiedBy;
    delete o.refundedBy;
    delete o.cancelledBy;
    o.paymentHistory = (o.paymentHistory || []).map(stripActor);
  }
  return o;
};

// ─── Access control for a single order ───────────────────────────────────────

const canView = (req, order) => {
  if (req.userType === 'admin') return true;
  if (req.userType === 'farmer') return String(order.farmerId) === String(req.user._id);
  if (req.userType === 'partner') {
    const me = String(req.user._id);
    return order.status === 'APPROVED'
      || String(order.assignedPartnerId || '') === me
      || String(order.deliveredBy || '') === me;
  }
  return false;
};

// ─── Queries ─────────────────────────────────────────────────────────────────

const STATUS_GROUPS = {
  ACTIVE: ['PENDING_APPROVAL', 'APPROVED', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED'],
  CLOSED: ['DELIVERED', 'REJECTED', 'CANCELLED'],
};

const statusFilter = (raw) => {
  if (!raw) return null;
  const parts = String(raw).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    .flatMap((s) => STATUS_GROUPS[s] || [s]);
  const valid = parts.filter((s) => Order.ORDER_STATUSES.includes(s));
  return valid.length ? { $in: valid } : null;
};

const listFilter = (req) => {
  const q = req.query || {};
  const filter = {};
  const status = statusFilter(q.status);
  if (status) filter.status = status;

  if (q.paymentStatus && Order.PAYMENT_STATUSES.includes(String(q.paymentStatus).toUpperCase())) {
    filter.paymentStatus = String(q.paymentStatus).toUpperCase();
  }
  if (q.paymentMethod && ['COD', 'ONLINE'].includes(String(q.paymentMethod).toUpperCase())) {
    filter.paymentMethod = String(q.paymentMethod).toUpperCase();
  }
  if (q.collectionStatus && Order.COLLECTION_STATUSES.includes(String(q.collectionStatus).toUpperCase())) {
    filter.collectionStatus = String(q.collectionStatus).toUpperCase();
  }
  if (q.settlementStatus && Order.SETTLEMENT_STATUSES.includes(String(q.settlementStatus).toUpperCase())) {
    filter.settlementStatus = String(q.settlementStatus).toUpperCase();
  }
  const from = parseDate(q.from);
  const to = parseDate(q.to, true);
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }
  return filter;
};

// @route GET /api/orders
exports.getOrders = async (req, res) => {
  const q = req.query || {};
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const page = Math.max(1, Number(q.page) || 1);
  const filter = listFilter(req);

  if (req.userType === 'farmer') {
    filter.farmerId = req.user._id;
  } else if (req.userType === 'partner') {
    const me = req.user._id;
    const scope = String(q.scope || 'all').toLowerCase();
    if (scope === 'pool') {
      filter.status = 'APPROVED';
    } else if (scope === 'mine') {
      filter.$or = [{ assignedPartnerId: me }, { deliveredBy: me }];
    } else {
      filter.$or = [{ status: 'APPROVED' }, { assignedPartnerId: me }, { deliveredBy: me }];
    }
  } else {
    if (q.partnerId) filter.$or = [{ assignedPartnerId: requireValidId(q.partnerId) }, { deliveredBy: q.partnerId }];
    if (q.farmerId) filter.farmerId = requireValidId(q.farmerId);
    if (q.search) {
      const rx = new RegExp(escapeRegex(cleanText(q.search, 60)), 'i');
      const searchOr = [{ orderNumber: rx }, { farmerName: rx }, { farmerPhone: rx }, { paymentReference: rx }];
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: searchOr }];
        delete filter.$or;
      } else {
        filter.$or = searchOr;
      }
    }
  }

  // Oldest first for the approval queue, newest first otherwise.
  const sort = String(q.sort || '') === 'oldest' ? { createdAt: 1 } : { createdAt: -1 };
  const [orders, total] = await Promise.all([
    Order.find(filter).sort(sort).skip((page - 1) * limit).limit(limit),
    Order.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    count: orders.length,
    total,
    page,
    pages: Math.ceil(total / limit),
    data: orders.map((o) => serializeOrder(o, req.userType)),
  });
};

// @route GET /api/orders/counts  (admin) — badge counts for the dashboard
exports.getOrderCounts = async (req, res) => {
  const rows = await Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
  const byStatus = Object.fromEntries(Order.ORDER_STATUSES.map((s) => [s, 0]));
  rows.forEach((r) => { byStatus[r._id] = r.count; });
  const [awaitingPayment, refundsPending] = await Promise.all([
    Order.countDocuments({ paymentStatus: 'AWAITING_VERIFICATION' }),
    Order.countDocuments({ paymentStatus: 'REFUND_PENDING' }),
  ]);
  res.status(200).json({ success: true, data: { byStatus, awaitingPayment, refundsPending } });
};

// @route GET /api/orders/:id
exports.getOrderById = async (req, res) => {
  const order = await svc.loadOrder(req.params.id);
  if (!canView(req, order)) throw new AppError(404, 'ORDER_NOT_FOUND');
  res.status(200).json({ success: true, data: serializeOrder(order, req.userType) });
};

// ─── Farmer ──────────────────────────────────────────────────────────────────

// @route POST /api/orders/quote — price breakdown for the cart / checkout screen
exports.quote = async (req, res) => {
  const quote = await priceCart((req.body || {}).items, { strict: false });
  res.status(200).json({ success: true, data: quote });
};

// @route POST /api/orders
exports.createOrder = async (req, res) => {
  try {
    const { order, duplicate } = await svc.placeOrder(req, req.body || {});
    res.status(duplicate ? 200 : 201).json({
      success: true,
      duplicate,
      message: duplicate ? t(req, 'ORDER_DUPLICATE') : undefined,
      data: serializeOrder(order, 'farmer'),
    });
  } catch (err) {
    if (err instanceof AppError && err.key === 'PRICE_CHANGED') {
      return res.status(409).json({ success: false, code: 'PRICE_CHANGED', message: t(req, 'PRICE_CHANGED'), data: err.data });
    }
    throw err;
  }
};

// @route PATCH /api/orders/:id/payment-reference
exports.submitPaymentReference = async (req, res) => {
  const order = await svc.submitPaymentReference(req, req.params.id, req.body || {});
  res.status(200).json({ success: true, data: serializeOrder(order, req.userType) });
};

// @route PATCH /api/orders/:id/cancel  (farmer: own order; admin: ORDERS_APPROVE)
exports.cancelOrder = async (req, res) => {
  if (req.userType === 'admin' && !hasPermission(req.user, PERMISSIONS.ORDERS_APPROVE)) {
    throw new AppError(403, 'AUTH_FORBIDDEN');
  }
  if (req.userType === 'partner') throw new AppError(403, 'AUTH_FORBIDDEN');
  const order = await svc.cancelOrder(req, req.params.id, req.body || {});
  res.status(200).json({ success: true, data: serializeOrder(order, req.userType) });
};

// ─── Admin ───────────────────────────────────────────────────────────────────

const respond = (fn) => async (req, res) => {
  const order = await fn(req, req.params.id, req.body || {});
  res.status(200).json({ success: true, data: serializeOrder(order, req.userType) });
};

exports.recordVerification = respond(svc.recordVerification);
exports.approveOrder = respond(svc.approveOrder);
exports.rejectOrder = respond(svc.rejectOrder);
exports.assignPartner = respond(svc.adminAssign);
exports.releaseOrder = respond(svc.adminRelease);
exports.verifyPayment = respond(svc.verifyPayment);
exports.recordRefund = respond(svc.recordRefund);

// ─── Delivery partner ────────────────────────────────────────────────────────

exports.acceptOrder = respond((req, id) => svc.acceptFromPool(req, id));
exports.reportUnavailable = respond(svc.partnerUnavailable);
exports.pickupOrder = respond((req, id) => svc.partnerPickup(req, id));
exports.completeDelivery = respond(svc.partnerDeliver);
exports.failDelivery = respond(svc.partnerFail);

exports.serializeOrder = serializeOrder;
