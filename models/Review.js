// models/Review.js
const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  comment: {
    type: String,
    required: true,
    maxlength: 1000
  },
  images: [{
    url: String,
    alt: String
  }],
  isVerified: {
    type: Boolean,
    default: false
  },
  helpful: {
    votes: {
      type: Number,
      default: 0
    },
    voters: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }]
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Compound index to ensure one review per user per product
reviewSchema.index({ product: 1, user: 1 }, { unique: true });

// Index for sorting
reviewSchema.index({ createdAt: -1 });
reviewSchema.index({ rating: -1 });

const Review=mongoose.model('Review', reviewSchema);
module.exports = Review