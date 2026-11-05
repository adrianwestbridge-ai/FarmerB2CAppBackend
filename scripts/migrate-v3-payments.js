/*
 * One-time, idempotent migration to the payment ledger (partial QR payments, Accounts team).
 * Every order gets a `payments` ledger built from its old single UTR, plus the paid-online /
 * awaiting-confirmation totals, cash to collect and payment status recomputed from it.
 * Orders that already have ledger entries are left alone.
 *
 *   node scripts/migrate-v3-payments.js            # migrates the database in MONGODB_URI (db FarmerB2C)
 *   DRY_RUN=1 node scripts/migrate-v3-payments.js  # report only, no writes
 *
 * Take a backup (mongodump) before running it against production.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('../models/Order');
const { recomputePayment } = require('../services/paymentService');

const DRY = process.env.DRY_RUN === '1';
const SYSTEM_REQ = { user: null };

const entryFromLegacy = (o) => {
  const ref = String(o.paymentReference || '').trim();
  if (o.paymentMethod !== 'ONLINE' || !ref) return null;
  const confirmed = ['PAID', 'REFUND_PENDING', 'REFUNDED'].includes(o.paymentStatus);
  const pending = o.paymentStatus === 'AWAITING_VERIFICATION';
  const reviewed = !pending && (o.paymentVerifiedBy || o.paymentVerifiedByName);
  return {
    amount: o.totalAmount,
    confirmedAmount: confirmed ? o.totalAmount : 0,
    reference: ref,
    source: 'FARMER_QR',
    status: confirmed ? 'CONFIRMED' : pending ? 'PENDING' : 'REJECTED',
    submittedAt: o.paymentSubmittedAt || o.createdAt,
    submittedById: String(o.farmerId),
    submittedByRole: 'FARMER',
    submittedByName: o.farmerName || '',
    reviewedAt: reviewed ? (o.paidAt || o.updatedAt) : null,
    reviewedById: reviewed ? o.paymentVerifiedBy || null : null,
    reviewedByRole: reviewed ? 'ADMIN' : '',
    reviewedByName: reviewed ? o.paymentVerifiedByName || '' : '',
    rejectReason: !confirmed && !pending ? (o.paymentFailureReason || 'Not verified') : '',
    note: 'Migrated from the single-reference payment',
  };
};

async function run() {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || 'FarmerB2C' });
  const report = { scanned: 0, migrated: 0, withLedgerEntry: 0, statusChanged: [], skippedHasLedger: 0 };

  const cursor = Order.find({}).cursor();
  for await (const order of cursor) {
    report.scanned += 1;
    if ((order.payments || []).length > 0) { report.skippedHasLedger += 1; continue; }
    const before = order.paymentStatus;
    const entry = entryFromLegacy(order);
    if (entry) { order.payments.push(entry); report.withLedgerEntry += 1; }
    // Delivered orders keep their recorded cash; recompute only sets totals and status.
    recomputePayment(order, SYSTEM_REQ);
    if (order.paymentStatus !== before) report.statusChanged.push({ order: order.orderNumber, from: before, to: order.paymentStatus });
    report.migrated += 1;
    if (!DRY) await order.save({ validateModifiedOnly: true });
  }

  if (!DRY) await Order.syncIndexes();
  console.log(JSON.stringify({ dryRun: DRY, ...report }, null, 2));
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Migration failed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
