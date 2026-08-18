const express = require('express');
const {
  getProductReviews,
  createReview,
  deleteReview,
} = require('../controllers/reviewController');

const router = express.Router();

router.get('/product/:productId', getProductReviews);
router.post('/', createReview);
router.delete('/:id', deleteReview);

module.exports = router;
