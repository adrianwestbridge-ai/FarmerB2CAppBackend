const mongoose = require('mongoose');
const Order = require('../models/Order');
const Settlement = require('../models/Settlement');
const { toMoney } = require('../utils/validators');

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const TERMINATED = ['REJECTED', 'CANCELLED'];
const IN_PROGRESS = ['PENDING_APPROVAL', 'APPROVED', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED'];
const notTerminated = (expr) => ({ $cond: [{ $in: ['$status', TERMINATED] }, 0, expr] });

const emptyFarmerStats = () => ({
  orders: 0, delivered: 0, cancelled: 0, rejected: 0, inProgress: 0,
  orderValue: 0, sales: 0, discount: 0, mrpSavings: 0, lastOrderAt: null, firstOrderAt: null,
});

/**
 * Lifetime order statistics per farmer.
 * orderValue excludes rejected/cancelled orders; sales counts delivered orders only;
 * mrpSavings is what the farmer saved against MRP (selling-price discount + offers).
 */
const farmerStats = async (farmerIds) => {
  const ids = farmerIds.filter(Boolean).map(oid);
  if (!ids.length) return new Map();
  const rows = await Order.aggregate([
    { $match: { farmerId: { $in: ids } } },
    {
      $group: {
        _id: '$farmerId',
        orders: { $sum: 1 },
        delivered: { $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } },
        rejected: { $sum: { $cond: [{ $eq: ['$status', 'REJECTED'] }, 1, 0] } },
        inProgress: { $sum: { $cond: [{ $in: ['$status', IN_PROGRESS] }, 1, 0] } },
        orderValue: { $sum: notTerminated('$totalAmount') },
        sales: { $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, '$totalAmount', 0] } },
        discount: { $sum: notTerminated('$discount') },
        mrpSavings: { $sum: notTerminated({ $add: [{ $max: [0, { $subtract: [{ $ifNull: ['$mrpTotal', '$subtotal'] }, '$subtotal'] }] }, '$discount'] }) },
        lastOrderAt: { $max: '$createdAt' },
        firstOrderAt: { $min: '$createdAt' },
      },
    },
  ]);
  return new Map(rows.map(({ _id, ...r }) => [String(_id), {
    ...emptyFarmerStats(),
    ...r,
    orderValue: toMoney(r.orderValue),
    sales: toMoney(r.sales),
    discount: toMoney(r.discount),
    mrpSavings: toMoney(r.mrpSavings),
  }]));
};

const emptyPartnerStats = () => ({
  activeDeliveries: 0, assignments: 0, delivered: 0, failed: 0, unavailable: 0,
  deliveredValue: 0, cashCollected: 0, cashPendingHandover: 0, cashSubmitted: 0, cashDisputed: 0, cashVerified: 0,
  lastDeliveredAt: null,
});

/**
 * Lifetime delivery statistics per delivery partner: workload, outcomes from the assignment
 * history, and where the cash they collected currently is (with them / submitted / verified).
 */
const partnerStats = async (partnerIds) => {
  const idStrings = partnerIds.filter(Boolean).map(String);
  if (!idStrings.length) return new Map();
  const ids = idStrings.map(oid);
  const [active, events, cash] = await Promise.all([
    Order.aggregate([
      { $match: { assignedPartnerId: { $in: ids }, status: { $in: ['ASSIGNED', 'OUT_FOR_DELIVERY'] } } },
      { $group: { _id: '$assignedPartnerId', count: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $unwind: '$assignmentHistory' },
      { $match: { 'assignmentHistory.partnerId': { $in: idStrings } } },
      {
        $group: {
          _id: '$assignmentHistory.partnerId',
          assignments: { $sum: { $cond: [{ $in: ['$assignmentHistory.action', ['ACCEPTED', 'ASSIGNED_BY_ADMIN']] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $eq: ['$assignmentHistory.action', 'DELIVERED'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$assignmentHistory.action', 'FAILED'] }, 1, 0] } },
          unavailable: { $sum: { $cond: [{ $eq: ['$assignmentHistory.action', 'UNAVAILABLE'] }, 1, 0] } },
        },
      },
    ]),
    Order.aggregate([
      { $match: { deliveredBy: { $in: ids } } },
      {
        $group: {
          _id: '$deliveredBy',
          deliveredValue: { $sum: '$totalAmount' },
          cashCollected: { $sum: '$amountCollected' },
          cashPendingHandover: { $sum: { $cond: [{ $eq: ['$settlementStatus', 'PENDING'] }, '$amountCollected', 0] } },
          cashSubmitted: { $sum: { $cond: [{ $eq: ['$settlementStatus', 'SUBMITTED'] }, '$amountCollected', 0] } },
          cashDisputed: { $sum: { $cond: [{ $eq: ['$settlementStatus', 'DISPUTED'] }, '$amountCollected', 0] } },
          cashVerified: { $sum: { $cond: [{ $eq: ['$settlementStatus', 'VERIFIED'] }, '$amountCollected', 0] } },
          lastDeliveredAt: { $max: '$deliveredAt' },
        },
      },
    ]),
  ]);
  const map = new Map(idStrings.map((id) => [id, emptyPartnerStats()]));
  active.forEach((r) => { map.get(String(r._id)).activeDeliveries = r.count; });
  events.forEach((r) => { Object.assign(map.get(String(r._id)), { assignments: r.assignments, delivered: r.delivered, failed: r.failed, unavailable: r.unavailable }); });
  cash.forEach((r) => {
    Object.assign(map.get(String(r._id)), {
      deliveredValue: toMoney(r.deliveredValue),
      cashCollected: toMoney(r.cashCollected),
      cashPendingHandover: toMoney(r.cashPendingHandover),
      cashSubmitted: toMoney(r.cashSubmitted),
      cashDisputed: toMoney(r.cashDisputed),
      cashVerified: toMoney(r.cashVerified),
      lastDeliveredAt: r.lastDeliveredAt,
    });
  });
  return map;
};

const ORDER_SUMMARY_FIELDS = 'orderNumber createdAt status paymentMethod paymentStatus totalAmount mrpTotal subtotal discount farmerName assignedPartnerId assignedPartnerName deliveredBy deliveredAt amountCollected settlementStatus items.productName items.quantity';

const recentOrdersOfFarmer = (farmerId, limit = 100) => Order.find({ farmerId: oid(farmerId) })
  .select(ORDER_SUMMARY_FIELDS).sort({ createdAt: -1 }).limit(limit).lean();

const recentOrdersOfPartner = (partnerId, limit = 100) => Order.find({
  $or: [{ assignedPartnerId: oid(partnerId) }, { deliveredBy: oid(partnerId) }, { 'assignmentHistory.partnerId': String(partnerId) }],
}).select(ORDER_SUMMARY_FIELDS).sort({ createdAt: -1 }).limit(limit).lean();

const recentSettlementsOfPartner = (partnerId, limit = 50) => Settlement.find({ partnerId: oid(partnerId) })
  .select('settlementNumber handedOverAt expectedAmount submittedAmount difference status handoverReference verifiedByName disputeReason orderNumbers')
  .sort({ handedOverAt: -1 }).limit(limit).lean();

module.exports = {
  farmerStats,
  partnerStats,
  emptyFarmerStats,
  emptyPartnerStats,
  recentOrdersOfFarmer,
  recentOrdersOfPartner,
  recentSettlementsOfPartner,
};
