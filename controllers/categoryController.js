const Category = require('../models/Category');

// @desc    Get all active categories
// @route   GET /api/categories
exports.getCategories = async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true }).sort({ name: 1 });
    res.status(200).json({ success: true, count: categories.length, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get single category
// @route   GET /api/categories/:id
exports.getCategoryById = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    res.status(200).json({ success: true, data: category });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create category (Admin)
// @route   POST /api/categories
exports.createCategory = async (req, res) => {
  try {
    const { name, description, imageUrl } = req.body || {};
    const category = await Category.create({ name, description, imageUrl });
    res.status(201).json({ success: true, data: category });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Update category (Admin)
// @route   PUT /api/categories/:id
exports.updateCategory = async (req, res) => {
  try {
    const { name, description, imageUrl, isActive } = req.body || {};
    const updates = Object.fromEntries(Object.entries({ name, description, imageUrl, isActive }).filter(([, v]) => v !== undefined));
    const category = await Category.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    res.status(200).json({ success: true, data: category });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Delete category (Admin)
// @route   DELETE /api/categories/:id
exports.deleteCategory = async (req, res) => {
  try {
    const category = await Category.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    res.status(200).json({ success: true, message: 'Category deactivated' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
