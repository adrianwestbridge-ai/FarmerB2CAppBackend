const mongoose = require('mongoose');
const { AppError } = require('./i18n');

// Accepts "9876543210", "+91 98765 43210", "09876543210" → "9876543210".
const normalizePhone = (value) => {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
};

const isValidPhone = (phone) => /^[6-9]\d{9}$/.test(phone);

const normalizeUsername = (value) => String(value || '').trim().toLowerCase();
const isValidUsername = (username) => /^[a-z0-9_]{3,20}$/.test(username);

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || '')) && String(id).length === 24;

const requireValidId = (id) => {
  if (!isValidId(id)) throw new AppError(400, 'INVALID_ID');
  return String(id);
};

const cleanText = (value, max = 500) => String(value === undefined || value === null ? '' : value).trim().slice(0, max);

const toMoney = (n) => Math.round((Number(n) || 0) * 100) / 100;

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Parse "YYYY-MM-DD" (local IST business day) or ISO strings. Returns Date or null.
const parseDate = (value, endOfDay = false) => {
  if (!value) return null;
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  let d;
  if (m) {
    // Interpret as India Standard Time (UTC+05:30) calendar day.
    const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0) - 330 * 60000;
    d = new Date(endOfDay ? base + 24 * 3600000 - 1 : base);
  } else {
    d = new Date(s);
  }
  return Number.isNaN(d.getTime()) ? null : d;
};

module.exports = {
  normalizePhone,
  isValidPhone,
  normalizeUsername,
  isValidUsername,
  isValidId,
  requireValidId,
  cleanText,
  toMoney,
  escapeRegex,
  parseDate,
};
