const express = require('express');
const c = require('../controllers/offerController');
const { protect, requirePermission } = require('../middleware/authMiddleware');
const { PERMISSIONS: P } = require('../utils/permissions');

const router = express.Router();

// Farmer-facing list of currently valid offers
router.get('/active', c.activeOffers);

// Offer management
router.get('/', protect, requirePermission(P.OFFERS_MANAGE, P.REPORTS_VIEW), c.listOffers);
router.get('/:id', protect, requirePermission(P.OFFERS_MANAGE, P.REPORTS_VIEW), c.getOffer);
router.post('/', protect, requirePermission(P.OFFERS_MANAGE), c.createOffer);
router.put('/:id', protect, requirePermission(P.OFFERS_MANAGE), c.updateOffer);
router.patch('/:id/status', protect, requirePermission(P.OFFERS_MANAGE), c.setOfferStatus);

module.exports = router;
