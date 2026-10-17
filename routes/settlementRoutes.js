const express = require('express');
const c = require('../controllers/settlementController');
const { protect, partnerOnly, requirePermission } = require('../middleware/authMiddleware');
const { PERMISSIONS: P } = require('../utils/permissions');

const router = express.Router();

router.use(protect);

// Delivery partner
router.get('/mine', partnerOnly, c.mySettlements);
router.post('/', partnerOnly, c.submitSettlement);

// Admin
router.get('/', requirePermission(P.SETTLEMENTS_MANAGE, P.REPORTS_VIEW), c.listSettlements);
router.get('/outstanding', requirePermission(P.SETTLEMENTS_MANAGE, P.REPORTS_VIEW), c.outstandingByPartner);
router.post('/record', requirePermission(P.SETTLEMENTS_MANAGE), c.recordSettlement);
router.patch('/:id/verify', requirePermission(P.SETTLEMENTS_MANAGE), c.verifySettlement);
router.patch('/:id/dispute', requirePermission(P.SETTLEMENTS_MANAGE), c.disputeSettlement);

// Either the owning partner or an admin
router.get('/:id', (req, res, next) => (req.userType === 'partner' ? next() : requirePermission(P.SETTLEMENTS_MANAGE, P.REPORTS_VIEW)(req, res, next)), c.getSettlement);

module.exports = router;
