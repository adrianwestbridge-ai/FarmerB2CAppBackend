const fs = require('fs');
const path = require('path');
const Setting = require('../models/Setting');

// The business's own payment QR (seed-assets/payment-qr.png or .jpg). It is shown whenever the
// Super Admin has not uploaded another one, so farmers always get the right QR to pay.
// The image type is read from the file itself (a JPEG saved as .png still works).
const imageMime = (buf) => {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return '';
};
const loadDefaultQr = () => {
  for (const file of ['payment-qr.png', 'payment-qr.jpg', 'payment-qr.jpeg', 'payment-qr.webp']) {
    const full = path.join(__dirname, '..', 'seed-assets', file);
    if (!fs.existsSync(full)) continue;
    const buf = fs.readFileSync(full);
    const mime = imageMime(buf);
    if (mime) return `data:${mime};base64,${buf.toString('base64')}`;
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
