const mongoose = require('mongoose');

// Append-only audit trail. Updates and deletes are blocked at the model layer so that
// no API path (or accidental script using the model) can silently rewrite history.
const auditLogSchema = new mongoose.Schema({
  actorId: { type: String, default: null, index: true },
  actorRole: { type: String, default: 'SYSTEM', index: true }, // FARMER | PARTNER | ADMIN | MODERATOR | SUPER_ADMIN | SYSTEM | ANONYMOUS
  actorName: { type: String, default: '' },
  action: { type: String, required: true, index: true },
  entityType: { type: String, default: '', index: true }, // ORDER | ADMIN | FARMER | PARTNER | OFFER | SETTLEMENT | PRODUCT | SETTINGS | AUTH
  entityId: { type: String, default: '', index: true },
  entityRef: { type: String, default: '' },                 // human readable: order number, username...
  fromStatus: { type: String, default: '' },
  toStatus: { type: String, default: '' },
  reason: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  ip: { type: String, default: '' },
}, {
  timestamps: { createdAt: true, updatedAt: false },
});

auditLogSchema.index({ createdAt: -1 });

const blockMutation = function () {
  throw new Error('Audit logs are immutable');
};

['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete'].forEach((op) => {
  auditLogSchema.pre(op, blockMutation);
});

auditLogSchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('Audit logs are immutable'));
  next();
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
