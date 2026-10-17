const AuditLog = require('../models/AuditLog');

const actorRoleOf = (user) => {
  if (!user) return 'ANONYMOUS';
  if (user.userType === 'admin') return user.role || 'ADMIN';
  if (user.userType === 'partner') return 'PARTNER';
  if (user.userType === 'farmer') return 'FARMER';
  return 'SYSTEM';
};

const clientIp = (req) => (req && (req.ip || (req.socket && req.socket.remoteAddress))) || '';

/**
 * Record an audit entry. Never throws: a logging failure must not break the business action,
 * but it is reported to the server log so it can be investigated.
 */
const audit = async (req, entry) => {
  try {
    const user = entry.actor !== undefined ? entry.actor : (req && req.user);
    await AuditLog.create({
      actorId: user ? String(user._id) : null,
      actorRole: entry.actorRole || actorRoleOf(user),
      actorName: user ? (user.name || user.username || '') : (entry.actorName || ''),
      action: entry.action,
      entityType: entry.entityType || '',
      entityId: entry.entityId ? String(entry.entityId) : '',
      entityRef: entry.entityRef || '',
      fromStatus: entry.fromStatus || '',
      toStatus: entry.toStatus || '',
      reason: entry.reason || '',
      metadata: entry.metadata || {},
      ip: clientIp(req),
    });
  } catch (err) {
    console.error('[audit] failed to write audit log:', err.message);
  }
};

module.exports = { audit, actorRoleOf };
