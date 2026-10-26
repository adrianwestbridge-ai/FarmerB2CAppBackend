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
  profileUrl: { type: String, default: '' },
  coverImageUrl: { type: String, default: '' },
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
