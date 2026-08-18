const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema(
  {
    // Basic Details
    name: { type: String, required: true, trim: true, index: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', index: true },
    categoryId: { type: String, index: true },
    description: { type: String, default: '' },
    dosageInstructions: { type: String, default: '' },
    
    // Media
    images: [{ type: String }],
    imageUrls: [{ type: String }],
    videoUrl: { type: String, default: '' },
    pdfUrl: { type: String, default: '' },
    pdfLabelUrl: { type: String, default: '' },

    // Pricing & Discounts
    price: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    
    // Stock Management
    quantityAvailable: { type: Number, default: 0, min: 0 },
    stockQuantity: { type: Number, default: 0, min: 0 },

    // Status & Badges
    isActive: { type: Boolean, default: true, index: true },
    isFeatured: { type: Boolean, default: false },

    // Reviews
    averageRating: { type: Number, default: 5 },
    totalReviews: { type: Number, default: 0 },
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Pre-save normalization
ProductSchema.pre('save', function (next) {
  // Sync images and imageUrls
  if (this.imageUrls && this.imageUrls.length > 0 && (!this.images || this.images.length === 0)) {
    this.images = this.imageUrls;
  } else if (this.images && this.images.length > 0 && (!this.imageUrls || this.imageUrls.length === 0)) {
    this.imageUrls = this.images;
  }

  // Stock Quantity = total stock listed by seller; Quantity Available = remaining stock left for sale
  if (this.isNew) {
    if (this.quantityAvailable === undefined || this.quantityAvailable === null) {
      this.quantityAvailable = this.stockQuantity || 0;
    }
  } else if (this.isModified('stockQuantity') && !this.isModified('quantityAvailable')) {
    // If seller updates total stockQuantity, ensure quantityAvailable doesn't exceed new stockQuantity
    this.quantityAvailable = Math.min(this.stockQuantity || 0, this.quantityAvailable !== undefined ? this.quantityAvailable : (this.stockQuantity || 0));
  }
  if (this.quantityAvailable < 0) {
    this.quantityAvailable = 0;
  }

  // Sync pdfUrl and pdfLabelUrl
  if (this.pdfUrl && !this.pdfLabelUrl) {
    this.pdfLabelUrl = this.pdfUrl;
  } else if (this.pdfLabelUrl && !this.pdfUrl) {
    this.pdfUrl = this.pdfLabelUrl;
  }

  next();
});

// Search Index
ProductSchema.index({ name: 'text', description: 'text' });

module.exports = mongoose.model('Product', ProductSchema);