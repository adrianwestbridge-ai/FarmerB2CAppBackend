const express = require('express');
const {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  updateStock,
  deleteProduct,
} = require('../controllers/productController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

// Public / Farmer Routes
router.get('/', getProducts);
router.get('/:id', getProductById);

// Admin / Management Routes
router.post('/', protect, adminOnly, createProduct);
router.put('/:id', protect, adminOnly, updateProduct);
router.patch('/:id/stock', protect, adminOnly, updateStock);
router.delete('/:id', protect, adminOnly, deleteProduct);

module.exports = router;