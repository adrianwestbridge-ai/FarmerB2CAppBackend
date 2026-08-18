const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  owner_id: { type: String, required: true },
  farmerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmer', required: true },
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' }, // Optional reference to the Partner/Agent
  farmerName: { type: String },
  agentName: { type: String },
  visitDate: { type: Date, required: true },
  purpose: { type: String, enum: ['Crop Advisory', 'Product Demo', 'Follow-up', 'Complaint', 'Other'], required: true },
  status: { type: String, default: 'SCHEDULED', enum: ['SCHEDULED', 'COMPLETED', 'CANCELLED'] },
  notes: { type: String },
  nextVisitDate: { type: Date }
}, { 
  timestamps: true 
});

module.exports = mongoose.model('Activity', activitySchema);
