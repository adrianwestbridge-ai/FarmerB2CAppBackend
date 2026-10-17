const { AppError } = require('../utils/i18n');
const { audit } = require('../utils/audit');
const { getSettings, publicSettings } = require('../utils/settings');
const { cleanText, toMoney } = require('../utils/validators');

// @route GET /api/settings/public — values the app needs before / after login
exports.getPublicSettings = async (req, res) => {
  const settings = await getSettings();
  res.status(200).json({ success: true, data: publicSettings(settings) });
};

// @route GET /api/settings  (super admin)
exports.getSettings = async (req, res) => {
  const settings = await getSettings();
  res.status(200).json({ success: true, data: settings });
};

// @route PUT /api/settings  (super admin)
exports.updateSettings = async (req, res) => {
  const body = req.body || {};
  const settings = await getSettings();
  const before = publicSettings(settings);

  const money = (key) => {
    if (body[key] === undefined) return;
    const v = Number(body[key]);
    if (!Number.isFinite(v) || v < 0 || v > 100000) throw new AppError(400, 'SETTINGS_INVALID');
    settings[key] = toMoney(v);
  };
  money('deliveryFee');
  money('freeDeliveryAbove');
  money('partnerEarningPerDelivery');

  if (body.loginMethod !== undefined) {
    if (!['USERNAME_OR_MOBILE', 'USERNAME', 'MOBILE'].includes(body.loginMethod)) throw new AppError(400, 'SETTINGS_INVALID');
    settings.loginMethod = body.loginMethod;
  }
  ['codEnabled', 'onlineEnabled'].forEach((k) => {
    if (body[k] !== undefined) settings[k] = body[k] === true || body[k] === 'true';
  });
  if (!settings.codEnabled && !settings.onlineEnabled) throw new AppError(400, 'SETTINGS_INVALID');
  if (body.upiId !== undefined) settings.upiId = cleanText(body.upiId, 100);
  if (body.upiPayeeName !== undefined) settings.upiPayeeName = cleanText(body.upiPayeeName, 100);
  if (body.paymentInstructions !== undefined) settings.paymentInstructions = cleanText(body.paymentInstructions, 1000);
  if (body.paymentInstructionsHi !== undefined) settings.paymentInstructionsHi = cleanText(body.paymentInstructionsHi, 1000);

  settings.updatedBy = String(req.user._id);
  await settings.save();
  await audit(req, { action: 'SETTINGS_UPDATED', entityType: 'SETTINGS', entityId: settings._id, metadata: { before, after: publicSettings(settings) } });
  res.status(200).json({ success: true, data: settings });
};
