const express = require('express');
const c = require('../controllers/settingsController');
const { protect, superAdminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/public', c.getPublicSettings);
router.get('/', protect, superAdminOnly, c.getSettings);
router.put('/', protect, superAdminOnly, c.updateSettings);

module.exports = router;
