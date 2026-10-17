const mongoose = require('mongoose');

const ORDER_STATUSES = [
  'PENDING_APPROVAL', // placed by the farmer, waiting for an admin to verify by phone
  'APPROVED',         // accepted by an admin; available to delivery partners (open pool)
  'ASSIGNED',         // a delivery partner confirmed availability / was assigned
  'OUT_FOR_DELIVERY', // picked up by the delivery partner
  'DELIVERED',
  'DELIVERY_FAILED',  // partner reported a failed attempt; admin decides next step
  'REJECTED',         // admin rejected after verification
  'CANCELLED',        // cancelled by the farmer or an admin
];

// CANCELLED = nothing is owed any more (order rejected / cancelled before any payment was made).
const PAYMENT_STATUSES = ['PENDING', 'AWAITING_VERIFICATION', 'PAID', 'FAILED', 'REFUND_PENDING', 'REFUNDED', 'CANCELLED'];
const COLLECTION_STATUSES = ['NOT_APPLICABLE', 'PENDING', 'COLLECTED', 'DISPUTED'];
const SETTLEMENT_STATUSES = ['NOT_APPLICABLE', 'PENDING', 'SUBMITTED', 'VERIFIED', 'DISPUTED'];
const VERIFICATION_OUTCOMES = ['CONFIRMED', 'DENIED', 'NOT_REACHABLE', 'DETAILS_INCORRECT'];

const itemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: { type: String, required: true },
  productNameHi: { type: String, default: '' },
  image: { type: String, default: '' },
  unit: { type: String, default: '' },
  unitQuantity: { type: Number, default: 1 },
  mrp: { type: Number, required: true },
  unitPrice: { type: Number, required: true },
  quantity: { type: Number, required: true, min: 1 },
  lineMrpTotal: { type: Number, required: true },
  lineSubtotal: { type: Number, required: true },
  offerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', default: null },
  offerTitle: { type: String, default: '' },
  offerTitleHi: { type: String, default: '' },
  offerDiscountType: { type: String, default: '' },
  offerDiscountValue: { type: Number, default: 0 },
  discountPerUnit: { type: Number, default: 0 },
  lineDiscount: { type: Number, default: 0 },
  lineTotal: { type: Number, required: true },
}, { _id: false });

const historySchema = new mongoose.Schema({
  status: { type: String, required: true },
  at: { type: Date, default: Date.now },
  byId: { type: String, default: null },
  byRole: { type: String, default: '' },
  byName: { type: String, default: '' },
  note: { type: String, default: '' },
}, { _id: false });

const callSchema = new mongoose.Schema({
  outcome: { type: String, enum: VERIFICATION_OUTCOMES, required: true },
  note: { type: String, default: '' },
  at: { type: Date, default: Date.now },
  byId: { type: String, required: true },
  byName: { type: String, default: '' },
}, { _id: false });

const assignmentEventSchema = new mongoose.Schema({
  action: { type: String, enum: ['ACCEPTED', 'ASSIGNED_BY_ADMIN', 'UNAVAILABLE', 'RELEASED_BY_ADMIN', 'FAILED', 'PICKED_UP', 'DELIVERED'], required: true },
  partnerId: { type: String, default: null },
  partnerName: { type: String, default: '' },
  reason: { type: String, default: '' },
  at: { type: Date, default: Date.now },
  byId: { type: String, default: null },
  byRole: { type: String, default: '' },
  byName: { type: String, default: '' },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true, index: true },

  // Farmer
  farmerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmer', required: true, index: true },
  owner_id: { type: String, required: true, index: true },
  farmerName: { type: String, default: '' },
  farmerPhone: { type: String, default: '' },
  deliveryAddress: { type: String, required: true },

  // Line items and totals (₹), computed on the server at placement time.
  items: { type: [itemSchema], validate: (v) => Array.isArray(v) && v.length > 0 },
  mrpTotal: { type: Number, required: true },
  subtotal: { type: Number, required: true },
  discount: { type: Number, default: 0 },
  deliveryCharge: { type: Number, default: 0 },
  totalAmount: { type: Number, required: true, min: 0 },

  // Order lifecycle
  status: { type: String, enum: ORDER_STATUSES, default: 'PENDING_APPROVAL', index: true },
  statusHistory: { type: [historySchema], default: [] },
  trackingNote: { type: String, default: '' },

  // Admin phone verification & decision
  verificationCalls: { type: [callSchema], default: [] },
  verificationOutcome: { type: String, enum: [...VERIFICATION_OUTCOMES, ''], default: '' },
  decisionBy: { type: String, default: null, index: true },
  decisionByName: { type: String, default: '' },
  decisionAt: { type: Date, default: null },
  approvedAt: { type: Date, default: null, index: true },
  rejectionReason: { type: String, default: '' },

  // Cancellation
  cancelledBy: { type: String, default: null },
  cancelledByRole: { type: String, default: '' },
  cancelledByName: { type: String, default: '' },
  cancelledAt: { type: Date, default: null },
  cancelReason: { type: String, default: '' },

  // Delivery assignment
  assignedPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null, index: true },
  assignedPartnerName: { type: String, default: '' },
  assignedPartnerPhone: { type: String, default: '' },
  assignedAt: { type: Date, default: null },
  assignedBy: { type: String, default: '' },  // 'SELF' (accepted from pool) or admin id
  assignedByName: { type: String, default: '' },
  assignmentHistory: { type: [assignmentEventSchema], default: [] },
  pickedUpAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null, index: true },
  deliveredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null, index: true },
  deliveryProofUrl: { type: String, default: '' },
  deliveryNote: { type: String, default: '' },
  failureReason: { type: String, default: '' },
  failedAt: { type: Date, default: null },

  // Payment
  paymentMethod: { type: String, enum: ['COD', 'ONLINE'], required: true },
  paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'PENDING', index: true },
  paymentReference: { type: String, default: '', trim: true },
  paymentSubmittedAt: { type: Date, default: null },
  paymentVerifiedBy: { type: String, default: null },
  paymentVerifiedByName: { type: String, default: '' },
  paidAt: { type: Date, default: null },
  paymentFailureReason: { type: String, default: '' },
  refundAmount: { type: Number, default: 0 },
  refundReference: { type: String, default: '' },
  refundReason: { type: String, default: '' },
  refundedAt: { type: Date, default: null },
  refundedBy: { type: String, default: null },
  paymentHistory: { type: [historySchema], default: [] },

  // Cash on delivery collection & settlement (separate from the order and payment status)
  expectedCollection: { type: Number, default: 0 },
  amountCollected: { type: Number, default: 0 },
  collectedAt: { type: Date, default: null },
  collectionStatus: { type: String, enum: COLLECTION_STATUSES, default: 'NOT_APPLICABLE', index: true },
  collectionNote: { type: String, default: '' },
  settlementStatus: { type: String, enum: SETTLEMENT_STATUSES, default: 'NOT_APPLICABLE', index: true },
  settlementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Settlement', default: null, index: true },

  // Prevents duplicate submissions from double taps / retries.
  idempotencyKey: { type: String, default: null },
}, {
  timestamps: true,
  // Concurrent edits (e.g. two partners accepting the same order) fail with a VersionError
  // instead of silently overwriting each other.
  optimisticConcurrency: true,
});

orderSchema.index({ farmerId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
orderSchema.index({ paymentReference: 1 }, { unique: true, partialFilterExpression: { paymentReference: { $gt: '' } } });
orderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
module.exports.ORDER_STATUSES = ORDER_STATUSES;
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;
module.exports.COLLECTION_STATUSES = COLLECTION_STATUSES;
module.exports.SETTLEMENT_STATUSES = SETTLEMENT_STATUSES;
module.exports.VERIFICATION_OUTCOMES = VERIFICATION_OUTCOMES;
