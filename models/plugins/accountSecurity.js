const bcrypt = require('bcrypt');

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const isBcryptHash = (value) => typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);

/**
 * Shared password / session security for Farmer, Partner and Admin accounts:
 * - bcrypt hashing on save
 * - lockout after repeated failed logins
 * - tokenVersion so password changes / deactivation revoke existing sessions
 * - preferred app language (en | hi)
 */
module.exports = function accountSecurity(schema) {
  schema.add({
    password: { type: String },
    tokenVersion: { type: Number, default: 0 },
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    appLanguage: { type: String, enum: ['en', 'hi'], default: 'en' },
  });

  schema.pre('save', async function () {
    if (!this.isModified('password') || !this.password || isBcryptHash(this.password)) return;
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  });

  // Returns true on match. Legacy plaintext passwords (from old raw inserts) are accepted once
  // and flagged so the caller re-saves them hashed.
  schema.methods.matchPassword = async function (entered) {
    if (!this.password || typeof entered !== 'string' || !entered) return false;
    if (isBcryptHash(this.password)) return bcrypt.compare(entered, this.password);
    const ok = entered === this.password;
    if (ok) this.$locals.needsRehash = true;
    return ok;
  };

  schema.methods.isLocked = function () {
    return !!(this.lockUntil && this.lockUntil.getTime() > Date.now());
  };

  schema.methods.lockMinutesRemaining = function () {
    if (!this.isLocked()) return 0;
    return Math.max(1, Math.ceil((this.lockUntil.getTime() - Date.now()) / 60000));
  };

  schema.methods.registerFailedLogin = async function () {
    this.failedLoginAttempts = (this.failedLoginAttempts || 0) + 1;
    if (this.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      this.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
      this.failedLoginAttempts = 0;
    }
    await this.save({ validateBeforeSave: false });
  };

  schema.methods.registerSuccessfulLogin = async function () {
    this.failedLoginAttempts = 0;
    this.lockUntil = null;
    this.lastLoginAt = new Date();
    await this.save({ validateBeforeSave: false });
  };

  // Strip secrets whenever a document is serialized.
  const hideSecrets = (doc, ret) => {
    delete ret.password;
    delete ret.tokenVersion;
    delete ret.failedLoginAttempts;
    delete ret.lockUntil;
    return ret;
  };
  schema.set('toJSON', { transform: hideSecrets });
  schema.set('toObject', { transform: hideSecrets });
};

module.exports.MAX_FAILED_ATTEMPTS = MAX_FAILED_ATTEMPTS;
module.exports.LOCK_MINUTES = LOCK_MINUTES;
module.exports.isBcryptHash = isBcryptHash;
