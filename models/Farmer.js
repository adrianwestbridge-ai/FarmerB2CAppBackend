const mongoose = require('mongoose');
const accountSecurity = require('./plugins/accountSecurity');

const farmerSchema = new mongoose.Schema({
  owner_id: { type: String, required: true, index: true },
  phoneNumber: { type: String, required: true, unique: true, index: true, trim: true },
  username: { type: String, unique: true, sparse: true, index: true, trim: true, lowercase: true },
  name: { type: String, default: '', trim: true },
  language: { type: String, default: 'English' }, // spoken language, informational
  cropType: { type: String, default: '' },
  landSizeAcres: { type: Number, default: 0 },
  addressLine: { type: String, default: '' },
  village: { type: String, default: '' },
  district: { type: String, default: '' },
  state: { type: String, default: '' },
  pincode: { type: String, default: '' },
  profileUrl: { type: String, default: '' },
  coverImageUrl: { type: String, default: '' },
  status: { type: String, default: 'Active', enum: ['Active', 'Suspended', 'Pending'] },
  createdBy: { type: String, default: null },
}, {
  timestamps: true,
});

farmerSchema.plugin(accountSecurity);

module.exports = mongoose.model('Farmer', farmerSchema);
