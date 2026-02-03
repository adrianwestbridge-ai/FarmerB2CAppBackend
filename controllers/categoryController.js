const Category = require("../models/Category");
const slugify = require("slugify");

/**
 * @desc    Create category
 * @route   POST /api/categories
 */
exports.createCategory = async (req, res) => {
  try {
    const { name, description, isActive=true } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Category name is required",
      });
    }

    const slug = slugify(name, { lower: true });

    const exists = await Category.findOne({ slug });
    if (exists) {
      return res.status(409).json({
        success: false,
        message: "Category already exists",
      });
    }

    const category = await Category.create({
      name,
      slug,
      description,
      isActive,
    });

    res.status(201).json({
      success: true,
      data: category,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to create category",
      error: error.message,
    });
  }
};

/**
 * @desc    Get all categories
 * @route   GET /api/categories
 */
exports.getAllCategories = async (req, res) => {
  try {
    const categories = await Category.find().sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: categories.length,
      data: categories,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
      error: error.message,
    });
  }
};

/**
 * @desc    Get only active categories
 * @route   GET /api/categories/active
 */
exports.getActiveCategories = async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true });

    res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch active categories",
      error: error.message,
    });
  }
};

/**
 * @desc    Get category by slug
 * @route   GET /api/categories/:slug
 */
exports.getCategoryBySlug = async (req, res) => {
  try {
    const category = await Category.findOne({ slug: req.params.slug });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    res.status(200).json({
      success: true,
      data: category,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch category",
      error: error.message,
    });
  }
};

/**
 * @desc    Update category
 * @route   PUT /api/categories/:id
 */
exports.updateCategory = async (req, res) => {
  try {
    const { name, description, isActive } = req.body;

    const updateData = {};

    if (name) {
      updateData.name = name;
      updateData.slug = slugify(name, { lower: true });
    }

    if (description !== undefined) {
      updateData.description = description;
    }

    if (isActive !== undefined) {
      updateData.isActive = isActive;
    }

    const category = await Category.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    res.status(200).json({
      success: true,
      data: category,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update category",
      error: error.message,
    });
  }
};

/**
 * @desc    Soft delete (disable category)
 * @route   PATCH /api/categories/:id/disable
 */
exports.disableCategory = async (req, res) => {
  try {
    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Category disabled",
      data: category,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to disable category",
      error: error.message,
    });
  }
};

/**
 * @desc    Hard delete category
 * @route   DELETE /api/categories/:id
 */
exports.deleteCategory = async (req, res) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Category deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete category",
      error: error.message,
    });
  }
};
