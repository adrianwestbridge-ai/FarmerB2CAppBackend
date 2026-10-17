const Setting = require('../models/Setting');

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
  partnerEarningPerDelivery: s.partnerEarningPerDelivery,
});

module.exports = { getSettings, publicSettings };
