const Partner = require('../models/Partner');

// @desc    Get all partners/agents
// @route   GET /api/partners
exports.getPartners = async (req, res) => {
  try {
    const partners = await Partner.find({ status: 'Active' }).select('-password').sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: partners.length, data: partners });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create/Register Partner
// @route   POST /api/partners
exports.createPartner = async (req, res) => {
  try {
    const { name, phoneNumber, businessName, gstNumber, serviceArea, addressLine, password } = req.body;

    if (!name || !phoneNumber) {
      return res.status(400).json({ success: false, message: 'Name and phone number required' });
    }

    const existing = await Partner.findOne({ phoneNumber });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Partner with phone number already exists' });
    }

    const partner = await Partner.create({
      owner_id: `partner_${Date.now()}`,
      name,
      phoneNumber,
      businessName: businessName || '',
      gstNumber: gstNumber || '',
      serviceArea: serviceArea || '',
      addressLine: addressLine || '',
      password: password || '123456',
      createdBy: req.user.owner_id,
    });

    const partnerData = partner.toObject();
    delete partnerData.password;

    res.status(201).json({ success: true, data: partnerData });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Update partner details
// @route   PUT /api/partners/:id
exports.updatePartner = async (req, res) => {
  try {
    const partner = await Partner.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }).select('-password');

    if (!partner) {
      return res.status(404).json({ success: false, message: 'Partner not found' });
    }

    res.status(200).json({ success: true, data: partner });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
