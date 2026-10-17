const mongoose = require('mongoose');

const CategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, index: true },
    nameHi: { type: String, default: '', trim: true },
    imageUrl: { type: String, default: '' },
    description: { type: String, default: '' },
    isActive: { type: Boolean, default: true, index: true }
  },
  { 
    timestamps: true 
  }
);

module.exports = mongoose.model('Category', CategorySchema);