const express = require('express');
const {
  getFarmerVisits,
  getFarmerVisitById,
  scheduleFarmerVisit,
  updateFarmerVisit,
} = require('../controllers/farmerVisitController');
const { protect, requirePermission } = require('../middleware/authMiddleware');
const { PERMISSIONS: P } = require('../utils/permissions');

const router = express.Router();

router.use(protect, requirePermission(P.USERS_MANAGE));

router.get('/', getFarmerVisits);
router.get('/:id', getFarmerVisitById);
router.post('/', scheduleFarmerVisit);
router.put('/:id', updateFarmerVisit);

module.exports = router;
