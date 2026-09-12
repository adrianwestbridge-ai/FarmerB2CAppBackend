const jwt = require('jsonwebtoken');
const Farmer = require('../models/Farmer');
const Admin = require('../models/Admin');
const Partner = require('../models/Partner');

const generateToken = (id, userType, role) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return jwt.sign({ id, userType, role }, secret, {
    expiresIn: '30d',
  });
};

// @desc    Register a new Farmer
// @route   POST /api/auth/register
exports.registerFarmer = async (req, res) => {
  try {
    const {
      phoneNumber,
      name,
      language,
      cropType,
      landSizeAcres,
      addressLine,
      village,
      district,
      state,
      pincode,
      password,
    } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }

    const existingFarmer = await Farmer.findOne({ phoneNumber });
    if (existingFarmer) {
      return res.status(400).json({ success: false, message: 'Farmer already registered with this phone number' });
    }

    const owner_id = `farmer_${Date.now()}`;
    const farmer = await Farmer.create({
      owner_id,
      phoneNumber,
      name: name || '',
      language: language || 'English',
      cropType: cropType || '',
      landSizeAcres: landSizeAcres ? Number(landSizeAcres) : 0,
      addressLine: addressLine || '',
      village: village || '',
      district: district || '',
      state: state || '',
      pincode: pincode || '',
      password: password || '123456',
    });

    const token = generateToken(farmer._id, 'farmer', 'FARMER');

    res.status(201).json({
      success: true,
      token,
      data: farmer,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Unified User/Farmer/Admin/Partner Login
// @route   POST /api/auth/login
exports.loginFarmer = async (req, res) => {
  try {
    const { phoneNumber, password, owner_id, userId, username } = req.body;
    const identifier = phoneNumber || owner_id || userId || username;

    if (!identifier) {
      return res.status(400).json({ success: false, message: 'User ID, phone number or owner_id is required' });
    }

    // 1. Check Farmer collection
    let farmer = await Farmer.findOne({
      $or: [
        { phoneNumber: identifier },
        { owner_id: identifier },
      ],
    });

    if (farmer) {
      if (password && farmer.password) {
        const isMatch = await farmer.matchPassword(password);
        if (!isMatch && password !== farmer.password) {
          return res.status(401).json({ success: false, message: 'Invalid password' });
        }
      }
      const token = generateToken(farmer._id, 'farmer', 'FARMER');
      return res.status(200).json({
        success: true,
        token,
        data: farmer,
        userType: 'farmer',
      });
    }

    // 2. Check Admin collection
    let admin = await Admin.findOne({
      $or: [
        { username: identifier },
        { owner_id: identifier },
      ],
    });

    if (admin) {
      if (password && admin.password) {
        const isMatch = await admin.matchPassword(password);
        if (!isMatch && password !== admin.password) {
          return res.status(401).json({ success: false, message: 'Invalid password' });
        }
      }
      const token = generateToken(admin._id, 'admin', admin.role);
      return res.status(200).json({
        success: true,
        token,
        data: admin,
        userType: 'admin',
      });
    }

    // 3. Check Partner collection
    let partner = await Partner.findOne({
      $or: [
        { phoneNumber: identifier },
        { owner_id: identifier },
      ],
    });

    if (partner) {
      if (password && partner.password) {
        const isMatch = await partner.matchPassword(password);
        if (!isMatch && password !== partner.password) {
          return res.status(401).json({ success: false, message: 'Invalid password' });
        }
      }
      const token = generateToken(partner._id, 'partner', 'PARTNER');
      return res.status(200).json({
        success: true,
        token,
        data: partner,
        userType: 'partner',
      });
    }

    // 4. User not found in database
    return res.status(401).json({ success: false, message: 'Invalid credentials: User not found in database' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Admin Login
// @route   POST /api/auth/admin/login
exports.loginAdmin = async (req, res) => {
  try {
    const { username, password, owner_id, userId } = req.body;
    const identifier = username || owner_id || userId;

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Username/Owner ID and password are required' });
    }

    let admin = await Admin.findOne({
      $or: [
        { username: identifier },
        { owner_id: identifier },
      ],
    });

    if (!admin) {
      return res.status(401).json({ success: false, message: 'Admin user not found in database' });
    }

    const isMatch = await admin.matchPassword(password);
    if (!isMatch && password !== admin.password) {
      return res.status(401).json({ success: false, message: 'Invalid password' });
    }

    const token = generateToken(admin._id, 'admin', admin.role);

    res.status(200).json({
      success: true,
      token,
      data: admin,
      userType: 'admin',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Partner Login
// @route   POST /api/auth/partner/login
exports.loginPartner = async (req, res) => {
  try {
    const { phoneNumber, password, owner_id, userId } = req.body;
    const identifier = phoneNumber || owner_id || userId;

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Phone number/Owner ID and password are required' });
    }

    let partner = await Partner.findOne({
      $or: [
        { phoneNumber: identifier },
        { owner_id: identifier },
      ],
    });

    if (!partner) {
      return res.status(401).json({ success: false, message: 'Partner not found in database' });
    }

    const isMatch = await partner.matchPassword(password);
    if (!isMatch && password !== partner.password) {
      return res.status(401).json({ success: false, message: 'Invalid password' });
    }

    const token = generateToken(partner._id, 'partner', 'PARTNER');

    res.status(200).json({
      success: true,
      token,
      data: partner,
      userType: 'partner',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};




// @desc    Get Current Logged in User Profile
// @route   GET /api/auth/me
exports.getMe = async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: req.user,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update Current Logged in User Profile
// @route   PUT /api/auth/me
exports.updateMe = async (req, res) => {
  try {
    let updatedUser = null;
    const userId = req.user._id;

    const {
      name,
      phoneNumber,
      language,
      cropType,
      landSizeAcres,
      addressLine,
      village,
      district,
      state,
      pincode,
      profileUrl,
      coverImageUrl,
      businessName,
      gstNumber,
      serviceArea,
      online,
      vehicleName,
      vehicleNumber,
    } = req.body;

    const updateFields = {};
    if (name !== undefined) updateFields.name = name;
    if (phoneNumber !== undefined) updateFields.phoneNumber = phoneNumber;
    if (profileUrl !== undefined) updateFields.profileUrl = profileUrl;
    if (coverImageUrl !== undefined) updateFields.coverImageUrl = coverImageUrl;

    if (req.user.userType === 'farmer' || req.user.role === 'FARMER') {
      if (language !== undefined) updateFields.language = language;
      if (cropType !== undefined) updateFields.cropType = cropType;
      if (landSizeAcres !== undefined) updateFields.landSizeAcres = Number(landSizeAcres);
      if (addressLine !== undefined) updateFields.addressLine = addressLine;
      if (village !== undefined) updateFields.village = village;
      if (district !== undefined) updateFields.district = district;
      if (state !== undefined) updateFields.state = state;
      if (pincode !== undefined) updateFields.pincode = pincode;

      updatedUser = await Farmer.findByIdAndUpdate(userId, updateFields, {
        new: true,
        runValidators: true,
      }).select('-password');
    } else if (req.user.userType === 'admin' || ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(req.user.role)) {
      updatedUser = await Admin.findByIdAndUpdate(userId, updateFields, {
        new: true,
        runValidators: true,
      }).select('-password');
    } else if (req.user.userType === 'partner' || req.user.role === 'PARTNER') {
      if (businessName !== undefined) updateFields.businessName = businessName;
      if (gstNumber !== undefined) updateFields.gstNumber = gstNumber;
      if (serviceArea !== undefined) updateFields.serviceArea = serviceArea;
      if (addressLine !== undefined) updateFields.addressLine = addressLine;
      if (online !== undefined) updateFields.online = Boolean(online);
      if (vehicleName !== undefined) updateFields.vehicleName = vehicleName;
      if (vehicleNumber !== undefined) updateFields.vehicleNumber = vehicleNumber;

      updatedUser = await Partner.findByIdAndUpdate(userId, updateFields, {
        new: true,
        runValidators: true,
      }).select('-password');

      // If partner goes offline, cancel and unassign all active orders assigned to them
      if (online === false || online === 'false') {
        const Order = require('../models/Order');
        await Order.updateMany(
          {
            $or: [
              { assignedPartnerId: userId },
              { assignedPartnerName: req.user.name || req.user.businessName || '' }
            ],
            status: { $in: ['SHIPPED', 'PLACED'] }
          },
          {
            $set: {
              status: 'CANCELLED',
              assignedPartnerId: null,
              assignedPartnerName: '',
              assignedPartnerPhone: '',
              trackingNote: 'Order delivery cancelled as partner went offline. Re-opened for delivery assignment.'
            }
          }
        );
      }
    }


    if (!updatedUser) {
      return res.status(444 || 404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({
      success: true,
      data: updatedUser,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Update Password (for Farmer, Partner, Admin)
// @route   PUT /api/auth/update-password
exports.updatePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword, confirmPassword, adminPin } = req.body;

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password and confirm password are required',
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password and confirm password do not match',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long',
      });
    }

    const userId = req.user._id;
    const userType = req.user.userType;
    const role = req.user.role;

    let user = null;
    const isAdmin = userType === 'admin' || ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(role);

    if (isAdmin) {
      user = await Admin.findById(userId);
    } else if (userType === 'partner' || role === 'PARTNER') {
      user = await Partner.findById(userId);
    } else {
      user = await Farmer.findById(userId);
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Role specific security validation
    if (isAdmin) {
      // Admin requires security PIN managed via ENV
      const envAdminPin = process.env.ADMIN_SECURITY_PIN || '8888';
      if (!adminPin || String(adminPin).trim() !== String(envAdminPin).trim()) {
        return res.status(401).json({
          success: false,
          message: 'Invalid Admin Security PIN. Admin password update requires valid PIN.',
        });
      }
      if (oldPassword && user.matchPassword) {
        const isMatch = await user.matchPassword(oldPassword);
        if (!isMatch && oldPassword !== user.password) {
          return res.status(401).json({ success: false, message: 'Old password does not match' });
        }
      }
    } else {
      // Farmer / Partner require oldPassword verification
      if (!oldPassword) {
        return res.status(400).json({
          success: false,
          message: 'Old password is required',
        });
      }

      if (user.matchPassword) {
        const isMatch = await user.matchPassword(oldPassword);
        if (!isMatch && oldPassword !== user.password) {
          return res.status(401).json({
            success: false,
            message: 'Old password does not match',
          });
        }
      } else if (oldPassword !== user.password) {
        return res.status(401).json({
          success: false,
          message: 'Old password does not match',
        });
      }
    }

    // Set new password (pre save hook will hash it)
    user.password = newPassword;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Password updated successfully',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all Farmers, Partners, and Admins for Admin User Management Hub
// @route   GET /api/auth/all-users
exports.getAllUsers = async (req, res) => {
  try {
    const farmers = await Farmer.find().select('-password');
    const partners = await Partner.find().select('-password');
    const admins = await Admin.find().select('-password');

    res.status(200).json({
      success: true,
      data: {
        farmers,
        partners,
        admins,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


