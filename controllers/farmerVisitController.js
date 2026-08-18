const FarmerVisit = require('../models/FarmerVisit');

// @desc    Get farmer visits
// @route   GET /api/visits
exports.getFarmerVisits = async (req, res) => {
  try {
    const { farmerId, owner_id, status } = req.query;
    let filter = {};

    if (farmerId) filter.farmerId = farmerId;
    if (owner_id) filter.owner_id = owner_id;
    if (status) filter.status = status;

    const visits = await FarmerVisit.find(filter).sort({ visitDate: -1 });

    res.status(200).json({
      success: true,
      count: visits.length,
      data: visits,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get single visit details
// @route   GET /api/visits/:id
exports.getFarmerVisitById = async (req, res) => {
  try {
    const visit = await FarmerVisit.findById(req.params.id);
    if (!visit) {
      return res.status(404).json({ success: false, message: 'Farmer visit not found' });
    }
    res.status(200).json({ success: true, data: visit });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Schedule a new farmer visit
// @route   POST /api/visits
exports.scheduleFarmerVisit = async (req, res) => {
  try {
    const {
      farmerId,
      farmerName,
      agentName,
      visitDate,
      purpose,
      notes,
      nextVisitDate,
    } = req.body;

    const owner_id = req.user ? (req.user.owner_id || req.user._id.toString()) : (req.body.owner_id || 'system');

    if (!farmerId || !farmerName || !agentName || !visitDate || !purpose) {
      return res.status(400).json({
        success: false,
        message: 'farmerId, farmerName, agentName, visitDate, and purpose are required',
      });
    }

    const visit = await FarmerVisit.create({
      owner_id,
      farmerId,
      farmerName,
      agentName,
      visitDate: new Date(visitDate),
      purpose,
      status: req.body.status || 'SCHEDULED',
      notes: notes || '',
      nextVisitDate: nextVisitDate ? new Date(nextVisitDate) : undefined,
    });

    res.status(201).json({ success: true, data: visit });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Update farmer visit status/notes
// @route   PUT /api/visits/:id
exports.updateFarmerVisit = async (req, res) => {
  try {
    const visit = await FarmerVisit.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!visit) {
      return res.status(404).json({ success: false, message: 'Farmer visit not found' });
    }

    res.status(200).json({ success: true, data: visit });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
