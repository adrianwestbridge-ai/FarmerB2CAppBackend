const mongoose = require('mongoose');
const accountSecurity = require('./plugins/accountSecurity');
const { ALL_PERMISSIONS } = require('../utils/permissions');

const adminSchema = new mongoose.Schema({
  owner_id: { type: String, required: true },
  username: { type: String, required: true, unique: true, index: true, trim: true, lowercase: true },
  name: { type: String, required: true, trim: true },
  phoneNumber: { type: String, default: '', trim: true },
  email: { type: String, default: '', trim: true },
  role: { type: String, required: true, enum: ['SUPER_ADMIN', 'MODERATOR', 'ADMIN'], default: 'ADMIN' },
  permissions: [{ type: String, enum: ALL_PERMISSIONS }],
  profileUrl: { type: String, default: 'https://imgs.search.brave.com/F1eO9FCkTdutQz0izXsxkxblnBKfO4w_-uBSkj7Zi1A/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9tZWRp/YS5pc3RvY2twaG90/by5jb20vaWQvMTMx/NjQyMDY2OC92ZWN0/b3IvdXNlci1pY29u/LWh1bWFuLXBlcnNv/bi1zeW1ib2wtc29j/aWFsLXByb2ZpbGUt/aWNvbi1hdmF0YXIt/bG9naW4tc2lnbi13/ZWItdXNlci1zeW1i/b2wuanBnP3M9NjEy/eDYxMiZ3PTAmaz0y/MCZjPUFocVcyc3NY/OEVlSTJJWUZtNi1B/U1E3cmZlQldmckZG/VjRFODdTYUZoSkU9' },
  coverImageUrl: { type: String, default: 'https://imgs.search.brave.com/_yuX2tH4JdE-dUamrbOxiUG8cZ-Z0UdyKzZw5BH8TTQ/rs:fit:500:0:1:0/g:ce/aHR0cHM6Ly90My5m/dGNkbi5uZXQvanBn/LzIwLzQ0Lzg4Lzk0/LzM2MF9GXzIwNDQ4/ODk0MDZfT1dsb1dD/RGdTcW1DM0Vxd1ZN/VW5ncXR0c2JsUnpW/N0IuanBn' },
  // Active accounts can log in. Deactivated / Deleted accounts are kept (soft delete) so that
  // historical orders, payments and audit logs that reference them remain intact.
  status: { type: String, default: 'Active', enum: ['Active', 'Deactivated', 'Deleted'], index: true },
  deletedAt: { type: Date, default: null },
  createdBy: { type: String, default: null },
}, {
  timestamps: true,
});

adminSchema.plugin(accountSecurity);

module.exports = mongoose.model('Admin', adminSchema);
