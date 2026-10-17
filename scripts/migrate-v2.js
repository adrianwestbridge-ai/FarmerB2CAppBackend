/*
 * One-time, idempotent migration of an existing database to the v2 schema
 * (MRP pricing, multi-item orders with the admin-approval workflow, admin statuses/permissions).
 *
 *   node scripts/migrate-v2.js            # migrates the database in MONGODB_URI (db FarmerB2C)
 *   DB_NAME=OtherDb node scripts/migrate-v2.js
 *   DRY_RUN=1 node scripts/migrate-v2.js  # report only, no writes
 *
 * Take a backup (mongodump) before running it against production.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { DEFAULT_PERMISSIONS } = require('../utils/permissions');

const DRY = process.env.DRY_RUN === '1';
const isOid = (v) => v && mongoose.Types.ObjectId.isValid(String(v)) && String(v).length === 24;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const packSize = (name) => {
  const m = /\((\d+(?:\.\d+)?)\s*(kg|g|ml|L)\b/i.exec(String(name || ''));
  if (!m) return { unit: /seed/i.test(name) ? 'kg' : 'piece', unitQuantity: 1 };
  return { unit: { kg: 'kg', g: 'g', ml: 'ml', l: 'L' }[m[2].toLowerCase()], unitQuantity: Number(m[1]) };
};

async function run() {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || 'FarmerB2C' });
  const db = mongoose.connection.db;
  const report = { admins: 0, products: 0, orders: 0, ordersSkipped: [], settings: false };
  const write = async (coll, filter, update) => { if (!DRY) await db.collection(coll).updateOne(filter, update); };

  // ── Admins: status Verified/Pending/Suspended → Active/Deactivated, default permissions ──
  for (const a of await db.collection('admins').find({}).toArray()) {
    const set = {};
    if (!['Active', 'Deactivated', 'Deleted'].includes(a.status)) set.status = a.status === 'Verified' ? 'Active' : 'Deactivated';
    if (a.role !== 'SUPER_ADMIN' && !Array.isArray(a.permissions)) set.permissions = DEFAULT_PERMISSIONS[a.role] || DEFAULT_PERMISSIONS.MODERATOR;
    if (a.username && a.username !== String(a.username).toLowerCase()) set.username = String(a.username).toLowerCase();
    if (Object.keys(set).length) { report.admins += 1; await write('admins', { _id: a._id }, { $set: set }); }
  }

  // ── Products: price + discountPercent → mrp + selling price, pack unit ──
  const productById = new Map();
  for (const p of await db.collection('products').find({}).toArray()) {
    const set = {};
    const unset = {};
    if (p.mrp === undefined || p.mrp === null) {
      const d = Number(p.discountPercent) || 0;
      set.mrp = p.price;
      set.price = d > 0 ? Math.round(p.price * (1 - d / 100)) : p.price;
    }
    if (p.discountPercent !== undefined) unset.discountPercent = '';
    if (!p.unit) Object.assign(set, packSize(p.name));
    if (p.nameHi === undefined) set.nameHi = '';
    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    if (Object.keys(update).length) { report.products += 1; await write('products', { _id: p._id }, update); }
    productById.set(String(p._id), { ...p, ...set });
  }

  // ── Orders: single-product legacy documents → items[] + approval workflow fields ──
  const farmers = await db.collection('farmers').find({}).toArray();
  const farmerById = new Map(farmers.map((f) => [String(f._id), f]));
  const farmerByOwner = new Map(farmers.map((f) => [f.owner_id, f]));

  for (const o of await db.collection('orders').find({}).toArray()) {
    if (Array.isArray(o.items) && o.items.length) continue; // already migrated

    const farmer = (isOid(o.farmerId) && farmerById.get(String(o.farmerId))) || farmerByOwner.get(o.owner_id) || farmerByOwner.get(o.farmerId);
    if (!farmer) { report.ordersSkipped.push({ id: String(o._id), reason: 'farmer not found' }); continue; }

    const qty = Math.max(1, Number(o.quantity) || 1);
    const total = round2(o.totalAmount);
    const product = o.productId ? productById.get(String(o.productId)) : null;
    const unitPrice = round2(total / qty);
    const mrp = Math.max(round2(product ? product.mrp || product.price : o.price || unitPrice), unitPrice);
    const created = o.createdAt || new Date();

    const STATUS = { PLACED: 'PENDING_APPROVAL', SHIPPED: o.assignedPartnerId ? 'OUT_FOR_DELIVERY' : 'APPROVED', DELIVERED: 'DELIVERED', CANCELLED: 'CANCELLED' };
    const status = STATUS[o.status] || 'PENDING_APPROVAL';
    const paymentMethod = o.paymentMethod === 'COD' ? 'COD' : 'ONLINE';
    let paymentStatus = ['PENDING', 'PAID', 'FAILED'].includes(o.paymentStatus) ? o.paymentStatus : 'PENDING';
    if (status === 'CANCELLED' && paymentStatus !== 'PAID') paymentStatus = 'CANCELLED';
    if (status === 'CANCELLED' && paymentStatus === 'PAID') paymentStatus = 'REFUND_PENDING';

    const isCod = paymentMethod === 'COD';
    const delivered = status === 'DELIVERED';
    const note = `Migrated from legacy order (original status ${o.status || 'unknown'})`;

    const set = {
      orderNumber: `LEG-${String(o._id).slice(-8).toUpperCase()}`,
      farmerId: farmer._id,
      owner_id: farmer.owner_id,
      farmerName: o.farmerName || farmer.name || '',
      farmerPhone: o.farmerPhone || farmer.phoneNumber || '',
      deliveryAddress: o.deliveryAddress || farmer.addressLine || 'Address not recorded',
      items: [{
        productId: o.productId && isOid(o.productId) ? new mongoose.Types.ObjectId(String(o.productId)) : new mongoose.Types.ObjectId(),
        productName: o.productName || (product && product.name) || 'Product',
        productNameHi: (product && product.nameHi) || '',
        image: o.productImage || '',
        unit: (product && product.unit) || 'piece',
        unitQuantity: (product && product.unitQuantity) || 1,
        mrp,
        unitPrice,
        quantity: qty,
        lineMrpTotal: round2(mrp * qty),
        lineSubtotal: total,
        offerId: null,
        offerTitle: '',
        offerTitleHi: '',
        offerDiscountType: '',
        offerDiscountValue: 0,
        discountPerUnit: 0,
        lineDiscount: 0,
        lineTotal: total,
      }],
      mrpTotal: round2(mrp * qty),
      subtotal: total,
      discount: 0,
      deliveryCharge: 0,
      totalAmount: total,
      status,
      statusHistory: [{ status, at: created, byId: null, byRole: 'SYSTEM', byName: 'Migration', note }],
      paymentMethod,
      paymentStatus,
      paymentHistory: [{ status: paymentStatus, at: created, byId: null, byRole: 'SYSTEM', byName: 'Migration', note }],
      verificationCalls: [],
      verificationOutcome: status === 'PENDING_APPROVAL' ? '' : 'CONFIRMED',
      approvedAt: ['APPROVED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(status) ? created : null,
      assignmentHistory: [],
      deliveredBy: delivered && o.assignedPartnerId ? o.assignedPartnerId : null,
      deliveredAt: delivered ? (o.updatedAt || created) : null,
      cancelReason: status === 'CANCELLED' ? (o.trackingNote || 'Cancelled (legacy)') : '',
      cancelledAt: status === 'CANCELLED' ? (o.updatedAt || created) : null,
      expectedCollection: isCod && status !== 'CANCELLED' ? total : 0,
      amountCollected: isCod && delivered ? total : 0,
      collectedAt: isCod && delivered ? (o.updatedAt || created) : null,
      collectionStatus: !isCod || status === 'CANCELLED' ? 'NOT_APPLICABLE' : (delivered ? 'COLLECTED' : 'PENDING'),
      // Cash handovers for legacy deliveries happened outside the system.
      settlementStatus: 'NOT_APPLICABLE',
      idempotencyKey: null,
    };
    if (paymentStatus === 'REFUND_PENDING') set.refundAmount = total;

    report.orders += 1;
    await write('orders', { _id: o._id }, {
      $set: set,
      $unset: { productId: '', quantity: '', price: '', productName: '', productImage: '' },
    });
  }

  // ── Settings document ──
  if (!(await db.collection('settings').findOne({ key: 'global' }))) {
    report.settings = true;
    if (!DRY) {
      await db.collection('settings').insertOne({
        key: 'global', loginMethod: 'USERNAME_OR_MOBILE', deliveryFee: 50, freeDeliveryAbove: 0,
        codEnabled: true, onlineEnabled: true, upiId: '', upiPayeeName: '', paymentInstructions: '', paymentInstructionsHi: '',
        partnerEarningPerDelivery: 0, createdAt: new Date(), updatedAt: new Date(),
      });
    }
  }

  // ── Indexes defined by the new models ──
  if (!DRY) {
    for (const name of ['Order', 'Product', 'Offer', 'Settlement', 'AuditLog', 'Setting', 'Admin', 'Farmer', 'Partner', 'PasswordResetRequest']) {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const model = require(`../models/${name}`);
      await model.syncIndexes();
    }
  }

  console.log(JSON.stringify({ dryRun: DRY, ...report }, null, 2));
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Migration failed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
