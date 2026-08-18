const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  owner_id: { type: String, required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  quantity: { type: Number, default: 1, min: 1 },
  addedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

module.exports = mongoose.model('CartItem', cartItemSchema);
