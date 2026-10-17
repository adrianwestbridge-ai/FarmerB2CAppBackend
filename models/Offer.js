const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  titleHi: { type: String, default: '', trim: true },
  description: { type: String, default: '' },
  descriptionHi: { type: String, default: '' },

  // PERCENT: discountValue % off the selling price. FIXED: ₹discountValue off per unit.
  discountType: { type: String, enum: ['PERCENT', 'FIXED'], required: true },
  discountValue: { type: Number, required: true, min: 0 },

  products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product', index: true }],

  // Eligibility: minimum cart subtotal (₹, at selling price) and minimum quantity of the product.
  minPurchaseAmount: { type: Number, default: 0, min: 0 },
  minQuantity: { type: Number, default: 1, min: 1 },

  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  isActive: { type: Boolean, default: true, index: true },

  createdBy: { type: String, default: null },
  createdByName: { type: String, default: '' },
  updatedBy: { type: String, default: null },
  updatedByName: { type: String, default: '' },
}, {
  timestamps: true,
});

offerSchema.index({ isActive: 1, startDate: 1, endDate: 1 });

// ACTIVE | SCHEDULED | EXPIRED | INACTIVE — derived, never stored, so it can't go stale.
offerSchema.methods.statusAt = function (now = new Date()) {
  if (!this.isActive) return 'INACTIVE';
  if (this.endDate.getTime() < now.getTime()) return 'EXPIRED';
  if (this.startDate.getTime() > now.getTime()) return 'SCHEDULED';
  return 'ACTIVE';
};

module.exports = mongoose.model('Offer', offerSchema);
