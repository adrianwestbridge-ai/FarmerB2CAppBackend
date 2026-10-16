const Farmer = require('../models/Farmer');

// @desc    Get all farmers
// @route   GET /api/farmers
exports.getFarmers = async (req, res) => {
  try {
    const { search, limit = 50, page = 1 } = req.query;
    let filter = {};

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } },
        { village: { $regex: search, $options: 'i' } },
        { district: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;
    const farmers = await Farmer.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(Number(skip))
      .limit(Number(limit));

    const total = await Farmer.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: farmers.length,
      total,
      data: farmers,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create new Farmer (Admin only)
// @route   POST /api/farmers
exports.createFarmer = async (req, res) => {
  try {
    const { name, phoneNumber, username, password } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }
    if (!username) {
      return res.status(400).json({ success: false, message: 'Username is required' });
    }

    const normalizedUsername = String(username).trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(normalizedUsername)) {
      return res.status(400).json({ success: false, message: 'Username must be 3-20 characters and contain only lowercase letters, numbers, and underscores' });
    }

    const existingFarmer = await Farmer.findOne({ phoneNumber });
    if (existingFarmer) {
      return res.status(400).json({ success: false, message: 'Farmer already registered with this phone number' });
    }

    const existingUsername = await Farmer.findOne({ username: normalizedUsername });
    if (existingUsername) {
      return res.status(400).json({ success: false, message: 'Username already exists' });
    }

    const farmer = await Farmer.create({
      owner_id: `farmer_${Date.now()}`,
      phoneNumber,
      username: normalizedUsername,
      name: name || '',
      password: password || '123456',
      createdBy: req.user.owner_id,
    });

    const farmerData = farmer.toObject();
    delete farmerData.password;

    res.status(201).json({ success: true, data: farmerData });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Get single farmer profile
// @route   GET /api/farmers/:id
exports.getFarmerById = async (req, res) => {
  try {
    const farmer = await Farmer.findById(req.params.id).select('-password');
    if (!farmer) {
      return res.status(404).json({ success: false, message: 'Farmer not found' });
    }
    res.status(200).json({ success: true, data: farmer });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update farmer profile
// @route   PUT /api/farmers/:id
exports.updateFarmer = async (req, res) => {
  try {
    const farmer = await Farmer.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }).select('-password');

    if (!farmer) {
      return res.status(404).json({ success: false, message: 'Farmer not found' });
    }

    res.status(200).json({ success: true, data: farmer });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Delete/Deactivate farmer
// @route   DELETE /api/farmers/:id
exports.deleteFarmer = async (req, res) => {
  try {
    const farmer = await Farmer.findByIdAndUpdate(
      req.params.id,
      { status: 'Suspended' },
      { new: true }
    );
    if (!farmer) {
      return res.status(404).json({ success: false, message: 'Farmer not found' });
    }
    res.status(200).json({ success: true, message: 'Farmer status updated to Suspended' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
