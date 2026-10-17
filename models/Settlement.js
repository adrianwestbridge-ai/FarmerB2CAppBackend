const mongoose = require('mongoose');

// A cash handover by a delivery partner to the business. Each settlement covers a set of COD
// orders whose cash the partner collected. Expected vs submitted amounts are kept so that any
// difference stays visible for reconciliation.
const settlementSchema = new mongoose.Schema({
  settlementNumber: { type: String, required: true, unique: true },
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
  partnerName: { type: String, default: '' },
  partnerPhone: { type: String, default: '' },
  orders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Order' }],
  orderNumbers: [{ type: String }],

  expectedAmount: { type: Number, required: true, min: 0 },   // Σ cash collected on those orders
  submittedAmount: { type: Number, required: true, min: 0 },  // cash actually handed over
  difference: { type: Number, default: 0 },                   // submitted − expected

  handoverReference: { type: String, default: '' },           // receipt / deposit slip number
  handedOverAt: { type: Date, default: Date.now },
  handedOverTo: { type: String, default: '' },                // admin or business account
  notes: { type: String, default: '' },

  status: { type: String, enum: ['SUBMITTED', 'VERIFIED', 'DISPUTED'], default: 'SUBMITTED', index: true },
  submittedBy: { type: String, required: true },
  submittedByRole: { type: String, default: '' },
  submittedByName: { type: String, default: '' },
  verifiedBy: { type: String, default: null },
  verifiedByName: { type: String, default: '' },
  verifiedAt: { type: Date, default: null },
  disputeReason: { type: String, default: '' },
  resolutionNote: { type: String, default: '' },
}, {
  timestamps: true,
  optimisticConcurrency: true,
});

settlementSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Settlement', settlementSchema);
