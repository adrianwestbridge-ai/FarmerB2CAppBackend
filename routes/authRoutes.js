const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  login,
  registerFarmer,
  getMe,
  updateMe,
  updatePassword,
  checkUsernameAvailability,
  requestPasswordReset,
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const { t } = require('../utils/i18n');

const router = express.Router();

// Per-IP throttles on credential endpoints (per-account lockout is enforced in the controller).
// AUTH_RATE_LIMIT_MULTIPLIER lets automated test environments raise every limit at once.
const multiplier = Math.max(1, Number(process.env.AUTH_RATE_LIMIT_MULTIPLIER) || 1);
const limiter = (max, windowMinutes) => rateLimit({
  windowMs: windowMinutes * 60 * 1000,
  max: max * multiplier,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ success: false, code: 'TOO_MANY_REQUESTS', message: t(req, 'TOO_MANY_REQUESTS') }),
});

router.post('/login', limiter(20, 15), login);
router.post('/register', limiter(10, 60), registerFarmer);
router.post('/forgot-password', limiter(5, 60), requestPasswordReset);
router.get('/check-username', limiter(60, 15), checkUsernameAvailability);

router.get('/me', protect, getMe);
router.put('/me', protect, updateMe);
router.put('/update-password', protect, limiter(10, 15), updatePassword);

module.exports = router;
