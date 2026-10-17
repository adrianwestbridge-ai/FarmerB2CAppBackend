const mongoose = require('mongoose');

// Single business-configuration document (key = 'global'), editable by the Super Admin.
const settingSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },

  // Login: which identifier users may log in with.
  loginMethod: { type: String, enum: ['USERNAME_OR_MOBILE', 'USERNAME', 'MOBILE'], default: 'USERNAME_OR_MOBILE' },

  // Delivery charges (₹). freeDeliveryAbove = 0 disables the free-delivery threshold.
  deliveryFee: { type: Number, default: 50, min: 0 },
  freeDeliveryAbove: { type: Number, default: 0, min: 0 },

  // Payment modes.
  codEnabled: { type: Boolean, default: true },
  onlineEnabled: { type: Boolean, default: true },
  upiId: { type: String, default: '' },
  upiPayeeName: { type: String, default: '' },
  paymentInstructions: { type: String, default: '' },
  paymentInstructionsHi: { type: String, default: '' },

  // Delivery partner earnings (kept separate from customer cash collections). 0 = not used.
  partnerEarningPerDelivery: { type: Number, default: 0, min: 0 },

  updatedBy: { type: String, default: null },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Setting', settingSchema);
