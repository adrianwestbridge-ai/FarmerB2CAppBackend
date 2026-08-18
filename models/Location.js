const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: 'userModel' },
  userModel: { type: String, required: true, enum: ['Farmer', 'Partner', 'Admin'] },
  coordinates: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true } // [longitude, latitude]
  },
  address: { type: String },
  lastUpdated: { type: Date, default: Date.now }
}, { 
  timestamps: true 
});

// Create a geospatial index for location-based queries
locationSchema.index({ coordinates: '2dsphere' });

module.exports = mongoose.model('Location', locationSchema);
