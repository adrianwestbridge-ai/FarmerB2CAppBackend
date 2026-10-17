const express = require('express');
const c = require('../controllers/reportController');
const { protect, requirePermission } = require('../middleware/authMiddleware');
const { PERMISSIONS: P } = require('../utils/permissions');

const router = express.Router();

// The Super Admin holds REPORTS_VIEW implicitly; other admins only if it was granted to them.
router.use(protect, requirePermission(P.REPORTS_VIEW));

router.get('/summary', c.summary);
router.get('/orders', c.orders);
router.get('/admins', c.adminActivity);
router.get('/partners', c.partners);
router.get('/farmers', c.farmers);
router.get('/offers', c.offers);
router.get('/products', c.products);
router.get('/settlements', c.settlements);
router.get('/activity', c.activity);

module.exports = router;
