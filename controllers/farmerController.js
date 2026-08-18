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
