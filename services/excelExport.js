const ExcelJS = require('exceljs');
const Farmer = require('../models/Farmer');
const Partner = require('../models/Partner');
const Admin = require('../models/Admin');
const { farmerStats, emptyFarmerStats, partnerStats, emptyPartnerStats } = require('./userStats');

const IST_OFFSET_MS = 330 * 60000;
const GREEN = 'FF1E6B2E';
const DATE_KEY = /At$/;

/** Excel has no time zones: store the India wall-clock time so cells read like the app. */
const toIstDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() + IST_OFFSET_MS);
};

const cellValue = (column, row) => (typeof column.value === 'function' ? column.value(row) : row[column.value]);

/**
 * Adds one formatted sheet: green bold header, frozen header row, filters,
 * rupee number format for "(INR)" columns, readable dates and sensible widths.
 */
const addSheet = (wb, name, columns, rows) => {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.label, key: c.label, width: Math.max(12, Math.min(45, String(c.label).length + 4)) }));

  rows.forEach((row) => {
    const values = {};
    columns.forEach((c) => {
      let v = cellValue(c, row);
      const key = typeof c.value === 'string' ? c.value : '';
      if (DATE_KEY.test(key) || c.date) v = toIstDate(v);
      else if (Array.isArray(v)) v = v.join(', ');
      else if (v && typeof v === 'object' && !(v instanceof Date)) v = String(v);
      values[c.label] = v === undefined ? null : v;
    });
    ws.addRow(values);
  });

  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    const key = typeof c.value === 'string' ? c.value : '';
    if (/\(INR\)/.test(c.label) || c.money) col.numFmt = '"₹"#,##0.00';
    if (DATE_KEY.test(key) || c.date) { col.numFmt = 'dd-mmm-yyyy hh:mm'; col.width = Math.max(col.width, 18); }
    let longest = String(c.label).length;
    col.eachCell({ includeEmpty: false }, (cell, rowNumber) => {
      if (rowNumber > 1 && cell.value !== null && !(cell.value instanceof Date)) longest = Math.max(longest, String(cell.value).length);
    });
    col.width = Math.max(col.width, Math.min(50, longest + 2));
  });

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 30;
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
};

const addSummarySheet = (wb, title, summary, meta) => {
  const ws = wb.addWorksheet('Summary');
  ws.columns = [{ width: 38 }, { width: 22 }];
  ws.addRow([title]).font = { bold: true, size: 16, color: { argb: GREEN } };
  ws.addRow([`Period: ${meta.period}`]);
  ws.addRow([`Generated: ${meta.generatedAt} by ${meta.generatedBy}`]);
  ws.addRow([]);

  const section = (name, rows) => {
    const r = ws.addRow([name]);
    r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
    ws.mergeCells(r.number, 1, r.number, 2);
    rows.forEach(([label, value, money]) => {
      const row = ws.addRow([label, value]);
      if (money) row.getCell(2).numFmt = '"₹"#,##0.00';
    });
    ws.addRow([]);
  };

  const o = summary.orders;
  const f = summary.financial;
  section('Orders', [
    ['Total orders placed', o.total], ['Accepted by admin', o.accepted], ['Pending admin approval', o.pendingApproval],
    ['In delivery', o.inProgress], ['Delivered', o.delivered], ['Delivery failed', o.deliveryFailed],
    ['Rejected', o.rejected], ['Cancelled', o.cancelled],
  ]);
  section('Money', [
    ['Order value (all placed)', f.orderValue, true], ['Order value (excl. rejected/cancelled)', f.activeOrderValue, true],
    ['Total MRP of those orders', f.mrpValue, true], ['Offer discounts given', f.discounts, true],
    ['Completed sales (delivered)', f.completedSales, true], ['Delivery charges earned', f.deliveryCharges, true],
    ['Collected - Cash (COD)', f.collected.cod, true], ['Collected - Online', f.collected.online, true],
    ['Collected - Total', f.collected.total, true], ['Payments still pending', f.pendingPayments, true],
    ['Refunded', f.refunds.refunded, true], ['Refunds pending', f.refunds.pending, true],
  ]);
  section('Cash with delivery partners', [
    ['Not yet handed over', f.settlements.pendingHandover, true], ['Handed over, awaiting verification', f.settlements.submitted, true],
    ['Disputed', f.settlements.disputed, true], ['Verified', f.settlements.verified, true],
    ['Outstanding total', f.settlements.outstanding, true], ['Short collections (count)', f.settlements.shortCollections],
  ]);
  section('People', meta.people);
};

/**
 * Full business workbook for the given filters (date range etc.).
 * Admin accounts are included only for the Super Admin.
 */
const buildWorkbook = async ({ query, includeAdmins, generatedBy }) => {
  // Lazy require: the report controller also requires this module.
  const reports = require('../controllers/reportController');
  const run = reports.runReport;
  const q = { ...query };

  const [summary, daily, orders, settlements, products, offers, activity, adminActivity, partnerPerf, farmers, partners, admins] = await Promise.all([
    run(reports.summary, q),
    run(reports.summary, q, true),
    run(reports.orders, q, true),
    run(reports.settlements, q, true),
    run(reports.products, q, true),
    run(reports.offers, q, true),
    run(reports.activity, q, true),
    includeAdmins ? run(reports.adminActivity, q, true) : null,
    run(reports.partners, q),
    Farmer.find({}).sort({ createdAt: -1 }).lean(),
    Partner.find({}).sort({ createdAt: -1 }).lean(),
    includeAdmins ? Admin.find({ status: { $ne: 'Deleted' } }).sort({ createdAt: 1 }).lean() : [],
  ]);

  const [fStats, pStats] = await Promise.all([
    farmerStats(farmers.map((f) => f._id)),
    partnerStats(partners.map((p) => p._id)),
  ]);
  const perfInRange = new Map((partnerPerf || []).map((p) => [String(p.partnerId), p]));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'AgriHarvest';
  wb.created = new Date();

  const period = q.from || q.to ? `${q.from || 'start'} to ${q.to || 'today'}` : 'All time';
  addSummarySheet(wb, 'AgriHarvest business report', summary, {
    period,
    generatedAt: new Date(Date.now() + IST_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 16),
    generatedBy,
    people: [
      ['Farmers registered', farmers.length], ['Farmers active', farmers.filter((f) => f.status === 'Active').length],
      ['Delivery partners', partners.length], ['Delivery partners active', partners.filter((p) => p.status === 'Active').length],
      ...(includeAdmins ? [['Admin accounts (excl. deleted)', admins.length]] : []),
    ],
  });

  addSheet(wb, 'Daily', daily.columns, daily.rows);
  addSheet(wb, 'Orders', orders.columns, orders.rows);

  const farmerRows = farmers.map((f) => ({ ...f, ...(fStats.get(String(f._id)) || emptyFarmerStats()) }));
  addSheet(wb, 'Farmers', [
    { label: 'Farmer', value: 'name' }, { label: 'Username', value: 'username' }, { label: 'Mobile', value: 'phoneNumber' },
    { label: 'Village', value: 'village' }, { label: 'District', value: 'district' }, { label: 'State', value: 'state' },
    { label: 'Address', value: 'addressLine' }, { label: 'Status', value: 'status' },
    { label: 'Registered on', value: 'createdAt' }, { label: 'Last login', value: 'lastLoginAt' },
    { label: 'Total orders', value: 'orders' }, { label: 'Delivered', value: 'delivered' }, { label: 'In progress', value: 'inProgress' },
    { label: 'Cancelled', value: 'cancelled' }, { label: 'Rejected', value: 'rejected' },
    { label: 'Order value (INR)', value: 'orderValue' }, { label: 'Completed purchases (INR)', value: 'sales' },
    { label: 'Saved vs MRP (INR)', value: 'mrpSavings' }, { label: 'First order', value: 'firstOrderAt' }, { label: 'Last order', value: 'lastOrderAt' },
  ], farmerRows);

  const partnerRows = partners.map((p) => {
    const life = pStats.get(String(p._id)) || emptyPartnerStats();
    const inRange = perfInRange.get(String(p._id)) || {};
    return { ...p, ...life, rangeDelivered: inRange.delivered || 0, rangeFailed: inRange.failed || 0, rangeCash: inRange.cashCollected || 0 };
  });
  addSheet(wb, 'Delivery partners', [
    { label: 'Delivery partner', value: 'name' }, { label: 'Mobile', value: 'phoneNumber' }, { label: 'Username', value: 'username' },
    { label: 'Vehicle', value: 'vehicleName' }, { label: 'Vehicle no.', value: 'vehicleNumber' }, { label: 'Status', value: 'status' },
    { label: 'Online now', value: (r) => (r.online ? 'Yes' : 'No') },
    { label: 'Joined on', value: 'createdAt' }, { label: 'Last login', value: 'lastLoginAt' },
    { label: 'Active deliveries now', value: 'activeDeliveries' }, { label: 'Total assignments', value: 'assignments' },
    { label: 'Delivered (all time)', value: 'delivered' }, { label: 'Failed (all time)', value: 'failed' }, { label: 'Reported unavailable', value: 'unavailable' },
    { label: 'Delivered in period', value: 'rangeDelivered' }, { label: 'Failed in period', value: 'rangeFailed' },
    { label: 'Delivered value (INR)', value: 'deliveredValue' }, { label: 'Cash collected (INR)', value: 'cashCollected' },
    { label: 'Cash not handed over (INR)', value: 'cashPendingHandover' }, { label: 'Cash awaiting verification (INR)', value: 'cashSubmitted' },
    { label: 'Cash disputed (INR)', value: 'cashDisputed' }, { label: 'Cash verified (INR)', value: 'cashVerified' },
    { label: 'Last delivery', value: 'lastDeliveredAt' },
  ], partnerRows);

  if (includeAdmins) {
    addSheet(wb, 'Admins', [
      { label: 'Name', value: 'name' }, { label: 'Username', value: 'username' }, { label: 'Role', value: 'role' },
      { label: 'Status', value: 'status' }, { label: 'Mobile', value: 'phoneNumber' }, { label: 'Email', value: 'email' },
      { label: 'Permissions', value: (r) => (r.role === 'SUPER_ADMIN' ? 'ALL' : (r.permissions || []).join(', ')) },
      { label: 'Created on', value: 'createdAt' }, { label: 'Last login', value: 'lastLoginAt' },
    ], admins);
    addSheet(wb, 'Admin decisions', adminActivity.columns, adminActivity.rows);
  }

  addSheet(wb, 'Settlements', settlements.columns, settlements.rows);
  addSheet(wb, 'Products', products.columns, products.rows);
  addSheet(wb, 'Offers', offers.columns, offers.rows);
  addSheet(wb, 'Activity log', activity.columns, activity.rows);
  return wb;
};

module.exports = { buildWorkbook };
