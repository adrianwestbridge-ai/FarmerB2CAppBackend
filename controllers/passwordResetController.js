const PasswordResetRequest = require('../models/PasswordResetRequest');
const Farmer = require('../models/Farmer');
const Partner = require('../models/Partner');
const Admin = require('../models/Admin');
const { AppError, t } = require('../utils/i18n');
const { audit } = require('../utils/audit');
const { requireValidId, cleanText } = require('../utils/validators');
const { assertPassword } = require('../utils/identity');

const MODELS = { farmer: Farmer, partner: Partner, admin: Admin };
const isSuper = (req) => req.user.role === 'SUPER_ADMIN';

// @route GET /api/password-resets?status=OPEN
// Admin-account requests are only visible to the Super Admin.
exports.listRequests = async (req, res) => {
  const filter = {};
  const status = String(req.query.status || 'OPEN').toUpperCase();
  if (['OPEN', 'RESOLVED', 'REJECTED'].includes(status)) filter.status = status;
  if (!isSuper(req)) filter.userType = { $ne: 'admin' };
  const requests = await PasswordResetRequest.find(filter).sort({ createdAt: -1 }).limit(200);
  res.status(200).json({ success: true, count: requests.length, data: requests });
};

// @route PATCH /api/password-resets/:id/resolve  { newPassword, confirmPassword, note }
// Called after the admin has phoned the user's registered number and verified them.
exports.resolveRequest = async (req, res) => {
  const request = await PasswordResetRequest.findById(requireValidId(req.params.id));
  if (!request || request.status !== 'OPEN') throw new AppError(404, 'NOT_FOUND');
  if (request.userType === 'admin' && !isSuper(req)) throw new AppError(403, 'AUTH_SUPER_ADMIN_ONLY');
  const Model = MODELS[request.userType];
  const user = Model && request.userId ? await Model.findById(request.userId) : null;
  if (!user) throw new AppError(404, 'USER_NOT_FOUND');

  const { newPassword, confirmPassword, note } = req.body || {};
  assertPassword(newPassword, confirmPassword);
  user.password = newPassword;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  await user.save();

  request.status = 'RESOLVED';
  request.resolvedBy = String(req.user._id);
  request.resolvedByName = req.user.name || req.user.username;
  request.resolvedAt = new Date();
  request.note = cleanText(note, 300);
  await request.save();

  await audit(req, {
    action: 'PASSWORD_RESET_BY_ADMIN',
    entityType: request.userType.toUpperCase(),
    entityId: user._id,
    entityRef: request.identifier,
    reason: request.note,
    metadata: { requestId: String(request._id) },
  });
  res.status(200).json({ success: true, message: t(req, 'PASSWORD_RESET_DONE'), data: request });
};

// @route PATCH /api/password-resets/:id/reject  { note }
exports.rejectRequest = async (req, res) => {
  const request = await PasswordResetRequest.findById(requireValidId(req.params.id));
  if (!request || request.status !== 'OPEN') throw new AppError(404, 'NOT_FOUND');
  if (request.userType === 'admin' && !isSuper(req)) throw new AppError(403, 'AUTH_SUPER_ADMIN_ONLY');
  request.status = 'REJECTED';
  request.resolvedBy = String(req.user._id);
  request.resolvedByName = req.user.name || req.user.username;
  request.resolvedAt = new Date();
  request.note = cleanText((req.body || {}).note, 300);
  await request.save();
  await audit(req, { action: 'PASSWORD_RESET_REJECTED', entityType: 'AUTH', entityId: request._id, entityRef: request.identifier, reason: request.note });
  res.status(200).json({ success: true, data: request });
};
