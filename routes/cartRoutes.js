const express = require('express');
const {
  getCart,
  addToCart,
  updateCartQuantity,
  removeCartItem,
  clearCart,
} = require('../controllers/cartController');

const router = express.Router();

// Fetch user cart
router.get('/', getCart);

// Add product to cart
router.post('/', addToCart);

// Update quantity (+, -, or direct numeric value)
router.put('/:id', updateCartQuantity);
router.patch('/:id', updateCartQuantity);

// Remove single product (Delete icon)
router.delete('/:id', removeCartItem);
router.post('/remove', removeCartItem);

// Clear entire cart
router.delete('/', clearCart);

module.exports = router;
