const express = require('express');
const {
  getPartners,
  createPartner,
  updatePartner,
} = require('../controllers/partnerController');

const router = express.Router();

router.get('/', getPartners);
router.post('/', createPartner);
router.put('/:id', updatePartner);

module.exports = router;
