const { AppError } = require('../utils/i18n');
const { audit } = require('../utils/audit');
const { getSettings, publicSettings } = require('../utils/settings');
const { cleanText, cleanImage, toMoney, UPI_ID_RE, normalizeUpiId } = require('../utils/validators');

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
  const auditView = (x) => ({ ...publicSettings(x), upiQrImage: x.upiQrImage ? '[image]' : '' });
  const before = auditView(settings);

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
  if (body.upiId !== undefined) {
    const upi = normalizeUpiId(body.upiId);
    if (upi && !UPI_ID_RE.test(upi)) throw new AppError(400, 'UPI_ID_INVALID');
    settings.upiId = upi;
  }
  if (body.upiQrImage !== undefined) {
    const qr = cleanImage(body.upiQrImage);
    if (String(body.upiQrImage || '').trim() && !qr) throw new AppError(400, 'UPI_QR_INVALID');
    settings.upiQrImage = qr;
  }
  if (body.helplineNumber !== undefined) {
    const helpline = String(body.helplineNumber || '').replace(/[^\d+]/g, '');
    if (helpline && !/^\+?\d{6,15}$/.test(helpline)) throw new AppError(400, 'HELPLINE_INVALID');
    settings.helplineNumber = helpline;
  }
  // Farmers pay online by scanning the QR the Super Admin uploads.
  if (settings.onlineEnabled && !settings.upiQrImage) throw new AppError(400, 'UPI_QR_REQUIRED');
  if (body.upiPayeeName !== undefined) settings.upiPayeeName = cleanText(body.upiPayeeName, 100);
  if (body.paymentInstructions !== undefined) settings.paymentInstructions = cleanText(body.paymentInstructions, 1000);
  if (body.paymentInstructionsHi !== undefined) settings.paymentInstructionsHi = cleanText(body.paymentInstructionsHi, 1000);

  settings.updatedBy = String(req.user._id);
  await settings.save();
  await audit(req, { action: 'SETTINGS_UPDATED', entityType: 'SETTINGS', entityId: settings._id, metadata: { before, after: auditView(settings) } });
  res.status(200).json({ success: true, data: settings });
};
