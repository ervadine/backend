// backend/models/Brand.js
const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');
const slugify = require('slugify');

const brandSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Brand name is required'],
    unique: true,
    trim: true,
    maxlength: [100, 'Brand name cannot exceed 100 characters'],
    minlength: [2, 'Brand name must be at least 2 characters long']
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    index: true
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot exceed 500 characters'],
    trim: true
  },
  logo: {
    public_id: {
      type: String,
      default: ''
    },
    url: {
      type: String,
      default: ''
    },
    alt: {
      type: String,
      default: ''
    },
    width: {
      type: Number
    },
    height: {
      type: Number
    },
    format: {
      type: String
    },
    bytes: {
      type: Number
    }
  },
  website: {
    type: String,
    validate: {
      validator: function(v) {
        if (!v) return true; // Optional field
        return /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/.test(v);
      },
      message: 'Please provide a valid website URL'
    }
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'pending'],
    default: 'active'
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  metaTitle: {
    type: String,
    maxlength: [60, 'Meta title cannot exceed 60 characters']
  },
  metaDescription: {
    type: String,
    maxlength: [160, 'Meta description cannot exceed 160 characters']
  },
  seoKeywords: [{
    type: String,
    trim: true
  }],
  socialMedia: {
    facebook: {
      type: String,
      validate: {
        validator: function(v) {
          if (!v) return true;
          return /^(https?:\/\/)?(www\.)?facebook\.com\/.+$/.test(v);
        },
        message: 'Please provide a valid Facebook URL'
      }
    },
    twitter: {
      type: String,
      validate: {
        validator: function(v) {
          if (!v) return true;
          return /^(https?:\/\/)?(www\.)?twitter\.com\/.+$/.test(v);
        },
        message: 'Please provide a valid Twitter URL'
      }
    },
    instagram: {
      type: String,
      validate: {
        validator: function(v) {
          if (!v) return true;
          return /^(https?:\/\/)?(www\.)?instagram\.com\/.+$/.test(v);
        },
        message: 'Please provide a valid Instagram URL'
      }
    },
    linkedin: {
      type: String,
      validate: {
        validator: function(v) {
          if (!v) return true;
          return /^(https?:\/\/)?(www\.)?linkedin\.com\/.+$/.test(v);
        },
        message: 'Please provide a valid LinkedIn URL'
      }
    },
    youtube: {
      type: String,
      validate: {
        validator: function(v) {
          if (!v) return true;
          return /^(https?:\/\/)?(www\.)?youtube\.com\/.+$/.test(v);
        },
        message: 'Please provide a valid YouTube URL'
      }
    }
  },
  contactEmail: {
    type: String,
    validate: {
      validator: function(v) {
        if (!v) return true;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: 'Please provide a valid email address'
    }
  },
  sortOrder: {
    type: Number,
    default: 0
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      // Transform logo object for frontend
      if (ret.logo && !ret.logo.url) {
        ret.logo = undefined;
      }
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Virtual for product count
brandSchema.virtual('productCount', {
  ref: 'Product',
  localField: '_id',
  foreignField: 'brand',
  count: true
});

// Virtual for formatted logo URL (with transformations)
brandSchema.virtual('logoUrl').get(function() {
  if (!this.logo || !this.logo.public_id) return null;
  
  // Return optimized version for web
  return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME || 'duaodpu01'}/image/upload/c_scale,w_300,h_300,f_webp,q_auto/${this.logo.public_id}`;
});

// Virtual for thumbnail URL
brandSchema.virtual('logoThumbnail').get(function() {
  if (!this.logo || !this.logo.public_id) return null;
  
  return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME || 'duaodpu01'}/image/upload/c_thumb,w_100,h_100,f_webp,q_auto/${this.logo.public_id}`;
});

// Indexes for better performance
brandSchema.index({ name: 1 });
brandSchema.index({ slug: 1 });
brandSchema.index({ status: 1 });
brandSchema.index({ isFeatured: 1 });
brandSchema.index({ sortOrder: 1 });
brandSchema.index({ 'logo.url': 1 });
brandSchema.index({ createdAt: -1 });

// Pre-save middleware to generate slug
brandSchema.pre('save', function(next) {
  if (this.isModified('name')) {
    this.slug = slugify(this.name, {
      lower: true,
      strict: true,
      remove: /[*+~.()'"!:@]/g
    });
  }
  next();
});

// Static method to find active brands
brandSchema.statics.findActive = function() {
  return this.find({ status: 'active' }).sort({ sortOrder: 1, name: 1 });
};

// Static method to find featured brands
brandSchema.statics.findFeatured = function() {
  return this.find({ status: 'active', isFeatured: true }).sort({ sortOrder: 1, name: 1 });
};

// Static method to find brands with logos
brandSchema.statics.findWithLogos = function() {
  return this.find({ 
    'logo.public_id': { $exists: true, $ne: '' } 
  });
};

// Static method to search brands
brandSchema.statics.search = function(query) {
  return this.find({
    status: 'active',
    $or: [
      { name: { $regex: query, $options: 'i' } },
      { description: { $regex: query, $options: 'i' } },
      { 'seoKeywords': { $in: [new RegExp(query, 'i')] } }
    ]
  });
};

// Instance method to get brand details with product count
brandSchema.methods.getDetailsWithProductCount = async function() {
  await this.populate('productCount');
  return this;
};

// Instance method to check if brand has logo
brandSchema.methods.hasLogo = function() {
  return !!(this.logo && this.logo.public_id && this.logo.url);
};

// Instance method to get optimized logo URL
brandSchema.methods.getOptimizedLogo = function(width = 300, height = 300) {
  if (!this.hasLogo()) return null;
  
  return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME || 'duaodpu01'}/image/upload/c_scale,w_${width},h_${height},f_webp,q_auto/${this.logo.public_id}`;
};

// Middleware to update updatedBy field
brandSchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew) {
    this.updatedAt = Date.now();
  }
  next();
});

// Add pagination plugin
brandSchema.plugin(mongoosePaginate);

const Brand = mongoose.model('Brand', brandSchema);

module.exports = Brand;