const fs = require('fs');
const path = require('path');
const Setting = require('../models/Setting');

// The business's own payment QR (seed-assets/payment-qr.png or .jpg). It is shown whenever the
// Super Admin has not uploaded another one, so farmers always get the right QR to pay.
const loadDefaultQr = () => {
  for (const [file, mime] of [['payment-qr.png', 'image/png'], ['payment-qr.jpg', 'image/jpeg'], ['payment-qr.jpeg', 'image/jpeg']]) {
    const full = path.join(__dirname, '..', 'seed-assets', file);
    if (fs.existsSync(full)) return `data:${mime};base64,${fs.readFileSync(full).toString('base64')}`;
  }
  return '';
};
const DEFAULT_QR = loadDefaultQr();

const getSettings = async () => {
  let settings = await Setting.findOne({ key: 'global' });
  if (!settings) {
    try {
      settings = await Setting.create({ key: 'global' });
    } catch (err) {
      // Concurrent first request created it; read it back.
      settings = await Setting.findOne({ key: 'global' });
    }
  }
  return settings;
};

const publicSettings = (s) => ({
  loginMethod: s.loginMethod,
  deliveryFee: s.deliveryFee,
  freeDeliveryAbove: s.freeDeliveryAbove,
  codEnabled: s.codEnabled,
  onlineEnabled: s.onlineEnabled,
  upiId: s.upiId,
  upiPayeeName: s.upiPayeeName,
  paymentInstructions: s.paymentInstructions,
  paymentInstructionsHi: s.paymentInstructionsHi,
  upiQrImage: s.upiQrImage || DEFAULT_QR,
  helplineNumber: s.helplineNumber || '',
  partnerEarningPerDelivery: s.partnerEarningPerDelivery,
});

module.exports = { getSettings, publicSettings, DEFAULT_QR };
