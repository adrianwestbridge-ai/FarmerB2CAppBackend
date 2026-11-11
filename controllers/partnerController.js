const Partner = require('../models/Partner');
const Order = require('../models/Order');
const { AppError, t } = require('../utils/i18n');
const { audit } = require('../utils/audit');
const { requireValidId, escapeRegex, cleanText, cleanImage, normalizePhone } = require('../utils/validators');
const { assertUsername, assertPhone, assertPassword } = require('../utils/identity');
const { releaseOrdersOfPartner } = require('../services/orderService');
const { partnerStats, emptyPartnerStats, recentOrdersOfPartner, recentSettlementsOfPartner } = require('../services/userStats');

// @route GET /api/partners?status&online&search  (admin)
exports.getPartners = async (req, res) => {
  const filter = {};
  if (req.query.status && ['Active', 'Suspended', 'Pending', 'Deleted'].includes(req.query.status)) filter.status = req.query.status;
  else filter.status = { $ne: 'Deleted' };
  if (req.query.online === 'true') filter.online = true;
  if (req.query.online === 'false') filter.online = false;
  if (req.query.search) {
    const rx = new RegExp(escapeRegex(cleanText(req.query.search, 60)), 'i');
    filter.$or = [{ name: rx }, { phoneNumber: rx }, { username: rx }, { businessName: rx }];
  }
  const partners = await Partner.find(filter).sort({ createdAt: -1 });

  // Current workload (helps admins pick who to assign) and lifetime delivery / cash figures.
  const stats = await partnerStats(partners.map((p) => p._id));
  res.status(200).json({
    success: true,
    count: partners.length,
    data: partners.map((p) => {
      const st = stats.get(String(p._id)) || emptyPartnerStats();
      return { ...p.toJSON(), activeDeliveries: st.activeDeliveries, stats: st };
    }),
  });
};

// @route GET /api/partners/:id  (admin)
exports.getPartner = async (req, res) => {
  const partner = await Partner.findById(requireValidId(req.params.id));
  if (!partner) throw new AppError(404, 'USER_NOT_FOUND');
  const [stats, orders, settlements] = await Promise.all([
    partnerStats([partner._id]),
    recentOrdersOfPartner(partner._id),
    recentSettlementsOfPartner(partner._id),
  ]);
  res.status(200).json({
    success: true,
    data: { ...partner.toJSON(), stats: stats.get(String(partner._id)) || emptyPartnerStats(), orders, settlements },
  });
};

// @route POST /api/partners  (admin)
exports.createPartner = async (req, res) => {
  const body = req.body || {};
  const name = cleanText(body.name, 100);
  if (!name) throw new AppError(400, 'NAME_REQUIRED');
  const phoneNumber = await assertPhone(body.phoneNumber);
  const username = await assertUsername(body.username, { required: false });
  const password = assertPassword(body.password, body.confirmPassword);

  const partner = await Partner.create({
    owner_id: `partner_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    phoneNumber,
    username,
    password,
    businessName: cleanText(body.businessName, 150),
    gstNumber: cleanText(body.gstNumber, 20),
    serviceArea: cleanText(body.serviceArea, 150),
    addressLine: cleanText(body.addressLine, 300),
    vehicleName: cleanText(body.vehicleName, 80),
    vehicleNumber: cleanText(body.vehicleNumber, 20),
    profileUrl: cleanImage(body.profileUrl),
    // A new partner starts offline and goes online from the app when ready to take orders.
    online: false,
    createdBy: String(req.user._id),
  });
  await audit(req, { action: 'PARTNER_CREATED', entityType: 'PARTNER', entityId: partner._id, entityRef: phoneNumber, toStatus: 'Active' });
  res.status(201).json({ success: true, data: partner });
};

// @route PUT /api/partners/:id  (admin) — profile fields only
exports.updatePartner = async (req, res) => {
  const partner = await Partner.findById(requireValidId(req.params.id));
  if (!partner) throw new AppError(404, 'USER_NOT_FOUND');
  const body = req.body || {};
  if (body.name !== undefined) {
    const name = cleanText(body.name, 100);
    if (!name) throw new AppError(400, 'NAME_REQUIRED');
    partner.name = name;
  }
  if (body.phoneNumber !== undefined && normalizePhone(body.phoneNumber) !== partner.phoneNumber) {
    partner.phoneNumber = await assertPhone(body.phoneNumber, { exclude: { type: 'partner', id: partner._id } });
  }
  ['businessName', 'gstNumber', 'serviceArea', 'addressLine', 'vehicleName', 'vehicleNumber'].forEach((f) => {
    if (body[f] !== undefined) partner[f] = cleanText(body[f], 200);
  });
  if (body.profileUrl !== undefined) partner.profileUrl = cleanImage(body.profileUrl);
  await partner.save();
  await audit(req, { action: 'PARTNER_UPDATED', entityType: 'PARTNER', entityId: partner._id, entityRef: partner.phoneNumber });
  res.status(200).json({ success: true, data: partner });
};

// @route PATCH /api/partners/:id/status  { status: 'Active' | 'Suspended', reason }
exports.setPartnerStatus = async (req, res) => {
  const partner = await Partner.findById(requireValidId(req.params.id));
  if (!partner) throw new AppError(404, 'USER_NOT_FOUND');
  const status = (req.body || {}).status;
  if (!['Active', 'Suspended'].includes(status)) throw new AppError(400, 'STATUS_INVALID');
  const from = partner.status;
  if (from !== status) {
    partner.status = status;
    if (status === 'Suspended') {
      partner.tokenVersion = (partner.tokenVersion || 0) + 1;
      partner.online = false;
      await releaseOrdersOfPartner(req, partner, 'Delivery partner suspended');
    }
    await partner.save();
    await audit(req, {
      action: status === 'Active' ? 'PARTNER_ACTIVATED' : 'PARTNER_SUSPENDED',
      entityType: 'PARTNER',
      entityId: partner._id,
      entityRef: partner.phoneNumber,
      fromStatus: from,
      toStatus: status,
      reason: cleanText((req.body || {}).reason, 300),
    });
  }
  res.status(200).json({ success: true, data: partner });
};

// @route DELETE /api/partners/:id  { confirmPhone, reason }  (Super Admin)
// Closes the account for good: login stops, waiting orders go back to the pool and the mobile
// number is freed for a new partner. Past deliveries, cash and handovers keep the partner's name.
exports.deletePartner = async (req, res) => {
  const partner = await Partner.findById(requireValidId(req.params.id));
  if (!partner || partner.status === 'Deleted') throw new AppError(404, 'USER_NOT_FOUND');
  const confirm = String((req.body || {}).confirmPhone || '').replace(/\D/g, '').slice(-10);
  if (confirm !== partner.phoneNumber) throw new AppError(400, 'PARTNER_DELETE_CONFIRM');
  // Goods already picked up must be delivered (or reported failed) first.
  const onTheWay = await Order.countDocuments({ assignedPartnerId: partner._id, status: 'OUT_FOR_DELIVERY' });
  if (onTheWay > 0) throw new AppError(409, 'PARTNER_HAS_ACTIVE_DELIVERY', { count: onTheWay });
  // Cash collected but not yet handed to the office must be settled first.
  const cash = await Order.aggregate([
    { $match: { deliveredBy: partner._id, amountCollected: { $gt: 0 }, settlementStatus: 'PENDING' } },
    { $group: { _id: null, total: { $sum: '$amountCollected' } } },
  ]);
  const cashHeld = cash.length ? Math.round(cash[0].total * 100) / 100 : 0;
  if (cashHeld > 0) throw new AppError(409, 'PARTNER_HAS_CASH', { amount: cashHeld });

  const from = partner.status;
  partner.online = false;
  await releaseOrdersOfPartner(req, partner, 'Delivery partner deleted');
  partner.status = 'Deleted';
  partner.deletedAt = new Date();
  partner.deletedPhoneNumber = partner.phoneNumber;
  partner.phoneNumber = `deleted_${partner._id}`;
  partner.username = undefined;
  partner.tokenVersion = (partner.tokenVersion || 0) + 1; // signs out every session
  await partner.save({ validateBeforeSave: false });
  await audit(req, {
    action: 'PARTNER_DELETED',
    entityType: 'PARTNER',
    entityId: partner._id,
    entityRef: partner.deletedPhoneNumber,
    fromStatus: from,
    toStatus: 'Deleted',
    reason: cleanText((req.body || {}).reason, 300),
  });
  res.status(200).json({ success: true, message: t(req, 'PARTNER_DELETED'), data: partner });
};

// @route PATCH /api/partners/:id/password  { newPassword, confirmPassword }
exports.resetPartnerPassword = async (req, res) => {
  const partner = await Partner.findById(requireValidId(req.params.id));
  if (!partner) throw new AppError(404, 'USER_NOT_FOUND');
  const { newPassword, confirmPassword } = req.body || {};
  assertPassword(newPassword, confirmPassword);
  partner.password = newPassword;
  partner.tokenVersion = (partner.tokenVersion || 0) + 1;
  partner.failedLoginAttempts = 0;
  partner.lockUntil = null;
  await partner.save();
  await audit(req, { action: 'PASSWORD_RESET_BY_ADMIN', entityType: 'PARTNER', entityId: partner._id, entityRef: partner.phoneNumber });
  res.status(200).json({ success: true, message: t(req, 'PASSWORD_RESET_DONE') });
};
