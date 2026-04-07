const mongoose = require('mongoose');
const {SubcategoryEnum} =require('../helpers/SubcategoryHelper')
// Define subcategory enums for different product categories


// Helper function to get all subcategory values as an array
const getAllSubcategories = () => {
  const subcategories = [];
  
  for (const category in SubcategoryEnum) {
    if (typeof SubcategoryEnum[category] === 'object') {
      for (const subcategory in SubcategoryEnum[category]) {
        subcategories.push(SubcategoryEnum[category][subcategory]);
      }
    }
  }
  
  return subcategories;
};

// Helper function to get subcategories by main category
const getSubcategoriesByCategory = (categoryType) => {
  if (SubcategoryEnum[categoryType]) {
    return Object.values(SubcategoryEnum[categoryType]);
  }
  return [];
};

const sizeSchema = new mongoose.Schema({
  value: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['numeric', 'alphabetic', 'alphanumeric', 'composite'],
    required: true
  },
  displayText: {
    type: String,
    required: true
  },
  dimensions: {
    waist: String,
    length: String,
    chest: String,
    sleeve: String,
  }
});

const colorImageSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true
  },
  public_id: {
    type: String,
    required: true
  },
  alt: {
    type: String,
    default: ''
  },
  isPrimary: {
    type: Boolean,
    default: false
  },
  displayOrder: {
    type: Number,
    default: 0
  }
});

const colorQuantitySchema = new mongoose.Schema({
  size: {
    value: {
      type: String,
      required: true
    }
  },
  displayText: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  comparePrice: {
    type: Number,
    min: 0
  },
  sku: {
    type: String,
    set: function(sku) {
      // Return undefined for empty values instead of null
      return sku && sku.trim() !== '' ? sku.trim() : undefined;
    },
    default: undefined
  },
  barcode: {
    type: String,
    set: function(barcode) {
      // Return undefined for empty values instead of null
      return barcode && barcode.trim() !== '' ? barcode.trim() : undefined;
    },
    default: undefined
  },
  lowStockThreshold: {
    type: Number,
    default: 5
  },
  isLowStock: {
    type: Boolean,
    default: false
  },
  inStock: {
    type: Boolean,
    default: false
  }
});

const colorSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  value: {
    type: String,
    required: true,
    trim: true,
    maxlength: 20
  },
  hexCode: {
    type: String,
    trim: true,
    match: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  comparePrice: {
    type: Number,
    min: 0
  },
  displayOrder: {
    type: Number,
    default: 0
  },
  images: [colorImageSchema],
  quantityConfig: {
    trackQuantity: {
      type: Boolean,
      default: true
    },
    allowBackorder: {
      type: Boolean,
      default: false
    },
    lowStockThreshold: {
      type: Number,
      default: 5
    },
    quantities: [colorQuantitySchema],
    totalQuantity: {
      type: Number,
      default: 0,
      min: 0
    },
    availableQuantity: {
      type: Number,
      default: 0,
      min: 0
    },
    inStock: {
      type: Boolean,
      default: false
    },
    isLowStock: {
      type: Boolean,
      default: false
    }
  }
});

const variantSchema = new mongoose.Schema({
  size: {
    value: {
      type: String,
      required: false
    },
    displayText: String
  },
  color: {
    name: {
      type: String,
      required: false
    },
    value: {
      type: String,
      required: false
    },
    hexCode: String
  },
  material: String,
  price: {
    type: Number,
    min: 0
  },
  comparePrice: {
    type: Number,
    min: 0
  },
  quantity: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  sku: {
    type: String,
    set: function(sku) {
      // Return undefined for empty values instead of null
      return sku && sku.trim() !== '' ? sku.trim() : undefined;
    },
    default: undefined
  },
  barcode: {
    type: String,
    set: function(barcode) {
      // Return undefined for empty values instead of null
      return barcode && barcode.trim() !== '' ? barcode.trim() : undefined;
    },
    default: undefined
  },
  weight: {
    type: Number,
    min: 0
  },
  dimensions: {
    length: Number,
    width: Number,
    height: Number
  }
});

const specificationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  value: {
    type: String,
    required: true
  },
  displayOrder: {
    type: Number,
    default: 0
  }
});

const seoSchema = new mongoose.Schema({
  title: String,
  description: String,
  slug: {
    type: String,
    unique: true,
    lowercase: true
  }
});

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: [true, 'Product description is required'],
    maxlength: 2000
  },
  shortDescription: {
    type: String,
    maxlength: 500
  },
  sizeConfig: {
    hasSizes: {
      type: Boolean,
      default: false
    },
    type: {
      type: String,
      enum: ['clothing', 'shoes', 'pants', 'universal', 'none'],
      default: 'none'
    },
    availableSizes: [sizeSchema],
    dimensionalConfig: {
      hasDimensions: {
        type: Boolean,
        default: false
      },
      dimensionTypes: [{
        type: String,
        enum: ['waist', 'length', 'chest', 'sleeve', 'hip', 'inseam']
      }]
    }
  },
  colors: {
    hasColors: {
      type: Boolean,
      default: false
    },
    availableColors: [colorSchema]
  },
  sku: {
    type: String,
    unique: true,
    sparse: true,
    set: function(sku) {
      return sku && sku.trim() !== '' ? sku.trim() : undefined;
    },
    default: undefined
  },
  barcode: {
    type: String,
    unique: true,
    sparse: true,
    set: function(barcode) {
      return barcode && barcode.trim() !== '' ? barcode.trim() : undefined;
    },
    default: undefined
  },
  
  // ADDED: Subcategory field
  subcategory: {
    type: String,
    enum: getAllSubcategories(),
    required: false,
    trim: true,
    index: true // Added index for faster queries
  },
  
  lowStockThreshold: {
    type: Number,
    default: 5
  },
  trackQuantity: {
    type: Boolean,
    default: true
  },
  allowBackorder: {
    type: Boolean,
    default: false
  },
  weight: {
    type: Number,
    min: 0
  },
  dimensions: {
    length: Number,
    width: Number,
    height: Number
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true
  },
  brand: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Brand'
  },
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier'
  },
  tags: [String],
  specifications: [specificationSchema],
  ratings: {
    average: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    count: {
      type: Number,
      default: 0
    },
    distribution: {
      1: { type: Number, default: 0 },
      2: { type: Number, default: 0 },
      3: { type: Number, default: 0 },
      4: { type: Number, default: 0 },
      5: { type: Number, default: 0 }
    }
  },
  reviews: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Review'
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  isNew: {
    type: Boolean,
    default: false
  },
  isBestSeller: {
    type: Boolean,
    default: false
  },
  salesCount: {
    type: Number,
    default: 0
  },
  viewCount: {
    type: Number,
    default: 0
  },
  wishlistCount: {
    type: Number,
    default: 0
  },
  seo: seoSchema,
  defaultSize: {
    value: String,
    displayText: String
  },
  defaultColor: {
    name: String,
    value: String,
    hexCode: String
  },
  variants: [variantSchema],
  material: String,
  careInstructions: [String],
  shipping: {
    isFree: {
      type: Boolean,
      default: false
    },
    weightBasedShipping: {
      type: Boolean,
      default: false
    },
    fixedCost: {
      type: Number,
      min: 0
    }
  },
  tax: {
    taxable: {
      type: Boolean,
      default: true
    },
    taxCode: String
  },
  meta: {
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
productSchema.index({ name: 'text', description: 'text', tags: 'text' });
productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ category: 1, subcategory: 1, isActive: 1 }); // Added combined index
productSchema.index({ brand: 1, isActive: 1 });
productSchema.index({ 'colors.availableColors.price': 1 });
productSchema.index({ 'ratings.average': -1 });
productSchema.index({ salesCount: -1 });
productSchema.index({ isActive: 1 });
productSchema.index({ 'colors.availableColors.value': 1 });
productSchema.index({ 'seo.slug': 1 }, { unique: true, sparse: true });
productSchema.index({ createdAt: -1 });
productSchema.index({ isFeatured: 1, isActive: 1 });
productSchema.index({ 'colors.availableColors.comparePrice': 1 });

// FIXED: Updated indexes for variants.sku and variants.barcode
// Using proper partialFilterExpression to exclude undefined/null values
productSchema.index({ 'variants.sku': 1 }, { 
  unique: true, 
  sparse: true,
  name: 'variants.sku_1',
  partialFilterExpression: { 
    $and: [
      { 'variants.sku': { $exists: true } },
      { 'variants.sku': { $ne: null } },
      { 'variants.sku': { $type: 'string' } },
      { 'variants.sku': { $ne: '' } }
    ]
  }
});

productSchema.index({ 'variants.barcode': 1 }, { 
  unique: true, 
  sparse: true,
  name: 'variants.barcode_1',
  partialFilterExpression: { 
    $and: [
      { 'variants.barcode': { $exists: true } },
      { 'variants.barcode': { $ne: null } },
      { 'variants.barcode': { $type: 'string' } },
      { 'variants.barcode': { $ne: '' } }
    ]
  }
});

// Virtual Fields
productSchema.virtual('inStock').get(function() {
  if (this.variants && this.variants.length > 0) {
    return this.variants.some(variant => variant.quantity > 0);
  }
  return this.quantity > 0;
});

productSchema.virtual('discountPercentage').get(function() {
  if (this.colors.hasColors && this.colors.availableColors.length > 0) {
    const firstColor = this.colors.availableColors[0];
    if (firstColor.comparePrice && firstColor.comparePrice > firstColor.price) {
      return Math.round(((firstColor.comparePrice - firstColor.price) / firstColor.comparePrice) * 100);
    }
  }
  return 0;
});

productSchema.virtual('isLowStock').get(function() {
  if (this.variants && this.variants.length > 0) {
    const totalQuantity = this.variants.reduce((sum, variant) => sum + variant.quantity, 0);
    return totalQuantity > 0 && totalQuantity <= this.lowStockThreshold;
  }
  return this.quantity > 0 && this.quantity <= this.lowStockThreshold;
});

productSchema.virtual('totalQuantity').get(function() {
  if (this.variants && this.variants.length > 0) {
    return this.variants.reduce((sum, variant) => sum + variant.quantity, 0);
  }
  return this.quantity;
});

productSchema.virtual('colorsWithPrice').get(function() {
  if (!this.colors.hasColors) {
    return [];
  }
  
  return this.colors.availableColors.map(color => {
    const effectivePrice = color.price;
    const effectiveComparePrice = color.comparePrice;
    
    return {
      name: color.name,
      value: color.value,
      hexCode: color.hexCode,
      displayOrder: color.displayOrder,
      images: color.images || [],
      price: effectivePrice,
      comparePrice: effectiveComparePrice,
      discountPercentage: effectiveComparePrice && effectiveComparePrice > effectivePrice ? 
        Math.round(((effectiveComparePrice - effectivePrice) / effectiveComparePrice) * 100) : 0,
      quantityConfig: color.quantityConfig || {},
      inStock: color.quantityConfig?.inStock || false,
      isLowStock: color.quantityConfig?.isLowStock || false,
      totalQuantity: color.quantityConfig?.totalQuantity || 0,
      availableQuantity: color.quantityConfig?.availableQuantity || 0
    };
  }).sort((a, b) => a.displayOrder - b.displayOrder);
});

productSchema.virtual('priceRange').get(function() {
  if (!this.colors.hasColors || this.colors.availableColors.length === 0) {
    return { min: null, max: null };
  }
  
  const prices = this.colors.availableColors.map(color => color.price);
  return {
    min: Math.min(...prices),
    max: Math.max(...prices)
  };
});

productSchema.virtual('displayPrice').get(function() {
  if (!this.colors.hasColors || this.colors.availableColors.length === 0) {
    return 'No price available';
  }
  
  const priceRange = this.priceRange;
  if (priceRange.min === priceRange.max) {
    return `$${priceRange.min.toFixed(2)}`;
  }
  return `$${priceRange.min.toFixed(2)} - $${priceRange.max.toFixed(2)}`;
});

// Method to update color quantities
productSchema.methods.updateColorQuantities = function() {
  if (!this.colors.hasColors || !this.variants) {
    return;
  }
  
  let totalProductQuantity = 0; // Track total product quantity
  
  // Initialize quantityConfig for each color if it doesn't exist
  this.colors.availableColors.forEach(color => {
    if (!color.quantityConfig) {
      color.quantityConfig = {
        trackQuantity: true,
        allowBackorder: false,
        lowStockThreshold: 5,
        quantities: [],
        totalQuantity: 0,
        availableQuantity: 0,
        inStock: false,
        isLowStock: false
      };
    }
    
    // Reset quantities
    color.quantityConfig.totalQuantity = 0;
    color.quantityConfig.availableQuantity = 0;
    color.quantityConfig.inStock = false;
    color.quantityConfig.quantities = [];
  });
  
  // Create a map for easy color lookup
  const colorMap = new Map();
  this.colors.availableColors.forEach(color => {
    colorMap.set(color.value, color);
  });
  
  // Aggregate quantities from variants
  this.variants.forEach(variant => {
    if (variant.color && variant.color.value && colorMap.has(variant.color.value)) {
      const color = colorMap.get(variant.color.value);
      const variantQuantity = variant.quantity || 0;
      
      // Update total quantities
      color.quantityConfig.totalQuantity += variantQuantity;
      if (variantQuantity > 0) {
        color.quantityConfig.availableQuantity += variantQuantity;
        color.quantityConfig.inStock = true;
      }
      
      // Update quantity by size
      if (variant.size && variant.size.value) {
        const existingQuantity = color.quantityConfig.quantities.find(q => 
          q.size && q.size.value === variant.size.value
        );
        
        if (existingQuantity) {
          existingQuantity.quantity += variantQuantity;
          existingQuantity.inStock = existingQuantity.quantity > 0;
          existingQuantity.isLowStock = existingQuantity.inStock && 
            existingQuantity.quantity <= (existingQuantity.lowStockThreshold || 5);
        } else {
          color.quantityConfig.quantities.push({
            size: { 
              value: variant.size.value,
              displayText: variant.size.displayText || variant.size.value 
            },
            displayText: variant.size.displayText || variant.size.value,
            quantity: variantQuantity,
            price: variant.price || color.price || 0,
            comparePrice: variant.comparePrice || color.comparePrice,
            sku: variant.sku || "",
            barcode: variant.barcode || "",
            lowStockThreshold: color.quantityConfig.lowStockThreshold || 5,
            inStock: variantQuantity > 0,
            isLowStock: variantQuantity > 0 && variantQuantity <= (color.quantityConfig.lowStockThreshold || 5)
          });
        }
      }
    }
  });
  
  // Update isLowStock for each color and calculate total product quantity
  this.colors.availableColors.forEach(color => {
    if (color.quantityConfig) {
      color.quantityConfig.isLowStock = color.quantityConfig.inStock && 
        color.quantityConfig.availableQuantity <= (color.quantityConfig.lowStockThreshold || 5);
      
      // Add to total product quantity
      totalProductQuantity += color.quantityConfig.totalQuantity;
    }
  });
  
  // IMPORTANT: Update the main product quantity and stock status
  this.quantity = totalProductQuantity;
  this.inStock = totalProductQuantity > 0;
  this.isLowStock = totalProductQuantity > 0 && 
    totalProductQuantity <= (this.lowStockThreshold || 5);
  
  console.log("=== updateColorQuantities() DEBUG ===");
  console.log("Total product quantity:", totalProductQuantity);
  console.log("Product inStock:", this.inStock);
  console.log("Product isLowStock:", this.isLowStock);
  console.log("================================");
};

// Enhanced Pre-save middleware to ensure variant uniqueness
productSchema.pre('save', function(next) {
  // Handle empty strings for unique fields - set to undefined
  if (this.sku === '' || this.sku === null) this.sku = undefined;
  if (this.barcode === '' || this.barcode === null) this.barcode = undefined;
  
  // Update hasColors and hasSizes flags
  this.colors.hasColors = this.colors.availableColors && this.colors.availableColors.length > 0;
  this.sizeConfig.hasSizes = this.sizeConfig.availableSizes && this.sizeConfig.availableSizes.length > 0;
  
  // Ensure each color has proper configuration
  if (this.colors.hasColors) {
    this.colors.availableColors.forEach((color, index) => {
      // Ensure price is set
      if (color.price === undefined || color.price === null) {
        throw new Error(`Price is required for color: ${color.name || `color ${index + 1}`}`);
      }
      
      // Ensure quantityConfig exists
      if (!color.quantityConfig) {
        color.quantityConfig = {
          trackQuantity: true,
          allowBackorder: false,
          lowStockThreshold: 5,
          quantities: [],
          totalQuantity: 0,
          availableQuantity: 0,
          inStock: false,
          isLowStock: false
        };
      }
      
      // Set default comparePrice if not provided
      if (color.comparePrice === undefined || color.comparePrice === null) {
        color.comparePrice = undefined;
      }
      
      // Handle images
      if (color.images && color.images.length > 0) {
        // Ensure at least one primary image
        const hasPrimary = color.images.some(img => img.isPrimary);
        if (!hasPrimary && color.images.length > 0) {
          color.images[0].isPrimary = true;
        }
        
        // Sort images by displayOrder
        color.images.sort((a, b) => a.displayOrder - b.displayOrder);
      }
    });
    
    // Sort colors by displayOrder
    this.colors.availableColors.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  }
  
  // CRITICAL FIX: Ensure variant SKUs and barcodes are unique and not null/empty
  if (this.variants && this.variants.length > 0) {
    const usedSkus = new Set();
    const usedBarcodes = new Set();
    
    this.variants.forEach((variant, index) => {
      // Handle empty/null strings by setting to undefined
      if (variant.sku === '' || variant.sku === null) {
        variant.sku = undefined;
      }
      
      if (variant.barcode === '' || variant.barcode === null) {
        variant.barcode = undefined;
      }
      
      // Generate unique SKU if not provided
      if (!variant.sku) {
        const baseSku = this.sku || 'PROD';
        const colorPart = variant.color?.value ? variant.color.value.substring(0, 3).toUpperCase() : 'COL';
        const sizePart = variant.size?.value ? variant.size.value.substring(0, 3).toUpperCase() : 'SIZ';
        
        let proposedSku = `${baseSku}-${colorPart}-${sizePart}`;
        let counter = 1;
        let uniqueSku = proposedSku;
        
        // Ensure uniqueness within this product
        while (usedSkus.has(uniqueSku)) {
          uniqueSku = `${proposedSku}-${counter}`;
          counter++;
        }
        
        variant.sku = uniqueSku;
        usedSkus.add(uniqueSku);
      } else {
        // Ensure provided SKU is unique within this product
        const cleanSku = variant.sku.trim();
        let uniqueSku = cleanSku;
        let counter = 1;
        
        while (usedSkus.has(uniqueSku)) {
          uniqueSku = `${cleanSku}-${counter}`;
          counter++;
        }
        
        if (uniqueSku !== cleanSku) {
          variant.sku = uniqueSku;
        }
        
        usedSkus.add(uniqueSku);
      }
      
      // Generate unique barcode if not provided
      if (!variant.barcode) {
        const timestamp = Date.now().toString().slice(-6);
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        
        let proposedBarcode = `BC${timestamp}${random}`;
        let counter = 1;
        let uniqueBarcode = proposedBarcode;
        
        // Ensure uniqueness within this product
        while (usedBarcodes.has(uniqueBarcode)) {
          const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
          uniqueBarcode = `BC${timestamp}${random}`;
          counter++;
        }
        
        variant.barcode = uniqueBarcode;
        usedBarcodes.add(uniqueBarcode);
      } else {
        // Ensure provided barcode is unique within this product
        const cleanBarcode = variant.barcode.trim();
        let uniqueBarcode = cleanBarcode;
        let counter = 1;
        
        while (usedBarcodes.has(uniqueBarcode)) {
          uniqueBarcode = `${cleanBarcode}-${counter}`;
          counter++;
        }
        
        if (uniqueBarcode !== cleanBarcode) {
          variant.barcode = uniqueBarcode;
        }
        
        usedBarcodes.add(uniqueBarcode);
      }
    });
  }
  
  // Update color quantities from variants
  if (this.colors.hasColors && this.variants && this.variants.length > 0) {
    this.updateColorQuantities();
  }
  
  // Update meta timestamps
  this.meta.updatedAt = new Date();
  
  next();
});

// Pre-findOneAndUpdate middleware
productSchema.pre('findOneAndUpdate', async function(next) {
  const update = this.getUpdate();
  
  // Helper function to handle empty/null strings
  const handleEmptyStrings = (obj) => {
    if (obj && typeof obj === 'object') {
      if (obj.sku === '' || obj.sku === null) obj.sku = undefined;
      if (obj.barcode === '' || obj.barcode === null) obj.barcode = undefined;
    }
  };
  
  handleEmptyStrings(update);
  
  if (update.$set) {
    handleEmptyStrings(update.$set);
    
    // Handle variant updates
    if (update.$set.variants && Array.isArray(update.$set.variants)) {
      const usedSkus = new Set();
      const usedBarcodes = new Set();
      
      update.$set.variants.forEach((variant, index) => {
        // Handle empty/null strings
        if (variant.sku === '' || variant.sku === null) {
          update.$set[`variants.${index}.sku`] = undefined;
        }
        
        if (variant.barcode === '' || variant.barcode === null) {
          update.$set[`variants.${index}.barcode`] = undefined;
        }
        
        // Generate unique values if needed
        // This will be handled in post-findOneAndUpdate
      });
    }
  }
  
  next();
});

// Post-findOneAndUpdate middleware to handle variant SKU/barcode generation
productSchema.post('findOneAndUpdate', async function(doc) {
  if (doc) {
    // Generate missing SKUs and barcodes
    if (doc.variants && doc.variants.length > 0) {
      const usedSkus = new Set();
      const usedBarcodes = new Set();
      let needsSave = false;
      
      doc.variants.forEach(variant => {
        // Track existing values
        if (variant.sku) usedSkus.add(variant.sku);
        if (variant.barcode) usedBarcodes.add(variant.barcode);
      });
      
      // Generate missing values
      doc.variants.forEach(variant => {
        if (!variant.sku) {
          const baseSku = doc.sku || 'PROD';
          const colorPart = variant.color?.value ? variant.color.value.substring(0, 3).toUpperCase() : 'COL';
          const sizePart = variant.size?.value ? variant.size.value.substring(0, 3).toUpperCase() : 'SIZ';
          
          let proposedSku = `${baseSku}-${colorPart}-${sizePart}`;
          let counter = 1;
          let uniqueSku = proposedSku;
          
          while (usedSkus.has(uniqueSku)) {
            uniqueSku = `${proposedSku}-${counter}`;
            counter++;
          }
          
          variant.sku = uniqueSku;
          usedSkus.add(uniqueSku);
          needsSave = true;
        }
        
        if (!variant.barcode) {
          const timestamp = Date.now().toString().slice(-6);
          const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
          
          let proposedBarcode = `BC${timestamp}${random}`;
          let counter = 1;
          let uniqueBarcode = proposedBarcode;
          
          while (usedBarcodes.has(uniqueBarcode)) {
            const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
            uniqueBarcode = `BC${timestamp}${random}`;
            counter++;
          }
          
          variant.barcode = uniqueBarcode;
          usedBarcodes.add(uniqueBarcode);
          needsSave = true;
        }
      });
      
      if (needsSave) {
        // Update color quantities
        if (doc.colors.hasColors) {
          doc.updateColorQuantities();
        }
        
        await doc.save();
      }
    }
  }
});

// Add other instance methods
productSchema.methods.getAvailableColors = function() {
  if (!this.colors.hasColors) {
    return [];
  }
  
  return this.colors.availableColors.map(color => ({
    name: color.name,
    value: color.value,
    hexCode: color.hexCode,
    price: color.price,
    comparePrice: color.comparePrice,
    inStock: color.quantityConfig?.inStock || false
  }));
};

productSchema.methods.getImagesByColor = function(colorValue) {
  if (!this.colors.hasColors) {
    return [];
  }
  
  const color = this.colors.availableColors.find(c => c.value === colorValue);
  return color ? color.images || [] : [];
};

productSchema.methods.getSizesByColor = function(colorValue) {
  if (!this.sizeConfig.hasSizes) {
    return [];
  }
  
  const sizes = new Map();
  
  this.variants.forEach(variant => {
    if (variant.color && variant.color.value === colorValue && variant.size) {
      sizes.set(variant.size.value, {
        value: variant.size.value,
        displayText: variant.size.displayText || variant.size.value,
        inStock: variant.quantity > 0,
        quantity: variant.quantity
      });
    }
  });
  
  return Array.from(sizes.values());
};

productSchema.methods.getVariant = function(colorValue, sizeValue) {
  return this.variants.find(variant => 
    variant.color && 
    variant.color.value === colorValue && 
    variant.size && 
    variant.size.value === sizeValue
  );
};

// Static Methods
productSchema.statics.findByColor = function(colorValue) {
  return this.find({
    'colors.hasColors': true,
    'colors.availableColors.value': colorValue,
    isActive: true
  });
};

productSchema.statics.findInStockByColor = function(colorValue) {
  return this.find({
    'colors.hasColors': true,
    'colors.availableColors.value': colorValue,
    $or: [
      { quantity: { $gt: 0 } },
      { 'variants.quantity': { $gt: 0 } }
    ],
    isActive: true
  });
};

productSchema.statics.findByPriceRange = function(minPrice, maxPrice) {
  return this.find({
    'colors.hasColors': true,
    isActive: true,
    'colors.availableColors.price': { $gte: minPrice, $lte: maxPrice }
  });
};

// ADDED: Static method to find products by subcategory
productSchema.statics.findBySubcategory = function(subcategory) {
  return this.find({
    subcategory: subcategory,
    isActive: true
  });
};

// ADDED: Static method to find products by category and subcategory
productSchema.statics.findByCategoryAndSubcategory = function(categoryId, subcategory) {
  return this.find({
    category: categoryId,
    subcategory: subcategory,
    isActive: true
  });
};

// ADDED: Static method to get all subcategories (can be used for dropdowns)
productSchema.statics.getAllSubcategories = function() {
  return getAllSubcategories();
};

// ADDED: Static method to get subcategories for a specific category type
productSchema.statics.getSubcategoriesForType = function(categoryType) {
  return getSubcategoriesByCategory(categoryType);
};

const Product = mongoose.model('Product', productSchema);

// Export the enum for use in other files
module.exports = Product;