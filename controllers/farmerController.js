const Farmer = require('../models/Farmer');
const { AppError, t } = require('../utils/i18n');
const { audit } = require('../utils/audit');
const { requireValidId, escapeRegex, cleanText, normalizePhone } = require('../utils/validators');
const { assertUsername, assertPhone, assertPassword } = require('../utils/identity');
const { farmerStats, emptyFarmerStats, recentOrdersOfFarmer } = require('../services/userStats');

// @route GET /api/farmers?search&status&page&limit  (admin)
exports.getFarmers = async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const page = Math.max(1, Number(req.query.page) || 1);
  const filter = {};
  if (req.query.status && ['Active', 'Suspended', 'Pending'].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.search) {
    const rx = new RegExp(escapeRegex(cleanText(req.query.search, 60)), 'i');
    filter.$or = [{ name: rx }, { phoneNumber: rx }, { username: rx }, { village: rx }, { district: rx }];
  }
  const [farmers, total] = await Promise.all([
    Farmer.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Farmer.countDocuments(filter),
  ]);
  const stats = await farmerStats(farmers.map((f) => f._id));
  res.status(200).json({
    success: true,
    count: farmers.length,
    total,
    data: farmers.map((f) => ({ ...f.toJSON(), stats: stats.get(String(f._id)) || emptyFarmerStats() })),
  });
};

// @route GET /api/farmers/:id  (admin)
exports.getFarmerById = async (req, res) => {
  const farmer = await Farmer.findById(requireValidId(req.params.id));
  if (!farmer) throw new AppError(404, 'USER_NOT_FOUND');
  const [stats, orders] = await Promise.all([farmerStats([farmer._id]), recentOrdersOfFarmer(farmer._id)]);
  res.status(200).json({
    success: true,
    data: { ...farmer.toJSON(), stats: stats.get(String(farmer._id)) || emptyFarmerStats(), orders },
  });
};

// @route POST /api/farmers  (admin)
exports.createFarmer = async (req, res) => {
  const body = req.body || {};
  const phoneNumber = await assertPhone(body.phoneNumber);
  const username = await assertUsername(body.username);
  const password = assertPassword(body.password, body.confirmPassword);
  const name = cleanText(body.name, 100);
  if (!name) throw new AppError(400, 'NAME_REQUIRED');

  const farmer = await Farmer.create({
    owner_id: `farmer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    phoneNumber,
    username,
    name,
    password,
    addressLine: cleanText(body.addressLine, 300),
    village: cleanText(body.village, 100),
    district: cleanText(body.district, 100),
    state: cleanText(body.state, 100),
    pincode: cleanText(body.pincode, 10),
    createdBy: String(req.user._id),
  });
  await audit(req, { action: 'FARMER_CREATED', entityType: 'FARMER', entityId: farmer._id, entityRef: username, toStatus: 'Active' });
  res.status(201).json({ success: true, data: farmer });
};

// @route PUT /api/farmers/:id  (admin) — profile fields only
exports.updateFarmer = async (req, res) => {
  const farmer = await Farmer.findById(requireValidId(req.params.id));
  if (!farmer) throw new AppError(404, 'USER_NOT_FOUND');
  const body = req.body || {};
  if (body.name !== undefined) {
    const name = cleanText(body.name, 100);
    if (!name) throw new AppError(400, 'NAME_REQUIRED');
    farmer.name = name;
  }
  if (body.phoneNumber !== undefined && normalizePhone(body.phoneNumber) !== farmer.phoneNumber) {
    farmer.phoneNumber = await assertPhone(body.phoneNumber, { exclude: { type: 'farmer', id: farmer._id } });
  }
  ['addressLine', 'village', 'district', 'state', 'pincode', 'cropType', 'language'].forEach((f) => {
    if (body[f] !== undefined) farmer[f] = cleanText(body[f], f === 'addressLine' ? 300 : 100);
  });
  await farmer.save();
  await audit(req, { action: 'FARMER_UPDATED', entityType: 'FARMER', entityId: farmer._id, entityRef: farmer.username || farmer.phoneNumber });
  res.status(200).json({ success: true, data: farmer });
};

// @route PATCH /api/farmers/:id/status  { status: 'Active' | 'Suspended', reason }
exports.setFarmerStatus = async (req, res) => {
  const farmer = await Farmer.findById(requireValidId(req.params.id));
  if (!farmer) throw new AppError(404, 'USER_NOT_FOUND');
  const status = (req.body || {}).status;
  if (!['Active', 'Suspended'].includes(status)) throw new AppError(400, 'STATUS_INVALID');
  const from = farmer.status;
  if (from !== status) {
    farmer.status = status;
    if (status === 'Suspended') farmer.tokenVersion = (farmer.tokenVersion || 0) + 1;
    await farmer.save();
    await audit(req, {
      action: status === 'Active' ? 'FARMER_ACTIVATED' : 'FARMER_SUSPENDED',
      entityType: 'FARMER',
      entityId: farmer._id,
      entityRef: farmer.username || farmer.phoneNumber,
      fromStatus: from,
      toStatus: status,
      reason: cleanText((req.body || {}).reason, 300),
    });
  }
  res.status(200).json({ success: true, data: farmer });
};

// @route PATCH /api/farmers/:id/password  { newPassword, confirmPassword }
exports.resetFarmerPassword = async (req, res) => {
  const farmer = await Farmer.findById(requireValidId(req.params.id));
  if (!farmer) throw new AppError(404, 'USER_NOT_FOUND');
  const { newPassword, confirmPassword } = req.body || {};
  assertPassword(newPassword, confirmPassword);
  farmer.password = newPassword;
  farmer.tokenVersion = (farmer.tokenVersion || 0) + 1;
  farmer.failedLoginAttempts = 0;
  farmer.lockUntil = null;
  await farmer.save();
  await audit(req, { action: 'PASSWORD_RESET_BY_ADMIN', entityType: 'FARMER', entityId: farmer._id, entityRef: farmer.username || farmer.phoneNumber });
  res.status(200).json({ success: true, message: t(req, 'PASSWORD_RESET_DONE') });
};
