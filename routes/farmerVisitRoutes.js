const express = require('express');
const {
  getFarmerVisits,
  getFarmerVisitById,
  scheduleFarmerVisit,
  updateFarmerVisit,
} = require('../controllers/farmerVisitController');

const router = express.Router();

router.get('/', getFarmerVisits);
router.get('/:id', getFarmerVisitById);
router.post('/', scheduleFarmerVisit);
router.put('/:id', updateFarmerVisit);

module.exports = router;