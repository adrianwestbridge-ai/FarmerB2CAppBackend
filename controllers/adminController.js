const Admin = require('../models/Admin');
const AuditLog = require('../models/AuditLog');
const { AppError, t } = require('../utils/i18n');
const { audit } = require('../utils/audit');
const { ALL_PERMISSIONS, DEFAULT_PERMISSIONS, PERMISSIONS, effectivePermissions } = require('../utils/permissions');
const { requireValidId, cleanText, normalizePhone, isValidPhone, parseDate } = require('../utils/validators');
const { assertUsername, assertPassword } = require('../utils/identity');

const serialize = (admin) => ({ ...admin.toJSON(), effectivePermissions: effectivePermissions(admin) });

const parsePermissions = (raw, role) => {
  if (raw === undefined) return DEFAULT_PERMISSIONS[role] || [];
  if (!Array.isArray(raw) || raw.some((p) => !ALL_PERMISSIONS.includes(p))) throw new AppError(400, 'PERMISSION_INVALID');
  return [...new Set(raw)];
};

const parseRole = (role) => {
  const r = String(role || 'ADMIN').toUpperCase();
  if (!['ADMIN', 'MODERATOR'].includes(r)) throw new AppError(400, 'ADMIN_ROLE_INVALID');
  return r;
};

// Loads a manageable admin: never the Super Admin account itself.
const loadManaged = async (id) => {
  const admin = await Admin.findById(requireValidId(id));
  if (!admin || admin.status === 'Deleted') throw new AppError(404, 'USER_NOT_FOUND');
  if (admin.role === 'SUPER_ADMIN') throw new AppError(403, 'ADMIN_CANNOT_MODIFY_SUPER');
  return admin;
};

// @route GET /api/admins/permissions
exports.getPermissionCatalog = async (req, res) => {
  res.status(200).json({ success: true, data: { permissions: Object.values(PERMISSIONS), defaults: DEFAULT_PERMISSIONS } });
};

// @route GET /api/admins?status=Active|Deactivated|Deleted
exports.getAdmins = async (req, res) => {
  const filter = {};
  if (req.query.status && ['Active', 'Deactivated', 'Deleted'].includes(req.query.status)) filter.status = req.query.status;
  else filter.status = { $ne: 'Deleted' };
  const admins = await Admin.find(filter).sort({ role: -1, createdAt: -1 });
  res.status(200).json({ success: true, count: admins.length, data: admins.map(serialize) });
};

// @route GET /api/admins/:id
exports.getAdmin = async (req, res) => {
  const admin = await Admin.findById(requireValidId(req.params.id));
  if (!admin) throw new AppError(404, 'USER_NOT_FOUND');
  res.status(200).json({ success: true, data: serialize(admin) });
};

// @route POST /api/admins
exports.createAdmin = async (req, res) => {
  const body = req.body || {};
  const username = await assertUsername(body.username);
  const password = assertPassword(body.password, body.confirmPassword);
  const name = cleanText(body.name, 100);
  if (!name) throw new AppError(400, 'NAME_REQUIRED');
  const role = parseRole(body.role);
  const permissions = parsePermissions(body.permissions, role);
  const phone = normalizePhone(body.phoneNumber);
  if (phone && !isValidPhone(phone)) throw new AppError(400, 'PHONE_INVALID');

  const admin = await Admin.create({
    owner_id: `admin_${Date.now()}`,
    username,
    password,
    name,
    role,
    permissions,
    phoneNumber: phone,
    email: cleanText(body.email, 200),
    status: 'Active',
    createdBy: String(req.user._id),
  });

  await audit(req, { action: 'ADMIN_CREATED', entityType: 'ADMIN', entityId: admin._id, entityRef: username, toStatus: 'Active', metadata: { role, permissions } });
  res.status(201).json({ success: true, data: serialize(admin) });
};

// @route PUT /api/admins/:id  { name, phoneNumber, email, role, permissions }
exports.updateAdmin = async (req, res) => {
  const admin = await loadManaged(req.params.id);
  const body = req.body || {};
  const before = { name: admin.name, role: admin.role, permissions: [...(admin.permissions || [])], phoneNumber: admin.phoneNumber, email: admin.email };

  if (body.name !== undefined) {
    const name = cleanText(body.name, 100);
    if (!name) throw new AppError(400, 'NAME_REQUIRED');
    admin.name = name;
  }
  if (body.phoneNumber !== undefined) {
    const phone = normalizePhone(body.phoneNumber);
    if (phone && !isValidPhone(phone)) throw new AppError(400, 'PHONE_INVALID');
    admin.phoneNumber = phone;
  }
  if (body.email !== undefined) admin.email = cleanText(body.email, 200);
  if (body.role !== undefined) admin.role = parseRole(body.role);
  if (body.permissions !== undefined) admin.permissions = parsePermissions(body.permissions, admin.role);

  await admin.save();
  await audit(req, {
    action: 'ADMIN_UPDATED',
    entityType: 'ADMIN',
    entityId: admin._id,
    entityRef: admin.username,
    metadata: { before, after: { name: admin.name, role: admin.role, permissions: admin.permissions, phoneNumber: admin.phoneNumber, email: admin.email } },
  });
  res.status(200).json({ success: true, data: serialize(admin) });
};

// @route PATCH /api/admins/:id/status  { status: 'Active' | 'Deactivated', reason }
exports.setAdminStatus = async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) throw new AppError(400, 'ADMIN_CANNOT_MODIFY_SELF');
  const admin = await loadManaged(req.params.id);
  const status = (req.body || {}).status;
  if (!['Active', 'Deactivated'].includes(status)) throw new AppError(400, 'STATUS_INVALID');
  const from = admin.status;
  if (from !== status) {
    admin.status = status;
    if (status === 'Deactivated') admin.tokenVersion = (admin.tokenVersion || 0) + 1; // end active sessions
    await admin.save();
    await audit(req, {
      action: status === 'Active' ? 'ADMIN_ACTIVATED' : 'ADMIN_DEACTIVATED',
      entityType: 'ADMIN',
      entityId: admin._id,
      entityRef: admin.username,
      fromStatus: from,
      toStatus: status,
      reason: cleanText((req.body || {}).reason, 300),
    });
  }
  res.status(200).json({ success: true, data: serialize(admin) });
};

// @route DELETE /api/admins/:id  { confirmUsername, reason }
// Soft delete: the account can no longer log in, but every order, payment and audit record
// that references it is preserved.
exports.deleteAdmin = async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) throw new AppError(400, 'ADMIN_CANNOT_MODIFY_SELF');
  const admin = await loadManaged(req.params.id);
  const confirm = cleanText((req.body || {}).confirmUsername, 60).toLowerCase();
  if (confirm !== admin.username) throw new AppError(400, 'ADMIN_DELETE_CONFIRM');
  const from = admin.status;
  admin.status = 'Deleted';
  admin.deletedAt = new Date();
  admin.tokenVersion = (admin.tokenVersion || 0) + 1;
  await admin.save();
  await audit(req, {
    action: 'ADMIN_DELETED',
    entityType: 'ADMIN',
    entityId: admin._id,
    entityRef: admin.username,
    fromStatus: from,
    toStatus: 'Deleted',
    reason: cleanText((req.body || {}).reason, 300),
  });
  res.status(200).json({ success: true, message: t(req, 'ADMIN_DELETED'), data: serialize(admin) });
};

// @route PATCH /api/admins/:id/password  { newPassword, confirmPassword }
exports.resetAdminPassword = async (req, res) => {
  const admin = await loadManaged(req.params.id);
  const { newPassword, confirmPassword } = req.body || {};
  assertPassword(newPassword, confirmPassword);
  admin.password = newPassword;
  admin.tokenVersion = (admin.tokenVersion || 0) + 1;
  admin.failedLoginAttempts = 0;
  admin.lockUntil = null;
  await admin.save();
  await audit(req, { action: 'PASSWORD_RESET_BY_ADMIN', entityType: 'ADMIN', entityId: admin._id, entityRef: admin.username });
  res.status(200).json({ success: true, message: t(req, 'PASSWORD_RESET_DONE') });
};

// @route GET /api/admins/:id/activity?from&to&page&limit — what this admin did
exports.getAdminActivity = async (req, res) => {
  const admin = await Admin.findById(requireValidId(req.params.id));
  if (!admin) throw new AppError(404, 'USER_NOT_FOUND');
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const page = Math.max(1, Number(req.query.page) || 1);
  const filter = { actorId: String(admin._id) };
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to, true);
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }
  const [logs, total, summary] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    AuditLog.countDocuments(filter),
    AuditLog.aggregate([{ $match: filter }, { $group: { _id: '$action', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
  ]);
  res.status(200).json({
    success: true,
    total,
    page,
    pages: Math.ceil(total / limit),
    summary: summary.map((s) => ({ action: s._id, count: s.count })),
    data: logs,
  });
};
