const Order = require('../models/Order');
const { AppError } = require('../utils/i18n');
const { escapeRegex, parseDate, toMoney, isValidId } = require('../utils/validators');
const { paymentSummary } = require('../services/paymentService');

const ENTRY_STATUSES = ['PENDING', 'CONFIRMED', 'REJECTED'];
const TERMINATED = ['REJECTED', 'CANCELLED'];

const dateRange = (q, field) => {
  const from = parseDate(q.from);
  const to = parseDate(q.to, true);
  if (!from && !to) return {};
  const range = {};
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  return { [field]: range };
};

const ORDER_FIELDS = {
  orderNumber: 1, farmerId: 1, farmerName: 1, farmerPhone: 1, status: 1, paymentMethod: 1, paymentStatus: 1,
  totalAmount: 1, amountPaidOnline: 1, amountPendingOnline: 1, amountCollected: 1, collectionStatus: 1,
  expectedCollection: 1, assignedPartnerName: 1, createdAt: 1,
};

// @route GET /api/payments?status=PENDING|CONFIRMED|REJECTED|ALL&search=&from=&to=&reviewerId=&limit=
// Every reported / recorded QR payment, newest first, with the money position of its order.
exports.listPayments = async (req, res) => {
  const q = req.query || {};
  const limit = Math.min(300, Math.max(1, Number(q.limit) || 100));
  const status = String(q.status || 'PENDING').toUpperCase();

  const orderMatch = { 'payments.0': { $exists: true } };
  if (q.search) {
    const rx = new RegExp(escapeRegex(String(q.search).trim()), 'i');
    orderMatch.$or = [{ orderNumber: rx }, { farmerName: rx }, { farmerPhone: rx }, { 'payments.reference': rx }];
  }
  const entryMatch = { ...dateRange(q, 'payments.submittedAt') };
  if (ENTRY_STATUSES.includes(status)) entryMatch['payments.status'] = status;
  if (q.reviewerId) entryMatch['payments.reviewedById'] = String(q.reviewerId);

  const rows = await Order.aggregate([
    { $match: orderMatch },
    { $project: { ...ORDER_FIELDS, payments: 1 } },
    { $unwind: '$payments' },
    { $match: entryMatch },
    { $sort: { 'payments.submittedAt': status === 'PENDING' ? 1 : -1 } },
    { $limit: limit },
  ]);

  const data = rows.map(({ payments: entry, _id, ...order }) => ({
    entry,
    order: { _id, ...order, ...paymentSummary({ ...order, _id }) },
  }));
  res.status(200).json({ success: true, count: data.length, data });
};

// @route GET /api/payments/summary?from=&to=   (Super Admin)
// Accounts team report: what was reported, confirmed and rejected, and by whom.
exports.paymentSummary = async (req, res) => {
  const q = req.query || {};
  const entryRange = dateRange(q, 'payments.submittedAt');

  const [totals, byReviewer, outstanding, edits] = await Promise.all([
    Order.aggregate([
      { $match: { 'payments.0': { $exists: true } } },
      { $unwind: '$payments' },
      { $match: entryRange },
      {
        $group: {
          _id: '$payments.status',
          count: { $sum: 1 },
          reported: { $sum: '$payments.amount' },
          received: { $sum: '$payments.confirmedAmount' },
        },
      },
    ]),
    Order.aggregate([
      { $match: { 'payments.0': { $exists: true } } },
      { $unwind: '$payments' },
      { $match: { ...entryRange, 'payments.status': { $in: ['CONFIRMED', 'REJECTED'] }, 'payments.reviewedById': { $ne: null } } },
      {
        $group: {
          _id: '$payments.reviewedById',
          name: { $last: '$payments.reviewedByName' },
          role: { $last: '$payments.reviewedByRole' },
          confirmedCount: { $sum: { $cond: [{ $eq: ['$payments.status', 'CONFIRMED'] }, 1, 0] } },
          confirmedAmount: { $sum: { $cond: [{ $eq: ['$payments.status', 'CONFIRMED'] }, '$payments.confirmedAmount', 0] } },
          reportedOfConfirmed: { $sum: { $cond: [{ $eq: ['$payments.status', 'CONFIRMED'] }, '$payments.amount', 0] } },
          rejectedCount: { $sum: { $cond: [{ $eq: ['$payments.status', 'REJECTED'] }, 1, 0] } },
          rejectedAmount: { $sum: { $cond: [{ $eq: ['$payments.status', 'REJECTED'] }, '$payments.amount', 0] } },
          manualCount: { $sum: { $cond: [{ $eq: ['$payments.source', 'MANUAL'] }, 1, 0] } },
          lastActionAt: { $max: '$payments.reviewedAt' },
        },
      },
      { $sort: { confirmedAmount: -1 } },
    ]),
    // What farmers still owe on live orders, split by how it will be paid.
    Order.aggregate([
      { $match: { status: { $nin: TERMINATED }, paymentStatus: { $nin: ['PAID', 'REFUND_PENDING', 'REFUNDED', 'CANCELLED'] } } },
      {
        $project: {
          cash: { $cond: [{ $in: ['$collectionStatus', ['COLLECTED', 'DISPUTED']] }, '$amountCollected', 0] },
          totalAmount: 1, amountPaidOnline: 1, amountPendingOnline: 1, status: 1, expectedCollection: 1,
        },
      },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
          paidOnline: { $sum: '$amountPaidOnline' },
          pendingOnline: { $sum: '$amountPendingOnline' },
          cash: { $sum: '$cash' },
          toCollectOnDelivery: { $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, 0, '$expectedCollection'] } },
          dueAfterDelivery: {
            $sum: {
              $cond: [
                { $eq: ['$status', 'DELIVERED'] },
                { $max: [0, { $subtract: [{ $subtract: ['$totalAmount', '$amountPaidOnline'] }, '$cash'] }] },
                0,
              ],
            },
          },
        },
      },
    ]),
    Order.aggregate([
      { $match: { 'payments.edits.0': { $exists: true } } },
      { $unwind: '$payments' },
      { $unwind: '$payments.edits' },
      { $sort: { 'payments.edits.at': -1 } },
      { $limit: 20 },
      { $project: { orderId: '$_id', orderNumber: 1, farmerName: 1, entryId: '$payments._id', edit: '$payments.edits' } },
    ]),
  ]);

  const pick = (s) => totals.find((x) => x._id === s) || { count: 0, reported: 0, received: 0 };
  const o = outstanding[0] || { orders: 0, totalAmount: 0, paidOnline: 0, pendingOnline: 0, cash: 0, toCollectOnDelivery: 0, dueAfterDelivery: 0 };
  res.status(200).json({
    success: true,
    data: {
      pending: { count: pick('PENDING').count, amount: toMoney(pick('PENDING').reported) },
      confirmed: { count: pick('CONFIRMED').count, reported: toMoney(pick('CONFIRMED').reported), received: toMoney(pick('CONFIRMED').received) },
      rejected: { count: pick('REJECTED').count, amount: toMoney(pick('REJECTED').reported) },
      byReviewer: byReviewer.map((r) => ({
        reviewerId: r._id,
        name: r.name,
        role: r.role,
        confirmedCount: r.confirmedCount,
        confirmedAmount: toMoney(r.confirmedAmount),
        shortReceived: toMoney(r.reportedOfConfirmed - r.confirmedAmount),
        rejectedCount: r.rejectedCount,
        rejectedAmount: toMoney(r.rejectedAmount),
        manualCount: r.manualCount,
        lastActionAt: r.lastActionAt,
      })),
      outstanding: {
        orders: o.orders,
        totalAmount: toMoney(o.totalAmount),
        paidOnline: toMoney(o.paidOnline),
        pendingOnline: toMoney(o.pendingOnline),
        toCollectOnDelivery: toMoney(o.toCollectOnDelivery),
        dueAfterDelivery: toMoney(o.dueAfterDelivery),
      },
      recentEdits: edits,
    },
  });
};

// @route GET /api/payments/order/:id — the ledger of one order (admins with PAYMENTS_VERIFY)
exports.orderLedger = async (req, res) => {
  if (!isValidId(req.params.id)) throw new AppError(400, 'INVALID_ID');
  const order = await Order.findById(req.params.id).select({ ...ORDER_FIELDS, payments: 1 }).lean();
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND');
  res.status(200).json({ success: true, data: { ...order, ...paymentSummary(order) } });
};
