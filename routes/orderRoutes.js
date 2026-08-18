const express = require('express');
const {
  createOrder,

  getOrders,
  getOrderById,
  updateOrderStatus,
  updatePaymentStatus,
  acceptOrder,
  cancelDelivery,
  completeDelivery,
} = require('../controllers/orderController');

const router = express.Router();

router.get('/', getOrders);
router.post('/', createOrder);
router.get('/:id', getOrderById);
router.patch('/:id/status', updateOrderStatus);
router.patch('/:id/payment', updatePaymentStatus);
router.patch('/:id/accept', acceptOrder);
router.patch('/:id/cancel-delivery', cancelDelivery);
router.patch('/:id/deliver', completeDelivery);

module.exports = router;

