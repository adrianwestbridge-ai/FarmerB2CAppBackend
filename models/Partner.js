const mongoose = require('mongoose');
const accountSecurity = require('./plugins/accountSecurity');

const partnerSchema = new mongoose.Schema({
  owner_id: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  phoneNumber: { type: String, required: true, unique: true, index: true, trim: true },
  username: { type: String, unique: true, sparse: true, index: true, trim: true, lowercase: true },
  businessName: { type: String, default: '' },
  gstNumber: { type: String, default: '' },
  serviceArea: { type: String, default: '' },
  addressLine: { type: String, default: '' },
  profileUrl: { type: String, default: '' },
  coverImageUrl: { type: String, default: '' },
  online: { type: Boolean, default: true },
  vehicleName: { type: String, default: '' },
  vehicleNumber: { type: String, default: '' },
  status: { type: String, default: 'Active', enum: ['Active', 'Suspended', 'Pending'] },
  createdBy: { type: String, default: null },
}, {
  timestamps: true,
});

partnerSchema.plugin(accountSecurity);

module.exports = mongoose.model('Partner', partnerSchema);
