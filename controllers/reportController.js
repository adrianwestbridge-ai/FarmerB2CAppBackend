const mongoose = require('mongoose');
const Order = require('../models/Order');
const Admin = require('../models/Admin');
const AuditLog = require('../models/AuditLog');
const Settlement = require('../models/Settlement');
const { AppError } = require('../utils/i18n');
const { isValidId, parseDate, escapeRegex, cleanText, toMoney } = require('../utils/validators');

const TZ = '+05:30';
const oid = (id) => new mongoose.Types.ObjectId(String(id));

// ─── Filters ─────────────────────────────────────────────────────────────────

const dateRange = (q) => {
  const from = parseDate(q.from);
  const to = parseDate(q.to, true);
  if (q.from && !from) throw new AppError(400, 'VALIDATION_FAILED');
  if (q.to && !to) throw new AppError(400, 'VALIDATION_FAILED');
  if (!from && !to) return null;
  const range = {};
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  return range;
};

const upperIn = (value, allowed) => {
  if (!value) return null;
  const list = String(value).split(',').map((s) => s.trim().toUpperCase()).filter((s) => allowed.includes(s));
  return list.length ? { $in: list } : null;
};

/** Order match stage shared by every order-based report. */
const orderMatch = (q) => {
  const match = {};
  const range = dateRange(q);
  if (range) match.createdAt = range;
  const status = upperIn(q.status, Order.ORDER_STATUSES);
  if (status) match.status = status;
  const pm = upperIn(q.paymentMethod, ['COD', 'ONLINE']);
  if (pm) match.paymentMethod = pm;
  const ps = upperIn(q.paymentStatus, Order.PAYMENT_STATUSES);
  if (ps) match.paymentStatus = ps;
  const ss = upperIn(q.settlementStatus, Order.SETTLEMENT_STATUSES);
  if (ss) match.settlementStatus = ss;
  if (q.farmerId && isValidId(q.farmerId)) match.farmerId = oid(q.farmerId);
  if (q.partnerId && isValidId(q.partnerId)) match.$or = [{ assignedPartnerId: oid(q.partnerId) }, { deliveredBy: oid(q.partnerId) }];
  if (q.adminId && isValidId(q.adminId)) match.decisionBy = String(q.adminId);
  if (q.orderNumber) match.orderNumber = new RegExp(escapeRegex(cleanText(q.orderNumber, 40)), 'i');
  if (q.offerId && isValidId(q.offerId)) match['items.offerId'] = oid(q.offerId);
  if (q.productId && isValidId(q.productId)) match['items.productId'] = oid(q.productId);
  return match;
};

// ─── CSV ─────────────────────────────────────────────────────────────────────

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const sendCsv = (res, filename, columns, rows) => {
  // The Excel export runs the same report handlers and takes the table instead of CSV text.
  if (typeof res.captureTable === 'function') return res.captureTable({ filename, columns, rows });
  const header = columns.map((c) => csvCell(c.label)).join(',');
  const lines = rows.map((r) => columns.map((c) => csvCell(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(`﻿${[header, ...lines].join('\r\n')}`);
};

const wantsCsv = (req) => String(req.query.format || '').toLowerCase() === 'csv';

// ─── Summary dashboard ───────────────────────────────────────────────────────

const NOT_TERMINATED = { $nin: ['REJECTED', 'CANCELLED'] };

// @route GET /api/reports/summary
exports.summary = async (req, res) => {
  const match = orderMatch(req.query);

  const [facet] = await Order.aggregate([
    { $match: match },
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$totalAmount' } } }],
        accepted: [{ $match: { approvedAt: { $ne: null } } }, { $count: 'count' }],
        totals: [{
          $group: {
            _id: null,
            orders: { $sum: 1 },
            orderValue: { $sum: '$totalAmount' },
            activeOrderValue: { $sum: { $cond: [{ $in: ['$status', ['REJECTED', 'CANCELLED']] }, 0, '$totalAmount'] } },
            mrpValue: { $sum: { $cond: [{ $in: ['$status', ['REJECTED', 'CANCELLED']] }, 0, '$mrpTotal'] } },
            discounts: { $sum: { $cond: [{ $in: ['$status', ['REJECTED', 'CANCELLED']] }, 0, '$discount'] } },
            deliveryCharges: { $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, '$deliveryCharge', 0] } },
            completedSales: { $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, '$totalAmount', 0] } },
            codCollected: { $sum: { $cond: [{ $eq: ['$paymentMethod', 'COD'] }, '$amountCollected', 0] } },
            onlineCollected: {
              $sum: { $cond: [{ $and: [{ $eq: ['$paymentMethod', 'ONLINE'] }, { $in: ['$paymentStatus', ['PAID', 'REFUND_PENDING', 'REFUNDED']] }] }, '$totalAmount', 0] },
            },
            refunded: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'REFUNDED'] }, '$refundAmount', 0] } },
            refundsPending: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'REFUND_PENDING'] }, '$refundAmount', 0] } },
            pendingPayments: {
              $sum: {
                $cond: [
                  { $and: [{ $in: ['$paymentStatus', ['PENDING', 'AWAITING_VERIFICATION', 'FAILED']] }, { $not: [{ $in: ['$status', ['REJECTED', 'CANCELLED']] }] }] },
                  { $subtract: ['$totalAmount', '$amountCollected'] },
                  0,
                ],
              },
            },
            awaitingVerification: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'AWAITING_VERIFICATION'] }, 1, 0] } },
            pendingHandover: { $sum: { $cond: [{ $eq: ['$settlementStatus', 'PENDING'] }, '$amountCollected', 0] } },
            submittedSettlement: { $sum: { $cond: [{ $eq: ['$settlementStatus', 'SUBMITTED'] }, '$amountCollected', 0] } },
            disputedSettlement: { $sum: { $cond: [{ $eq: ['$settlementStatus', 'DISPUTED'] }, '$amountCollected', 0] } },
            verifiedSettlement: { $sum: { $cond: [{ $eq: ['$settlementStatus', 'VERIFIED'] }, '$amountCollected', 0] } },
            shortCollections: { $sum: { $cond: [{ $eq: ['$collectionStatus', 'DISPUTED'] }, 1, 0] } },
          },
        }],
        byPaymentMode: [{
          $group: {
            _id: '$paymentMethod',
            orders: { $sum: 1 },
            value: { $sum: { $cond: [{ $in: ['$status', ['REJECTED', 'CANCELLED']] }, 0, '$totalAmount'] } },
            collected: {
              $sum: {
                $cond: [
                  { $eq: ['$paymentMethod', 'COD'] },
                  '$amountCollected',
                  { $cond: [{ $in: ['$paymentStatus', ['PAID', 'REFUND_PENDING', 'REFUNDED']] }, '$totalAmount', 0] },
                ],
              },
            },
            pending: {
              $sum: {
                $cond: [
                  { $and: [{ $in: ['$paymentStatus', ['PENDING', 'AWAITING_VERIFICATION', 'FAILED']] }, { $not: [{ $in: ['$status', ['REJECTED', 'CANCELLED']] }] }] },
                  { $subtract: ['$totalAmount', '$amountCollected'] },
                  0,
                ],
              },
            },
          },
        }],
        daily: [
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } },
              orders: { $sum: 1 },
              value: { $sum: '$totalAmount' },
              discount: { $sum: { $cond: [{ $in: ['$status', ['REJECTED', 'CANCELLED']] }, 0, '$discount'] } },
              delivered: { $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, 1, 0] } },
              rejected: { $sum: { $cond: [{ $eq: ['$status', 'REJECTED'] }, 1, 0] } },
              cancelled: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } },
              sales: { $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, '$totalAmount', 0] } },
            },
          },
          { $sort: { _id: 1 } },
        ],
      },
    },
  ]);

  const byStatus = Object.fromEntries(Order.ORDER_STATUSES.map((s) => [s, { count: 0, value: 0 }]));
  facet.byStatus.forEach((r) => { byStatus[r._id] = { count: r.count, value: toMoney(r.value) }; });
  const tot = facet.totals[0] || {};
  const m = (k) => toMoney(tot[k] || 0);

  const data = {
    filters: req.query,
    orders: {
      total: tot.orders || 0,
      accepted: facet.accepted[0] ? facet.accepted[0].count : 0,
      pendingApproval: byStatus.PENDING_APPROVAL.count,
      rejected: byStatus.REJECTED.count,
      cancelled: byStatus.CANCELLED.count,
      delivered: byStatus.DELIVERED.count,
      deliveryFailed: byStatus.DELIVERY_FAILED.count,
      inProgress: byStatus.APPROVED.count + byStatus.ASSIGNED.count + byStatus.OUT_FOR_DELIVERY.count,
      byStatus,
    },
    // Order value, completed sales, collected payments, refunds and settlements are reported
    // separately on purpose: they answer different questions and must not be mixed.
    financial: {
      orderValue: m('orderValue'),               // everything placed (incl. later rejected/cancelled)
      activeOrderValue: m('activeOrderValue'),   // excluding rejected / cancelled
      mrpValue: m('mrpValue'),
      discounts: m('discounts'),
      completedSales: m('completedSales'),       // delivered orders
      deliveryCharges: m('deliveryCharges'),
      collected: {
        cod: m('codCollected'),
        online: m('onlineCollected'),
        total: toMoney((tot.codCollected || 0) + (tot.onlineCollected || 0)),
      },
      pendingPayments: m('pendingPayments'),
      awaitingVerification: tot.awaitingVerification || 0,
      refunds: { refunded: m('refunded'), pending: m('refundsPending') },
      settlements: {
        pendingHandover: m('pendingHandover'),
        submitted: m('submittedSettlement'),
        disputed: m('disputedSettlement'),
        verified: m('verifiedSettlement'),
        outstanding: toMoney((tot.pendingHandover || 0) + (tot.submittedSettlement || 0) + (tot.disputedSettlement || 0)),
        shortCollections: tot.shortCollections || 0,
      },
    },
    byPaymentMode: facet.byPaymentMode.map((r) => ({
      paymentMethod: r._id,
      orders: r.orders,
      value: toMoney(r.value),
      collected: toMoney(r.collected),
      pending: toMoney(r.pending),
    })),
    daily: facet.daily.map((d) => ({
      date: d._id,
      orders: d.orders,
      value: toMoney(d.value),
      discount: toMoney(d.discount),
      delivered: d.delivered,
      rejected: d.rejected,
      cancelled: d.cancelled,
      sales: toMoney(d.sales),
    })),
  };

  if (wantsCsv(req)) {
    return sendCsv(res, 'daily-summary.csv', [
      { label: 'Date', value: 'date' },
      { label: 'Orders', value: 'orders' },
      { label: 'Order value (INR)', value: 'value' },
      { label: 'Discount (INR)', value: 'discount' },
      { label: 'Delivered', value: 'delivered' },
      { label: 'Completed sales (INR)', value: 'sales' },
      { label: 'Rejected', value: 'rejected' },
      { label: 'Cancelled', value: 'cancelled' },
    ], data.daily);
  }
  res.status(200).json({ success: true, data });
};

// ─── Order list ──────────────────────────────────────────────────────────────

// @route GET /api/reports/orders
exports.orders = async (req, res) => {
  const match = orderMatch(req.query);
  const csv = wantsCsv(req);
  const limit = csv ? 10000 : Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const page = csv ? 1 : Math.max(1, Number(req.query.page) || 1);
  const [orders, total] = await Promise.all([
    Order.find(match).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Order.countDocuments(match),
  ]);

  if (csv) {
    return sendCsv(res, 'orders.csv', [
      { label: 'Order ID', value: 'orderNumber' },
      { label: 'Placed at', value: 'createdAt' },
      { label: 'Status', value: 'status' },
      { label: 'Farmer', value: 'farmerName' },
      { label: 'Farmer mobile', value: 'farmerPhone' },
      { label: 'Items', value: (o) => o.items.map((i) => `${i.productName} x${i.quantity}`).join('; ') },
      { label: 'Subtotal (INR)', value: 'subtotal' },
      { label: 'Discount (INR)', value: 'discount' },
      { label: 'Delivery (INR)', value: 'deliveryCharge' },
      { label: 'Total (INR)', value: 'totalAmount' },
      { label: 'Payment mode', value: 'paymentMethod' },
      { label: 'Payment status', value: 'paymentStatus' },
      { label: 'Payment reference', value: 'paymentReference' },
      { label: 'Approved/Rejected by', value: 'decisionByName' },
      { label: 'Decision at', value: 'decisionAt' },
      { label: 'Rejection reason', value: 'rejectionReason' },
      { label: 'Cancel reason', value: 'cancelReason' },
      { label: 'Delivery partner', value: 'assignedPartnerName' },
      { label: 'Delivered at', value: 'deliveredAt' },
      { label: 'Cash expected (INR)', value: 'expectedCollection' },
      { label: 'Cash collected (INR)', value: 'amountCollected' },
      { label: 'Collection status', value: 'collectionStatus' },
      { label: 'Settlement status', value: 'settlementStatus' },
      { label: 'Refund (INR)', value: 'refundAmount' },
    ], orders);
  }
  res.status(200).json({ success: true, total, page, pages: Math.ceil(total / limit), data: orders });
};

// ─── Admin activity (approvals / rejections / assignments / offers) ─────────

const ADMIN_ACTIONS = {
  approved: 'ORDER_APPROVED',
  rejected: 'ORDER_REJECTED',
  cancelled: 'ORDER_CANCELLED',
  verificationCalls: 'ORDER_VERIFICATION_RECORDED',
  assigned: 'DELIVERY_ASSIGNED',
  reassigned: 'DELIVERY_REASSIGNED',
  released: 'DELIVERY_RELEASED',
  paymentsVerified: 'PAYMENT_VERIFIED',
  paymentsRejected: 'PAYMENT_REJECTED',
  refunds: 'PAYMENT_REFUNDED',
  offersCreated: 'OFFER_CREATED',
  offersUpdated: 'OFFER_UPDATED',
  offersActivated: 'OFFER_ACTIVATED',
  offersDeactivated: 'OFFER_DEACTIVATED',
  settlementsVerified: 'SETTLEMENT_VERIFIED',
  settlementsDisputed: 'SETTLEMENT_DISPUTED',
};

const ADMIN_ACTION_LABELS = {
  approved: 'Orders approved', rejected: 'Orders rejected', cancelled: 'Orders cancelled',
  verificationCalls: 'Verification calls recorded', assigned: 'Deliveries assigned', reassigned: 'Deliveries reassigned',
  released: 'Returned to pool', paymentsVerified: 'Payments verified', paymentsRejected: 'Payments rejected',
  refunds: 'Refunds recorded', offersCreated: 'Offers created', offersUpdated: 'Offers edited',
  offersActivated: 'Offers activated', offersDeactivated: 'Offers deactivated',
  settlementsVerified: 'Settlements verified', settlementsDisputed: 'Settlements disputed',
};

// @route GET /api/reports/admins
exports.adminActivity = async (req, res) => {
  const match = { actorRole: { $in: ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'] }, action: { $in: Object.values(ADMIN_ACTIONS) } };
  const range = dateRange(req.query);
  if (range) match.createdAt = range;
  if (req.query.adminId && isValidId(req.query.adminId)) match.actorId = String(req.query.adminId);

  const rows = await AuditLog.aggregate([
    { $match: match },
    { $group: { _id: { actorId: '$actorId', action: '$action' }, count: { $sum: 1 }, name: { $last: '$actorName' }, role: { $last: '$actorRole' } } },
  ]);
  const admins = await Admin.find({}).select('name username role status');
  const byAdmin = new Map(admins.map((a) => [String(a._id), {
    adminId: String(a._id), name: a.name, username: a.username, role: a.role, status: a.status,
    ...Object.fromEntries(Object.keys(ADMIN_ACTIONS).map((k) => [k, 0])),
  }]));
  const keyOf = Object.fromEntries(Object.entries(ADMIN_ACTIONS).map(([k, v]) => [v, k]));
  rows.forEach((r) => {
    const id = r._id.actorId;
    if (!byAdmin.has(id)) byAdmin.set(id, { adminId: id, name: r.name, username: '', role: r.role, status: '', ...Object.fromEntries(Object.keys(ADMIN_ACTIONS).map((k) => [k, 0])) });
    byAdmin.get(id)[keyOf[r._id.action]] = r.count;
  });
  let data = [...byAdmin.values()];
  if (match.actorId) data = data.filter((d) => d.adminId === match.actorId);

  if (wantsCsv(req)) {
    return sendCsv(res, 'admin-activity.csv', [
      { label: 'Admin', value: 'name' }, { label: 'Username', value: 'username' }, { label: 'Role', value: 'role' }, { label: 'Status', value: 'status' },
      ...Object.keys(ADMIN_ACTIONS).map((k) => ({ label: ADMIN_ACTION_LABELS[k] || k, value: k })),
    ], data);
  }
  res.status(200).json({ success: true, data });
};

// ─── Delivery partners ───────────────────────────────────────────────────────

// @route GET /api/reports/partners
exports.partners = async (req, res) => {
  const range = dateRange(req.query);
  const eventMatch = {};
  if (range) eventMatch['assignmentHistory.at'] = range;
  if (req.query.partnerId && isValidId(req.query.partnerId)) eventMatch['assignmentHistory.partnerId'] = String(req.query.partnerId);

  const [events, collections] = await Promise.all([
    Order.aggregate([
      { $unwind: '$assignmentHistory' },
      { $match: { 'assignmentHistory.partnerId': { $ne: null }, ...eventMatch } },
      {
        $group: {
          _id: '$assignmentHistory.partnerId',
          name: { $last: '$assignmentHistory.partnerName' },
          accepted: { $sum: { $cond: [{ $eq: ['$assignmentHistory.action', 'ACCEPTED'] }, 1, 0] } },
          assignedByAdmin: { $sum: { $cond: [{ $eq: ['$assignmentHistory.action', 'ASSIGNED_BY_ADMIN'] }, 1, 0] } },
          unavailable: { $sum: { $cond: [{ $eq: ['$assignmentHistory.action', 'UNAVAILABLE'] }, 1, 0] } },
          released: { $sum: { $cond: [{ $eq: ['$assignmentHistory.action', 'RELEASED_BY_ADMIN'] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $eq: ['$assignmentHistory.action', 'DELIVERED'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$assignmentHistory.action', 'FAILED'] }, 1, 0] } },
        },
      },
    ]),
    Order.aggregate([
      { $match: { deliveredBy: { $ne: null }, ...(range ? { deliveredAt: range } : {}) } },
      {
        $group: {
          _id: '$deliveredBy',
          deliveredValue: { $sum: '$totalAmount' },
          cashExpected: { $sum: '$expectedCollection' },
          cashCollected: { $sum: '$amountCollected' },
          pendingHandover: { $sum: { $cond: [{ $eq: ['$settlementStatus', 'PENDING'] }, '$amountCollected', 0] } },
        },
      },
    ]),
  ]);
  const cash = new Map(collections.map((c) => [String(c._id), c]));
  const data = events.map((e) => {
    const c = cash.get(String(e._id)) || {};
    return {
      partnerId: e._id,
      name: e.name,
      accepted: e.accepted,
      assignedByAdmin: e.assignedByAdmin,
      totalAssignments: e.accepted + e.assignedByAdmin,
      delivered: e.delivered,
      failed: e.failed,
      unavailable: e.unavailable,
      released: e.released,
      deliveredValue: toMoney(c.deliveredValue || 0),
      cashExpected: toMoney(c.cashExpected || 0),
      cashCollected: toMoney(c.cashCollected || 0),
      pendingHandover: toMoney(c.pendingHandover || 0),
    };
  });
  if (wantsCsv(req)) {
    return sendCsv(res, 'delivery-partners.csv', [
      { label: 'Delivery partner', value: 'name' }, { label: 'Accepted from pool', value: 'accepted' }, { label: 'Assigned by admin', value: 'assignedByAdmin' },
      { label: 'Delivered', value: 'delivered' }, { label: 'Failed', value: 'failed' }, { label: 'Reported unavailable', value: 'unavailable' },
      { label: 'Delivered value (INR)', value: 'deliveredValue' }, { label: 'Cash expected (INR)', value: 'cashExpected' },
      { label: 'Cash collected (INR)', value: 'cashCollected' }, { label: 'Pending handover (INR)', value: 'pendingHandover' },
    ], data);
  }
  res.status(200).json({ success: true, data });
};

// ─── Farmers ─────────────────────────────────────────────────────────────────

// @route GET /api/reports/farmers
exports.farmers = async (req, res) => {
  const match = orderMatch(req.query);
  const data = (await Order.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$farmerId',
        name: { $last: '$farmerName' },
        phone: { $last: '$farmerPhone' },
        orders: { $sum: 1 },
        delivered: { $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, 1, 0] } },
        rejected: { $sum: { $cond: [{ $eq: ['$status', 'REJECTED'] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } },
        orderValue: { $sum: { $cond: [{ $in: ['$status', ['REJECTED', 'CANCELLED']] }, 0, '$totalAmount'] } },
        discount: { $sum: { $cond: [{ $in: ['$status', ['REJECTED', 'CANCELLED']] }, 0, '$discount'] } },
        lastOrderAt: { $max: '$createdAt' },
      },
    },
    { $sort: { orderValue: -1 } },
  ])).map((r) => ({ ...r, farmerId: r._id, orderValue: toMoney(r.orderValue), discount: toMoney(r.discount) }));
  if (wantsCsv(req)) {
    return sendCsv(res, 'farmers.csv', [
      { label: 'Farmer', value: 'name' }, { label: 'Mobile', value: 'phone' }, { label: 'Orders', value: 'orders' },
      { label: 'Delivered', value: 'delivered' }, { label: 'Rejected', value: 'rejected' }, { label: 'Cancelled', value: 'cancelled' },
      { label: 'Order value (INR)', value: 'orderValue' }, { label: 'Discount (INR)', value: 'discount' }, { label: 'Last order', value: 'lastOrderAt' },
    ], data);
  }
  res.status(200).json({ success: true, data });
};

// ─── Offers & products ───────────────────────────────────────────────────────

// @route GET /api/reports/offers
exports.offers = async (req, res) => {
  const match = { ...orderMatch(req.query), status: NOT_TERMINATED };
  const offerFilter = req.query.offerId && isValidId(req.query.offerId) ? { 'items.offerId': oid(req.query.offerId) } : { 'items.offerId': { $ne: null } };
  const data = (await Order.aggregate([
    { $match: match },
    { $unwind: '$items' },
    { $match: offerFilter },
    {
      $group: {
        _id: '$items.offerId',
        title: { $last: '$items.offerTitle' },
        orders: { $addToSet: '$_id' },
        unitsSold: { $sum: '$items.quantity' },
        totalDiscount: { $sum: '$items.lineDiscount' },
        salesValue: { $sum: '$items.lineTotal' },
      },
    },
    { $sort: { totalDiscount: -1 } },
  ])).map((r) => ({ offerId: r._id, title: r.title, orderCount: r.orders.length, unitsSold: r.unitsSold, totalDiscount: toMoney(r.totalDiscount), salesValue: toMoney(r.salesValue) }));
  if (wantsCsv(req)) {
    return sendCsv(res, 'offers.csv', [
      { label: 'Offer', value: 'title' }, { label: 'Orders', value: 'orderCount' }, { label: 'Units sold', value: 'unitsSold' },
      { label: 'Total discount (INR)', value: 'totalDiscount' }, { label: 'Sales value (INR)', value: 'salesValue' },
    ], data);
  }
  res.status(200).json({ success: true, data });
};

// @route GET /api/reports/products
exports.products = async (req, res) => {
  const match = { ...orderMatch(req.query), status: NOT_TERMINATED };
  const itemMatch = req.query.productId && isValidId(req.query.productId) ? { 'items.productId': oid(req.query.productId) } : {};
  const data = (await Order.aggregate([
    { $match: match },
    { $unwind: '$items' },
    { $match: itemMatch },
    {
      $group: {
        _id: '$items.productId',
        name: { $last: '$items.productName' },
        unitsSold: { $sum: '$items.quantity' },
        grossValue: { $sum: '$items.lineSubtotal' },
        discount: { $sum: '$items.lineDiscount' },
        netValue: { $sum: '$items.lineTotal' },
      },
    },
    { $sort: { netValue: -1 } },
  ])).map((r) => ({ productId: r._id, name: r.name, unitsSold: r.unitsSold, grossValue: toMoney(r.grossValue), discount: toMoney(r.discount), netValue: toMoney(r.netValue) }));
  if (wantsCsv(req)) {
    return sendCsv(res, 'products.csv', [
      { label: 'Product', value: 'name' }, { label: 'Units sold', value: 'unitsSold' }, { label: 'Gross (INR)', value: 'grossValue' },
      { label: 'Discount (INR)', value: 'discount' }, { label: 'Net (INR)', value: 'netValue' },
    ], data);
  }
  res.status(200).json({ success: true, data });
};

// ─── Settlements ─────────────────────────────────────────────────────────────

// @route GET /api/reports/settlements
exports.settlements = async (req, res) => {
  const filter = {};
  const range = dateRange(req.query);
  if (range) filter.handedOverAt = range;
  const st = upperIn(req.query.settlementStatus, ['SUBMITTED', 'VERIFIED', 'DISPUTED']);
  if (st) filter.status = st;
  if (req.query.partnerId && isValidId(req.query.partnerId)) filter.partnerId = oid(req.query.partnerId);
  const rows = await Settlement.find(filter).sort({ handedOverAt: -1 }).lean();
  if (wantsCsv(req)) {
    return sendCsv(res, 'settlements.csv', [
      { label: 'Settlement', value: 'settlementNumber' }, { label: 'Delivery partner', value: 'partnerName' },
      { label: 'Handed over at', value: 'handedOverAt' }, { label: 'Orders', value: (r) => r.orderNumbers.join('; ') },
      { label: 'Expected (INR)', value: 'expectedAmount' }, { label: 'Submitted (INR)', value: 'submittedAmount' },
      { label: 'Difference (INR)', value: 'difference' }, { label: 'Status', value: 'status' },
      { label: 'Reference', value: 'handoverReference' }, { label: 'Verified by', value: 'verifiedByName' }, { label: 'Dispute reason', value: 'disputeReason' },
    ], rows);
  }
  res.status(200).json({ success: true, data: rows });
};

// ─── Activity history (audit log) ────────────────────────────────────────────

// @route GET /api/reports/activity?role&actorId&entityType&action&entityRef&from&to
exports.activity = async (req, res) => {
  const filter = {};
  const range = dateRange(req.query);
  if (range) filter.createdAt = range;
  const role = String(req.query.role || '').toUpperCase();
  if (role === 'ADMIN') filter.actorRole = { $in: ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'] };
  else if (['FARMER', 'PARTNER', 'SUPER_ADMIN', 'MODERATOR', 'ANONYMOUS'].includes(role)) filter.actorRole = role;
  if (req.query.actorId) filter.actorId = cleanText(req.query.actorId, 40);
  if (req.query.entityType) filter.entityType = cleanText(req.query.entityType, 30).toUpperCase();
  if (req.query.action) filter.action = cleanText(req.query.action, 60).toUpperCase();
  if (req.query.entityRef) filter.entityRef = new RegExp(escapeRegex(cleanText(req.query.entityRef, 60)), 'i');
  if (req.query.entityId) filter.entityId = cleanText(req.query.entityId, 40);

  const csv = wantsCsv(req);
  const limit = csv ? 10000 : Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const page = csv ? 1 : Math.max(1, Number(req.query.page) || 1);
  const [logs, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  if (csv) {
    return sendCsv(res, 'activity.csv', [
      { label: 'Time', value: 'createdAt' }, { label: 'User', value: 'actorName' }, { label: 'Role', value: 'actorRole' },
      { label: 'Action', value: 'action' }, { label: 'Entity', value: 'entityType' }, { label: 'Reference', value: 'entityRef' },
      { label: 'From', value: 'fromStatus' }, { label: 'To', value: 'toStatus' }, { label: 'Reason', value: 'reason' },
    ], logs);
  }
  res.status(200).json({ success: true, total, page, pages: Math.ceil(total / limit), data: logs });
};

// ─── Shared runner (used by the overview and the Excel export) ───────────────

/**
 * Runs a report handler in-process. asTable=true returns { columns, rows } exactly as the CSV
 * export would produce them; otherwise returns the JSON `data`.
 */
const runReport = (handler, query, asTable = false) => new Promise((resolve, reject) => {
  const res = {
    status() { return res; },
    setHeader() {},
    send() {},
    json: (body) => resolve(asTable ? { columns: [], rows: body.data || [] } : body.data),
    captureTable: (table) => resolve(table),
  };
  Promise.resolve(handler({ query: asTable ? { ...query, format: 'csv' } : { ...query } }, res)).catch(reject);
});
exports.runReport = runReport;

// ─── Super Admin overview ────────────────────────────────────────────────────

const istYmd = (date) => new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 10);

const periodTotals = async (from) => {
  const [r] = await Order.aggregate([
    { $match: from ? { createdAt: { $gte: from } } : {} },
    {
      $group: {
        _id: null,
        orders: { $sum: 1 },
        delivered: { $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, 1, 0] } },
        rejectedOrCancelled: { $sum: { $cond: [{ $in: ['$status', ['REJECTED', 'CANCELLED']] }, 1, 0] } },
        orderValue: { $sum: { $cond: [{ $in: ['$status', ['REJECTED', 'CANCELLED']] }, 0, '$totalAmount'] } },
        sales: { $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, '$totalAmount', 0] } },
        discounts: { $sum: { $cond: [{ $in: ['$status', ['REJECTED', 'CANCELLED']] }, 0, '$discount'] } },
        collected: {
          $sum: {
            $cond: [
              { $eq: ['$paymentMethod', 'COD'] },
              '$amountCollected',
              { $cond: [{ $in: ['$paymentStatus', ['PAID', 'REFUND_PENDING', 'REFUNDED']] }, '$totalAmount', 0] },
            ],
          },
        },
      },
    },
  ]);
  const t = r || {};
  const activeOrders = (t.orders || 0) - (t.rejectedOrCancelled || 0);
  return {
    orders: t.orders || 0,
    delivered: t.delivered || 0,
    rejectedOrCancelled: t.rejectedOrCancelled || 0,
    orderValue: toMoney(t.orderValue || 0),
    sales: toMoney(t.sales || 0),
    discounts: toMoney(t.discounts || 0),
    collected: toMoney(t.collected || 0),
    averageOrder: activeOrders > 0 ? toMoney((t.orderValue || 0) / activeOrders) : 0,
  };
};

// @route GET /api/reports/overview — the Super Admin's business dashboard
exports.overview = async (req, res) => {
  const Farmer = require('../models/Farmer');
  const Partner = require('../models/Partner');
  const today = istYmd(new Date());
  const monthStartYmd = `${today.slice(0, 8)}01`;
  const todayStart = parseDate(today);
  const monthStart = parseDate(monthStartYmd);

  const [
    todayTotals, monthTotals, allTotals,
    farmersTotal, farmersActive, farmersNew, partnersTotal, partnersActive, partnersOnline, adminsTotal, adminsActive,
    statusCounts, payCounts, cashWithPartners, settlementCounts,
    topFarmers, partnerPerf, adminDecisions,
  ] = await Promise.all([
    periodTotals(todayStart), periodTotals(monthStart), periodTotals(null),
    Farmer.countDocuments({}), Farmer.countDocuments({ status: 'Active' }), Farmer.countDocuments({ createdAt: { $gte: monthStart } }),
    Partner.countDocuments({}), Partner.countDocuments({ status: 'Active' }), Partner.countDocuments({ status: 'Active', online: true }),
    Admin.countDocuments({ status: { $ne: 'Deleted' } }), Admin.countDocuments({ status: 'Active' }),
    Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Order.aggregate([
      { $match: { paymentStatus: { $in: ['AWAITING_VERIFICATION', 'REFUND_PENDING'] } } },
      { $group: { _id: '$paymentStatus', count: { $sum: 1 }, amount: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'REFUND_PENDING'] }, '$refundAmount', '$totalAmount'] } } } },
    ]),
    Order.aggregate([{ $match: { settlementStatus: 'PENDING', amountCollected: { $gt: 0 } } }, { $group: { _id: null, amount: { $sum: '$amountCollected' } } }]),
    Settlement.aggregate([{ $match: { status: { $in: ['SUBMITTED', 'DISPUTED'] } } }, { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$submittedAmount' } } }]),
    runReport(exports.farmers, { from: monthStartYmd, to: today }),
    runReport(exports.partners, { from: monthStartYmd, to: today }),
    runReport(exports.adminActivity, { from: monthStartYmd, to: today }),
  ]);

  const byStatus = Object.fromEntries(statusCounts.map((r) => [r._id, r.count]));
  const pay = Object.fromEntries(payCounts.map((r) => [r._id, r]));
  const stl = Object.fromEntries(settlementCounts.map((r) => [r._id, r]));

  res.status(200).json({
    success: true,
    data: {
      today: todayTotals,
      month: monthTotals,
      allTime: allTotals,
      people: {
        farmers: { total: farmersTotal, active: farmersActive, newThisMonth: farmersNew },
        partners: { total: partnersTotal, active: partnersActive, online: partnersOnline },
        admins: { total: adminsTotal, active: adminsActive },
      },
      attention: {
        pendingApproval: byStatus.PENDING_APPROVAL || 0,
        awaitingPartner: byStatus.APPROVED || 0,
        inDelivery: (byStatus.ASSIGNED || 0) + (byStatus.OUT_FOR_DELIVERY || 0),
        deliveryFailed: byStatus.DELIVERY_FAILED || 0,
        paymentsToVerify: pay.AWAITING_VERIFICATION ? pay.AWAITING_VERIFICATION.count : 0,
        refundsPending: pay.REFUND_PENDING ? pay.REFUND_PENDING.count : 0,
        refundsPendingAmount: toMoney(pay.REFUND_PENDING ? pay.REFUND_PENDING.amount : 0),
        cashWithPartners: toMoney(cashWithPartners[0] ? cashWithPartners[0].amount : 0),
        settlementsToVerify: stl.SUBMITTED ? stl.SUBMITTED.count : 0,
        settlementsToVerifyAmount: toMoney(stl.SUBMITTED ? stl.SUBMITTED.amount : 0),
        settlementsDisputed: stl.DISPUTED ? stl.DISPUTED.count : 0,
      },
      topFarmers: (topFarmers || []).slice(0, 5),
      partnerPerformance: (partnerPerf || []).sort((a, b) => b.delivered - a.delivered).slice(0, 5),
      adminDecisions: (adminDecisions || [])
        .filter((a) => a.status !== 'Deleted')
        .map((a) => ({
          adminId: a.adminId, name: a.name, role: a.role,
          approved: a.approved, rejected: a.rejected, assigned: a.assigned + a.reassigned, paymentsVerified: a.paymentsVerified,
        }))
        .sort((a, b) => (b.approved + b.rejected) - (a.approved + a.rejected)),
    },
  });
};

// ─── Excel export ────────────────────────────────────────────────────────────

const EXPORT_TOKEN_MINUTES = 5;
const usedExportTokens = new Map(); // jti -> expiry (ms); each link downloads once

const EXPORT_FILTER_KEYS = ['from', 'to', 'status', 'paymentMethod', 'paymentStatus', 'settlementStatus', 'farmerId', 'partnerId', 'adminId', 'orderNumber', 'offerId', 'productId'];

// @route POST /api/reports/export-link — short-lived, single-use link the phone opens in its browser
exports.exportLink = async (req, res) => {
  const jwt = require('jsonwebtoken');
  const crypto = require('crypto');
  const body = req.body || {};
  const query = {};
  EXPORT_FILTER_KEYS.forEach((k) => { if (body[k]) query[k] = cleanText(body[k], 60); });
  dateRange(query); // rejects invalid from / to
  const token = jwt.sign(
    {
      id: String(req.user._id), userType: 'admin', tv: req.user.tokenVersion || 0,
      purpose: 'excel-export', q: query, jti: crypto.randomBytes(12).toString('hex'),
    },
    process.env.JWT_SECRET,
    { expiresIn: `${EXPORT_TOKEN_MINUTES}m` },
  );
  const base = `${req.protocol}://${req.get('host')}`;
  res.status(200).json({
    success: true,
    data: { url: `${base}/api/reports/download?token=${encodeURIComponent(token)}`, expiresInMinutes: EXPORT_TOKEN_MINUTES },
  });
};

// @route GET /api/reports/download?token= — streams the .xlsx (opened by the browser, so no Authorization header)
exports.download = async (req, res) => {
  const jwt = require('jsonwebtoken');
  const { resolveUser } = require('../middleware/authMiddleware');
  const { hasPermission, PERMISSIONS } = require('../utils/permissions');
  const { audit } = require('../utils/audit');
  const { buildWorkbook } = require('../services/excelExport');

  const token = String(req.query.token || '');
  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    throw new AppError(401, 'AUTH_TOKEN_INVALID');
  }
  // A normal session token is never accepted here, and each link works once.
  if (claims.purpose !== 'excel-export' || !claims.jti) throw new AppError(401, 'AUTH_TOKEN_INVALID');
  const now = Date.now();
  for (const [k, exp] of usedExportTokens) if (exp < now) usedExportTokens.delete(k);
  if (usedExportTokens.has(claims.jti)) throw new AppError(401, 'AUTH_TOKEN_INVALID');

  const resolved = await resolveUser(token);
  if (!resolved || resolved.inactive || resolved.userType !== 'admin') throw new AppError(401, 'AUTH_TOKEN_INVALID');
  if (!hasPermission(resolved.user, PERMISSIONS.REPORTS_VIEW)) throw new AppError(403, 'AUTH_FORBIDDEN');
  usedExportTokens.set(claims.jti, claims.exp * 1000);

  req.user = resolved.user;
  req.userType = 'admin';
  const query = claims.q || {};
  const wb = await buildWorkbook({
    query,
    includeAdmins: resolved.user.role === 'SUPER_ADMIN',
    generatedBy: resolved.user.name || resolved.user.username,
  });

  await audit(req, { action: 'REPORT_EXPORTED', entityType: 'REPORT', entityRef: 'excel', metadata: { query } });
  const name = `AgriHarvest-report-${query.from || 'all'}-to-${query.to || istYmd(new Date())}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'no-store');
  await wb.xlsx.write(res);
  res.end();
};
