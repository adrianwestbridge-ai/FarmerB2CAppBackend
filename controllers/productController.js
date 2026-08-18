const Product = require('../models/Product.js');

// @desc    Get all products (with optional search, category filter, and feature filter)
// @route   GET /api/products
exports.getProducts = async (req, res) => {
  try {
    const { category, categoryId, search, isFeatured, limit = 50, page = 1 } = req.query;

    let filter = { isActive: true };

    const selectedCategory = categoryId || category;
    if (selectedCategory) {
      filter.$or = [
        { category: selectedCategory },
        { categoryId: selectedCategory }
      ];
    }

    if (isFeatured === 'true') {
      filter.isFeatured = true;
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;

    const products = await Product.find(filter)
      .populate('category', 'name imageUrl')
      .sort({ createdAt: -1 })
      .skip(Number(skip))
      .limit(Number(limit));

    const total = await Product.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: products.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      data: products,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get single product details
// @route   GET /api/products/:id
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('category', 'name imageUrl');

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.status(200).json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create a new product (Admin)
// @route   POST /api/products
exports.createProduct = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const Category = require('../models/Category.js');

    const body = { ...req.body };

    // Support 'title' as an alias for 'name'
    if (!body.name && body.title) {
      body.name = body.title;
    }

    // Handle flexible stock fields (stock vs stockQuantity vs quantityAvailable)
    if (body.stock !== undefined) {
      if (body.stockQuantity === undefined) body.stockQuantity = Number(body.stock);
      if (body.quantityAvailable === undefined) body.quantityAvailable = Number(body.stock);
    }

    // Handle category field (can be ObjectId string, category name string, or categoryId)
    if (body.category && typeof body.category === 'string') {
      if (mongoose.Types.ObjectId.isValid(body.category)) {
        // Valid ObjectId string
      } else {
        // Category name passed as string (e.g. "Fertilizers")
        body.categoryId = body.category;
        const foundCat = await Category.findOne({ name: new RegExp(`^${body.category}$`, 'i') });
        if (foundCat) {
          body.category = foundCat._id;
        } else {
          delete body.category; // Remove string to avoid BSON error on ObjectId field
        }
      }
    }

    const product = await Product.create(body);
    res.status(201).json({ success: true, data: product });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Update product details (Admin)
// @route   PUT /api/products/:id
exports.updateProduct = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const Category = require('../models/Category.js');

    const body = { ...req.body };

    if (!body.name && body.title) {
      body.name = body.title;
    }

    if (body.stock !== undefined) {
      if (body.stockQuantity === undefined) body.stockQuantity = Number(body.stock);
      if (body.quantityAvailable === undefined) body.quantityAvailable = Number(body.stock);
    }

    if (body.category && typeof body.category === 'string') {
      if (mongoose.Types.ObjectId.isValid(body.category)) {
        // Valid ObjectId
      } else {
        body.categoryId = body.category;
        const foundCat = await Category.findOne({ name: new RegExp(`^${body.category}$`, 'i') });
        if (foundCat) {
          body.category = foundCat._id;
        } else {
          delete body.category;
        }
      }
    }

    const product = await Product.findByIdAndUpdate(req.params.id, body, {
      new: true,
      runValidators: true,
    });

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.status(200).json({ success: true, data: product });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Update stock quantity directly (Admin / Quick Stepper)
// @route   PATCH /api/products/:id/stock
exports.updateStock = async (req, res) => {
  try {
    const { stockQuantity, quantityAvailable } = req.body;
    const qty = quantityAvailable !== undefined ? quantityAvailable : stockQuantity;

    if (qty === undefined || qty < 0) {
      return res.status(400).json({ success: false, message: 'Valid stock quantity required' });
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { stockQuantity: qty, quantityAvailable: qty },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.status(200).json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Soft delete / Deactivate a product (Admin)
// @route   DELETE /api/products/:id
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.status(200).json({ success: true, message: 'Product deactivated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};