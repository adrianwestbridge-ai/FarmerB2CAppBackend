const express = require('express');
const c = require('../controllers/adminController');
const { protect, superAdminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

// Only the Super Admin can view or manage admin accounts.
router.use(protect, superAdminOnly);

router.get('/permissions', c.getPermissionCatalog);
router.get('/', c.getAdmins);
router.post('/', c.createAdmin);
router.get('/:id', c.getAdmin);
router.put('/:id', c.updateAdmin);
router.patch('/:id/status', c.setAdminStatus);
router.patch('/:id/password', c.resetAdminPassword);
router.get('/:id/activity', c.getAdminActivity);
router.delete('/:id', c.deleteAdmin);

module.exports = router;
