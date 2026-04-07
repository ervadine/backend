const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Category name is required'],
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    maxlength: 500
  },
  sex: {
    type: String,
    enum: ['men', 'women', 'unisex', 'kids', 'baby'],
    default: 'unisex',
    index: true
  },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null
  },
  image: {
    public_id: {
      type: String,
      default: null
    },
    url: {
      type: String,
      default: null
    },
    alt: {
      type: String,
      default: ''
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  sortOrder: {
    type: Number,
    default: 0
  },
  seo: {
    title: String,
    description: String,
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      sparse: true
    }
  },
  customFields: [{
    name: String,
    type: {
      type: String,
      enum: ['string', 'number', 'boolean', 'array']
    },
    required: Boolean,
    options: [String]
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index for hierarchical queries and sex filtering
categorySchema.index({ parent: 1 });
categorySchema.index({ isActive: 1, sortOrder: 1 });
categorySchema.index({ sex: 1, isActive: 1 });
categorySchema.index({ 'seo.slug': 1 });

// Virtual for child categories
categorySchema.virtual('children', {
  ref: 'Category',
  localField: '_id',
  foreignField: 'parent'
});

// Virtual for getting full category path
categorySchema.virtual('path').get(function() {
  return this.parent ? `${this.parent.path} > ${this.name}` : this.name;
});

// Pre-remove middleware to delete image from Cloudinary when category is deleted
categorySchema.pre('remove', async function(next) {
  try {
    if (this.image && this.image.public_id) {
      const { deleteImage } = require('../utils/cloudinary');
      await deleteImage(this.image.public_id);
    }
    next();
  } catch (error) {
    next(error);
  }
});

// Pre-save middleware to generate slug ONLY on creation
categorySchema.pre('save', function(next) {
  // Only generate slug if it's a new document and slug doesn't exist
  if (this.isNew && (!this.seo?.slug)) {
    this.seo = this.seo || {};
    this.seo.slug = this.generateSlug(this.name);
  }
  next();
});

// Instance method to generate slug from name
categorySchema.methods.generateSlug = function(name) {
  return name
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

// Instance method to update slug manually
categorySchema.methods.updateSlug = function(newSlug = null) {
  this.seo = this.seo || {};
  if (newSlug) {
    this.seo.slug = newSlug
      .toLowerCase()
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  } else {
    this.seo.slug = this.generateSlug(this.name);
  }
  return this.save();
};

// Static method to find categories by sex
categorySchema.statics.findBySex = function(sex) {
  return this.find({ sex, isActive: true }).sort({ sortOrder: 1, name: 1 });
};

// Static method to find active categories
categorySchema.statics.findActive = function() {
  return this.find({ isActive: true }).sort({ sortOrder: 1, name: 1 });
};

// Instance method to update image
categorySchema.methods.updateImage = async function(imageData) {
  const { deleteImage, uploadSingleImage } = require('../utils/cloudinary');
  
  // Delete old image if exists
  if (this.image && this.image.public_id) {
    await deleteImage(this.image.public_id);
  }
  
  // Upload new image
  if (imageData.path) {
    const uploadResult = await uploadSingleImage(
      imageData.path, 
      'dar_collection/categories',
      { 
        transformation: [
          { width: 800, height: 600, crop: 'limit' },
          { quality: 'auto' },
          { format: 'webp' }
        ]
      }
    );
    
    if (uploadResult.success) {
      this.image = {
        public_id: uploadResult.data.public_id,
        url: uploadResult.data.url,
        alt: imageData.alt || this.name
      };
      return await this.save();
    } else {
      throw new Error(`Image upload failed: ${uploadResult.error}`);
    }
  }
};

// Instance method to delete image
categorySchema.methods.deleteImage = async function() {
  const { deleteImage } = require('../utils/cloudinary');
  
  if (this.image && this.image.public_id) {
    const deleteResult = await deleteImage(this.image.public_id);
    if (deleteResult.success) {
      this.image = {
        public_id: null,
        url: null,
        alt: ''
      };
      return await this.save();
    } else {
      throw new Error(`Image deletion failed: ${deleteResult.error}`);
    }
  }
  return this;
};

const Category = mongoose.model('Category', categorySchema);
module.exports = Category;