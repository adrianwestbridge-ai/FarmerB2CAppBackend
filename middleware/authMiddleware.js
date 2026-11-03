const jwt = require('jsonwebtoken');
const Farmer = require('../models/Farmer');
const Admin = require('../models/Admin');
const Partner = require('../models/Partner');
const { t } = require('../utils/i18n');
const { audit } = require('../utils/audit');
const { hasPermission, effectivePermissions } = require('../utils/permissions');

const MODELS = { farmer: Farmer, partner: Partner, admin: Admin };

// Admins: Active | Deactivated | Deleted. Farmers / partners: Active | Suspended | Pending.
const isAccountActive = (user) => user.status === 'Active';

// Farmers and partners stay signed in on their phone until they log out, so their token is long-lived
// and renewed by GET /auth/me (sliding). Admin sessions live only in app memory and use the shorter one.
// Revocation (password change, suspension, deletion) still works at any time through tokenVersion.
const tokenLifetime = (userType) => (userType === 'admin'
  ? process.env.JWT_EXPIRES_IN || '7d'
  : process.env.JWT_USER_EXPIRES_IN || '90d');

const signToken = (user, userType) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return jwt.sign(
    { id: String(user._id), userType, tv: user.tokenVersion || 0 },
    secret,
    { expiresIn: tokenLifetime(userType) },
  );
};

const extractToken = (req) => {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
};

// Resolves the user for a token, or null if the token/account is not valid any more.
const resolveUser = async (token) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  let decoded;
  try {
    decoded = jwt.verify(token, secret);
  } catch (e) {
    return null;
  }
  const Model = MODELS[decoded.userType];
  if (!Model || !decoded.id) return null;
  const user = await Model.findById(decoded.id);
  if (!user) return null;
  if ((user.tokenVersion || 0) !== (decoded.tv || 0)) return null;
  if (!isAccountActive(user)) return { inactive: true };
  user.userType = decoded.userType;
  return { user, userType: decoded.userType };
};

/**
 * Requires a valid session. Deactivated / deleted / suspended accounts and sessions issued before
 * a password change are rejected on every request, not just at login.
 */
const protect = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ success: false, code: 'AUTH_TOKEN_MISSING', message: t(req, 'AUTH_TOKEN_MISSING') });
  }
  const resolved = await resolveUser(token);
  if (!resolved) {
    return res.status(401).json({ success: false, code: 'AUTH_TOKEN_INVALID', message: t(req, 'AUTH_TOKEN_INVALID') });
  }
  if (resolved.inactive) {
    return res.status(401).json({ success: false, code: 'AUTH_ACCOUNT_INACTIVE', message: t(req, 'AUTH_ACCOUNT_INACTIVE') });
  }
  req.user = resolved.user;
  req.userType = resolved.userType;
  next();
};

/** Attaches req.user when a valid token is present; otherwise continues anonymously. */
const optionalAuth = async (req, res, next) => {
  const token = extractToken(req);
  if (token) {
    const resolved = await resolveUser(token);
    if (resolved && !resolved.inactive) {
      req.user = resolved.user;
      req.userType = resolved.userType;
    }
  }
  next();
};

const deny = async (req, res, key) => {
  await audit(req, {
    action: 'ACCESS_DENIED',
    entityType: 'AUTH',
    reason: `${req.method} ${req.originalUrl}`,
    metadata: { required: key },
  });
  return res.status(403).json({ success: false, code: key, message: t(req, key) });
};

const requireUserType = (userType, key) => (req, res, next) => {
  if (req.userType === userType) return next();
  return deny(req, res, key);
};

const farmerOnly = requireUserType('farmer', 'AUTH_ROLE_FARMER');
const partnerOnly = requireUserType('partner', 'AUTH_ROLE_PARTNER');
const adminOnly = requireUserType('admin', 'AUTH_ROLE_ADMIN');

const superAdminOnly = (req, res, next) => {
  if (req.userType === 'admin' && req.user.role === 'SUPER_ADMIN') return next();
  return deny(req, res, 'AUTH_SUPER_ADMIN_ONLY');
};

/** Admin holding the given permission (the Super Admin holds all). */
const requirePermission = (...permissions) => (req, res, next) => {
  if (req.userType === 'admin' && permissions.some((p) => hasPermission(req.user, p))) return next();
  return deny(req, res, 'AUTH_FORBIDDEN');
};

module.exports = {
  protect,
  optionalAuth,
  farmerOnly,
  partnerOnly,
  adminOnly,
  superAdminOnly,
  requirePermission,
  signToken,
  resolveUser,
  effectivePermissions,
  MODELS,
};
