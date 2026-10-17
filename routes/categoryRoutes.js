const express = require('express');
const {
  getCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
} = require('../controllers/categoryController');
const { protect, requirePermission } = require('../middleware/authMiddleware');
const { PERMISSIONS: P } = require('../utils/permissions');

const router = express.Router();

router.get('/', getCategories);
router.get('/:id', getCategoryById);
router.post('/', protect, requirePermission(P.PRODUCTS_MANAGE), createCategory);
router.put('/:id', protect, requirePermission(P.PRODUCTS_MANAGE), updateCategory);
router.delete('/:id', protect, requirePermission(P.PRODUCTS_MANAGE), deleteCategory);

module.exports = router;
