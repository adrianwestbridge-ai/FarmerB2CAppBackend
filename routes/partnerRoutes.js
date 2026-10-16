const express = require('express');
const {
  getPartners,
  createPartner,
  updatePartner,
} = require('../controllers/partnerController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', getPartners);
router.post('/', protect, adminOnly, createPartner);
router.put('/:id', updatePartner);

module.exports = router;
