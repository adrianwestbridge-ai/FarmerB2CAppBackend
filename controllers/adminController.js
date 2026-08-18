const Admin = require('../models/Admin');

// @desc    Get all admin users
// @route   GET /api/admins
exports.getAdmins = async (req, res) => {
  try {
    const admins = await Admin.find().select('-password').sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: admins.length, data: admins });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create new Admin (Super Admin only)
// @route   POST /api/admins
exports.createAdmin = async (req, res) => {
  try {
    const { username, password, name, role = 'ADMIN' } = req.body;

    if (!username || !password || !name) {
      return res.status(400).json({ success: false, message: 'username, password, and name are required' });
    }

    const existing = await Admin.findOne({ username });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Username already in use' });
    }

    const admin = await Admin.create({
      owner_id: `admin_${Date.now()}`,
      username,
      password,
      name,
      role,
      status: 'Verified',
    });

    res.status(201).json({ success: true, data: admin });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
