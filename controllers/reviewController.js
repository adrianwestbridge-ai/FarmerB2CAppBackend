const Review = require('../models/Review');
const Product = require('../models/Product');

// @desc    Get reviews for a product
// @route   GET /api/reviews/product/:productId
exports.getProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;
    const reviews = await Review.find({ productId }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: reviews.length,
      data: reviews,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create a review for a product
// @route   POST /api/reviews
exports.createReview = async (req, res) => {
  try {
    const { productId, farmerName, rating, comment } = req.body;
    const owner_id = req.user ? (req.user.owner_id || req.user._id.toString()) : (req.body.owner_id || 'anonymous');

    if (!productId || !rating) {
      return res.status(400).json({ success: false, message: 'productId and rating (1-5) are required' });
    }

    const review = await Review.create({
      owner_id,
      productId,
      farmerName: farmerName || (req.user ? req.user.name : 'Farmer'),
      rating: Number(rating),
      comment: comment || '',
    });

    // Recalculate average rating for Product if product exists in DB
    try {
      const reviews = await Review.find({ productId });
      const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;

      await Product.findByIdAndUpdate(productId, {
        averageRating: Number(avg.toFixed(1)),
        totalReviews: reviews.length,
      });
    } catch (e) {
      // Ignore if Product ID is custom string
    }

    res.status(201).json({ success: true, data: review });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete a review
// @route   DELETE /api/reviews/:id
exports.deleteReview = async (req, res) => {
  try {
    const review = await Review.findByIdAndDelete(req.params.id);
    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }
    res.status(200).json({ success: true, message: 'Review deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
