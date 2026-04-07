const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  description: {
    type: String,
    maxlength: 500
  },
  discountType: {
    type: String,
    enum: ['percentage', 'fixed'],
    required: true
  },
  discountValue: {
    type: Number,
    required: true,
    min: 0
  },
  minimumCartValue: {
    type: Number,
    default: 0
  },
  maximumDiscount: {
    type: Number
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  usageLimit: {
    type: Number
  },
  usedCount: {
    type: Number,
    default: 0
  },
  perUserLimit: {
    type: Number,
    default: 1
  },
  usedBy: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    usedAt: {
      type: Date,
      default: Date.now
    }
  }],
  categories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  }],
  products: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }],
  excludedProducts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  isSingleUse: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes
couponSchema.index({ code: 1 });
couponSchema.index({ startDate: 1, endDate: 1 });
couponSchema.index({ isActive: 1 });

// Virtual for isValid
couponSchema.virtual('isValid').get(function() {
  const now = new Date();
  return this.isActive && 
         this.startDate <= now && 
         this.endDate >= now && 
         (!this.usageLimit || this.usedCount < this.usageLimit);
});

// Method to check if user has used coupon
couponSchema.methods.hasUserUsed = function(userId) {
  if (!userId) return false;
  return this.usedBy.some(usage => usage.userId.toString() === userId.toString());
};

// Method to apply coupon usage
couponSchema.methods.recordUsage = function(userId) {
  this.usedCount += 1;
  if (userId) {
    this.usedBy.push({ userId });
  }
  return this.save();
};

const Coupon = mongoose.model('Coupon', couponSchema);

module.exports = Coupon;