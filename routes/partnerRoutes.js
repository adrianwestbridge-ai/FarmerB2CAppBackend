const express = require('express');
const c = require('../controllers/partnerController');
const { protect, requirePermission } = require('../middleware/authMiddleware');
const { PERMISSIONS: P } = require('../utils/permissions');

const router = express.Router();

// Partners manage their own profile through /api/auth/me; these routes are for admins.
router.use(protect, requirePermission(P.USERS_MANAGE, P.ORDERS_ASSIGN, P.SETTLEMENTS_MANAGE, P.REPORTS_VIEW));

router.get('/', c.getPartners);
router.get('/:id', c.getPartner);
router.post('/', requirePermission(P.USERS_MANAGE), c.createPartner);
router.put('/:id', requirePermission(P.USERS_MANAGE), c.updatePartner);
router.patch('/:id/status', requirePermission(P.USERS_MANAGE), c.setPartnerStatus);
router.patch('/:id/password', requirePermission(P.USERS_MANAGE), c.resetPartnerPassword);

module.exports = router;
