const express = require('express');
const c = require('../controllers/passwordResetController');
const { protect, requirePermission } = require('../middleware/authMiddleware');
const { PERMISSIONS: P } = require('../utils/permissions');

const router = express.Router();

router.use(protect, requirePermission(P.USERS_MANAGE));

router.get('/', c.listRequests);
router.patch('/:id/resolve', c.resolveRequest);
router.patch('/:id/reject', c.rejectRequest);

module.exports = router;
