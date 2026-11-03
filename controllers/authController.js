const bcrypt = require('bcrypt');
const Farmer = require('../models/Farmer');
const Admin = require('../models/Admin');
const Partner = require('../models/Partner');
const Order = require('../models/Order');
const PasswordResetRequest = require('../models/PasswordResetRequest');
const { signToken, effectivePermissions } = require('../middleware/authMiddleware');
const { t, AppError } = require('../utils/i18n');
const { audit } = require('../utils/audit');
const { getSettings } = require('../utils/settings');
const { normalizePhone, isValidPhone, normalizeUsername, isValidUsername, cleanText, cleanImage } = require('../utils/validators');
const { assertUsername, assertPhone, assertPassword, isUsernameTaken } = require('../utils/identity');
const { releaseOrdersOfPartner } = require('../services/orderService');
const CartItem = require('../models/CartItem');

// A real bcrypt hash used to keep the response time of "unknown user" equal to "wrong password".
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-not-a-password', 10);

const sessionPayload = (user, userType, token) => ({
  success: true,
  token,
  userType,
  data: user.toJSON(),
  permissions: userType === 'admin' ? effectivePermissions(user) : [],
});

// Collect every account the identifier could refer to, honouring the configured login method.
// Admins always log in with their username.
const findLoginCandidates = async (identifier, loginMethod) => {
  const phone = normalizePhone(identifier);
  const looksLikePhone = isValidPhone(phone);
  const username = normalizeUsername(identifier);
  const allowMobile = loginMethod !== 'USERNAME';
  const allowUsername = loginMethod !== 'MOBILE';

  const queries = [];
  if (allowMobile && looksLikePhone) {
    queries.push(Farmer.findOne({ phoneNumber: phone }).then((u) => u && { user: u, userType: 'farmer' }));
    queries.push(Partner.findOne({ phoneNumber: phone }).then((u) => u && { user: u, userType: 'partner' }));
  }
  if (allowUsername && isValidUsername(username)) {
    queries.push(Farmer.findOne({ username }).then((u) => u && { user: u, userType: 'farmer' }));
    queries.push(Partner.findOne({ username }).then((u) => u && { user: u, userType: 'partner' }));
  }
  if (isValidUsername(username)) {
    queries.push(Admin.findOne({ username }).then((u) => u && { user: u, userType: 'admin' }));
  }
  const results = (await Promise.all(queries)).filter(Boolean);
  const seen = new Set();
  return results.filter((c) => {
    const key = `${c.userType}:${c.user._id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// @route   POST /api/auth/login
// @body    { identifier, password }  (legacy: username / phoneNumber)
exports.login = async (req, res) => {
  const body = req.body || {};
  const identifier = cleanText(body.identifier || body.username || body.phoneNumber || '', 100);
  const password = typeof body.password === 'string' ? body.password : '';

  if (!identifier) throw new AppError(400, 'AUTH_IDENTIFIER_REQUIRED');
  if (!password) throw new AppError(400, 'AUTH_PASSWORD_REQUIRED');

  const settings = await getSettings();
  const candidates = await findLoginCandidates(identifier, settings.loginMethod);

  if (candidates.length === 0) {
    await bcrypt.compare(password, DUMMY_HASH);
    await audit(req, { actor: null, action: 'LOGIN_FAILED', entityType: 'AUTH', entityRef: identifier, reason: 'UNKNOWN_IDENTIFIER' });
    // Tell the user which identifier type is expected when a method restriction applies.
    const looksLikePhone = isValidPhone(normalizePhone(identifier));
    if (settings.loginMethod === 'MOBILE' && !looksLikePhone && !(await Admin.exists({ username: normalizeUsername(identifier) }))) {
      throw new AppError(401, 'AUTH_MOBILE_ONLY');
    }
    if (settings.loginMethod === 'USERNAME' && looksLikePhone) throw new AppError(401, 'AUTH_USERNAME_ONLY');
    throw new AppError(401, 'AUTH_INVALID_CREDENTIALS');
  }

  const locked = candidates.find((c) => c.user.isLocked());
  if (locked && candidates.length === 1) {
    await audit(req, { actor: locked.user, actorRole: locked.userType.toUpperCase(), action: 'LOGIN_BLOCKED', entityType: 'AUTH', entityId: locked.user._id, entityRef: identifier, reason: 'LOCKED' });
    throw new AppError(429, 'AUTH_ACCOUNT_LOCKED', { minutes: locked.user.lockMinutesRemaining() });
  }

  let matched = null;
  for (const candidate of candidates) {
    if (candidate.user.isLocked()) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await candidate.user.matchPassword(password)) {
      matched = candidate;
      break;
    }
  }

  if (!matched) {
    for (const candidate of candidates) {
      if (!candidate.user.isLocked()) {
        // eslint-disable-next-line no-await-in-loop
        await candidate.user.registerFailedLogin();
      }
    }
    await audit(req, {
      actor: candidates[0].user,
      actorRole: candidates[0].userType === 'admin' ? candidates[0].user.role : candidates[0].userType.toUpperCase(),
      action: 'LOGIN_FAILED',
      entityType: 'AUTH',
      entityId: candidates[0].user._id,
      entityRef: identifier,
      reason: 'WRONG_PASSWORD',
    });
    throw new AppError(401, 'AUTH_INVALID_CREDENTIALS');
  }

  const { user, userType } = matched;
  const actorRole = userType === 'admin' ? user.role : userType.toUpperCase();

  if (user.status !== 'Active') {
    await audit(req, { actor: user, actorRole, action: 'LOGIN_BLOCKED', entityType: 'AUTH', entityId: user._id, entityRef: identifier, reason: `STATUS_${String(user.status).toUpperCase()}` });
    throw new AppError(403, 'AUTH_ACCOUNT_INACTIVE');
  }

  if (user.$locals.needsRehash) user.password = password; // re-hashed by the pre-save hook
  await user.registerSuccessfulLogin();

  await audit(req, { actor: user, actorRole, action: 'LOGIN_SUCCESS', entityType: 'AUTH', entityId: user._id, entityRef: identifier });

  user.userType = userType;
  res.status(200).json(sessionPayload(user, userType, signToken(user, userType)));
};

// @route   POST /api/auth/register  (Farmer self-registration)
exports.registerFarmer = async (req, res) => {
  const body = req.body || {};
  const phoneNumber = await assertPhone(body.phoneNumber, { exclude: {} });
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
    language: cleanText(body.language, 40) || 'English',
    cropType: cleanText(body.cropType, 100),
    landSizeAcres: Math.max(0, Number(body.landSizeAcres) || 0),
    addressLine: cleanText(body.addressLine, 300),
    village: cleanText(body.village, 100),
    district: cleanText(body.district, 100),
    state: cleanText(body.state, 100),
    pincode: cleanText(body.pincode, 10),
    appLanguage: body.appLanguage === 'hi' ? 'hi' : 'en',
  });

  await audit(req, { actor: farmer, actorRole: 'FARMER', action: 'ACCOUNT_REGISTERED', entityType: 'FARMER', entityId: farmer._id, entityRef: username });

  farmer.userType = 'farmer';
  res.status(201).json(sessionPayload(farmer, 'farmer', signToken(farmer, 'farmer')));
};

// @route   GET /api/auth/me
// Farmers and partners also get a renewed token, so a saved session never expires while the app is used.
exports.getMe = async (req, res) => {
  res.status(200).json({
    success: true,
    ...(req.userType !== 'admin' && { token: signToken(req.user, req.userType) }),
    userType: req.userType,
    data: req.user.toJSON(),
    permissions: req.userType === 'admin' ? effectivePermissions(req.user) : [],
  });
};

// @route   PUT /api/auth/me — users may only edit their own descriptive profile fields.
exports.updateMe = async (req, res) => {
  const body = req.body || {};
  const user = req.user;
  const set = (field, value) => { if (value !== undefined) user[field] = value; };

  if (body.name !== undefined) {
    const name = cleanText(body.name, 100);
    if (!name) throw new AppError(400, 'NAME_REQUIRED');
    user.name = name;
  }
  // Photos come from the phone camera / gallery as compressed data URIs (or a public URL).
  if (body.profileUrl !== undefined) set('profileUrl', cleanImage(body.profileUrl));
  if (body.coverImageUrl !== undefined) set('coverImageUrl', cleanImage(body.coverImageUrl));
  if (body.appLanguage !== undefined) set('appLanguage', body.appLanguage === 'hi' ? 'hi' : 'en');

  if (req.userType === 'farmer') {
    if (body.phoneNumber !== undefined && normalizePhone(body.phoneNumber) !== user.phoneNumber) {
      user.phoneNumber = await assertPhone(body.phoneNumber, { exclude: { type: 'farmer', id: user._id } });
    }
    ['language', 'cropType', 'addressLine', 'village', 'district', 'state', 'pincode'].forEach((f) => {
      if (body[f] !== undefined) set(f, cleanText(body[f], f === 'addressLine' ? 300 : 100));
    });
    if (body.landSizeAcres !== undefined) set('landSizeAcres', Math.max(0, Number(body.landSizeAcres) || 0));
  } else if (req.userType === 'partner') {
    ['businessName', 'gstNumber', 'serviceArea', 'addressLine', 'vehicleName', 'vehicleNumber'].forEach((f) => {
      if (body[f] !== undefined) set(f, cleanText(body[f], 200));
    });
    if (body.online !== undefined) {
      const goingOnline = body.online === true || body.online === 'true';
      if (!goingOnline && user.online !== false) {
        // Cannot vanish with goods in hand; assigned-but-not-picked-up orders return to the pool.
        const outForDelivery = await Order.countDocuments({ assignedPartnerId: user._id, status: 'OUT_FOR_DELIVERY' });
        if (outForDelivery > 0) throw new AppError(400, 'PARTNER_OFFLINE_ACTIVE_DELIVERY');
        await releaseOrdersOfPartner(req, user, 'Delivery partner went offline');
      }
      user.online = goingOnline;
    }
  } else if (req.userType === 'admin') {
    if (body.phoneNumber !== undefined) {
      const phone = normalizePhone(body.phoneNumber);
      if (phone && !isValidPhone(phone)) throw new AppError(400, 'PHONE_INVALID');
      user.phoneNumber = phone;
    }
    if (body.email !== undefined) set('email', cleanText(body.email, 200));
  }

  await user.save();
  res.status(200).json({ success: true, data: user.toJSON() });
};

// @route   PUT /api/auth/update-password
exports.updatePassword = async (req, res) => {
  const { oldPassword, newPassword, confirmPassword } = req.body || {};
  assertPassword(newPassword, confirmPassword);
  if (!oldPassword) throw new AppError(400, 'PASSWORD_OLD_REQUIRED');
  if (!(await req.user.matchPassword(oldPassword))) throw new AppError(401, 'PASSWORD_OLD_INCORRECT');

  req.user.password = newPassword;
  req.user.tokenVersion = (req.user.tokenVersion || 0) + 1; // sign out every other session
  await req.user.save();

  await audit(req, { action: 'PASSWORD_CHANGED', entityType: req.userType.toUpperCase(), entityId: req.user._id });
  res.status(200).json({
    success: true,
    message: t(req, 'PASSWORD_UPDATED'),
    token: signToken(req.user, req.userType),
  });
};

const OPEN_ORDER_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED'];

// @route   DELETE /api/auth/me  (farmer) — deletes the farmer's own account (Play Store requirement).
// Personal details are erased and the phone number / username are freed for a new registration.
// Orders stay as business and tax records, with the name and phone recorded at order time.
exports.deleteMe = async (req, res) => {
  if (req.userType !== 'farmer') throw new AppError(403, 'ACCOUNT_DELETE_STAFF');
  const { password } = req.body || {};
  if (!password || !(await req.user.matchPassword(password))) throw new AppError(401, 'PASSWORD_OLD_INCORRECT');
  const open = await Order.countDocuments({ farmerId: req.user._id, status: { $in: OPEN_ORDER_STATUSES } });
  if (open > 0) throw new AppError(409, 'ACCOUNT_HAS_OPEN_ORDERS', { count: open });

  const farmer = req.user;
  const ownerId = farmer.owner_id;
  const id = String(farmer._id);
  farmer.status = 'Deleted';
  farmer.deletedAt = new Date();
  farmer.name = 'Deleted farmer';
  farmer.phoneNumber = `deleted_${id}`;
  farmer.username = undefined;
  ['addressLine', 'village', 'district', 'state', 'pincode', 'cropType', 'profileUrl', 'coverImageUrl'].forEach((k) => { farmer[k] = ''; });
  farmer.landSizeAcres = 0;
  farmer.password = undefined;
  farmer.tokenVersion = (farmer.tokenVersion || 0) + 1; // signs out every session
  await farmer.save({ validateBeforeSave: false });
  if (ownerId) await CartItem.deleteMany({ owner_id: ownerId });
  await PasswordResetRequest.deleteMany({ userId: id }).catch(() => {});

  await audit(req, { action: 'ACCOUNT_DELETED', entityType: 'FARMER', entityId: farmer._id, reason: 'Deleted by the farmer' });
  res.status(200).json({ success: true, message: t(req, 'ACCOUNT_DELETED') });
};

// @route   GET /api/auth/check-username?username=xyz
exports.checkUsernameAvailability = async (req, res) => {
  const username = normalizeUsername(req.query.username);
  if (!username) throw new AppError(400, 'USERNAME_REQUIRED');
  if (!isValidUsername(username)) throw new AppError(400, 'USERNAME_INVALID');
  const available = !(await isUsernameTaken(username));
  res.status(200).json({ success: true, available, message: t(req, available ? 'USERNAME_AVAILABLE' : 'USERNAME_TAKEN') });
};

// @route   POST /api/auth/forgot-password
// Always returns the same response so the endpoint cannot be used to discover accounts.
exports.requestPasswordReset = async (req, res) => {
  const identifier = cleanText((req.body || {}).identifier, 100);
  if (!identifier) throw new AppError(400, 'AUTH_IDENTIFIER_REQUIRED');

  const candidates = await findLoginCandidates(identifier, 'USERNAME_OR_MOBILE');
  const match = candidates[0];

  const recentOpen = match && await PasswordResetRequest.findOne({ userId: String(match.user._id), status: 'OPEN' });
  if (!recentOpen) {
    const request = await PasswordResetRequest.create({
      identifier,
      userType: match ? match.userType : 'unknown',
      userId: match ? String(match.user._id) : null,
      userName: match ? (match.user.name || match.user.username || '') : '',
      phoneNumber: match ? (match.user.phoneNumber || '') : '',
    });
    await audit(req, { actor: null, action: 'PASSWORD_RESET_REQUESTED', entityType: 'AUTH', entityId: request._id, entityRef: identifier });
  }

  res.status(200).json({ success: true, message: t(req, 'PASSWORD_RESET_REQUESTED') });
};
