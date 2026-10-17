const Settlement = require('../models/Settlement');
const Order = require('../models/Order');
const Partner = require('../models/Partner');
const { nextNumber } = require('../models/Counter');
const { AppError } = require('../utils/i18n');
const { audit } = require('../utils/audit');
const { getSettings } = require('../utils/settings');
const { requireValidId, cleanText, toMoney, parseDate, isValidId } = require('../utils/validators');

// Cash a partner has collected on delivered COD orders but not yet handed over.
const outstandingFilter = (partnerId) => ({
  deliveredBy: partnerId,
  paymentMethod: 'COD',
  amountCollected: { $gt: 0 },
  settlementStatus: 'PENDING',
});

const outstandingFor = async (partnerId) => {
  const orders = await Order.find(outstandingFilter(partnerId))
    .select('orderNumber amountCollected expectedCollection collectedAt collectionStatus farmerName')
    .sort({ collectedAt: 1 });
  return { orders, total: toMoney(orders.reduce((s, o) => s + o.amountCollected, 0)) };
};

const saveSettlement = async (s) => {
  try {
    return await s.save();
  } catch (err) {
    if (err && err.name === 'VersionError') throw new AppError(409, 'ORDER_CHANGED');
    throw err;
  }
};

// Creates a settlement for the given partner, locking the selected outstanding orders.
const createSettlement = async (req, partner, body) => {
  const submittedAmount = Number(body.submittedAmount);
  if (body.submittedAmount === undefined || body.submittedAmount === '' || !Number.isFinite(submittedAmount) || submittedAmount < 0) {
    throw new AppError(400, 'SETTLEMENT_AMOUNT_INVALID');
  }
  const { orders } = await outstandingFor(partner._id);
  let selected = orders;
  if (Array.isArray(body.orderIds) && body.orderIds.length) {
    const wanted = new Set(body.orderIds.map(String).filter(isValidId));
    selected = orders.filter((o) => wanted.has(String(o._id)));
  }
  if (!selected.length) throw new AppError(400, 'SETTLEMENT_NOTHING_OUTSTANDING');

  const expectedAmount = toMoney(selected.reduce((s, o) => s + o.amountCollected, 0));
  const settlement = new Settlement({
    settlementNumber: await nextNumber('STL'),
    partnerId: partner._id,
    partnerName: partner.name,
    partnerPhone: partner.phoneNumber,
    orders: selected.map((o) => o._id),
    orderNumbers: selected.map((o) => o.orderNumber),
    expectedAmount,
    submittedAmount: toMoney(submittedAmount),
    difference: toMoney(submittedAmount - expectedAmount),
    handoverReference: cleanText(body.handoverReference, 60),
    handedOverAt: parseDate(body.handedOverAt) || new Date(),
    handedOverTo: cleanText(body.handedOverTo, 100),
    notes: cleanText(body.notes, 500),
    status: 'SUBMITTED',
    submittedBy: String(req.user._id),
    submittedByRole: req.userType === 'admin' ? req.user.role : 'PARTNER',
    submittedByName: req.user.name || req.user.username || '',
  });

  // Lock the orders atomically; if any was settled concurrently, undo and fail.
  const ids = selected.map((o) => o._id);
  const result = await Order.updateMany(
    { _id: { $in: ids }, settlementStatus: 'PENDING' },
    { $set: { settlementStatus: 'SUBMITTED', settlementId: settlement._id } },
  );
  if (result.modifiedCount !== ids.length) {
    await Order.updateMany({ _id: { $in: ids }, settlementId: settlement._id }, { $set: { settlementStatus: 'PENDING', settlementId: null } });
    throw new AppError(409, 'ORDER_CHANGED');
  }
  try {
    await settlement.save();
  } catch (err) {
    await Order.updateMany({ _id: { $in: ids }, settlementId: settlement._id }, { $set: { settlementStatus: 'PENDING', settlementId: null } });
    throw err;
  }

  await audit(req, {
    action: 'SETTLEMENT_SUBMITTED',
    entityType: 'SETTLEMENT',
    entityId: settlement._id,
    entityRef: settlement.settlementNumber,
    toStatus: 'SUBMITTED',
    metadata: { partnerId: String(partner._id), expectedAmount, submittedAmount: settlement.submittedAmount, difference: settlement.difference, orders: settlement.orderNumbers },
  });
  return settlement;
};

// ─── Delivery partner ────────────────────────────────────────────────────────

// @route GET /api/settlements/mine
exports.mySettlements = async (req, res) => {
  const [outstanding, settlements, deliveredCount, settings] = await Promise.all([
    outstandingFor(req.user._id),
    Settlement.find({ partnerId: req.user._id }).sort({ createdAt: -1 }).limit(100),
    Order.countDocuments({ deliveredBy: req.user._id, status: 'DELIVERED' }),
    getSettings(),
  ]);
  const perDelivery = settings.partnerEarningPerDelivery || 0;
  res.status(200).json({
    success: true,
    data: {
      outstanding,
      settlements,
      // Partner earnings are tracked separately from customer cash collections.
      earnings: { deliveredCount, perDelivery, total: toMoney(deliveredCount * perDelivery) },
    },
  });
};

// @route POST /api/settlements  (partner submits a cash handover)
exports.submitSettlement = async (req, res) => {
  const settlement = await createSettlement(req, req.user, req.body || {});
  res.status(201).json({ success: true, data: settlement });
};

// ─── Admin ───────────────────────────────────────────────────────────────────

// @route POST /api/settlements/record  { partnerId, submittedAmount, ... } (admin records a handover)
exports.recordSettlement = async (req, res) => {
  const partner = await Partner.findById(requireValidId((req.body || {}).partnerId));
  if (!partner) throw new AppError(404, 'USER_NOT_FOUND');
  const settlement = await createSettlement(req, partner, req.body || {});
  res.status(201).json({ success: true, data: settlement });
};

// @route GET /api/settlements?status&partnerId&from&to
exports.listSettlements = async (req, res) => {
  const filter = {};
  const status = String(req.query.status || '').toUpperCase();
  if (['SUBMITTED', 'VERIFIED', 'DISPUTED'].includes(status)) filter.status = status;
  if (req.query.partnerId) filter.partnerId = requireValidId(req.query.partnerId);
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to, true);
  if (from || to) {
    filter.handedOverAt = {};
    if (from) filter.handedOverAt.$gte = from;
    if (to) filter.handedOverAt.$lte = to;
  }
  const settlements = await Settlement.find(filter).sort({ createdAt: -1 }).limit(500);
  const totals = settlements.reduce((acc, s) => {
    acc.expected += s.expectedAmount;
    acc.submitted += s.submittedAmount;
    acc.difference += s.difference;
    return acc;
  }, { expected: 0, submitted: 0, difference: 0 });
  res.status(200).json({
    success: true,
    count: settlements.length,
    totals: { expected: toMoney(totals.expected), submitted: toMoney(totals.submitted), difference: toMoney(totals.difference) },
    data: settlements,
  });
};

// @route GET /api/settlements/outstanding — per-partner reconciliation snapshot
exports.outstandingByPartner = async (req, res) => {
  const rows = await Order.aggregate([
    { $match: { paymentMethod: 'COD', status: 'DELIVERED', deliveredBy: { $ne: null } } },
    {
      $group: {
        _id: '$deliveredBy',
        expectedTotal: { $sum: '$expectedCollection' },
        collectedTotal: { $sum: '$amountCollected' },
        pendingHandover: { $sum: { $cond: [{ $eq: ['$settlementStatus', 'PENDING'] }, '$amountCollected', 0] } },
        pendingOrders: { $sum: { $cond: [{ $eq: ['$settlementStatus', 'PENDING'] }, 1, 0] } },
        submitted: { $sum: { $cond: [{ $eq: ['$settlementStatus', 'SUBMITTED'] }, '$amountCollected', 0] } },
        verified: { $sum: { $cond: [{ $eq: ['$settlementStatus', 'VERIFIED'] }, '$amountCollected', 0] } },
        disputed: { $sum: { $cond: [{ $eq: ['$settlementStatus', 'DISPUTED'] }, '$amountCollected', 0] } },
        shortCollections: { $sum: { $cond: [{ $eq: ['$collectionStatus', 'DISPUTED'] }, 1, 0] } },
      },
    },
  ]);
  const partners = await Partner.find({ _id: { $in: rows.map((r) => r._id) } }).select('name phoneNumber');
  const names = new Map(partners.map((p) => [String(p._id), p]));
  res.status(200).json({
    success: true,
    data: rows.map((r) => ({
      partnerId: r._id,
      partnerName: names.get(String(r._id)) ? names.get(String(r._id)).name : '',
      partnerPhone: names.get(String(r._id)) ? names.get(String(r._id)).phoneNumber : '',
      expectedTotal: toMoney(r.expectedTotal),
      collectedTotal: toMoney(r.collectedTotal),
      collectionDifference: toMoney(r.collectedTotal - r.expectedTotal),
      pendingHandover: toMoney(r.pendingHandover),
      pendingOrders: r.pendingOrders,
      submitted: toMoney(r.submitted),
      verified: toMoney(r.verified),
      disputed: toMoney(r.disputed),
      shortCollections: r.shortCollections,
    })),
  });
};

// @route GET /api/settlements/:id
exports.getSettlement = async (req, res) => {
  const settlement = await Settlement.findById(requireValidId(req.params.id));
  if (!settlement) throw new AppError(404, 'SETTLEMENT_NOT_FOUND');
  if (req.userType === 'partner' && String(settlement.partnerId) !== String(req.user._id)) throw new AppError(404, 'SETTLEMENT_NOT_FOUND');
  const orders = await Order.find({ _id: { $in: settlement.orders } }).select('orderNumber farmerName amountCollected expectedCollection collectionStatus collectedAt');
  res.status(200).json({ success: true, data: { ...settlement.toObject(), orderDetails: orders } });
};

const transition = (toStatus, action) => async (req, res) => {
  const settlement = await Settlement.findById(requireValidId(req.params.id));
  if (!settlement) throw new AppError(404, 'SETTLEMENT_NOT_FOUND');
  const allowedFrom = toStatus === 'VERIFIED' ? ['SUBMITTED', 'DISPUTED'] : ['SUBMITTED'];
  if (!allowedFrom.includes(settlement.status)) {
    throw new AppError(409, 'SETTLEMENT_TRANSITION_INVALID', { status: settlement.status });
  }
  const note = cleanText((req.body || {}).reason || (req.body || {}).note, 500);
  if (toStatus === 'DISPUTED' && note.length < 3) throw new AppError(400, 'ORDER_REASON_REQUIRED');
  const from = settlement.status;
  settlement.status = toStatus;
  settlement.verifiedBy = String(req.user._id);
  settlement.verifiedByName = req.user.name || req.user.username;
  settlement.verifiedAt = new Date();
  if (toStatus === 'DISPUTED') settlement.disputeReason = note;
  else if (from === 'DISPUTED') settlement.resolutionNote = note;
  await saveSettlement(settlement);
  await Order.updateMany({ settlementId: settlement._id }, { $set: { settlementStatus: toStatus } });
  await audit(req, {
    action,
    entityType: 'SETTLEMENT',
    entityId: settlement._id,
    entityRef: settlement.settlementNumber,
    fromStatus: from,
    toStatus,
    reason: note,
    metadata: { expectedAmount: settlement.expectedAmount, submittedAmount: settlement.submittedAmount, difference: settlement.difference },
  });
  res.status(200).json({ success: true, data: settlement });
};

// @route PATCH /api/settlements/:id/verify  { note }
exports.verifySettlement = transition('VERIFIED', 'SETTLEMENT_VERIFIED');
// @route PATCH /api/settlements/:id/dispute  { reason }
exports.disputeSettlement = transition('DISPUTED', 'SETTLEMENT_DISPUTED');
