const mongoose = require('mongoose');

const UNITS = ['kg', 'g', 'L', 'ml', 'packet', 'bag', 'piece', 'bottle', 'box', 'set', 'dozen', 'quintal', 'tonne', 'acre-pack'];

const ProductSchema = new mongoose.Schema(
  {
    // Basic Details
    name: { type: String, required: true, trim: true, index: true },
    nameHi: { type: String, default: '', trim: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', index: true },
    categoryId: { type: String, index: true },
    description: { type: String, default: '' },
    descriptionHi: { type: String, default: '' },
    dosageInstructions: { type: String, default: '' },
    dosageInstructionsHi: { type: String, default: '' },

    // Media
    images: [{ type: String }],
    imageUrls: [{ type: String }],
    videoUrl: { type: String, default: '' },
    pdfUrl: { type: String, default: '' },
    pdfLabelUrl: { type: String, default: '' },

    // Pricing (₹, tax inclusive). `price` is the everyday selling price; `mrp` is the printed
    // Maximum Retail Price. Time-bound discounts come from Offers, never from this document.
    mrp: { type: Number, required: true, min: 0 },
    price: { type: Number, required: true, min: 0 },

    // Pack size, e.g. 5 kg bag → unitQuantity 5, unit 'kg'.
    unit: { type: String, enum: UNITS, default: 'kg' },
    unitQuantity: { type: Number, default: 1, min: 0 },

    // Stock Management
    quantityAvailable: { type: Number, default: 0, min: 0 },
    stockQuantity: { type: Number, default: 0, min: 0 },

    // Status & Badges
    isActive: { type: Boolean, default: true, index: true },
    isFeatured: { type: Boolean, default: false },

    // Reviews
    averageRating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

ProductSchema.pre('validate', function (next) {
  if (this.mrp === undefined || this.mrp === null || this.mrp < this.price) this.mrp = this.price;
  next();
});

ProductSchema.pre('save', function (next) {
  // Sync images and imageUrls
  if (this.imageUrls && this.imageUrls.length > 0 && (!this.images || this.images.length === 0)) {
    this.images = this.imageUrls;
  } else if (this.images && this.images.length > 0 && (!this.imageUrls || this.imageUrls.length === 0)) {
    this.imageUrls = this.images;
  }

  if (this.isNew && (this.quantityAvailable === undefined || this.quantityAvailable === null)) {
    this.quantityAvailable = this.stockQuantity || 0;
  }
  if (this.quantityAvailable < 0) this.quantityAvailable = 0;

  if (this.pdfUrl && !this.pdfLabelUrl) this.pdfLabelUrl = this.pdfUrl;
  else if (this.pdfLabelUrl && !this.pdfUrl) this.pdfUrl = this.pdfLabelUrl;

  next();
});

ProductSchema.index({ name: 'text', description: 'text' });

module.exports = mongoose.model('Product', ProductSchema);
module.exports.UNITS = UNITS;
