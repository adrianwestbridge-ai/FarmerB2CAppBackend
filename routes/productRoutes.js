const express = require('express');
const {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  updateStock,
  deleteProduct,
} = require('../controllers/productController');
const { protect, optionalAuth, requirePermission } = require('../middleware/authMiddleware');
const { PERMISSIONS: P } = require('../utils/permissions');

const router = express.Router();

// Public catalogue (admins with PRODUCTS_MANAGE additionally see inactive products)
router.get('/', optionalAuth, getProducts);
router.get('/:id', optionalAuth, getProductById);

// Product management
router.post('/', protect, requirePermission(P.PRODUCTS_MANAGE), createProduct);
router.put('/:id', protect, requirePermission(P.PRODUCTS_MANAGE), updateProduct);
router.patch('/:id/stock', protect, requirePermission(P.PRODUCTS_MANAGE), updateStock);
router.delete('/:id', protect, requirePermission(P.PRODUCTS_MANAGE), deleteProduct);

module.exports = router;
