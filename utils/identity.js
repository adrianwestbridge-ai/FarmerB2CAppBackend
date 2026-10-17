const Farmer = require('../models/Farmer');
const Partner = require('../models/Partner');
const Admin = require('../models/Admin');
const { AppError } = require('./i18n');
const { normalizePhone, isValidPhone, normalizeUsername, isValidUsername } = require('./validators');

// Usernames are unique across every account type; mobile numbers are unique across farmers and
// delivery partners (the two account types that can log in with a mobile number).

const isUsernameTaken = async (username, exclude = {}) => {
  const [f, p, a] = await Promise.all([
    Farmer.findOne({ username }).select('_id'),
    Partner.findOne({ username }).select('_id'),
    Admin.findOne({ username }).select('_id'),
  ]);
  const hits = [
    f && { type: 'farmer', id: String(f._id) },
    p && { type: 'partner', id: String(p._id) },
    a && { type: 'admin', id: String(a._id) },
  ].filter(Boolean);
  return hits.some((h) => !(h.type === exclude.type && h.id === String(exclude.id)));
};

const isPhoneTaken = async (phoneNumber, exclude = {}) => {
  const [f, p] = await Promise.all([
    Farmer.findOne({ phoneNumber }).select('_id'),
    Partner.findOne({ phoneNumber }).select('_id'),
  ]);
  const hits = [
    f && { type: 'farmer', id: String(f._id) },
    p && { type: 'partner', id: String(p._id) },
  ].filter(Boolean);
  return hits.some((h) => !(h.type === exclude.type && h.id === String(exclude.id)));
};

/** Validates + normalizes a username, throwing localized errors. */
const assertUsername = async (raw, { required = true, exclude } = {}) => {
  const username = normalizeUsername(raw);
  if (!username) {
    if (required) throw new AppError(400, 'USERNAME_REQUIRED');
    return undefined;
  }
  if (!isValidUsername(username)) throw new AppError(400, 'USERNAME_INVALID');
  if (await isUsernameTaken(username, exclude)) throw new AppError(400, 'USERNAME_TAKEN');
  return username;
};

/** Validates + normalizes a mobile number, throwing localized errors. */
const assertPhone = async (raw, { required = true, exclude, unique = true } = {}) => {
  const phone = normalizePhone(raw);
  if (!phone) {
    if (required) throw new AppError(400, 'PHONE_REQUIRED');
    return undefined;
  }
  if (!isValidPhone(phone)) throw new AppError(400, 'PHONE_INVALID');
  if (unique && await isPhoneTaken(phone, exclude)) throw new AppError(400, 'PHONE_TAKEN');
  return phone;
};

const assertPassword = (password, confirmPassword) => {
  if (typeof password !== 'string' || password.length < 6) throw new AppError(400, 'PASSWORD_MIN_LENGTH');
  if (confirmPassword !== undefined && password !== confirmPassword) throw new AppError(400, 'PASSWORD_MISMATCH');
  return password;
};

module.exports = { isUsernameTaken, isPhoneTaken, assertUsername, assertPhone, assertPassword };
