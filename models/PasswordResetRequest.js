const mongoose = require('mongoose');

// Without OTP, a forgotten password is reset by an admin after calling the user's registered
// mobile number. Users raise a request; admins see and resolve it.
const passwordResetRequestSchema = new mongoose.Schema({
  identifier: { type: String, required: true, trim: true },
  userType: { type: String, enum: ['farmer', 'partner', 'admin', 'unknown'], default: 'unknown' },
  userId: { type: String, default: null, index: true },
  userName: { type: String, default: '' },
  phoneNumber: { type: String, default: '' },
  status: { type: String, enum: ['OPEN', 'RESOLVED', 'REJECTED'], default: 'OPEN', index: true },
  resolvedBy: { type: String, default: null },
  resolvedByName: { type: String, default: '' },
  resolvedAt: { type: Date, default: null },
  note: { type: String, default: '' },
}, {
  timestamps: true,
});

module.exports = mongoose.model('PasswordResetRequest', passwordResetRequestSchema);
