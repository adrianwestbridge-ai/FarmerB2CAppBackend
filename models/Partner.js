const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const partnerSchema = new mongoose.Schema({
  owner_id: { type: String, required: true },
  name: { type: String, required: true },
  phoneNumber: { type: String, required: true, unique: true, index: true },
  password: { type: String },
  businessName: { type: String, default: '' },
  gstNumber: { type: String, default: '' },
  serviceArea: { type: String, default: '' },
  addressLine: { type: String, default: '' },
  profileUrl: { type: String, default: 'https://imgs.search.brave.com/F1eO9FCkTdutQz0izXsxkxblnBKfO4w_-uBSkj7Zi1A/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9tZWRp/YS5pc3RvY2twaG90/by5jb20vaWQvMTMx/NjQyMDY2OC92ZWN0/b3IvdXNlci1pY29u/LWh1bWFuLXBlcnNv/bi1zeW1ib2wtc29j/aWFsLXByb2ZpbGUt/aWNvbi1hdmF0YXIt/bG9naW4tc2lnbi13/ZWItdXNlci1zeW1i/b2wuanBnP3M9NjEy/eDYxMiZ3PTAmaz0y/MCZjPUFocVcyc3NY/OEVlSTJJWUZtNi1B/U1E3cmZlQldmckZG/VjRFODdTYUZoSkU9' },
  coverImageUrl: { type: String, default: 'https://imgs.search.brave.com/S3axndwF2I-zGId7wURk_6c6EFCh7EXC-G_5Xh9jePE/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly90My5m/dGNkbi5uZXQvanBn/LzA1LzQ5LzQwLzEy/LzM2MF9GXzU0OTQw/MTI5MV9uN1hUajEz/ZXlxaFBaUWxRbHpE/VFFsSG8zQ2RsdHd3/NC5qcGc' },
  online: { type: Boolean, default: true },
  vehicleName: { type: String, default: 'Mahindra Pickup' },
  vehicleNumber: { type: String, default: 'UP 70 AB 1234' },
  status: { type: String, default: 'Active', enum: ['Active', 'Suspended', 'Pending'] },
}, { 
  timestamps: true 
});

partnerSchema.pre('save', async function(next) {
  if (!this.isModified('password') || !this.password) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

partnerSchema.methods.matchPassword = async function(enteredPassword) {
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('Partner', partnerSchema);
