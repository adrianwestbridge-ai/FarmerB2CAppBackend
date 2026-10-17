const express = require('express');
const { getCart, addToCart, setQuantity, removeCartItem, clearCart } = require('../controllers/cartController');
const { protect, farmerOnly } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect, farmerOnly);

router.get('/', getCart);
router.post('/', addToCart);
router.put('/:productId', setQuantity);
router.delete('/:productId', removeCartItem);
router.delete('/', clearCart);

module.exports = router;
