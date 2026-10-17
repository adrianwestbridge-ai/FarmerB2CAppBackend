const express = require('express');
const {
  getProductReviews,
  createReview,
  deleteReview,
} = require('../controllers/reviewController');
const { protect, farmerOnly, requirePermission } = require('../middleware/authMiddleware');
const { PERMISSIONS: P } = require('../utils/permissions');

const router = express.Router();

router.get('/product/:productId', getProductReviews);
router.post('/', protect, farmerOnly, createReview);
router.delete('/:id', protect, (req, res, next) => (req.userType === 'farmer' ? next() : requirePermission(P.PRODUCTS_MANAGE)(req, res, next)), deleteReview);

module.exports = router;
