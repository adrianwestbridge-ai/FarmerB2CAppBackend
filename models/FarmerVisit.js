const mongoose = require('mongoose');

const farmerVisitSchema = new mongoose.Schema({
  owner_id: { type: String, required: true, index: true },
  farmerId: { type: String, required: true, index: true },
  farmerName: { type: String, required: true },
  agentName: { type: String, required: true },
  visitDate: { type: Date, required: true },
  purpose: { 
    type: String, 
    required: true, 
    enum: ['Crop Advisory', 'Product Demo', 'Follow-up', 'Complaint', 'Other'],
    default: 'Crop Advisory'
  },
  status: { 
    type: String, 
    default: 'SCHEDULED', 
    enum: ['SCHEDULED', 'COMPLETED', 'CANCELLED'] 
  },
  notes: { type: String, default: '' },
  nextVisitDate: { type: Date }
}, { 
  timestamps: true 
});

module.exports = mongoose.model('FarmerVisit', farmerVisitSchema);
