const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const { AppError } = require('../utils/i18n');
const { audit } = require('../utils/audit');
const { hasPermission, PERMISSIONS } = require('../utils/permissions');
const { requireValidId, escapeRegex, cleanText, toMoney } = require('../utils/validators');
const { withPricing } = require('../services/pricingService');

const canManage = (req) => req.userType === 'admin' && hasPermission(req.user, PERMISSIONS.PRODUCTS_MANAGE);

// @route GET /api/products
exports.getProducts = async (req, res) => {
  const { category, categoryId, search, isFeatured, includeInactive, isActive } = req.query;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const page = Math.max(1, Number(req.query.page) || 1);

  const filter = {};
  // Inactive products are only visible to admins who manage products.
  if (canManage(req) && (includeInactive === 'true' || isActive === 'false')) {
    if (isActive === 'false') filter.isActive = false;
  } else {
    filter.isActive = true;
  }

  const and = [];
  const selectedCategory = categoryId || category;
  if (selectedCategory) {
    const or = [{ categoryId: selectedCategory }];
    if (mongoose.Types.ObjectId.isValid(selectedCategory)) or.push({ category: selectedCategory });
    and.push({ $or: or });
  }
  if (isFeatured === 'true') filter.isFeatured = true;
  if (search) {
    const rx = new RegExp(escapeRegex(cleanText(search, 60)), 'i');
    and.push({ $or: [{ name: rx }, { nameHi: rx }, { description: rx }] });
  }
  if (and.length) filter.$and = and;

  const [products, total] = await Promise.all([
    Product.find(filter).populate('category', 'name imageUrl').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Product.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    count: products.length,
    total,
    page,
    pages: Math.ceil(total / limit),
    data: await withPricing(products),
  });
};

// @route GET /api/products/:id
exports.getProductById = async (req, res) => {
  const product = await Product.findById(requireValidId(req.params.id)).populate('category', 'name imageUrl');
  if (!product || (!product.isActive && !canManage(req))) throw new AppError(404, 'PRODUCT_NOT_FOUND');
  res.status(200).json({ success: true, data: await withPricing(product) });
};

// Whitelisted, validated product fields from an admin request.
const productFields = async (body, existing) => {
  const out = {};
  const str = (key, max) => { if (body[key] !== undefined) out[key] = cleanText(body[key], max); };

  if (body.name !== undefined || body.title !== undefined) {
    out.name = cleanText(body.name !== undefined ? body.name : body.title, 150);
    if (!out.name) throw new AppError(400, 'VALIDATION_FAILED');
  }
  str('nameHi', 150);
  str('description', 3000);
  str('descriptionHi', 3000);
  str('dosageInstructions', 1000);
  str('dosageInstructionsHi', 1000);
  str('videoUrl', 1000);
  str('pdfUrl', 1000);
  str('pdfLabelUrl', 1000);

  if (body.images !== undefined || body.imageUrls !== undefined) {
    const imgs = (Array.isArray(body.images) ? body.images : body.imageUrls || []).map((u) => cleanText(u, 2000)).filter(Boolean).slice(0, 10);
    out.images = imgs;
    out.imageUrls = imgs;
  }

  if (body.unit !== undefined) {
    if (!Product.UNITS.includes(body.unit)) throw new AppError(400, 'VALIDATION_FAILED');
    out.unit = body.unit;
  }
  if (body.unitQuantity !== undefined) {
    const uq = Number(body.unitQuantity);
    if (!Number.isFinite(uq) || uq <= 0) throw new AppError(400, 'VALIDATION_FAILED');
    out.unitQuantity = uq;
  }

  // Pricing: selling price must be > 0 and ≤ MRP.
  const price = body.price !== undefined ? toMoney(body.price) : (existing ? existing.price : undefined);
  const mrp = body.mrp !== undefined ? toMoney(body.mrp) : (existing ? existing.mrp : price);
  if (body.price !== undefined || body.mrp !== undefined || !existing) {
    if (!(price > 0) || !(mrp > 0) || price > mrp) throw new AppError(400, 'PRODUCT_PRICE_INVALID');
    out.price = price;
    out.mrp = mrp;
  }

  const stock = body.stockQuantity !== undefined ? body.stockQuantity : (body.stock !== undefined ? body.stock : body.quantityAvailable);
  if (stock !== undefined) {
    const qty = Math.floor(Number(stock));
    if (!Number.isFinite(qty) || qty < 0) throw new AppError(400, 'VALIDATION_FAILED');
    out.stockQuantity = qty;
    out.quantityAvailable = qty;
  }

  if (body.isActive !== undefined) out.isActive = body.isActive === true || body.isActive === 'true';
  if (body.isFeatured !== undefined) out.isFeatured = body.isFeatured === true || body.isFeatured === 'true';

  if (body.category !== undefined && body.category !== null && body.category !== '') {
    const cat = String(body.category);
    if (mongoose.Types.ObjectId.isValid(cat) && cat.length === 24) {
      const found = await Category.findById(cat);
      if (found) { out.category = found._id; out.categoryId = found.name; }
    } else {
      const found = await Category.findOne({ name: new RegExp(`^${escapeRegex(cat)}$`, 'i') });
      out.categoryId = found ? found.name : cleanText(cat, 60);
      if (found) out.category = found._id;
    }
  }
  return out;
};

// @route POST /api/products
exports.createProduct = async (req, res) => {
  const fields = await productFields(req.body || {}, null);
  if (!fields.name) throw new AppError(400, 'VALIDATION_FAILED');
  const product = await Product.create(fields);
  await audit(req, { action: 'PRODUCT_CREATED', entityType: 'PRODUCT', entityId: product._id, entityRef: product.name, metadata: { mrp: product.mrp, price: product.price } });
  res.status(201).json({ success: true, data: await withPricing(product) });
};

// @route PUT /api/products/:id
exports.updateProduct = async (req, res) => {
  const product = await Product.findById(requireValidId(req.params.id));
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND');
  const before = { mrp: product.mrp, price: product.price, isActive: product.isActive, quantityAvailable: product.quantityAvailable };
  const fields = await productFields(req.body || {}, product);
  Object.assign(product, fields);
  await product.save();
  await audit(req, {
    action: 'PRODUCT_UPDATED',
    entityType: 'PRODUCT',
    entityId: product._id,
    entityRef: product.name,
    metadata: { before, after: { mrp: product.mrp, price: product.price, isActive: product.isActive, quantityAvailable: product.quantityAvailable } },
  });
  res.status(200).json({ success: true, data: await withPricing(product) });
};

// @route PATCH /api/products/:id/stock  { stockQuantity }
exports.updateStock = async (req, res) => {
  const qty = Math.floor(Number((req.body || {}).stockQuantity ?? (req.body || {}).quantityAvailable));
  if (!Number.isFinite(qty) || qty < 0) throw new AppError(400, 'VALIDATION_FAILED');
  const product = await Product.findById(requireValidId(req.params.id));
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND');
  const before = product.quantityAvailable;
  product.stockQuantity = qty;
  product.quantityAvailable = qty;
  await product.save();
  await audit(req, { action: 'PRODUCT_STOCK_UPDATED', entityType: 'PRODUCT', entityId: product._id, entityRef: product.name, metadata: { before, after: qty } });
  res.status(200).json({ success: true, data: await withPricing(product) });
};

// @route DELETE /api/products/:id — soft delete (deactivate); order history keeps its snapshot.
exports.deleteProduct = async (req, res) => {
  const product = await Product.findById(requireValidId(req.params.id));
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND');
  product.isActive = false;
  await product.save();
  await audit(req, { action: 'PRODUCT_DEACTIVATED', entityType: 'PRODUCT', entityId: product._id, entityRef: product.name });
  res.status(200).json({ success: true, data: await withPricing(product) });
};
