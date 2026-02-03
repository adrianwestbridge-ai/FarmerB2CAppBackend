const express = require("express");
const router = express.Router();

const {
  createCategory,
  getAllCategories,
  getActiveCategories,
  getCategoryBySlug,
  updateCategory,
  disableCategory,
  deleteCategory,
} = require("../controllers/categoryController");

// CREATE okkk
router.post("/", createCategory);

// READ okkk
router.get("/", getAllCategories);
router.get("/active", getActiveCategories);
router.get("/:slug", getCategoryBySlug);

// UPDATE okkk
router.put("/:id", updateCategory);
router.patch("/:id/disable", disableCategory);

// DELETE okkk
router.delete("/:id", deleteCategory);

module.exports = router;
