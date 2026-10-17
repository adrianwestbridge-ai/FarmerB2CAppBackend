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
  profileUrl: { type: String, default: 'https://imgs.search.brave.com/F1eO9FCkTdutQz0izXsxkxblnBKfO4w_-uBSkj7Zi1A/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9tZWRp/YS5pc3RvY2twaG90/by5jb20vaWQvMTMx/NjQyMDY2OC92ZWN0/b3IvdXNlci1pY29u/LWh1bWFuLXBlcnNv/bi1zeW1ib2wtc29j/aWFsLXByb2ZpbGUt/aWNvbi1hdmF0YXIt/bG9naW4tc2lnbi13/ZWItdXNlci1zeW1i/b2wuanBnP3M9NjEy/eDYxMiZ3PTAmaz0y/MCZjPUFocVcyc3NY/OEVlSTJJWUZtNi1B/U1E3cmZlQldmckZG/VjRFODdTYUZoSkU9' },
  coverImageUrl: { type: String, default: 'https://imgs.search.brave.com/GHtnziceWoATyIUqfUx7UI0jSOiDlj8G4WrPR6O8e0s/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9pbWcu/bWFnbmlmaWMuY29t/L3ByZW1pdW0tcGhv/dG8vY2xvc2UtdXAt/YWdyaWN1bHR1cmUt/c2NlbmVyeS1maWVs/ZC13aGVhdC1maWVs/ZC1mYXJtaW5nLWJh/Y2tncm91bmRfMTc5/OTM1LTYzMTA4Lmpw/Zz9zZW10PWFpc190/ZXN0X2Imdz03NDAm/cT04MA' },
  status: { type: String, default: 'Active', enum: ['Active', 'Suspended', 'Pending'] },
  createdBy: { type: String, default: null },
}, {
  timestamps: true,
});

farmerSchema.plugin(accountSecurity);

module.exports = mongoose.model('Farmer', farmerSchema);
