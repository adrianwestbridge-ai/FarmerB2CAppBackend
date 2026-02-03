const Tag = require("../models/Tag");
const slugify = require("slugify");

/**
 * @desc    Create tag
 * @route   POST /api/tags
 */
exports.createTag = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Tag name is required",
      });
    }

    const slug = slugify(name, { lower: true });

    const exists = await Tag.findOne({ slug });
    if (exists) {
      return res.status(409).json({
        success: false,
        message: "Tag already exists",
      });
    }

    const tag = await Tag.create({ name, slug });

    res.status(201).json({
      success: true,
      data: tag,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to create tag",
      error: error.message,
    });
  }
};

/**
 * @desc    Get all tags
 * @route   GET /api/tags
 */
exports.getAllTags = async (req, res) => {
  try {
    const tags = await Tag.find().sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: tags.length,
      data: tags,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch tags",
      error: error.message,
    });
  }
};

/**
 * @desc    Get tag by slug
 * @route   GET /api/tags/:slug
 */
exports.getTagBySlug = async (req, res) => {
  try {
    const tag = await Tag.findOne({ slug: req.params.slug });

    if (!tag) {
      return res.status(404).json({
        success: false,
        message: "Tag not found",
      });
    }

    res.status(200).json({
      success: true,
      data: tag,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch tag",
      error: error.message,
    });
  }
};

/**
 * @desc    Update tag
 * @route   PUT /api/tags/:id
 */
exports.updateTag = async (req, res) => {
  try {
    const { name } = req.body;

    const updateData = {};
    if (name) {
      updateData.name = name;
      updateData.slug = slugify(name, { lower: true });
    }

    const tag = await Tag.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!tag) {
      return res.status(404).json({
        success: false,
        message: "Tag not found",
      });
    }

    res.status(200).json({
      success: true,
      data: tag,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update tag",
      error: error.message,
    });
  }
};

/**
 * @desc    Delete tag
 * @route   DELETE /api/tags/:id
 */
exports.deleteTag = async (req, res) => {
  try {
    const tag = await Tag.findByIdAndDelete(req.params.id);

    if (!tag) {
      return res.status(404).json({
        success: false,
        message: "Tag not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Tag deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete tag",
      error: error.message,
    });
  }
};
