const News = require("../models/News");
const Category = require("../models/Category");
const Tag = require("../models/Tag");
const User = require("../models/User");
const slugify = require("slugify");
const mongoose = require("mongoose");

/**
 * @desc    Create news
 * @route   POST /api/news
 * @access  Admin / Editor / Author
 */
const createNews = async (req, res) => {
  try {
    const { title, summary, content, image, category, tags, status } = req.body;

    if (!title || !content || !category) {
      return res.status(400).json({
        success: false,
        message: "Title, content and category are required",
      });
    }

    const slug = slugify(title, { lower: true, strict: true });

    const existingNews = await News.findOne({ slug });
    if (existingNews) {
      return res.status(400).json({
        success: false,
        message: "News with this title already exists",
      });
    }

    const news = await News.create({
      title,
      slug,
      summary,
      content,
      image,
      category,
      tags,
      status: status || "draft",
      author: req.user._id,
    });

    res.status(201).json({
      success: true,
      message: "News created successfully",
      data: news,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to create news",
      error: error.message,
    });
  }
};

/**
 * @desc    Get all news (pagination, search, filters)
 * @route   GET /api/news
 * @access  Public
 */
const getAllNews = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 100;
    const skip = (page - 1) * limit;

    const { search, category, tag, status } = req.query;

    const query = {};
    if (status) {
      const statusArray = status.split(",");
      query.status = { $in: statusArray };
    } else {
      query.status = "published";
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { summary: { $regex: search, $options: "i" } },
      ];
    }

    // ✅ CATEGORY: ID OR NAME OR SLUG
    if (category) {
      // If ObjectId
      if (mongoose.Types.ObjectId.isValid(category)) {
        query.category = category;
      }
      // If slug or name
      else {
        const cat = await Category.findOne({
          $or: [{ slug: category }, { name: category }],
        }).lean();

        if (!cat) {
          return res.status(404).json({
            success: false,
            message: "Category not found",
          });
        }

        query.category = cat._id;
      }
    }

    if (tag) {
      if (mongoose.Types.ObjectId.isValid(tag)) {
        query.tags = tag;
      } else {
        const tagDoc = await Tag.findOne({
          $or: [{ slug: tag }, { name: tag }],
        }).lean();

        if (!tagDoc) {
          return res.status(404).json({
            success: false,
            message: "Tag not found",
          });
        }

        query.tags = tagDoc._id;
      }
    }

    const total = await News.countDocuments(query);

    const news = await News.find(query)
      .populate("category", "name slug")
      .populate("tags", "name slug")
      .populate("author", "name avatar")
      .sort({ publishedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.status(200).json({
      success: true,
      page,
      totalPages: Math.ceil(total / limit),
      totalNews: total,
      data: news,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch news",
      error: error.message,
    });
  }
};

/**
 * @desc    Get single news by ID
 * @route   GET /api/news/:id
 * @access  Public
 */
const getSingleNews = async (req, res) => {
  try {
    const news = await News.findById(req.params.id)
      .populate("category", "name slug")
      .populate("tags", "name slug")
      .populate("author", "name avatar")
      .lean();

    if (!news) {
      return res.status(404).json({
        success: false,
        message: "News not found",
      });
    }

    res.status(200).json({
      success: true,
      data: news,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch news",
      error: error.message,
    });
  }
};

/**
 * @desc    Get news by slug
 * @route   GET /api/news/slug/:slug
 * @access  Public
 */
const getNewsBySlug = async (req, res) => {
  try {
    const news = await News.findOneAndUpdate(
      { slug: req.params.slug, status: "published" },
      { $inc: { views: 1 } },
      { new: true }
    )
      .populate("category", "name slug")
      .populate("tags", "name slug")
      .populate("author", "name avatar")
      .lean();

    if (!news) {
      return res.status(404).json({
        success: false,
        message: "News not found",
      });
    }

    res.status(200).json({
      success: true,
      data: news,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch news",
      error: error.message,
    });
  }
};

/**
 * @desc    Update news
 * @route   PUT /api/news/:id
 * @access  Admin / Editor / Author (own)
 */
const updateNews = async (req, res) => {
  try {
    const news = await News.findById(req.params.id);

    if (!news) {
      return res.status(404).json({
        success: false,
        message: "News not found",
      });
    }

    if (
      req.user.role === "author" &&
      news.author.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "You can update only your own news",
      });
    }

    if (req.body.title) {
      news.title = req.body.title;
      news.slug = slugify(req.body.title, { lower: true, strict: true });
    }

    news.summary = req.body.summary ?? news.summary;
    news.content = req.body.content ?? news.content;
    news.image = req.body.image ?? news.image;
    news.category = req.body.category ?? news.category;
    news.tags = req.body.tags ?? news.tags;
    news.status = req.body.status ?? news.status;

    if (req.body.status === "published" && !news.publishedAt) {
      news.publishedAt = new Date();
    }

    await news.save();

    res.status(200).json({
      success: true,
      message: "News updated successfully",
      data: news,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update news",
      error: error.message,
    });
  }
};

/**
 * @desc    Delete news
 * @route   DELETE /api/news/:id
 * @access  Admin
 */
const deleteNews = async (req, res) => {
  try {
    const news = await News.findById(req.params.id);

    if (!news) {
      return res.status(404).json({
        success: false,
        message: "News not found",
      });
    }

    await news.deleteOne();

    res.status(200).json({
      success: true,
      message: "News deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete news",
      error: error.message,
    });
  }
};

// Export all functions using CommonJS
module.exports = {
  createNews,
  getAllNews,
  getSingleNews,
  getNewsBySlug,
  updateNews,
  deleteNews,
};
