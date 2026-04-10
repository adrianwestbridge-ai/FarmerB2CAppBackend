const mongoose = require('mongoose');

const CalendarSchema = new mongoose.Schema({
  // Date Information
  date: {
    type: Date,
    required: true,
    unique: true,
    index: true
  },
  month: {
    type: Number,
    required: true,
    min: 1,
    max: 12
  },
  day: {
    type: Number,
    required: true,
    min: 1,
    max: 31
  },
  
  // Event Details
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  
  // New Field: External Link or Event Source
  url: {
    type: String,
    trim: true,
    default: ""
  },

  category: {
    type: String,
    enum: [
      'National', 'International', 'Religious', 'Cultural', 
      'Sports', 'Science', 'Technology', 'Health', 'Environment'
    ],
    required: true
  },
  
  // Google Doodle Style Image Data
  doodleImage: {
    url: String,
    alt: String,
    artist: String
  },
  
  eventType: {
    type: String,
    enum: [
      'Holiday', 'Festival', 'Observance', 'Awareness Day', 
      'Birthday', 'Anniversary', 'Commemoration'
    ],
    required: true
  },
  
  // Location/Origin
  region: {
    type: String,
    enum: ['India', 'World', 'Both'],
    required: true
  },
  
  // Holiday Information
  isPublicHoliday: {
    type: Boolean,
    default: false
  },
  states: [{
    type: String // For India-specific holidays in certain states
  }],
  
  // Metadata & UI
  tags: [String],
  color: {
    type: String,
    default: '#B00020'
  },
  isRecurring: {
    type: Boolean,
    default: true
  }
}, {
  // Automatically creates 'createdAt' and 'updatedAt'
  timestamps: true 
});

// Indexes for faster filtering in your API
// CalendarEventSchema.index({ month: 1, day: 1 });
// CalendarEventSchema.index({ category: 1 });

module.exports = mongoose.model('Calendar', CalendarSchema);