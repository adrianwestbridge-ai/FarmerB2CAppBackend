const express = require('express');
const {
  getFarmers,
  getFarmerById,
  updateFarmer,
  deleteFarmer,
} = require('../controllers/farmerController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', protect, getFarmers);
router.get('/:id', protect, getFarmerById);
router.put('/:id', protect, updateFarmer);
router.delete('/:id', protect, adminOnly, deleteFarmer);

module.exports = router;
