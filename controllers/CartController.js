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
  static async getOrCreateCart(userId, sessionId, shouldCreate = false) {
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
          .populate(populateOptions);
        
        // If no user cart found but session exists, check for session cart and convert it
        if (!cart && sessionId) {
          const sessionCart = await Cart.findOne({ sessionId })
            .populate(populateOptions);
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
          .populate(populateOptions);
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
      if (cart && cart.items) {
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
      
      return null;
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
    const isLocalhost = process.env.NODE_ENV !== 'production';
    
    const cookieOptions = {
      httpOnly: true,
      secure: !isLocalhost,
      sameSite: isLocalhost ? 'lax' : 'none',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
      domain: !isLocalhost ? '.onrender.com' : undefined
    };
    
    res.cookie('cartSessionId', sessionId, cookieOptions);
    console.log('🍪 Cart session cookie set:', { sessionId, options: cookieOptions });
  }

  /**
   * Extract string values from color and size objects
   */
  static extractSelectionValues(selectedColor, selectedSize) {
    let colorValue = null;
    let sizeValue = null;

    if (selectedColor) {
      if (typeof selectedColor === 'string') {
        colorValue = selectedColor;
      } else if (typeof selectedColor === 'object') {
        colorValue = selectedColor.value || selectedColor.hexCode || null;
      }
    }

    if (selectedSize) {
      if (typeof selectedSize === 'string') {
        sizeValue = selectedSize;
      } else if (typeof selectedSize === 'object') {
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

    if (!selectedColor) {
      const primaryImage = product.images.find(img => img.isPrimary);
      return primaryImage ? primaryImage.url : product.images[0].url;
    }

    if (product.colors && product.colors.hasColors && product.colors.availableColors) {
      const color = product.colors.availableColors.find(c =>
        c.value === selectedColor || c.hexCode === selectedColor
      );
      if (color && color.images && color.images.length > 0) {
        const primaryImage = color.images.find(img => img.isPrimary);
        return primaryImage ? primaryImage.url : color.images[0].url;
      }
    }

    const colorImage = product.images.find(img =>
      img.color === selectedColor ||
      img.alt?.includes(selectedColor)
    );

    if (colorImage) {
      return colorImage.url;
    }

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
      const colorMatch = !colorValue ||
        (variant.color && (
          variant.color.value === colorValue ||
          variant.color.hexCode === colorValue ||
          variant.color.name === colorValue
        ));
     
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

    const { colorValue, sizeValue } = CartController.extractSelectionValues(selectedColor, selectedSize);

    let availableQuantity = product.totalQuantity || product.quantity || 0;
    let productPrice = product.price;
    let variant = null;

    if (product.variants && product.variants.length > 0) {
      variant = CartController.findMatchingVariant(product, colorValue, sizeValue);
     
      if (variant) {
        availableQuantity = variant.quantity || 0;
        productPrice = variant.price || product.price;
      } else {
        const anyInStockVariant = product.variants.find(v => v.quantity > 0);
        if (anyInStockVariant) {
          availableQuantity = anyInStockVariant.quantity;
          productPrice = anyInStockVariant.price || product.price;
        }
      }
    } else {
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

      if (product.colors && product.colors.hasColors && colorValue) {
        const validColor = product.colors.availableColors.some(
          color => color.value === colorValue || color.hexCode === colorValue
        );
        if (!validColor) {
          throw new HttpError('Invalid color selection', 400);
        }
      }

      if (product.sizeConfig && product.sizeConfig.hasSizes && sizeValue) {
        const validSize = product.sizeConfig.availableSizes.some(
          size => size.value === sizeValue
        );
        if (!validSize) {
          throw new HttpError('Invalid size selection', 400);
        }
      }
    }

    if (product.trackQuantity !== false && !product.allowBackorder) {
      if (availableQuantity < quantity) {
        throw new HttpError(`Insufficient stock. Available: ${availableQuantity}, Requested: ${quantity}`, 400);
      }
    }

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
   * GET /api/cart/items - Get user's cart
   */
  static getCart = asyncHandler(async (req, res) => {
    const userId = req.user?._id || null;
    let sessionId = req.cookies?.cartSessionId;
    
    if (!sessionId && req.headers['x-cart-session-id']) {
      sessionId = req.headers['x-cart-session-id'];
      console.log('📦 Using session ID from header:', sessionId);
    }

    console.log('🔍 Getting cart for:', { userId, sessionId });

    const cart = await CartController.getOrCreateCart(userId, sessionId, false);
    
    console.log('📦 Cart found:', cart ? {
      _id: cart._id,
      userId: cart.user,
      sessionId: cart.sessionId,
      itemCount: cart.items?.length || 0
    } : 'No cart found');
    
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
          lastUpdated: new Date().toISOString()
        },
        message: 'Cart retrieved successfully'
      });
    }
    
    const formattedCart = CartController.formatCart(cart);
    
    if (formattedCart.lastUpdated instanceof Date) {
      formattedCart.lastUpdated = formattedCart.lastUpdated.toISOString();
    }
    
    res.status(200).json({
      success: true,
      data: {
        ...formattedCart,
        sessionId: sessionId
      },
      message: 'Cart retrieved successfully'
    });
  });

  /**
   * POST /api/cart/add-item - Add item to cart
   */
  static addToCart = asyncHandler(async (req, res) => {
    const { productId, selectedColor, selectedSize, quantity = 1 } = req.body;
    const userId = req.user?._id || null;
    let sessionId = req.cookies?.cartSessionId;
    
    if (!sessionId && req.headers['x-cart-session-id']) {
      sessionId = req.headers['x-cart-session-id'];
      console.log('📦 Using session ID from header for add:', sessionId);
    }

    if (!productId) {
      throw new HttpError('Product ID is required', 400);
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new HttpError('Invalid product ID', 400);
    }

    if (!sessionId && !userId) {
      sessionId = CartController.generateSessionId();
      CartController.setCartCookie(res, sessionId);
      console.log('🆕 Generated new session ID:', sessionId);
    }

    const { colorValue, sizeValue } = CartController.extractSelectionValues(selectedColor, selectedSize);

    const product = await CartController.validateProduct(
      productId, colorValue, sizeValue, quantity
    );

    const cart = await CartController.getOrCreateCart(userId, sessionId, true);
    
    if (!cart) {
      throw new HttpError('Unable to create or retrieve cart', 500);
    }

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
        sessionId: sessionId
      },
      message: 'Item added to cart successfully'
    });
  });

  /**
   * PUT /api/cart/update-item/:itemId - Update cart item quantity
   */
  static updateCartItem = asyncHandler(async (req, res) => {
    const { itemId } = req.params;
    const { quantity } = req.body;
    const userId = req.user?._id || null;
    let sessionId = req.cookies?.cartSessionId;
    
    if (!sessionId && req.headers['x-cart-session-id']) {
      sessionId = req.headers['x-cart-session-id'];
    }

    if (!quantity || quantity < 1) {
      throw new HttpError('Valid quantity is required (minimum 1)', 400);
    }

    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      throw new HttpError('Invalid cart item ID', 400);
    }

    const cart = await CartController.getOrCreateCart(userId, sessionId, true);
    
    if (!cart || !cart.items || cart.items.length === 0) {
      throw new HttpError('Cart is empty', 404);
    }

    const itemIndex = cart.items.findIndex(item => item._id.toString() === itemId);

    if (itemIndex === -1) {
      throw new HttpError('Cart item not found', 404);
    }

    const cartItem = cart.items[itemIndex];

    await CartController.validateProduct(
      cartItem.product._id.toString(),
      cartItem.selectedColor,
      cartItem.selectedSize,
      quantity
    );

    cart.items[itemIndex].quantity = quantity;
    cart.items[itemIndex].addedAt = new Date();
    cart.lastUpdated = new Date();
    await cart.save();
   
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
    const userId = req.user?._id || null;
    let sessionId = req.cookies?.cartSessionId;
    
    if (!sessionId && req.headers['x-cart-session-id']) {
      sessionId = req.headers['x-cart-session-id'];
      console.log('📦 Using session ID from header for remove:', sessionId);
    }

    console.log('🗑️ Attempting to remove item:', { itemId, userId, sessionId });

    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      throw new HttpError('Invalid cart item ID format', 400);
    }

    const cart = await CartController.getOrCreateCart(userId, sessionId, false);
    
    if (!cart) {
      console.log('❌ No cart found');
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    console.log('📦 Cart found with items:', cart.items.map(i => ({
      _id: i._id.toString(),
      productId: i.product?._id?.toString()
    })));

    const itemIndex = cart.items.findIndex(item => 
      item._id.toString() === itemId
    );

    if (itemIndex === -1) {
      console.log('❌ Item not found in cart. Available IDs:', cart.items.map(i => i._id.toString()));
      throw new HttpError('Cart item not found', 404);
    }

    const removedItem = cart.items[itemIndex];
    cart.items.splice(itemIndex, 1);
    cart.lastUpdated = new Date();
    
    await cart.save();
    console.log('✅ Item removed successfully:', {
      removedItemId: removedItem._id,
      remainingItems: cart.items.length
    });
   
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
    const userId = req.user?._id || null;
    let sessionId = req.cookies?.cartSessionId;
    
    if (!sessionId && req.headers['x-cart-session-id']) {
      sessionId = req.headers['x-cart-session-id'];
    }

    const cart = await CartController.getOrCreateCart(userId, sessionId, true);
    
    if (!cart) {
      return res.status(200).json({
        success: true,
        data: {
          items: [],
          itemCount: 0,
          subtotal: 0,
          discountAmount: 0,
          discountedTotal: 0,
          coupon: null,
          lastUpdated: new Date().toISOString()
        },
        message: 'Cart is already empty'
      });
    }
   
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
   * GET /api/cart/count - Get cart count
   */
  static getCartCount = asyncHandler(async (req, res) => {
    const userId = req.user?._id;
    let sessionId = req.cookies?.cartSessionId;
    
    if (!sessionId && req.headers['x-cart-session-id']) {
      sessionId = req.headers['x-cart-session-id'];
    }

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
   * POST /api/cart/apply-coupon - Apply coupon to cart
   */
  static applyCoupon = asyncHandler(async (req, res) => {
    const { couponCode } = req.body;
    const userId = req.user?._id || null;
    let sessionId = req.cookies?.cartSessionId;
    
    if (!sessionId && req.headers['x-cart-session-id']) {
      sessionId = req.headers['x-cart-session-id'];
    }

    if (!couponCode) {
      throw new HttpError('Coupon code is required', 400);
    }

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

    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      throw new HttpError('Coupon usage limit exceeded', 400);
    }

    const cart = await CartController.getOrCreateCart(userId, sessionId, true);

    if (cart.items.length === 0) {
      throw new HttpError('Cannot apply coupon to empty cart', 400);
    }

    const subtotal = cart.items.reduce((total, item) => {
      return total + (item.price * item.quantity);
    }, 0);

    if (coupon.minimumCartValue && subtotal < coupon.minimumCartValue) {
      throw new HttpError(
        `Minimum cart value of $${coupon.minimumCartValue} required for this coupon`,
        400
      );
    }

    cart.coupon = {
      code: coupon.code,
      discount: coupon.discountValue,
      discountType: coupon.discountType,
      appliedAt: new Date()
    };

    cart.lastUpdated = new Date();
    await cart.save();
   
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
    const userId = req.user?._id || null;
    let sessionId = req.cookies?.cartSessionId;
    
    if (!sessionId && req.headers['x-cart-session-id']) {
      sessionId = req.headers['x-cart-session-id'];
    }

    const cart = await CartController.getOrCreateCart(userId, sessionId, true);

    if (!cart.coupon) {
      throw new HttpError('No coupon applied to cart', 400);
    }

    cart.coupon = undefined;
    cart.lastUpdated = new Date();
    await cart.save();
   
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
    const userId = req.user?._id || null;
    let sessionId = req.cookies?.cartSessionId;
    
    if (!sessionId && req.headers['x-cart-session-id']) {
      sessionId = req.headers['x-cart-session-id'];
    }

    const cart = await CartController.getOrCreateCart(userId, sessionId, false);
    
    if (!cart) {
      return res.status(200).json({
        success: true,
        data: {
          itemCount: 0,
          subtotal: 0,
          totalPrice: 0,
          discountAmount: 0,
          discountedTotal: 0,
          items: [],
          coupon: null,
          savings: 0,
          shippingEstimate: 0,
          taxEstimate: 0
        },
        message: 'Cart summary retrieved successfully'
      });
    }
    
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
   * GET /api/cart/check-product - Check if product is in cart
   */
  static checkProductInCart = asyncHandler(async (req, res) => {
    const { productId, selectedColor, selectedSize } = req.query;
    const userId = req.user?._id;
    let sessionId = req.cookies?.cartSessionId;
    
    if (!sessionId && req.headers['x-cart-session-id']) {
      sessionId = req.headers['x-cart-session-id'];
    }

    if (!productId) {
      throw new HttpError('Product ID is required', 400);
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new HttpError('Invalid product ID', 400);
    }

    const { colorValue, sizeValue } = CartController.extractSelectionValues(selectedColor, selectedSize);

    const cart = await CartController.getOrCreateCart(userId, sessionId, false);
    
    if (!cart) {
      return res.status(200).json({
        success: true,
        data: {
          isInCart: false,
          quantity: 0,
          cartItemId: null
        },
        message: 'Product cart status retrieved successfully'
      });
    }
   
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
   * GET /api/cart/validate - Validate cart before checkout
   */
  static validateCart = asyncHandler(async (req, res) => {
    const userId = req.user?._id || null;
    let sessionId = req.cookies?.cartSessionId;
    
    if (!sessionId && req.headers['x-cart-session-id']) {
      sessionId = req.headers['x-cart-session-id'];
    }

    const cart = await CartController.getOrCreateCart(userId, sessionId, false);
    
    if (!cart) {
      return res.status(200).json({
        success: true,
        data: {
          isValid: false,
          errors: ['Cart is empty'],
          warnings: [],
          updatedItems: []
        },
        message: 'Cart validation completed'
      });
    }
   
    const validationResults = {
      isValid: true,
      errors: [],
      warnings: [],
      updatedItems: []
    };

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

    for (const item of cart.items) {
      try {
        const validatedProduct = await CartController.validateProduct(
          item.product._id.toString(),
          item.selectedColor,
          item.selectedSize,
          item.quantity
        );

        if (validatedProduct.price !== item.price) {
          validationResults.warnings.push(
            `Price has changed for "${item.product?.name || 'Unknown'}". Old price: $${item.price}, New price: $${validatedProduct.price}`
          );
          item.price = validatedProduct.price;
          validationResults.updatedItems.push(item.product?.name || 'Unknown');
          needsSave = true;
        }

        if (userId && !item.user) {
          item.user = userId;
          needsSave = true;
        }
      } catch (error) {
        validationResults.isValid = false;
        validationResults.errors.push(`Validation failed for "${item.product?.name || 'Unknown'}": ${error.message}`);
      }
    }

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
   * GET /api/cart/checkout-details - Get cart details for checkout
   */
  static getCheckoutDetails = asyncHandler(async (req, res) => {
    const userId = req.user?._id || null;
    let sessionId = req.cookies?.cartSessionId;
    
    if (!sessionId && req.headers['x-cart-session-id']) {
      sessionId = req.headers['x-cart-session-id'];
    }

    const cart = await CartController.getOrCreateCart(userId, sessionId, false);
   
    if (!cart || cart.items.length === 0) {
      throw new HttpError('Cart is empty', 400);
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
    const userId = req.user?._id || null;
    let sessionId = req.cookies?.cartSessionId;
    
    if (!sessionId && req.headers['x-cart-session-id']) {
      sessionId = req.headers['x-cart-session-id'];
    }

    if (!updates || !Array.isArray(updates)) {
      throw new HttpError('Updates array is required', 400);
    }

    const cart = await CartController.getOrCreateCart(userId, sessionId, true);
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
        await CartController.validateProduct(
          cartItem.product._id.toString(),
          cartItem.selectedColor,
          cartItem.selectedSize,
          quantity
        );

        cart.items[itemIndex].quantity = quantity;
        cart.items[itemIndex].addedAt = new Date();
       
        if (userId && !cart.items[itemIndex].user) {
          cart.items[itemIndex].user = userId;
        }
       
        needsSave = true;
      } catch (error) {
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
   * POST /api/cart/migrate - Migrate cart from session to user (for login)
   */
  static migrateCart = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    let sessionId = req.cookies?.cartSessionId;
    
    if (!sessionId && req.headers['x-cart-session-id']) {
      sessionId = req.headers['x-cart-session-id'];
    }

    if (!userId) {
      throw new HttpError('User must be logged in to migrate cart', 401);
    }

    if (!sessionId) {
      throw new HttpError('No session cart found to migrate', 400);
    }

    const cart = await CartController.mergeCarts(userId, sessionId);
   
    res.clearCookie('cartSessionId');
   
    const formattedCart = CartController.formatCart(cart);

    res.status(200).json({
      success: true,
      data: formattedCart,
      message: 'Cart migrated successfully'
    });
  });

  /**
   * POST /api/cart/sync - Sync session cart with user cart
   */
  static syncCarts = asyncHandler(async (req, res) => {
    const userId = req.user?._id;
    let sessionId = req.cookies?.cartSessionId;
    
    if (!sessionId && req.headers['x-cart-session-id']) {
      sessionId = req.headers['x-cart-session-id'];
    }

    if (!userId) {
      throw new HttpError('Authentication required', 401);
    }

    if (!sessionId) {
      const cart = await CartController.getOrCreateCart(userId, null, false);
      const formattedCart = cart ? CartController.formatCart(cart) : {
        items: [],
        itemCount: 0,
        subtotal: 0,
        discountAmount: 0,
        discountedTotal: 0,
        coupon: null
      };
     
      return res.status(200).json({
        success: true,
        data: formattedCart,
        message: 'Cart synced successfully'
      });
    }

    const cart = await CartController.mergeCarts(userId, sessionId);
   
    res.clearCookie('cartSessionId');
   
    const formattedCart = CartController.formatCart(cart);

    res.status(200).json({
      success: true,
      data: formattedCart,
      message: 'Cart synced successfully'
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
        guestCart.user = userId;
        guestCart.sessionId = undefined;
        await guestCart.save();
        return guestCart;
      }

      for (const guestItem of guestCart.items) {
        const existingItemIndex = userCart.items.findIndex(item =>
          item.product._id.toString() === guestItem.product._id.toString() &&
          item.selectedColor === guestItem.selectedColor &&
          item.selectedSize === guestItem.selectedSize
        );

        if (existingItemIndex > -1) {
          userCart.items[existingItemIndex].quantity += guestItem.quantity;
          userCart.items[existingItemIndex].addedAt = new Date();
        } else {
          const newItem = {
            ...guestItem.toObject(),
            addedAt: new Date()
          };
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

      await Cart.findByIdAndDelete(guestCart._id);

      return userCart;
    } catch (error) {
      console.error('❌ Merge carts error:', error);
      throw new HttpError(`Failed to merge carts: ${error.message}`, 500);
    }
  }

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
          if (item.selectedColor && typeof item.selectedColor === 'object') {
            item.selectedColor = item.selectedColor.value || item.selectedColor.hexCode || null;
            needsUpdate = true;
          }
         
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
   * Debug endpoint - Get all carts (development only)
   */
  static debugCart = asyncHandler(async (req, res) => {
    const userId = req.user?._id || null;
    let sessionId = req.cookies?.cartSessionId;
    
    if (!sessionId && req.headers['x-cart-session-id']) {
      sessionId = req.headers['x-cart-session-id'];
    }

    const userCart = userId ? await Cart.findOne({ user: userId }) : null;
    const sessionCart = sessionId ? await Cart.findOne({ sessionId }) : null;
    const allCarts = await Cart.find({}).limit(10);
    
    res.status(200).json({
      success: true,
      data: {
        requestInfo: {
          userId,
          sessionId,
          cookies: req.cookies,
          headers: {
            'x-cart-session-id': req.headers['x-cart-session-id']
          }
        },
        carts: {
          userCart: userCart ? {
            _id: userCart._id,
            user: userCart.user,
            sessionId: userCart.sessionId,
            itemCount: userCart.items?.length || 0,
            items: userCart.items?.map(i => ({
              _id: i._id,
              productId: i.product,
              quantity: i.quantity
            }))
          } : null,
          sessionCart: sessionCart ? {
            _id: sessionCart._id,
            user: sessionCart.user,
            sessionId: sessionCart.sessionId,
            itemCount: sessionCart.items?.length || 0,
            items: sessionCart.items?.map(i => ({
              _id: i._id,
              productId: i.product,
              quantity: i.quantity
            }))
          } : null
        },
        allCarts: allCarts.map(c => ({
          _id: c._id,
          user: c.user,
          sessionId: c.sessionId,
          itemCount: c.items?.length || 0,
          lastUpdated: c.lastUpdated
        }))
      }
    });
  });
}

module.exports = CartController;
