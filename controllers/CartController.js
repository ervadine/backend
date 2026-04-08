const asyncHandler = require("express-async-handler");
const HttpError = require('../middleware/HttpError');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const mongoose = require('mongoose');

class CartController {



  // Add this validation before adding items
static validateAddToCartRequest(req, res, next) {
  const { productId, quantity } = req.body;
  
  // Check if this is an automated/bot request
  const userAgent = req.headers['user-agent'];
  const isBot = /bot|crawler|spider|scraper/i.test(userAgent);
  
  if (isBot) {
    throw new HttpError('Automated requests not allowed', 403);
  }
  
  // Check for rapid successive requests
  const lastRequest = req.session?.lastCartRequest;
  if (lastRequest && Date.now() - lastRequest < 1000) {
    throw new HttpError('Too many requests', 429);
  }
  
  req.session = req.session || {};
  req.session.lastCartRequest = Date.now();
  
  next();
}
 
  /**
   * Get or create cart for user/session with optimized population
   */
 


static async getOrCreateCart(userId, sessionId, shouldCreate = false) {  // ← Changed to false
  try {
    let cart;
    
    // Define fields to populate (only what's needed for cart)
    const populateOptions = {
      path: 'items.product',
      select: '_id name price images seo isActive colors variants sizeConfig trackQuantity allowBackorder lowStockThreshold'
    };
    
    // Priority 1: User cart (if user is logged in)
    if (userId) {
      cart = await Cart.findOne({ user: userId })
        .populate(populateOptions)
      
      // If no user cart found but session exists, check for session cart and convert it
      if (!cart && sessionId) {
        const sessionCart = await Cart.findOne({ sessionId })
          .populate(populateOptions)
        if (sessionCart) {
          // Convert session cart to user cart
          sessionCart.user = userId;
          sessionCart.sessionId = undefined;
          await sessionCart.save();
          cart = sessionCart;
        }
      }
    }
    
    // Priority 2: Session cart (if no user cart found and user is not logged in)
    if (!cart && sessionId && !userId) {
      cart = await Cart.findOne({ sessionId })
        .populate(populateOptions)
    }

    // Priority 3: Create new cart ONLY if shouldCreate is true
    if (!cart && shouldCreate === true) {
      console.log('🛒 Creating new cart for:', { userId, sessionId });
      
      const cartData = {
        items: [],
        lastUpdated: new Date()
      };

      if (userId) {
        cartData.user = userId;
      } else if (sessionId) {
        cartData.sessionId = sessionId;
      } else {
        return null;
      }

      cart = new Cart(cartData);
      await cart.save();
      cart = await Cart.findById(cart._id).populate(populateOptions);
    }

    // Only process items if cart exists
    if (cart) {
      const validItems = cart.items.filter(item =>
        item.product && item.product.isActive !== false
      );

      if (validItems.length !== cart.items.length) {
        cart.items = validItems;
        cart.lastUpdated = new Date();
        await cart.save();
        cart = await Cart.findById(cart._id).populate(populateOptions);
      }
    }

    return cart;
  } catch (error) {
    console.error('❌ Cart error:', error);
    
    if (error.code === 11000) {
      return await CartController.getOrCreateCart(userId, sessionId, shouldCreate);
    }
    
    return null;  // Return null instead of throwing
  }
}

  /**
   * Generate session ID for guest users
   */
  static generateSessionId() {
    return `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Set cart session cookie
   */
  static setCartCookie(res, sessionId) {
    res.cookie('cartSessionId', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
  }

  /**
   * Extract string values from color and size objects
   */
  static extractSelectionValues(selectedColor, selectedSize) {
    let colorValue = null;
    let sizeValue = null;

    // Handle selectedColor (could be string or object)
    if (selectedColor) {
      if (typeof selectedColor === 'string') {
        colorValue = selectedColor;
      } else if (typeof selectedColor === 'object') {
        // Extract value from color object
        colorValue = selectedColor.value || selectedColor.hexCode || null;
      }
    }

    // Handle selectedSize (could be string or object)
    if (selectedSize) {
      if (typeof selectedSize === 'string') {
        sizeValue = selectedSize;
      } else if (typeof selectedSize === 'object') {
        // Extract value from size object
        sizeValue = selectedSize.value || null;
      }
    }

    return { colorValue, sizeValue };
  }

  /**
   * Get appropriate image for cart item based on color selection
   */
  static getProductImageForCart(product, selectedColor) {
    if (!product || !product.images || product.images.length === 0) {
      return null;
    }

    // If no color selected, return primary image or first image
    if (!selectedColor) {
      const primaryImage = product.images.find(img => img.isPrimary);
      return primaryImage ? primaryImage.url : product.images[0].url;
    }

    // For products with colors structure
    if (product.colors && product.colors.hasColors && product.colors.availableColors) {
      const color = product.colors.availableColors.find(c =>
        c.value === selectedColor || c.hexCode === selectedColor
      );
      if (color && color.images && color.images.length > 0) {
        const primaryImage = color.images.find(img => img.isPrimary);
        return primaryImage ? primaryImage.url : color.images[0].url;
      }
    }

    // Try to find image for the selected color in general images
    const colorImage = product.images.find(img =>
      img.color === selectedColor ||
      img.alt?.includes(selectedColor)
    );

    if (colorImage) {
      return colorImage.url;
    }

    // If no color-specific image found, return primary or first image
    const primaryImage = product.images.find(img => img.isPrimary);
    return primaryImage ? primaryImage.url : product.images[0].url;
  }

  /**
   * Find matching variant based on color and size
   */
  static findMatchingVariant(product, colorValue, sizeValue) {
    if (!product.variants || product.variants.length === 0) {
      return null;
    }

    return product.variants.find(variant => {
      // Check color match (if color is selected)
      const colorMatch = !colorValue ||
        (variant.color && (
          variant.color.value === colorValue ||
          variant.color.hexCode === colorValue ||
          variant.color.name === colorValue
        ));
     
      // Check size match (if size is selected)
      const sizeMatch = !sizeValue ||
        (variant.size && variant.size.value === sizeValue);
     
      return colorMatch && sizeMatch;
    });
  }

  /**
   * Validate product availability and get correct price
   */
  static async validateProduct(productId, selectedColor, selectedSize, quantity) {
    const product = await Product.findById(productId)
      .select('name price quantity variants colors sizeConfig isActive inStock images trackQuantity allowBackorder lowStockThreshold');
   
    if (!product || product.isActive === false) {
      throw new HttpError('Product not found or inactive', 404);
    }

    // Extract string values from objects if needed
    const { colorValue, sizeValue } = CartController.extractSelectionValues(selectedColor, selectedSize);

    let availableQuantity = product.totalQuantity || product.quantity || 0;
    let productPrice = product.price;
    let variant = null;

    // Check if product has variants
    if (product.variants && product.variants.length > 0) {
      variant = CartController.findMatchingVariant(product, colorValue, sizeValue);
     
      if (variant) {
        availableQuantity = variant.quantity || 0;
        productPrice = variant.price || product.price;
      } else {
        // If no exact variant found, check for any variant with stock
        const anyInStockVariant = product.variants.find(v => v.quantity > 0);
        if (anyInStockVariant) {
          availableQuantity = anyInStockVariant.quantity;
          productPrice = anyInStockVariant.price || product.price;
        }
      }
    } else {
      // For products with color-based quantity tracking
      if (product.colors && product.colors.hasColors && colorValue) {
        const color = product.colors.availableColors.find(
          c => c.value === colorValue || c.hexCode === colorValue
        );
       
        if (color) {
          productPrice = color.price || product.price;
         
          if (color.quantityConfig) {
            if (sizeValue && color.quantityConfig.quantities) {
              const sizeQuantity = color.quantityConfig.quantities.find(
                q => q.size && q.size.value === sizeValue
              );
              if (sizeQuantity) {
                availableQuantity = sizeQuantity.quantity || 0;
                productPrice = sizeQuantity.price || color.price || product.price;
              }
            } else {
              availableQuantity = color.quantityConfig.totalQuantity || 0;
            }
          }
        }
      }

      // Validate color selection
      if (product.colors && product.colors.hasColors && colorValue) {
        const validColor = product.colors.availableColors.some(
          color => color.value === colorValue || color.hexCode === colorValue
        );
        if (!validColor) {
          throw new HttpError('Invalid color selection', 400);
        }
      }

      // Validate size selection
      if (product.sizeConfig && product.sizeConfig.hasSizes && sizeValue) {
        const validSize = product.sizeConfig.availableSizes.some(
          size => size.value === sizeValue
        );
        if (!validSize) {
          throw new HttpError('Invalid size selection', 400);
        }
      }
    }

    // Check stock availability if tracking quantity
    if (product.trackQuantity !== false && !product.allowBackorder) {
      if (availableQuantity < quantity) {
        throw new HttpError(`Insufficient stock. Available: ${availableQuantity}, Requested: ${quantity}`, 400);
      }
    }

    // If no price found, use product base price
    if (!productPrice || productPrice <= 0) {
      productPrice = product.price;
    }

    return {
      productId: product._id,
      name: product.name,
      price: productPrice,
      availableQuantity,
      selectedColor: colorValue,
      selectedSize: sizeValue,
      variant: variant,
      image: CartController.getProductImageForCart(product, colorValue)
    };
  }

  /**
   * Format cart item for response
   */
  static formatCartItem(item) {
    const product = item.product;
   
    return {
      _id: item._id,
      product: product ? {
        _id: product._id,
        name: product.name,
        price: product.price,
        image: CartController.getProductImageForCart(product, item.selectedColor),
        slug: product.seo?.slug,
        isActive: product.isActive,
        inStock: product.inStock || true,
        trackQuantity: product.trackQuantity,
        quantity: product.totalQuantity || product.quantity || 0,
        colors: product.colors,
        sizeConfig: product.sizeConfig
      } : null,
      selectedColor: item.selectedColor,
      selectedSize: item.selectedSize,
      quantity: item.quantity,
      price: item.price,
      addedAt: item.addedAt,
      subtotal: item.price * item.quantity,
      maxQuantity: product ? (product.totalQuantity || product.quantity || 100) : 100
    };
  }

  /**
   * Format cart for response
   */
  static formatCart(cart) {
    const totals = cart.calculateTotals();
   
    return {
      _id: cart._id,
      user: cart.user,
      sessionId: cart.sessionId,
      items: cart.items.map(item => CartController.formatCartItem(item)),
      coupon: cart.coupon,
      lastUpdated: cart.lastUpdated,
      ...totals
    };
  }




/**
 * GET /api/cart/items - Get user's cart with session ID in response
 */
static getCart = asyncHandler(async (req, res) => {
  const userId = req.user?._id || null;
  let sessionId = req.cookies?.cartSessionId;
  
  // Also check headers for session ID (for localStorage fallback)
  if (!sessionId && req.headers['x-cart-session-id']) {
    sessionId = req.headers['x-cart-session-id'];
    console.log('📦 Using session ID from header:', sessionId);
  }

  // Pass false to NOT create a cart automatically
  const cart = await CartController.getOrCreateCart(userId, sessionId, false);
  
  // If no cart exists, return empty cart response
  if (!cart) {
    return res.status(200).json({
      success: true,
      data: {
        _id: null,
        user: userId,
        sessionId: sessionId || null,
        items: [],
        itemCount: 0,
        subtotal: 0,
        discountAmount: 0,
        discountedTotal: 0,
        coupon: null,
        lastUpdated: new Date()
      },
      message: 'Cart retrieved successfully'
    });
  }
  
  const formattedCart = CartController.formatCart(cart);
  
  res.status(200).json({
    success: true,
    data: {
      ...formattedCart,
      sessionId: sessionId // Return session ID for localStorage
    },
    message: 'Cart retrieved successfully'
  });
});

/**
 * POST /api/cart/add-item - Add item to cart with session ID in response
 */
static addToCart = asyncHandler(async (req, res) => {
  const { productId, selectedColor, selectedSize, quantity = 1 } = req.body;
  const userId = req.user?._id || null;
  let sessionId = req.cookies?.cartSessionId;
  
  // Also check headers for session ID
  if (!sessionId && req.headers['x-cart-session-id']) {
    sessionId = req.headers['x-cart-session-id'];
    console.log('📦 Using session ID from header for add:', sessionId);
  }

  // Validate required fields
  if (!productId) {
    throw new HttpError('Product ID is required', 400);
  }

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new HttpError('Invalid product ID', 400);
  }

  // Generate session ID for guest users if it doesn't exist
  if (!sessionId && !userId) {
    sessionId = CartController.generateSessionId();
    CartController.setCartCookie(res, sessionId);
    console.log('🆕 Generated new session ID:', sessionId);
  }

  // Extract string values from objects if needed
  const { colorValue, sizeValue } = CartController.extractSelectionValues(selectedColor, selectedSize);

  // Validate product and get price
  const product = await CartController.validateProduct(
    productId, colorValue, sizeValue, quantity
  );

  // Pass true to create cart if it doesn't exist
  const cart = await CartController.getOrCreateCart(userId, sessionId, true);
  
  if (!cart) {
    throw new HttpError('Unable to create or retrieve cart', 500);
  }

  // Check if item already exists in cart
  const existingItemIndex = cart.items.findIndex(item =>
    item.product._id.toString() === productId &&
    item.selectedColor === colorValue &&
    item.selectedSize === sizeValue
  );

  if (existingItemIndex > -1) {
    const newQuantity = cart.items[existingItemIndex].quantity + quantity;
    
    await CartController.validateProduct(productId, colorValue, sizeValue, newQuantity);
    
    cart.items[existingItemIndex].quantity = newQuantity;
    cart.items[existingItemIndex].addedAt = new Date();
  } else {
    const cartItem = {
      product: productId,
      selectedColor: colorValue || null,
      selectedSize: sizeValue || null,
      quantity,
      price: product.price,
      addedAt: new Date()
    };

    if (userId) {
      cartItem.user = userId;
    }

    cart.items.push(cartItem);
  }

  cart.lastUpdated = new Date();
  await cart.save();
  
  await cart.populate({
    path: 'items.product',
    select: '_id name price images seo isActive trackQuantity colors sizeConfig'
  });
  
  const formattedCart = CartController.formatCart(cart);

  res.status(201).json({
    success: true,
    data: {
      ...formattedCart,
      sessionId: sessionId // Return session ID for localStorage
    },
    message: 'Item added to cart successfully'
  });
});

/**
 * GET /api/cart/count - Get cart count with session support
 */
static getCartCount = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  let sessionId = req.cookies?.cartSessionId;
  
  // Also check headers for session ID
  if (!sessionId && req.headers['x-cart-session-id']) {
    sessionId = req.headers['x-cart-session-id'];
  }

  // Pass false to NOT create a cart
  const cart = await CartController.getOrCreateCart(userId, sessionId, false);
  
  if (!cart) {
    return res.status(200).json({
      success: true,
      data: {
        itemCount: 0,
        uniqueItems: 0,
        sessionId: sessionId
      },
      message: 'Cart count retrieved successfully'
    });
  }
  
  res.status(200).json({
    success: true,
    data: {
      itemCount: cart.itemCount,
      uniqueItems: cart.items.length,
      sessionId: sessionId
    },
    message: 'Cart count retrieved successfully'
  });
});

  /**
   * PUT /api/cart/update-item/:itemId - Update cart item quantity
   */
  static updateCartItem = asyncHandler(async (req, res) => {
    const { itemId } = req.params;
    const { quantity } = req.body;
    // FIXED: Using req.user?._id correctly
    const userId = req.user?._id || null;
    const sessionId = req.cookies?.cartSessionId;

    if (!quantity || quantity < 1) {
      throw new HttpError('Valid quantity is required (minimum 1)', 400);
    }

    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      throw new HttpError('Invalid cart item ID', 400);
    }

    const cart = await CartController.getOrCreateCart(userId, sessionId);
    const itemIndex = cart.items.findIndex(item => item._id.toString() === itemId);

    if (itemIndex === -1) {
      throw new HttpError('Cart item not found', 404);
    }

    const cartItem = cart.items[itemIndex];

    // Check product stock
    await CartController.validateProduct(
      cartItem.product._id.toString(),
      cartItem.selectedColor,
      cartItem.selectedSize,
      quantity
    );

    cart.items[itemIndex].quantity = quantity;
    cart.items[itemIndex].addedAt = new Date(); // Update timestamp
    cart.lastUpdated = new Date();
    await cart.save();
   
    // Populate with limited fields
    await cart.populate({
      path: 'items.product',
      select: '_id name price images seo isActive trackQuantity colors sizeConfig'
    });
   
    const formattedCart = CartController.formatCart(cart);

    res.status(200).json({
      success: true,
      data: formattedCart,
      message: 'Cart item updated successfully'
    });
  });

  /**
   * DELETE /api/cart/delete-item/:itemId - Remove item from cart
   */
  static removeFromCart = asyncHandler(async (req, res) => {
    const { itemId } = req.params;
    // FIXED: Using req.user?._id correctly
    const userId = req.user?._id || null;
    const sessionId = req.cookies?.cartSessionId;

    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      throw new HttpError('Invalid cart item ID', 400);
    }

    const cart = await CartController.getOrCreateCart(userId, sessionId);
    const itemIndex = cart.items.findIndex(item => item._id.toString() === itemId);

    if (itemIndex === -1) {
      throw new HttpError('Cart item not found', 404);
    }

    cart.items.splice(itemIndex, 1);
    cart.lastUpdated = new Date();
    await cart.save();
   
    // Populate with limited fields
    await cart.populate({
      path: 'items.product',
      select: '_id name price images seo isActive trackQuantity colors sizeConfig'
    });
   
    const formattedCart = CartController.formatCart(cart);

    res.status(200).json({
      success: true,
      data: formattedCart,
      message: 'Item removed from cart successfully'
    });
  });

  /**
   * DELETE /api/cart/clear-items - Clear entire cart
   */
  static clearCart = asyncHandler(async (req, res) => {
    // FIXED: Using req.user?._id correctly
    const userId = req.user?._id || null;
    const sessionId = req.cookies?.cartSessionId;

    const cart = await CartController.getOrCreateCart(userId, sessionId);
   
    cart.items = [];
    cart.coupon = undefined;
    cart.lastUpdated = new Date();
    await cart.save();

    const formattedCart = CartController.formatCart(cart);

    res.status(200).json({
      success: true,
      data: formattedCart,
      message: 'Cart cleared successfully'
    });
  });

  /**
   * POST /api/cart/apply-coupon - Apply coupon to cart
   */
  static applyCoupon = asyncHandler(async (req, res) => {
    const { couponCode } = req.body;
    // FIXED: Using req.user?._id correctly
    const userId = req.user?._id || null;
    const sessionId = req.cookies?.cartSessionId;

    if (!couponCode) {
      throw new HttpError('Coupon code is required', 400);
    }

    // Find valid coupon
    const coupon = await Coupon.findOne({
      code: couponCode.toUpperCase(),
      isActive: true,
      startDate: { $lte: new Date() },
      $or: [
        { endDate: { $gte: new Date() } },
        { endDate: null }
      ]
    });

    if (!coupon) {
      throw new HttpError('Invalid or expired coupon code', 400);
    }

    // Check usage limits
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      throw new HttpError('Coupon usage limit exceeded', 400);
    }

    const cart = await CartController.getOrCreateCart(userId, sessionId);

    // Check if cart is empty
    if (cart.items.length === 0) {
      throw new HttpError('Cannot apply coupon to empty cart', 400);
    }

    // Calculate current subtotal
    const subtotal = cart.items.reduce((total, item) => {
      return total + (item.price * item.quantity);
    }, 0);

    // Check minimum cart value
    if (coupon.minimumCartValue && subtotal < coupon.minimumCartValue) {
      throw new HttpError(
        `Minimum cart value of $${coupon.minimumCartValue} required for this coupon`,
        400
      );
    }

    // Apply coupon to cart
    cart.coupon = {
      code: coupon.code,
      discount: coupon.discountValue,
      discountType: coupon.discountType,
      appliedAt: new Date()
    };

    cart.lastUpdated = new Date();
    await cart.save();
   
    // Populate with limited fields
    await cart.populate({
      path: 'items.product',
      select: '_id name price images seo isActive trackQuantity colors sizeConfig'
    });
   
    const formattedCart = CartController.formatCart(cart);

    res.status(200).json({
      success: true,
      data: formattedCart,
      message: 'Coupon applied successfully'
    });
  });

  /**
   * DELETE /api/cart/remove-coupon - Remove coupon from cart
   */
  static removeCoupon = asyncHandler(async (req, res) => {
    // FIXED: Using req.user?._id correctly
    const userId = req.user?._id || null;
    const sessionId = req.cookies?.cartSessionId;

    const cart = await CartController.getOrCreateCart(userId, sessionId);

    if (!cart.coupon) {
      throw new HttpError('No coupon applied to cart', 400);
    }

    cart.coupon = undefined;
    cart.lastUpdated = new Date();
    await cart.save();
   
    // Populate with limited fields
    await cart.populate({
      path: 'items.product',
      select: '_id name price images seo isActive trackQuantity colors sizeConfig'
    });
   
    const formattedCart = CartController.formatCart(cart);

    res.status(200).json({
      success: true,
      data: formattedCart,
      message: 'Coupon removed successfully'
    });
  });

  /**
   * GET /api/cart/summary - Get cart summary
   */
  static getCartSummary = asyncHandler(async (req, res) => {
    // FIXED: Using req.user?._id correctly
    const userId = req.user?._id || null;
    const sessionId = req.cookies?.cartSessionId;

    const cart = await CartController.getOrCreateCart(userId, sessionId);
    const formattedCart = CartController.formatCart(cart);

    const summary = {
      itemCount: formattedCart.itemCount,
      subtotal: formattedCart.subtotal,
      totalPrice: formattedCart.subtotal,
      discountAmount: formattedCart.discountAmount,
      discountedTotal: formattedCart.discountedTotal,
      items: formattedCart.items.map(item => ({
        _id: item._id,
        product: {
          _id: item.product?._id,
          name: item.product?.name,
          image: item.product?.image,
          slug: item.product?.slug
        },
        selectedColor: item.selectedColor,
        selectedSize: item.selectedSize,
        quantity: item.quantity,
        price: item.price,
        subtotal: item.price * item.quantity
      })),
      coupon: formattedCart.coupon,
      savings: formattedCart.discountAmount,
      shippingEstimate: formattedCart.discountedTotal > 50 ? 0 : 10,
      taxEstimate: formattedCart.discountedTotal * 0.08
    };

    res.status(200).json({
      success: true,
      data: summary,
      message: 'Cart summary retrieved successfully'
    });
  });

  /**
   * Merge guest cart with user cart after login
   */
  static async mergeCarts(userId, sessionId) {
    try {
      if (!userId || !sessionId) {
        throw new HttpError('User ID and session ID are required for cart merging', 400);
      }

      const userCart = await Cart.findOne({ user: userId })
        .populate({
          path: 'items.product',
          select: '_id name price images seo isActive trackQuantity colors sizeConfig'
        });
   
      const guestCart = await Cart.findOne({ sessionId })
        .populate({
          path: 'items.product',
          select: '_id name price images seo isActive trackQuantity colors sizeConfig'
        });

      if (!guestCart || guestCart.items.length === 0) {
        return userCart;
      }

      if (!userCart) {
        // Convert guest cart to user cart
        guestCart.user = userId;
        guestCart.sessionId = undefined;
        await guestCart.save();
        return guestCart;
      }

      // Merge items from guest cart to user cart
      for (const guestItem of guestCart.items) {
        const existingItemIndex = userCart.items.findIndex(item =>
          item.product._id.toString() === guestItem.product._id.toString() &&
          item.selectedColor === guestItem.selectedColor &&
          item.selectedSize === guestItem.selectedSize
        );

        if (existingItemIndex > -1) {
          // Update quantity for existing item
          userCart.items[existingItemIndex].quantity += guestItem.quantity;
          // Update timestamp
          userCart.items[existingItemIndex].addedAt = new Date();
        } else {
          // Add new item with userId
          const newItem = {
            ...guestItem.toObject(),
            addedAt: new Date()
          };
          // Add userId to the item if it doesn't have one
          if (!newItem.user) {
            newItem.user = userId;
          }
          userCart.items.push(newItem);
        }
      }

      userCart.lastUpdated = new Date();
      await userCart.save();
     
      await userCart.populate({
        path: 'items.product',
        select: '_id name price images seo isActive trackQuantity colors sizeConfig'
      });

      // Delete guest cart
      await Cart.findByIdAndDelete(guestCart._id);

      return userCart;
    } catch (error) {
      console.error('❌ Merge carts error:', error);
      throw new HttpError(`Failed to merge carts: ${error.message}`, 500);
    }
  }

  /**
   * Get cart count (for badge/header display)
   */


  

  /**
   * Check if product is in cart
   */
  static checkProductInCart = asyncHandler(async (req, res) => {
    const { productId, selectedColor, selectedSize } = req.query;
    // FIXED: Using req.user?._id correctly
    const userId = req.user?._id;
    const sessionId = req.cookies?.cartSessionId;

    if (!productId) {
      throw new HttpError('Product ID is required', 400);
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new HttpError('Invalid product ID', 400);
    }

    // Extract string values from objects if needed
    const { colorValue, sizeValue } = CartController.extractSelectionValues(selectedColor, selectedSize);

    const cart = await CartController.getOrCreateCart(userId, sessionId);
   
    const isInCart = cart.items.some(item =>
      item.product._id.toString() === productId &&
      item.selectedColor === colorValue &&
      item.selectedSize === sizeValue
    );

    const cartItem = cart.items.find(item =>
      item.product._id.toString() === productId &&
      item.selectedColor === colorValue &&
      item.selectedSize === sizeValue
    );

    res.status(200).json({
      success: true,
      data: {
        isInCart,
        quantity: cartItem?.quantity || 0,
        cartItemId: cartItem?._id || null
      },
      message: 'Product cart status retrieved successfully'
    });
  });

  /**
   * Validate cart before checkout
   */
  static validateCart = asyncHandler(async (req, res) => {
    // FIXED: Using req.user?._id correctly
    const userId = req.user?._id || null;
    const sessionId = req.cookies?.cartSessionId;

    const cart = await CartController.getOrCreateCart(userId, sessionId);
   
    const validationResults = {
      isValid: true,
      errors: [],
      warnings: [],
      updatedItems: []
    };

    // Check if cart is empty
    if (cart.items.length === 0) {
      validationResults.isValid = false;
      validationResults.errors.push('Cart is empty');
      return res.status(200).json({
        success: true,
        data: validationResults,
        message: 'Cart validation completed'
      });
    }

    let needsSave = false;

    // Validate each item
    for (const item of cart.items) {
      try {
        // Re-validate using the validateProduct method
        const validatedProduct = await CartController.validateProduct(
          item.product._id.toString(),
          item.selectedColor,
          item.selectedSize,
          item.quantity
        );

        // Check if price has changed
        if (validatedProduct.price !== item.price) {
          validationResults.warnings.push(
            `Price has changed for "${item.product?.name || 'Unknown'}". Old price: $${item.price}, New price: $${validatedProduct.price}`
          );
          // Update price in cart
          item.price = validatedProduct.price;
          validationResults.updatedItems.push(item.product?.name || 'Unknown');
          needsSave = true;
        }

        // Update userId on item if not present but user is logged in
        if (userId && !item.user) {
          item.user = userId;
          needsSave = true;
        }
      } catch (error) {
        validationResults.isValid = false;
        validationResults.errors.push(`Validation failed for "${item.product?.name || 'Unknown'}": ${error.message}`);
      }
    }

    // Save cart if prices were updated
    if (needsSave) {
      cart.lastUpdated = new Date();
      await cart.save();
    }

    res.status(200).json({
      success: true,
      data: validationResults,
      message: 'Cart validation completed'
    });
  });

  /**
   * Helper method to clean cart items data (for existing cart data with objects)
   */
  static async cleanCartData() {
    try {
      const carts = await Cart.find({
        $or: [
          { 'items.selectedColor': { $type: 'object' } },
          { 'items.selectedSize': { $type: 'object' } }
        ]
      });

      for (const cart of carts) {
        let needsUpdate = false;
       
        for (const item of cart.items) {
          // Clean selectedColor if it's an object
          if (item.selectedColor && typeof item.selectedColor === 'object') {
            item.selectedColor = item.selectedColor.value || item.selectedColor.hexCode || null;
            needsUpdate = true;
          }
         
          // Clean selectedSize if it's an object
          if (item.selectedSize && typeof item.selectedSize === 'object') {
            item.selectedSize = item.selectedSize.value || null;
            needsUpdate = true;
          }
        }
       
        if (needsUpdate) {
          await cart.save();
          console.log(`✅ Cleaned cart data for cart ID: ${cart._id}`);
        }
      }
     
      console.log(`✅ Cleaned ${carts.length} carts with object data`);
    } catch (error) {
      console.error('❌ Error cleaning cart data:', error);
    }
  }

  /**
   * POST /api/cart/migrate - Migrate cart from session to user (for login)
   */
  static migrateCart = asyncHandler(async (req, res) => {
    // FIXED: Using req.user._id correctly
    const userId = req.user._id;
    const sessionId = req.cookies?.cartSessionId;

    if (!userId) {
      throw new HttpError('User must be logged in to migrate cart', 401);
    }

    if (!sessionId) {
      throw new HttpError('No session cart found to migrate', 400);
    }

    const cart = await CartController.mergeCarts(userId, sessionId);
   
    // Clear the session cookie after migration
    res.clearCookie('cartSessionId');
   
    const formattedCart = CartController.formatCart(cart);

    res.status(200).json({
      success: true,
      data: formattedCart,
      message: 'Cart migrated successfully'
    });
  });

  /**
   * GET /api/cart/checkout-details - Get cart details for checkout
   */
  static getCheckoutDetails = asyncHandler(async (req, res) => {
    // FIXED: Using req.user?._id correctly
    const userId = req.user?._id || null;
    const sessionId = req.cookies?.cartSessionId;

    const cart = await CartController.getOrCreateCart(userId, sessionId);
   
    if (cart.items.length === 0) {
      throw new HttpError('Cart is empty', 400);
    }

    // Validate all items
    const validation = await CartController.validateCart(req, res, true);
   
    if (!validation.isValid) {
      throw new HttpError('Cart validation failed', 400);
    }

    const formattedCart = CartController.formatCart(cart);

    const checkoutDetails = {
      cartId: cart._id,
      items: formattedCart.items,
      totals: {
        subtotal: formattedCart.subtotal,
        discountAmount: formattedCart.discountAmount,
        discountedTotal: formattedCart.discountedTotal,
        shipping: formattedCart.discountedTotal > 50 ? 0 : 10,
        tax: formattedCart.discountedTotal * 0.08,
        grandTotal: formattedCart.discountedTotal + (formattedCart.discountedTotal > 50 ? 0 : 10) + (formattedCart.discountedTotal * 0.08)
      },
      coupon: formattedCart.coupon,
      itemCount: formattedCart.itemCount
    };

    res.status(200).json({
      success: true,
      data: checkoutDetails,
      message: 'Checkout details retrieved successfully'
    });
  });

  /**
   * POST /api/cart/bulk-update - Update multiple cart items at once
   */
  static bulkUpdateCart = asyncHandler(async (req, res) => {
    const { updates } = req.body;
    // FIXED: Using req.user?._id correctly
    const userId = req.user?._id || null;
    const sessionId = req.cookies?.cartSessionId;

    if (!updates || !Array.isArray(updates)) {
      throw new HttpError('Updates array is required', 400);
    }

    const cart = await CartController.getOrCreateCart(userId, sessionId);
    let needsSave = false;

    for (const update of updates) {
      const { itemId, quantity } = update;

      if (!itemId || !mongoose.Types.ObjectId.isValid(itemId)) {
        continue;
      }

      if (!quantity || quantity < 1) {
        continue;
      }

      const itemIndex = cart.items.findIndex(item => item._id.toString() === itemId);
     
      if (itemIndex === -1) {
        continue;
      }

      const cartItem = cart.items[itemIndex];

      try {
        // Validate product stock
        await CartController.validateProduct(
          cartItem.product._id.toString(),
          cartItem.selectedColor,
          cartItem.selectedSize,
          quantity
        );

        cart.items[itemIndex].quantity = quantity;
        cart.items[itemIndex].addedAt = new Date();
       
        // Update userId on item if not present but user is logged in
        if (userId && !cart.items[itemIndex].user) {
          cart.items[itemIndex].user = userId;
        }
       
        needsSave = true;
      } catch (error) {
        // Skip items that fail validation
        console.warn(`Skipping update for item ${itemId}: ${error.message}`);
      }
    }

    if (needsSave) {
      cart.lastUpdated = new Date();
      await cart.save();
     
      await cart.populate({
        path: 'items.product',
        select: '_id name price images seo isActive trackQuantity colors sizeConfig'
      });
    }

    const formattedCart = CartController.formatCart(cart);

    res.status(200).json({
      success: true,
      data: formattedCart,
      message: 'Cart updated successfully'
    });
  });

  /**
   * GET /api/cart/user-items - Get cart items for logged-in user only
   */
  static getUserCartItems = asyncHandler(async (req, res) => {
    // This route requires authentication
    if (!req.user?._id) {
      throw new HttpError('Authentication required', 401);
    }

    const userId = req.user._id;
    const cart = await Cart.findOne({ user: userId })
      .populate({
        path: 'items.product',
        select: '_id name price images seo isActive trackQuantity colors sizeConfig'
      });

    if (!cart) {
      return res.status(200).json({
        success: true,
        data: {
          items: [],
          itemCount: 0,
          subtotal: 0,
          discountAmount: 0,
          discountedTotal: 0
        },
        message: 'Cart is empty'
      });
    }

    const formattedCart = CartController.formatCart(cart);

    res.status(200).json({
      success: true,
      data: formattedCart,
      message: 'User cart items retrieved successfully'
    });
  });

  /**
   * POST /api/cart/sync - Sync session cart with user cart
   * Useful when user logs in and has items in both carts
   */
  static syncCarts = asyncHandler(async (req, res) => {
    const userId = req.user?._id;
    const sessionId = req.cookies?.cartSessionId;

    if (!userId) {
      throw new HttpError('Authentication required', 401);
    }

    if (!sessionId) {
      // Just return user cart if no session exists 
      const cart = await CartController.getOrCreateCart(userId, null);
      const formattedCart = CartController.formatCart(cart);
     
      return res.status(200).json({
        success: true,
        data: formattedCart,
        message: 'Cart synced successfully'
      });
    }

    // Merge carts if both exist
    const cart = await CartController.mergeCarts(userId, sessionId);
   
    // Clear the session cookie after sync
    res.clearCookie('cartSessionId');
   
    const formattedCart = CartController.formatCart(cart);

    res.status(200).json({
      success: true,
      data: formattedCart,
      message: 'Cart synced successfully'
    });
  });
}

module.exports = CartController;




