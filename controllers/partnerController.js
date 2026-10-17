const Partner = require('../models/Partner');
const Order = require('../models/Order');
const { AppError, t } = require('../utils/i18n');
const { audit } = require('../utils/audit');
const { requireValidId, escapeRegex, cleanText, normalizePhone } = require('../utils/validators');
const { assertUsername, assertPhone, assertPassword } = require('../utils/identity');
const { releaseOrdersOfPartner } = require('../services/orderService');

// @route GET /api/partners?status&online&search  (admin)
exports.getPartners = async (req, res) => {
  const filter = {};
  if (req.query.status && ['Active', 'Suspended', 'Pending'].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.online === 'true') filter.online = true;
  if (req.query.online === 'false') filter.online = false;
  if (req.query.search) {
    const rx = new RegExp(escapeRegex(cleanText(req.query.search, 60)), 'i');
    filter.$or = [{ name: rx }, { phoneNumber: rx }, { username: rx }, { businessName: rx }];
  }
  const partners = await Partner.find(filter).sort({ createdAt: -1 });

  // Current workload per partner, to help admins pick who to assign.
  const loads = await Order.aggregate([
    { $match: { assignedPartnerId: { $in: partners.map((p) => p._id) }, status: { $in: ['ASSIGNED', 'OUT_FOR_DELIVERY'] } } },
    { $group: { _id: '$assignedPartnerId', active: { $sum: 1 } } },
  ]);
  const loadMap = new Map(loads.map((l) => [String(l._id), l.active]));

  res.status(200).json({
    success: true,
    count: partners.length,
    data: partners.map((p) => ({ ...p.toJSON(), activeDeliveries: loadMap.get(String(p._id)) || 0 })),
  });
};

// @route GET /api/partners/:id  (admin)
exports.getPartner = async (req, res) => {
  const partner = await Partner.findById(requireValidId(req.params.id));
  if (!partner) throw new AppError(404, 'USER_NOT_FOUND');
  res.status(200).json({ success: true, data: partner });
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
