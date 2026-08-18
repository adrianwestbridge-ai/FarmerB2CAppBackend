const express = require('express');
const {
  registerFarmer,
  loginFarmer,
  loginAdmin,
  loginPartner,
  getMe,
  updateMe,
  updatePassword,
  getAllUsers,
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/register', registerFarmer);
router.post('/login', loginFarmer);
router.post('/admin/login', loginAdmin);
router.post('/partner/login', loginPartner);
router.get('/me', protect, getMe);
router.put('/me', protect, updateMe);
router.put('/update-password', protect, updatePassword);
router.get('/all-users', getAllUsers);


module.exports = router;

