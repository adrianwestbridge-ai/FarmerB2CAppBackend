const express = require('express');
const c = require('../controllers/farmerController');
const { protect, requirePermission } = require('../middleware/authMiddleware');
const { PERMISSIONS: P } = require('../utils/permissions');

const router = express.Router();

// Farmers manage their own profile through /api/auth/me; these routes are for admins.
router.use(protect, requirePermission(P.USERS_MANAGE, P.ORDERS_APPROVE, P.REPORTS_VIEW));

router.get('/', c.getFarmers);
router.get('/:id', c.getFarmerById);
router.post('/', requirePermission(P.USERS_MANAGE), c.createFarmer);
router.put('/:id', requirePermission(P.USERS_MANAGE), c.updateFarmer);
router.patch('/:id/status', requirePermission(P.USERS_MANAGE), c.setFarmerStatus);
router.patch('/:id/password', requirePermission(P.USERS_MANAGE), c.resetFarmerPassword);

module.exports = router;
