const express = require('express');
const { getAdmins, createAdmin } = require('../controllers/adminController');
const { protect, adminOnly, superAdminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', protect, adminOnly, getAdmins);
router.post('/', protect, superAdminOnly, createAdmin);

module.exports = router;
