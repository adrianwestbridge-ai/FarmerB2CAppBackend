const express = require('express');
const c = require('../controllers/paymentController');
const { protect, superAdminOnly, requirePermission } = require('../middleware/authMiddleware');
const { PERMISSIONS: P } = require('../utils/permissions');

const router = express.Router();

router.use(protect);
router.get('/', requirePermission(P.PAYMENTS_VERIFY), c.listPayments);
router.get('/summary', superAdminOnly, c.paymentSummary);
router.get('/order/:id', requirePermission(P.PAYMENTS_VERIFY), c.orderLedger);

module.exports = router;
