/*
 * One-time, idempotent migration: the MODERATOR role no longer exists.
 *
 * - Every MODERATOR account becomes an ADMIN account and KEEPS its permissions
 *   (normally "approve orders" + "assign delivery partners"), so nobody is locked out
 *   and the Super Admin can widen or narrow them later.
 * - Every recorded role "MODERATOR" in history (orders, settlements, activity log) is
 *   rewritten to "ADMIN", so reports and filters keep counting that work.
 *
 *   node scripts/migrate-v4-remove-moderator.js            # migrates the database in MONGODB_URI (db FarmerB2C)
 *   DRY_RUN=1 node scripts/migrate-v4-remove-moderator.js  # report only, no writes
 *
 * Take a backup (mongodump) before running it against production.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.env.DRY_RUN === '1';
const OLD = 'MODERATOR';
const NEW = 'ADMIN';

/** Returns a copy of `value` with every "MODERATOR" under a *role / *Role key replaced, and whether anything changed. */
const rewrite = (value) => {
  let changed = false;
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof mongoose.Types.ObjectId) && !Buffer.isBuffer(v) && v._bsontype === undefined) {
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        if (/role$/i.test(k) && x === OLD) { out[k] = NEW; changed = true; } else out[k] = walk(x);
      }
      return out;
    }
    return v;
  };
  const out = walk(value);
  return { out, changed };
};

async function run() {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || 'FarmerB2C' });
  const db = mongoose.connection.db;
  const report = { dryRun: DRY, adminsConverted: [], ordersUpdated: 0, settlementsUpdated: 0, auditLogsUpdated: 0 };

  // 1. Accounts: MODERATOR -> ADMIN, permissions kept as they are.
  const mods = await db.collection('admins').find({ role: OLD }).project({ username: 1, permissions: 1 }).toArray();
  report.adminsConverted = mods.map((m) => ({ username: m.username, permissions: m.permissions || [] }));
  if (!DRY && mods.length) await db.collection('admins').updateMany({ role: OLD }, { $set: { role: NEW } });

  // 2. Activity log.
  const auditFilter = { actorRole: OLD };
  report.auditLogsUpdated = await db.collection('auditlogs').countDocuments(auditFilter);
  if (!DRY && report.auditLogsUpdated) await db.collection('auditlogs').updateMany(auditFilter, { $set: { actorRole: NEW } });

  // 3. Orders and settlements: role fields inside history / payment / assignment records.
  for (const [name, key] of [['orders', 'ordersUpdated'], ['settlements', 'settlementsUpdated']]) {
    const all = db.collection(name).find({});
    for await (const doc of all) {
      const { _id, ...rest } = doc;
      const { out, changed } = rewrite(rest);
      if (!changed) continue;
      report[key] += 1;
      if (!DRY) await db.collection(name).replaceOne({ _id }, out);
    }
  }

  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Migration failed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
