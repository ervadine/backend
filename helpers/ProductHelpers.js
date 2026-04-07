const mongoose = require('mongoose');
const slugify = require('slugify');

class ProductHelpers {
  // Validate MongoDB ObjectId
  static isValidObjectId(id) {
    return mongoose.Types.ObjectId.isValid(id);
  }

  // Generate slug for product
  static generateSlug(name, existingSlugs = []) {
    let baseSlug = slugify(name, {
      lower: true,
      strict: true,
      remove: /[*+~.()'"!:@]/g
    });
    
    let slug = baseSlug;
    let counter = 1;
    
    while (existingSlugs.includes(slug)) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    
    return slug;
  }

  // Validate product data
  static validateProductData(productData) {
    const errors = [];
    
    if (!productData.name || productData.name.trim().length === 0) {
      errors.push('Product name is required');
    }
    
    if (!productData.description || productData.description.trim().length === 0) {
      errors.push('Product description is required');
    }
    
    if (!productData.category) {
      errors.push('Category is required');
    }
    
    // Validate colors have prices
    if (productData.colors?.hasColors && productData.colors.availableColors) {
      productData.colors.availableColors.forEach((color, index) => {
        if (color.price === undefined || color.price === null) {
          errors.push(`Price is required for color: ${color.name}`);
        }
      });
    } else {
      errors.push('Product must have at least one color with price');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Build product filter for queries
  static buildProductFilter(filters = {}) {
    const filter = { isActive: true };
    
    Object.keys(filters).forEach(key => {
      const value = filters[key];
      
      if (value !== undefined && value !== null && value !== '') {
        switch (key) {
          case 'category':
            if (this.isValidObjectId(value)) {
              filter.category = value;
            }
            break;
            
          case 'brand':
            if (this.isValidObjectId(value)) {
              filter.brand = value;
            }
            break;
            
          case 'minPrice':
          case 'maxPrice':
            // These filters are now for color prices only
            if (!filter['colors.availableColors.price']) {
              filter['colors.availableColors.price'] = {};
            }
            if (key === 'minPrice') {
              filter['colors.availableColors.price'].$gte = parseFloat(value);
            } else {
              filter['colors.availableColors.price'].$lte = parseFloat(value);
            }
            break;
            
          case 'inStock':
            if (value === 'true') {
              filter.$or = [
                { quantity: { $gt: 0 } },
                { 'variants.quantity': { $gt: 0 } }
              ];
            }
            break;
            
          case 'featured':
            if (value === 'true') {
              filter.isFeatured = true;
            }
            break;
            
          case 'color':
            filter.$or = [
              { 'colors.availableColors.name': { $regex: value, $options: 'i' } },
              { 'colors.availableColors.value': { $regex: value, $options: 'i' } }
            ];
            break;
            
          case 'colors':
            const colorArray = Array.isArray(value) ? value : value.split(',');
            filter['colors.availableColors.value'] = { $in: colorArray };
            break;
            
          case 'hasColors':
            filter['colors.hasColors'] = value === 'true';
            break;
            
          case 'size':
            filter.$or = [
              { 'sizeConfig.availableSizes.value': value },
              { 'sizeConfig.availableSizes.displayText': { $regex: value, $options: 'i' } },
              { 'variants.size.value': value }
            ];
            break;
            
          case 'sizes':
            const sizeArray = Array.isArray(value) ? value : value.split(',');
            filter.$or = [
              { 'sizeConfig.availableSizes.value': { $in: sizeArray } },
              { 'variants.size.value': { $in: sizeArray } }
            ];
            break;
            
          case 'hasSizes':
            filter['sizeConfig.hasSizes'] = value === 'true';
            break;
            
          case 'search':
            const searchRegex = { $regex: value, $options: 'i' };
            filter.$or = [
              { name: searchRegex },
              { description: searchRegex },
              { shortDescription: searchRegex },
              { tags: { $in: [new RegExp(value, 'i')] } }
            ];
            break;
            
          case 'sex':
            if (value === 'unisex') {
              filter.sex = 'unisex';
            } else {
              filter.$or = [
                { sex: value },
                { sex: 'unisex' }
              ];
            }
            break;
            
          case 'material':
            filter.material = { $regex: value, $options: 'i' };
            break;
            
          case 'tags':
            const tagArray = Array.isArray(value) ? value : value.split(',');
            filter.tags = { $in: tagArray };
            break;
            
          case 'minRating':
            const minRating = parseFloat(value);
            if (!isNaN(minRating) && minRating >= 0 && minRating <= 5) {
              filter['ratings.average'] = { $gte: minRating };
            }
            break;
            
          case 'maxRating':
            const maxRating = parseFloat(value);
            if (!isNaN(maxRating) && maxRating >= 0 && maxRating <= 5) {
              if (!filter['ratings.average']) {
                filter['ratings.average'] = {};
              }
              filter['ratings.average'].$lte = maxRating;
            }
            break;
            
          default:
            // Ignore unknown filters
            break;
        }
      }
    });
    
    return filter;
  }

// In ProductHelpers.js - buildSortOptions method
static buildSortOptions(sortBy = 'createdAt', sortOrder = 'desc') {
  const sortOptions = {};
  
  // Handle special sorting cases
  switch (sortBy) {
    case 'price-low-high':
      // Price: Low to High
      sortOptions['colors.availableColors.price'] = 1; // Ascending
      break;
      
    case 'price-high-low':
      // Price: High to Low
      sortOptions['colors.availableColors.price'] = -1; // Descending
      break;
      
    case 'featured':
      sortOptions = { isFeatured: -1, createdAt: -1 };
      break;
      
    case 'rating':
      sortOptions['ratings.average'] = -1;
      break;
      
    case 'newest':
      sortOptions.createdAt = -1;
      break;
      
    case 'createdAt':
    case 'updatedAt':
    case 'name':
    case 'sales':
    case 'views':
      // Map common sort fields
      const sortFieldMap = {
        'createdAt': 'createdAt',
        'updatedAt': 'updatedAt',
        'name': 'name',
        'sales': 'salesCount',
        'views': 'viewCount'
      };
      
      const field = sortFieldMap[sortBy] || sortBy;
      const order = sortOrder === 'asc' ? 1 : -1;
      sortOptions[field] = order;
      break;
      
    default:
      // For any other field, use the provided sortOrder
      const defaultOrder = sortOrder === 'asc' ? 1 : -1;
      sortOptions[sortBy] = defaultOrder;
      break;
  }
  
  return sortOptions;
}
  // Build pagination options
  static buildPaginationOptions(page = 1, limit = 12) {
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(parseInt(limit), 100));
    const skip = (pageNum - 1) * limitNum;
    
    return {
      page: pageNum,
      limit: limitNum,
      skip
    };
  }


  // In ProductHelpers.js
static generateProductFilters = (product) => {
  const filterOptions = {
    size: [],
    color: []
  };

  // Process sizes
  if (product.sizeConfig?.hasSizes && product.sizeConfig.availableSizes?.length > 0) {
    filterOptions.size = product.sizeConfig.availableSizes.map(size => ({
      value: size.value,
      displayText: size.displayText,
      type: size.type,
      inStock: product.variants?.some(variant => 
        variant.size?.value === size.value && variant.quantity > 0
      ) || false,
      variantCount: product.variants?.filter(variant => 
        variant.size?.value === size.value
      ).length || 0
    })).sort((a, b) => {
      // Sort sizes intelligently
      if (a.type === 'numeric' && b.type === 'numeric') {
        return parseFloat(a.value) - parseFloat(b.value);
      }
      return a.displayText.localeCompare(b.displayText);
    });
  }

  // Process colors
  if (product.colors?.hasColors && product.colors.availableColors?.length > 0) {
    filterOptions.color = product.colors.availableColors.map(color => ({
      name: color.name,
      value: color.value,
      hexCode: color.hexCode,
      price: color.price,
      comparePrice: color.comparePrice,
      discountPercentage: color.comparePrice && color.comparePrice > color.price 
        ? Math.round(((color.comparePrice - color.price) / color.comparePrice) * 100)
        : null,
      inStock: product.variants?.some(variant => 
        variant.color?.value === color.value && variant.quantity > 0
      ) || false,
      variantCount: product.variants?.filter(variant => 
        variant.color?.value === color.value
      ).length || 0,
      imageUrl: color.images?.length > 0 ? color.images[0].url : null,
      displayOrder: color.displayOrder || 0
    })).sort((a, b) => a.displayOrder - b.displayOrder);
  }

  return filterOptions;
};

  // Format paginated response
  static formatPaginatedResponse(data, pagination, additionalData = {}) {
    return {
      success: true,
      data,
      pagination,
      ...additionalData
    };
  }

  // Format success response
  static formatSuccessResponse(data, message = 'Success') {
    return {
      success: true,
      message,
      data
    };
  }

  // Format error response
  static formatErrorResponse(message, statusCode = 400, errors = []) {
    return {
      success: false,
      message,
      statusCode,
      errors
    };
  }

  // Enhance product with color data
  static enhanceProductWithColorData(product) {
    const productObj = product.toObject ? product.toObject() : product;
    
    // Get price range from colors
    let minPrice = null;
    let maxPrice = null;
    let hasDiscount = false;
    
    if (productObj.colors?.hasColors && productObj.colors.availableColors?.length > 0) {
      const prices = productObj.colors.availableColors
        .filter(color => color.price !== null && color.price !== undefined)
        .map(color => color.price);
      
      if (prices.length > 0) {
        minPrice = Math.min(...prices);
        maxPrice = Math.max(...prices);
      }
      
      // Check if any color has a discount
      hasDiscount = productObj.colors.availableColors.some(color => 
        color.comparePrice && color.comparePrice > color.price
      );
    }
    
    // Get display price
    let displayPrice = 'Price not available';
    if (minPrice !== null && maxPrice !== null) {
      if (minPrice === maxPrice) {
        displayPrice = `$${minPrice.toFixed(2)}`;
      } else {
        displayPrice = `$${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)}`;
      }
    }
    
    // Get primary image from any color
    let primaryImage = null;
    if (productObj.colors?.hasColors && productObj.colors.availableColors?.length > 0) {
      for (const color of productObj.colors.availableColors) {
        if (color.images && color.images.length > 0) {
          const primary = color.images.find(img => img.isPrimary) || color.images[0];
          if (primary) {
            primaryImage = {
              ...primary,
              color: color.value,
              colorName: color.name,
              colorPrice: color.price,
              colorComparePrice: color.comparePrice
            };
            break;
          }
        }
      }
    }
    
    // Calculate discount percentage (use first color with discount)
    let discountPercentage = 0;
    if (productObj.colors?.hasColors && productObj.colors.availableColors?.length > 0) {
      const colorWithDiscount = productObj.colors.availableColors.find(color => 
        color.comparePrice && color.comparePrice > color.price
      );
      if (colorWithDiscount) {
        discountPercentage = Math.round(
          ((colorWithDiscount.comparePrice - colorWithDiscount.price) / colorWithDiscount.comparePrice) * 100
        );
      }
    }
    
    return {
      ...productObj,
      priceRange: {
        min: minPrice,
        max: maxPrice,
        display: displayPrice
      },
      hasDiscount,
      discountPercentage,
      primaryImage,
      colorsWithPrices: productObj.colors?.availableColors?.map(color => ({
        name: color.name,
        value: color.value,
        hexCode: color.hexCode,
        price: color.price,
        comparePrice: color.comparePrice,
        discountPercentage: color.comparePrice && color.comparePrice > color.price ? 
          Math.round(((color.comparePrice - color.price) / color.comparePrice) * 100) : 0,
        images: color.images || []
      })) || []
    };
  }

  // Get color price summary for a product
  static getColorPriceSummary(product) {
    if (!product.colors?.hasColors || !product.colors.availableColors?.length) {
      return {
        hasColors: false,
        message: 'Product does not have colors'
      };
    }
    
    const colors = product.colors.availableColors;
    const prices = colors
      .filter(color => color.price !== null && color.price !== undefined)
      .map(color => color.price);
    
    const colorPriceDetails = colors.map(color => ({
      name: color.name,
      value: color.value,
      price: color.price,
      comparePrice: color.comparePrice,
      hasDiscount: color.comparePrice && color.comparePrice > color.price,
      discountPercentage: color.comparePrice && color.comparePrice > color.price ? 
        Math.round(((color.comparePrice - color.price) / color.comparePrice) * 100) : 0
    }));
    
    return {
      hasColors: true,
      colorCount: colors.length,
      priceRange: {
        min: prices.length > 0 ? Math.min(...prices) : null,
        max: prices.length > 0 ? Math.max(...prices) : null,
        display: prices.length > 0 ? 
          (Math.min(...prices) === Math.max(...prices) ? 
            `$${Math.min(...prices).toFixed(2)}` : 
            `$${Math.min(...prices).toFixed(2)} - $${Math.max(...prices).toFixed(2)}`) : 
          'Price not available'
      },
      averagePrice: prices.length > 0 ? 
        (prices.reduce((sum, price) => sum + price, 0) / prices.length).toFixed(2) : 
        null,
      colorsWithDiscount: colorPriceDetails.filter(color => color.hasDiscount).length,
      colorPriceDetails
    };
  }

  // Analyze product prices across multiple products
  static analyzeProductPrices(products) {
    if (!products || products.length === 0) {
      return {
        productCount: 0,
        message: 'No products to analyze'
      };
    }
    
    const allPrices = [];
    const productsWithDiscount = [];
    
    products.forEach(product => {
      if (product.priceRange?.min !== null && product.priceRange?.max !== null) {
        allPrices.push(product.priceRange.min, product.priceRange.max);
      }
      
      if (product.hasDiscount) {
        productsWithDiscount.push(product._id);
      }
    });
    
    return {
      productCount: products.length,
      minPriceOverall: allPrices.length > 0 ? Math.min(...allPrices) : null,
      maxPriceOverall: allPrices.length > 0 ? Math.max(...allPrices) : null,
      averagePrice: allPrices.length > 0 ? 
        (allPrices.reduce((sum, price) => sum + price, 0) / allPrices.length).toFixed(2) : 
        null,
      productsWithDiscountCount: productsWithDiscount.length,
      discountPercentage: productsWithDiscount.length > 0 ? 
        Math.round((productsWithDiscount.length / products.length) * 100) : 0
    };
  }

  // Analyze product discounts
  static analyzeProductDiscounts(products) {
    if (!products || products.length === 0) {
      return {
        productCount: 0,
        message: 'No products to analyze'
      };
    }
    
    const discountRanges = {
      '0-10%': 0,
      '10-20%': 0,
      '20-30%': 0,
      '30-40%': 0,
      '40-50%': 0,
      '50%+': 0
    };
    
    let totalDiscount = 0;
    let productsWithDiscount = 0;
    
    products.forEach(product => {
      if (product.discountPercentage > 0) {
        productsWithDiscount++;
        totalDiscount += product.discountPercentage;
        
        if (product.discountPercentage < 10) {
          discountRanges['0-10%']++;
        } else if (product.discountPercentage < 20) {
          discountRanges['10-20%']++;
        } else if (product.discountPercentage < 30) {
          discountRanges['20-30%']++;
        } else if (product.discountPercentage < 40) {
          discountRanges['30-40%']++;
        } else if (product.discountPercentage < 50) {
          discountRanges['40-50%']++;
        } else {
          discountRanges['50%+']++;
        }
      }
    });
    
    return {
      productCount: products.length,
      productsWithDiscount,
      averageDiscount: productsWithDiscount > 0 ? (totalDiscount / productsWithDiscount).toFixed(1) : 0,
      discountRanges,
      discountPercentage: productsWithDiscount > 0 ? 
        Math.round((productsWithDiscount / products.length) * 100) : 0
    };
  }

  // Calculate product stock status
  static calculateProductStockStatus(product) {
    let totalQuantity = product.quantity || 0;
    let inStock = totalQuantity > 0;
    let isLowStock = false;
    
    // Calculate from variants if they exist
    if (product.variants && product.variants.length > 0) {
      totalQuantity = product.variants.reduce((sum, variant) => sum + (variant.quantity || 0), 0);
      inStock = product.variants.some(variant => (variant.quantity || 0) > 0);
    }
    
    // Check if low stock
    if (inStock && product.lowStockThreshold) {
      isLowStock = totalQuantity <= product.lowStockThreshold;
    }
    
    return {
      totalQuantity,
      inStock,
      isLowStock,
      lowStockThreshold: product.lowStockThreshold || 5
    };
  }

  // Analyze low stock products
  static analyzeLowStockProducts(products) {
    if (!products || products.length === 0) {
      return {
        productCount: 0,
        message: 'No low stock products'
      };
    }
    
    const categoryCounts = {};
    let totalLowStockQuantity = 0;
    
    products.forEach(product => {
      const categoryName = product.category?.name || 'Uncategorized';
      categoryCounts[categoryName] = (categoryCounts[categoryName] || 0) + 1;
      
      const stockInfo = this.calculateProductStockStatus(product);
      totalLowStockQuantity += stockInfo.totalQuantity;
    });
    
    return {
      productCount: products.length,
      totalLowStockQuantity,
      byCategory: Object.keys(categoryCounts).map(category => ({
        category,
        count: categoryCounts[category]
      })),
      urgencyLevel: totalLowStockQuantity < 10 ? 'Critical' : 
                   totalLowStockQuantity < 50 ? 'High' : 
                   totalLowStockQuantity < 100 ? 'Medium' : 'Low'
    };
  }

  // Generate image alt text
  static generateImageAltText(product, color, imageType = 'color', index = 0) {
    const productName = product.name || 'Product';
    const colorName = color?.name || '';
    const imageTypeText = imageType === 'color' ? 'color' : 'product';
    
    if (colorName) {
      return `${productName} - ${colorName} - ${imageTypeText} image ${index + 1}`;
    }
    
    return `${productName} - ${imageTypeText} image ${index + 1}`;
  }

  // Extract color data for frontend display
  static extractColorDataForDisplay(product) {
    if (!product.colors?.hasColors || !product.colors.availableColors?.length) {
      return {
        hasColors: false,
        colors: []
      };
    }
    
    const colors = product.colors.availableColors.map(color => ({
      id: color._id || color.value,
      name: color.name,
      value: color.value,
      hexCode: color.hexCode,
      price: color.price,
      comparePrice: color.comparePrice,
      discountPercentage: color.comparePrice && color.comparePrice > color.price ? 
        Math.round(((color.comparePrice - color.price) / color.comparePrice) * 100) : 0,
      images: color.images?.map(img => ({
        url: img.url,
        alt: img.alt || `${product.name} - ${color.name} image`,
        isPrimary: img.isPrimary || false
      })) || [],
      inStock: color.quantityConfig?.inStock || false,
      availableQuantity: color.quantityConfig?.availableQuantity || 0
    }));
    
    // Find colors with the lowest price for "starting at" price display
    const prices = colors
      .filter(color => color.price !== null && color.price !== undefined)
      .map(color => color.price);
    
    const lowestPrice = prices.length > 0 ? Math.min(...prices) : null;
    
    return {
      hasColors: true,
      colors,
      priceInfo: {
        startingAt: lowestPrice,
        hasPriceVariation: prices.length > 1 && Math.min(...prices) !== Math.max(...prices),
        priceRange: prices.length > 0 ? {
          min: Math.min(...prices),
          max: Math.max(...prices)
        } : null
      }
    };
  }

  // Validate color price data
  static validateColorPrices(colors) {
    const errors = [];
    
    if (!colors || !Array.isArray(colors)) {
      errors.push('Colors array is required');
      return { isValid: false, errors };
    }
    
    colors.forEach((color, index) => {
      if (!color.name || color.name.trim().length === 0) {
        errors.push(`Color ${index + 1}: Name is required`);
      }
      
      if (!color.value || color.value.trim().length === 0) {
        errors.push(`Color ${color.name || `#${index + 1}`}: Value is required`);
      }
      
      if (color.price === undefined || color.price === null) {
        errors.push(`Color ${color.name || color.value}: Price is required`);
      } else if (typeof color.price !== 'number' || color.price < 0) {
        errors.push(`Color ${color.name || color.value}: Price must be a non-negative number`);
      }
      
      if (color.comparePrice !== undefined && color.comparePrice !== null) {
        if (typeof color.comparePrice !== 'number' || color.comparePrice < 0) {
          errors.push(`Color ${color.name || color.value}: Compare price must be a non-negative number`);
        } else if (color.comparePrice < color.price) {
          errors.push(`Color ${color.name || color.value}: Compare price must be greater than or equal to price`);
        }
      }
    });
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Prepare product data for form submission
  static prepareProductDataForForm(productData, isUpdate = false) {
    const data = { ...productData };
    
    // Ensure colors have required price field
    if (data.colors?.hasColors && data.colors.availableColors) {
      data.colors.availableColors = data.colors.availableColors.map(color => ({
        ...color,
        price: color.price !== undefined ? Number(color.price) : (isUpdate ? undefined : 0),
        comparePrice: color.comparePrice !== undefined ? Number(color.comparePrice) : null
      }));
    }
    
    // Parse numeric fields
    const numericFields = ['quantity', 'lowStockThreshold', 'weight', 'viewCount', 'salesCount', 'wishlistCount'];
    numericFields.forEach(field => {
      if (data[field] !== undefined) {
        data[field] = Number(data[field]);
      }
    });
    
    // Parse dimensions
    if (data.dimensions) {
      const dimensionFields = ['length', 'width', 'height'];
      dimensionFields.forEach(field => {
        if (data.dimensions[field] !== undefined) {
          data.dimensions[field] = Number(data.dimensions[field]);
        }
      });
    }
    
    // Parse shipping cost
    if (data.shipping?.fixedCost !== undefined) {
      data.shipping.fixedCost = Number(data.shipping.fixedCost);
    }
    
    return data;
  }
}

module.exports = ProductHelpers;