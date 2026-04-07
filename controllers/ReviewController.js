const asyncHandler = require("express-async-handler");
const HttpError = require('../middleware/HttpError');
const Review = require('../models/Review');
const Product = require('../models/Product');
const mongoose = require('mongoose');

class ReviewController {
   
  // @desc    Get all reviews for a product
  // @route   GET /api/products/:productId/reviews
  // @access  Public
  static getProductReviews = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const minRating = parseInt(req.query.minRating) || 1;
    const maxRating = parseInt(req.query.maxRating) || 5;

    // Validate product exists
    const product = await Product.findById(productId);
    if (!product) {
      throw new HttpError('Product not found', 404);
    }

    const skip = (page - 1) * limit;

    // Build filter object
    const filter = {
      product: productId,
      isActive: true,
      rating: { $gte: minRating, $lte: maxRating }
    };

    // Get reviews with pagination
    const reviews = await Review.find(filter)
      .populate('user', 'firstName lastName email')
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(limit);
     
    // Get total count for pagination
    const total = await Review.countDocuments(filter);
 console.log("product reviews: ", {
      reviews,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalReviews: total,
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1
     })
    res.json({
      reviews,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalReviews: total,
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1
    });
  });

  // @desc    Get single review
  // @route   GET /api/reviews/:id
  // @access  Public
  static getReview = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const review = await Review.findById(id)
      .populate('user', 'name email')
      .populate('product', 'name images');

    if (!review || !review.isActive) {
      throw new HttpError('Review not found', 404);
    }

    res.json(review);
  });

  // @desc    Create new review
  // @route   POST /api/products/:productId/reviews
  // @access  Private
  static createReview = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const { rating, title, comment, images } = req.body;
    // FIXED: Use req.user._id instead of req.user.userId
    const userId = req.user._id;

    // Validate product exists
    const product = await Product.findById(productId);
    if (!product) {
      throw new HttpError('Product not found', 404);
    }

    // Check if user already reviewed this product
    const existingReview = await Review.findOne({
      product: productId,
      user: userId
    });

    if (existingReview) {
      throw new HttpError('You have already reviewed this product', 400);
    }

    // Create review
    const review = new Review({
      product: productId,
      user: userId,
      rating,
      title,
      comment,
      images: images || []
    });

    const createdReview = await review.save();

    // Update product ratings
    await ReviewController.updateProductRatings(productId);

    // Populate user info for response
    await createdReview.populate('user', 'name email');

    res.status(201).json(createdReview);
  });

  // @desc    Update review
  // @route   PUT /api/reviews/:id
  // @access  Private
  static updateReview = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { rating, title, comment, images } = req.body;
    // FIXED: Use req.user._id
    const userId = req.user._id;

    const review = await Review.findById(id);

    if (!review || !review.isActive) {
      throw new HttpError('Review not found', 404);
    }

    // Check if user owns the review
    if (review.user.toString() !== userId) {
      throw new HttpError('Not authorized to update this review', 403);
    }

    // Update review
    review.rating = rating || review.rating;
    review.title = title || review.title;
    review.comment = comment || review.comment;
    review.images = images || review.images;

    const updatedReview = await review.save();

    // Update product ratings if rating changed
    if (rating && rating !== review.rating) {
      await ReviewController.updateProductRatings(review.product);
    }

    await updatedReview.populate('user', 'name email');

    res.json(updatedReview);
  });

  // @desc    Delete review
  // @route   DELETE /api/reviews/:id
  // @access  Private
  static deleteReview = asyncHandler(async (req, res) => {
    const { id } = req.params;
    // FIXED: Use req.user._id
    const userId = req.user?._id;

    const review = await Review.findById(id);

    if (!review || !review.isActive) {
      throw new HttpError('Review not found', 404);
    }

    // Check if user owns the review or is admin
    if (review.user?._id.toString() !== userId.toString()) {
      throw new HttpError('Not authorized to delete this review', 403);
    }

    // Soft delete
    review.isActive = false;
    await review.save();

    // Update product ratings
    await ReviewController.updateProductRatings(review.product);

    res.json({ message: 'Review deleted successfully' });
  });

  // @desc    Mark review as helpful
  // @route   POST /api/reviews/:id/helpful
  // @access  Private
  static markHelpful = asyncHandler(async (req, res) => {
    const { id } = req.params;
    // FIXED: Use req.user._id
    const userId = req.user._id;

    const review = await Review.findById(id);

    if (!review || !review.isActive) {
      throw new HttpError('Review not found', 404);
    }

    // Check if user already voted
    const hasVoted = review.helpful.voters.some(
      voterId => voterId.toString() === userId
    );

    if (hasVoted) {
      throw new HttpError('You have already voted for this review', 400);
    }

    // Add vote
    review.helpful.votes += 1;
    review.helpful.voters.push(userId);

    await review.save();

    res.json({ 
      message: 'Review marked as helpful',
      helpfulVotes: review.helpful.votes 
    });
  });

  // @desc    Get user's reviews
  // @route   GET /api/users/me/reviews
  // @access  Private
  static getUserReviews = asyncHandler(async (req, res) => {
    // FIXED: Use req.user._id
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const skip = (page - 1) * limit;

    const reviews = await Review.find({ 
      user: userId, 
      isActive: true 
    })
      .populate('product', 'name images price')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Review.countDocuments({ 
      user: userId, 
      isActive: true 
    });

    res.json({
      reviews,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalReviews: total
    });
  });

  // Helper method to update product ratings
  static updateProductRatings = async (productId) => {
    const reviews = await Review.find({ 
      product: productId, 
      isActive: true 
    });

    if (reviews.length === 0) {
      await Product.findByIdAndUpdate(productId, {
        'ratings.average': 0,
        'ratings.count': 0
      });
      return;
    }

    const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
    const averageRating = totalRating / reviews.length;

    await Product.findByIdAndUpdate(productId, {
      'ratings.average': Math.round(averageRating * 10) / 10, // Round to 1 decimal
      'ratings.count': reviews.length
    });
  };
}

module.exports = ReviewController;