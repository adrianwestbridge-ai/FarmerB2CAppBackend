const CartItem = require('../models/CartItem');
const Product = require('../models/Product');
const { AppError } = require('../utils/i18n');
const { requireValidId, isValidId } = require('../utils/validators');
const { priceCart } = require('../services/pricingService');

// The cart always belongs to the logged-in farmer; any owner_id sent by the client is ignored.
const ownerOf = (req) => req.user.owner_id;

const MAX_QTY = 1000;

const loadCart = async (owner_id) => {
  const items = await CartItem.find({ owner_id }).sort({ addedAt: 1, createdAt: 1 });

  // Consolidate duplicates and drop items whose product no longer exists.
  const byProduct = new Map();
  const removeIds = [];
  const productIds = items.map((i) => i.productId);
  const existing = new Set((await Product.find({ _id: { $in: productIds } }).select('_id')).map((p) => String(p._id)));
  for (const item of items) {
    const pid = String(item.productId);
    if (!existing.has(pid)) { removeIds.push(item._id); continue; }
    if (byProduct.has(pid)) {
      const keep = byProduct.get(pid);
      keep.quantity = Math.min(MAX_QTY, keep.quantity + item.quantity);
      await keep.save();
      removeIds.push(item._id);
    } else {
      byProduct.set(pid, item);
    }
  }
  if (removeIds.length) await CartItem.deleteMany({ _id: { $in: removeIds } });
  return [...byProduct.values()];
};

const respondWithCart = async (req, res, status = 200) => {
  const items = await loadCart(ownerOf(req));
  let quote = null;
  if (items.length) {
    quote = await priceCart(items.map((i) => ({ productId: i.productId, quantity: i.quantity })), { strict: false });
  }
  res.status(status).json({
    success: true,
    count: items.length,
    data: items.map((i) => ({ _id: i._id, productId: i.productId, quantity: i.quantity })),
    quote,
  });
};

// @route GET /api/cart
exports.getCart = async (req, res) => respondWithCart(req, res);

// @route POST /api/cart  { productId, quantity }  — adds to the existing quantity
exports.addToCart = async (req, res) => {
  const { productId } = req.body || {};
  const quantity = Math.floor(Number((req.body || {}).quantity ?? 1));
  requireValidId(productId);
  if (!Number.isFinite(quantity) || quantity < 1) throw new AppError(400, 'CART_QTY_INVALID');

  const product = await Product.findById(productId);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND');
  if (!product.isActive) throw new AppError(400, 'PRODUCT_INACTIVE', { name: product.name });

  const owner_id = ownerOf(req);
  const existing = await CartItem.findOne({ owner_id, productId });
  const target = Math.min(MAX_QTY, (existing ? existing.quantity : 0) + quantity);
  if (target > (product.quantityAvailable || 0)) {
    throw new AppError(400, 'PRODUCT_OUT_OF_STOCK', { name: product.name, available: product.quantityAvailable || 0 });
  }
  if (existing) {
    existing.quantity = target;
    await existing.save();
  } else {
    await CartItem.create({ owner_id, productId, quantity: target });
  }
  return respondWithCart(req, res, existing ? 200 : 201);
};

// @route PUT /api/cart/:productId  { quantity }  — sets the quantity (0 removes)
exports.setQuantity = async (req, res) => {
  const productId = requireValidId(req.params.productId);
  const quantity = Math.floor(Number((req.body || {}).quantity));
  if (!Number.isFinite(quantity) || quantity < 0) throw new AppError(400, 'CART_QTY_INVALID');
  const owner_id = ownerOf(req);

  if (quantity === 0) {
    await CartItem.deleteMany({ owner_id, productId });
    return respondWithCart(req, res);
  }

  const product = await Product.findById(productId);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND');
  if (!product.isActive) throw new AppError(400, 'PRODUCT_INACTIVE', { name: product.name });
  if (quantity > (product.quantityAvailable || 0)) {
    throw new AppError(400, 'PRODUCT_OUT_OF_STOCK', { name: product.name, available: product.quantityAvailable || 0 });
  }
  await CartItem.findOneAndUpdate(
    { owner_id, productId },
    { $set: { quantity: Math.min(MAX_QTY, quantity) }, $setOnInsert: { addedAt: new Date() } },
    { upsert: true },
  );
  return respondWithCart(req, res);
};

// @route DELETE /api/cart/:productId
exports.removeCartItem = async (req, res) => {
  const id = req.params.productId;
  if (!isValidId(id)) throw new AppError(400, 'INVALID_ID');
  await CartItem.deleteMany({ owner_id: ownerOf(req), $or: [{ productId: id }, { _id: id }] });
  return respondWithCart(req, res);
};

// @route DELETE /api/cart
exports.clearCart = async (req, res) => {
  await CartItem.deleteMany({ owner_id: ownerOf(req) });
  return respondWithCart(req, res);
};
