const express = require('express');
const c = require('../controllers/orderController');
const { protect, farmerOnly, partnerOnly, adminOnly, requirePermission } = require('../middleware/authMiddleware');
const { PERMISSIONS: P } = require('../utils/permissions');

const router = express.Router();

router.use(protect);

// Shared (results are scoped to the caller's role inside the controller)
router.get('/', c.getOrders);
router.get('/counts', adminOnly, c.getOrderCounts);
router.get('/:id', c.getOrderById);

// Farmer
router.post('/quote', farmerOnly, c.quote);
router.post('/', farmerOnly, c.createOrder);
router.patch('/:id/payment-reference', farmerOnly, c.submitPaymentReference);
router.patch('/:id/cancel', c.cancelOrder); // farmer (own) or admin with ORDERS_APPROVE

// Admin — approval workflow
router.patch('/:id/verification', requirePermission(P.ORDERS_APPROVE), c.recordVerification);
router.patch('/:id/approve', requirePermission(P.ORDERS_APPROVE), c.approveOrder);
router.patch('/:id/reject', requirePermission(P.ORDERS_APPROVE), c.rejectOrder);

// Admin — delivery assignment
router.patch('/:id/assign', requirePermission(P.ORDERS_ASSIGN), c.assignPartner);
router.patch('/:id/release', requirePermission(P.ORDERS_ASSIGN), c.releaseOrder);

// Admin — payments
router.patch('/:id/payment/verify', requirePermission(P.PAYMENTS_VERIFY), c.verifyPayment);
router.patch('/:id/payment/refund', requirePermission(P.PAYMENTS_VERIFY), c.recordRefund);

// Delivery partner
router.patch('/:id/accept', partnerOnly, c.acceptOrder);
router.patch('/:id/unavailable', partnerOnly, c.reportUnavailable);
router.patch('/:id/pickup', partnerOnly, c.pickupOrder);
router.patch('/:id/deliver', partnerOnly, c.completeDelivery);
router.patch('/:id/fail', partnerOnly, c.failDelivery);

module.exports = router;
