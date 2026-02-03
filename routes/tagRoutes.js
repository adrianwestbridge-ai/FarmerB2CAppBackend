const express = require("express");
const router = express.Router();

const {
  createTag,
  getAllTags,
  getTagBySlug,
  updateTag,
  deleteTag,
} = require("../controllers/tagController");

// CREATE okkk
router.post("/", createTag);

// READ okkk
router.get("/", getAllTags);
router.get("/:slug", getTagBySlug);

// UPDATE okkk
router.put("/:id", updateTag);

// DELETE okkk
router.delete("/:id", deleteTag);

module.exports = router;
