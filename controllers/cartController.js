const mongoose = require('mongoose');
const CartItem = require('../models/CartItem');
const Product = require('../models/Product');

// Safe helper to extract owner_id
const getOwnerId = (req) => {
  if (!req) return null;
  if (req.user) {
    return req.user.owner_id || (req.user._id ? req.user._id.toString() : null);
  }
  const body = req.body || {};
  const query = req.query || {};
  const params = req.params || {};

  return (
    body.owner_id ||
    query.owner_id ||
    params.owner_id ||
    body.farmerId ||
    query.farmerId ||
    params.farmerId ||
    null
  );
};

// @desc    Get user's cart items
// @route   GET /api/cart
exports.getCart = async (req, res) => {
  try {
    const owner_id = getOwnerId(req);
    if (!owner_id) {
      return res.status(400).json({ success: false, message: 'owner_id or farmerId is required' });
    }

    const items = await CartItem.find({ owner_id })
      .populate({
        path: 'productId',
        populate: { path: 'category', select: 'name' },
      })
      .sort({ addedAt: 1, createdAt: 1 });

    // Clean up orphaned cart items and consolidate duplicate items for same product
    const validItems = [];
    const orphanedIds = [];

    for (const item of items) {
      if (item.productId) {
        validItems.push(item);
      } else {
        orphanedIds.push(item._id);
      }
    }

    if (orphanedIds.length > 0) {
      await CartItem.deleteMany({ _id: { $in: orphanedIds } });
    }

    // Consolidate duplicates by productId
    const uniqueMap = {};
    const duplicateIds = [];

    for (const item of validItems) {
      const pid = item.productId._id ? item.productId._id.toString() : item.productId.toString();
      if (uniqueMap[pid]) {
        uniqueMap[pid].quantity += item.quantity;
        duplicateIds.push(item._id);
      } else {
        uniqueMap[pid] = item;
      }
    }

    if (duplicateIds.length > 0) {
      await CartItem.deleteMany({ _id: { $in: duplicateIds } });
    }

    const finalCartItems = Object.values(uniqueMap);

    res.status(200).json({
      success: true,
      count: finalCartItems.length,
      data: finalCartItems,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }

};

// @desc    Add item to cart or increment
// @route   POST /api/cart
exports.addToCart = async (req, res) => {
  try {
    const body = req.body || {};
    const { productId, quantity = 1 } = body;
    const owner_id = getOwnerId(req);

    if (!owner_id || !productId) {
      return res.status(400).json({ success: false, message: 'owner_id and productId are required' });
    }

    // 1. Verify productId format
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(404).json({
        success: false,
        message: 'Invalid product ID format. Product does not exist in database.',
      });
    }

    // 2. Verify product exists in Products collection
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found in database. Cannot add to cart.',
      });
    }

    if (product.isActive === false) {
      return res.status(400).json({
        success: false,
        message: 'Product is currently inactive and cannot be added to cart.',
      });
    }

    // 3. Update existing item or create new item
    let existingItem = await CartItem.findOne({ owner_id, productId });
    if (existingItem) {
      existingItem.quantity += Number(quantity);
      await existingItem.save();
      await existingItem.populate({ path: 'productId', populate: { path: 'category', select: 'name' } });
      return res.status(200).json({
        success: true,
        message: 'Cart quantity updated',
        data: existingItem,
      });
    }

    const newItem = await CartItem.create({
      owner_id,
      productId,
      quantity: Math.max(1, Number(quantity)),
    });

    await newItem.populate({ path: 'productId', populate: { path: 'category', select: 'name' } });

    res.status(201).json({
      success: true,
      message: 'Item added to cart',
      data: newItem,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update cart item quantity (+, -, or direct quantity value)
// @route   PUT /api/cart/:id OR PATCH /api/cart/:id
exports.updateCartQuantity = async (req, res) => {
  try {
    const params = req.params || {};
    const body = req.body || {};
    const id = params.id; // Can be CartItem _id OR productId
    const { quantity, delta, action } = body;
    const owner_id = getOwnerId(req);

    let item = null;

    if (id && mongoose.Types.ObjectId.isValid(id)) {
      item = await CartItem.findById(id);
    }

    if (!item && owner_id && id) {
      item = await CartItem.findOne({ owner_id, productId: id });
    }

    if (!item) {
      return res.status(404).json({ success: false, message: 'Cart item not found in cart' });
    }

    // Verify underlying product still exists
    if (item.productId && mongoose.Types.ObjectId.isValid(item.productId)) {
      const product = await Product.findById(item.productId);
      if (!product) {
        await CartItem.findByIdAndDelete(item._id);
        return res.status(404).json({
          success: false,
          removed: true,
          message: 'Product no longer exists in database. Removed from cart.',
        });
      }
    }

    // Calculate new target quantity
    let newQuantity = item.quantity;

    if (quantity !== undefined) {
      newQuantity = Number(quantity);
    } else if (delta !== undefined) {
      newQuantity = item.quantity + Number(delta);
    } else if (action === 'increment') {
      newQuantity = item.quantity + 1;
    } else if (action === 'decrement') {
      newQuantity = item.quantity - 1;
    }

    // If target quantity is 0 or negative, remove item from cart
    if (newQuantity <= 0) {
      await CartItem.findByIdAndDelete(item._id);
      return res.status(200).json({
        success: true,
        removed: true,
        message: 'Item removed from cart',
        data: { _id: item._id, productId: item.productId, quantity: 0 },
      });
    }

    item.quantity = newQuantity;
    await item.save();
    await item.populate({ path: 'productId', populate: { path: 'category', select: 'name' } });

    res.status(200).json({
      success: true,
      removed: false,
      message: 'Cart quantity updated successfully',
      data: item,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Remove single cart item (via Delete button)
// @route   DELETE /api/cart/:id OR POST /api/cart/remove
exports.removeCartItem = async (req, res) => {
  try {
    const params = req.params || {};
    const body = req.body || {};
    const query = req.query || {};

    const id = params.id || body.id || body.cartItemId;
    const productId = body.productId || query.productId;
    const owner_id = getOwnerId(req);

    let item = null;

    if (id && mongoose.Types.ObjectId.isValid(id)) {
      item = await CartItem.findByIdAndDelete(id);
    }

    if (!item && owner_id && (productId || id)) {
      const targetProdId = productId || id;
      item = await CartItem.findOneAndDelete({ owner_id, productId: targetProdId });
    }

    if (!item) {
      return res.status(404).json({ success: false, message: 'Cart item not found' });
    }

    res.status(200).json({
      success: true,
      removed: true,
      message: 'Item removed from cart successfully',
      data: { _id: item._id },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Clear entire cart for user
// @route   DELETE /api/cart
exports.clearCart = async (req, res) => {
  try {
    const owner_id = getOwnerId(req);
    if (!owner_id) {
      return res.status(400).json({ success: false, message: 'owner_id or farmerId required' });
    }

    await CartItem.deleteMany({ owner_id });

    res.status(200).json({
      success: true,
      message: 'Cart cleared successfully',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
