const express = require("express");

// Controllers
const {
  createNews,
  getAllNews,
  getSingleNews,
  getNewsBySlug,
  updateNews,
  deleteNews,
} = require("../controllers/newsController");

// Middleware
const { protect, adminOnly } = require("../middleware/authMiddleware");
const router = express.Router();

/**
 * @route   POST /api/news
 * @desc    Create news
 * @access  Admin / Editor
 */
router.post("/",protect,createNews);

/**
 * @route   GET /api/news
 * @desc    Get all news (pagination, search, filters)
 * @access  Public
 * @query   page, limit, search, category, tag, status
 */
router.get("/", getAllNews);

/**
 * @route   GET /api/news/slug/:slug
 * @desc    Get news by slug
 * @access  Public
 */
router.get("/slug/:slug", getNewsBySlug);

/**
 * @route   GET /api/news/:id
 * @desc    Get single news by ID
 * @access  Public
 */
router.get("/:id", getSingleNews);

/**
 * @route   PUT /api/news/:id
 * @desc    Update news
 * @access  Admin / Editor
 */
router.put("/:id",protect, updateNews);

/**
 * @route   DELETE /api/news/:id
 * @desc    Delete news
 * @access  Admin
 */
router.delete("/:id", deleteNews);

module.exports = router;

