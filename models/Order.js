const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  owner_id: { type: String, required: true, index: true },
  farmerId: { type: String, required: true },
  status: { 
    type: String, 
    default: 'PLACED', 
    enum: ['PLACED', 'SHIPPED', 'DELIVERED', 'CANCELLED'] 
  },
  paymentMethod: { type: String, default: 'COD', enum: ['COD', 'ONLINE', 'UPI'] },
  paymentStatus: { 
    type: String, 
    default: 'PENDING', 
    enum: ['PENDING', 'PAID', 'FAILED'] 
  },
  paymentReference: { type: String, default: '' },
  totalAmount: { type: Number, required: true, min: 0 },
  deliveryAddress: { type: String, required: true },
  trackingNote: { type: String, default: 'Order placed successfully' },
  assignedPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
  assignedPartnerName: { type: String, default: '' },
  assignedPartnerPhone: { type: String, default: '' },
  deliveryProofUrl: { type: String, default: '' },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  quantity: { type: Number, default: 1, min: 1 },
  price: { type: Number, default: 0 },
  productName: { type: String, default: '' },
  productImage: { type: String, default: '' },
  farmerName: { type: String, default: '' },
  farmerPhone: { type: String, default: '' },
}, {
  timestamps: true 
});

module.exports = mongoose.model('Order', orderSchema);

