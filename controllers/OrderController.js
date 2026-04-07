// controllers/orderController.js
const asyncHandler = require("express-async-handler");
const HttpError = require('../middleware/HttpError');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { emailService } = require('../services/service-email');

class OrderController {

  // @desc    Validate order data and calculate totals (without creating order)
  // @route   POST /api/orders/validate
  // @access  Private
  static validateOrder = asyncHandler(async (req, res) => {
    const {
      items,
      shippingAddress,
      shippingMethod,
      paymentMethod
    } = req.body;

    const userId = req.user._id;

    console.log('🟢 OrderController.validateOrder called:', {
      userId,
      itemCount: items?.length || 0,
      paymentMethod,
      shippingMethod
    });

    // Validate required fields
    if (!items || items.length === 0) {
      throw new HttpError('Order items are required', 400);
    }

    if (!shippingAddress) {
      throw new HttpError('Shipping address is required', 400);
    }

    if (!shippingMethod) {
      throw new HttpError('Shipping method is required', 400);
    }

    if (!paymentMethod) {
      throw new HttpError('Payment method is required', 400);
    }

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      throw new HttpError('User not found', 404);
    }

    // Validate and calculate order items
    let subtotal = 0;
    const orderItems = [];
    const stockReservations = [];

    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product) {
        throw new HttpError(`Product not found: ${item.productId}`, 404);
      }

      // Find the specific variant based on color and size
      let variant = null;
      let variantQuantity = 0;
      let variantPrice = 0;

      // Check if product has colors
      if (product.colors.hasColors) {
        // Find the variant matching color and size
        variant = product.variants.find(v => {
          const colorMatch = v.color && v.color.value === item.colorValue;
          const sizeMatch = v.size && v.size.value === item.sizeValue;
          return colorMatch && sizeMatch;
        });

        if (!variant) {
          throw new HttpError(`Variant not found for product: ${product.name} with color ${item.colorValue} and size ${item.sizeValue}`, 404);
        }

        variantQuantity = variant.quantity || 0;
        variantPrice = variant.price || product.colors.availableColors.find(c => c.value === item.colorValue)?.price || 0;

        // Check variant stock
        if (variantQuantity < item.quantity) {
          throw new HttpError(`Insufficient stock for variant: ${product.name} (${item.colorValue}, ${item.sizeValue})`, 400);
        }
      } else {
        // For products without colors/variants
        if (product.quantity < item.quantity) {
          throw new HttpError(`Insufficient stock for product: ${product.name}`, 400);
        }
        variantPrice = product.price || 0;
      }

      const itemTotal = Number((variantPrice * item.quantity).toFixed(2));
      subtotal = Number((subtotal + itemTotal).toFixed(2));

      orderItems.push({
        product: item.productId,
        variant: {
          colorValue: item.colorValue,
          sizeValue: item.sizeValue,
          price: variantPrice
        },
        quantity: item.quantity,
        price: variantPrice,
        total: itemTotal
      });

      // Store stock reservation info
      stockReservations.push({
        productId: item.productId,
        productName: product.name,
        colorValue: item.colorValue,
        sizeValue: item.sizeValue,
        variant,
        quantity: item.quantity,
        hasColors: product.colors.hasColors
      });
    }

    // Calculate totals
    const taxRate = 0.08; // 8%
    const tax = Number((subtotal * taxRate).toFixed(2));
    const shipping = shippingMethod === 'standard' ? 10.00 :
      shippingMethod === 'express' ? 20.00 :
        shippingMethod === 'overnight' ? 40.00 : 10.00;
    const discount = 0; // No discount for now
    const total = Number((subtotal + tax + shipping - discount).toFixed(2));

    console.log('🟢 Order validation completed:', {
      subtotal: subtotal.toFixed(2),
      tax: tax.toFixed(2),
      shipping: shipping.toFixed(2),
      discount: discount.toFixed(2),
      total: total.toFixed(2),
      totalInCents: Math.round(total * 100),
      itemCount: orderItems.length,
      requiresPayment: ['stripe', 'credit_card', 'klarna', 'afterpay'].includes(paymentMethod)
    });

    res.json({
      success: true,
      orderData: {
        items: orderItems,
        subtotal,
        tax,
        shipping,
        discount,
        total,
        shippingAddress,
        shippingMethod,
        paymentMethod,
        stockReservations,
        calculatedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes expiry
      },
      message: 'Order validated successfully'
    });
  });


  static createPaymentIntent = asyncHandler(async (req, res) => {
    const {
      orderData,
      billingAddress,
      paymentMethod = 'stripe',
      useSavedCard = false,
      savedPaymentMethodId = null
    } = req.body;

    const userId = req.user._id;

    console.log('🟢 OrderController.createPaymentIntent called:', {
      userId,
      paymentMethod,
      orderTotal: orderData?.total,
      hasOrderData: !!orderData,
      useSavedCard,
      hasSavedPaymentMethodId: !!savedPaymentMethodId
    });

    // Validate required fields
    if (!orderData) {
      throw new HttpError('Order data is required', 400);
    }

    if (!orderData.total || orderData.total <= 0) {
      throw new HttpError('Valid order total is required', 400);
    }

    // Check if order data is still valid (not expired)
    if (new Date(orderData.expiresAt) < new Date()) {
      throw new HttpError('Order data has expired. Please restart checkout.', 400);
    }

    // Get user with stripeCustomerId
    const user = await User.findById(userId).select('+stripeCustomerId');
    if (!user) {
      throw new HttpError('User not found', 404);
    }

    // Calculate amount in cents
    const amountInCents = Math.round(orderData.total * 100);

    console.log('🟢 Creating payment intent with:', {
      amountInCents,
      paymentMethod,
      userId: user._id,
      userEmail: user.email,
      orderSubtotal: orderData.subtotal,
      orderShipping: orderData.shipping,
      orderTax: orderData.tax,
      useSavedCard,
      savedPaymentMethodId,
      hasStripeCustomerId: !!user.stripeCustomerId
    });

    // Prepare base payment intent parameters
    const paymentIntentParams = {
      amount: amountInCents,
      currency: 'usd',
      metadata: {
        userId: userId.toString(),
        userEmail: user.email,
        userFirstName: user.firstName,
        userLastName: user.lastName,
        source: 'order_checkout',
        paymentMethod: paymentMethod,
        orderTotal: orderData.total.toFixed(2),
        orderSubtotal: orderData.subtotal.toFixed(2),
        orderTax: orderData.tax.toFixed(2),
        orderShipping: orderData.shipping.toFixed(2),
        orderDataHash: this.generateOrderHash(orderData),
        useSavedCard: useSavedCard.toString()
      },
      capture_method: 'automatic'
    };

    // CRITICAL: Handle saved card payment with defensive programming
    if (useSavedCard && savedPaymentMethodId) {
      console.log('💰 Processing saved card payment...');

      // DEFENSIVE PROGRAMMING: Ensure user has Stripe Customer ID
      if (!user.stripeCustomerId) {
        console.log('⚠️ User has saved card but no stripeCustomerId. Attempting to fix automatically...');

        try {
          // Try to retrieve the payment method to get customer info
          const paymentMethod = await stripe.paymentMethods.retrieve(savedPaymentMethodId);
          console.log('📇 Retrieved payment method:', {
            id: paymentMethod.id,
            type: paymentMethod.type,
            hasCustomer: !!paymentMethod.customer
          });

          // Check if payment method is already attached to a customer
          if (paymentMethod.customer) {
            // Use the existing customer ID from the payment method
            user.stripeCustomerId = paymentMethod.customer;
            await user.save();
            console.log('✅ Found and saved existing Stripe Customer ID:', user.stripeCustomerId);
          } else {
            // Create a new Stripe Customer
            console.log('🆕 Creating new Stripe Customer...');
            const customer = await stripe.customers.create({
              email: user.email,
              name: `${user.firstName} ${user.lastName}`,
              phone: user.phone,
              metadata: {
                userId: user._id.toString(),
                userEmail: user.email,
                userPhone: user.phone || '',
                createdVia: 'checkout_fallback'
              }
            });

            // Attach the payment method to the new customer
            await stripe.paymentMethods.attach(savedPaymentMethodId, {
              customer: customer.id
            });

            user.stripeCustomerId = customer.id;
            await user.save();
            console.log('✅ Created and attached new Stripe Customer:', customer.id);
          }

          // If this card is marked as default in our system, update Stripe
          const card = user.paymentCards.find(c => c.stripePaymentMethodId === savedPaymentMethodId);
          if (card && card.isDefault) {
            await stripe.customers.update(user.stripeCustomerId, {
              invoice_settings: {
                default_payment_method: savedPaymentMethodId
              }
            });
            console.log('✅ Updated default payment method in Stripe');
          }

        } catch (fixError) {
          console.error('❌ Failed to fix missing Stripe Customer:', fixError);
          throw new HttpError(
            'Unable to process saved payment. Please try removing and re-adding your payment method.',
            400
          );
        }
      }

      // Verify we now have a Stripe Customer ID
      if (!user.stripeCustomerId) {
        throw new HttpError('Unable to set up payment. Please try adding your payment method again.', 400);
      }

      console.log('💰 Using saved payment method:', {
        paymentMethodId: savedPaymentMethodId,
        customerId: user.stripeCustomerId,
        confirm: true,
        off_session: true
      });

      // Set up the payment intent for saved card
      paymentIntentParams.customer = user.stripeCustomerId;
      paymentIntentParams.payment_method = savedPaymentMethodId;
      paymentIntentParams.confirm = true;
      paymentIntentParams.off_session = true;
      paymentIntentParams.confirmation_method = 'automatic';
    }
    else {
      // For new cards, enable automatic payment methods
      console.log('💳 Setting up new card payment...');
      paymentIntentParams.automatic_payment_methods = {
        enabled: true,
        allow_redirects: 'always'
      };

      // Add customer ID if exists (for attaching payment method later)
      if (user.stripeCustomerId) {
        paymentIntentParams.customer = user.stripeCustomerId;
        console.log('📎 Will attach new card to existing customer:', user.stripeCustomerId);
      }
    }

    // Add shipping address if provided
    if (orderData.shippingAddress) {
      paymentIntentParams.shipping = {
        name: `${orderData.shippingAddress.firstName} ${orderData.shippingAddress.lastName}`,
        address: {
          line1: orderData.shippingAddress.street,
          line2: orderData.shippingAddress.apartment || '',
          city: orderData.shippingAddress.city,
          state: orderData.shippingAddress.state,
          postal_code: orderData.shippingAddress.zipCode,
          country: orderData.shippingAddress.country
        },
        phone: orderData.shippingAddress.phone
      };
    }

    // Validate amount for specific payment methods (only for new cards)
    if (!useSavedCard) {
      const MIN_KLARNA_AMOUNT = 50;
      const MIN_AFTERPAY_AMOUNT = 100;
      const MAX_AFTERPAY_AMOUNT = 200000;

      if (paymentMethod === 'klarna' && amountInCents < MIN_KLARNA_AMOUNT) {
        throw new HttpError('Amount too low for Klarna. Minimum is $0.50.', 400);
      }

      if (paymentMethod === 'afterpay' && (amountInCents < MIN_AFTERPAY_AMOUNT || amountInCents > MAX_AFTERPAY_AMOUNT)) {
        throw new HttpError(`Afterpay amount must be between $${(MIN_AFTERPAY_AMOUNT / 100).toFixed(2)} and $${(MAX_AFTERPAY_AMOUNT / 100).toFixed(2)}`, 400);
      }
    }

    try {
      // Create payment intent
      const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

      console.log('✅ Payment intent created successfully:', {
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        clientSecret: paymentIntent.client_secret ? 'present' : 'missing',
        paymentMethodTypes: paymentIntent.payment_method_types,
        amount: paymentIntent.amount,
        amountInDollars: (paymentIntent.amount / 100).toFixed(2),
        isSavedCardPayment: useSavedCard,
        customer: paymentIntent.customer,
        paymentMethod: paymentIntent.payment_method
      });

      // For saved cards, check if payment succeeded or requires action
      if (useSavedCard && savedPaymentMethodId) {
        if (paymentIntent.status === 'succeeded') {
          console.log('✅ Saved card payment succeeded immediately');
        }
        else if (paymentIntent.status === 'requires_action') {
          console.log('⚠️ Saved card requires additional action (3D Secure)');
          // Return client secret so frontend can handle 3D Secure
          return res.json({
            success: true,
            paymentIntent: {
              id: paymentIntent.id,
              clientSecret: paymentIntent.client_secret,
              status: paymentIntent.status,
              amount: paymentIntent.amount,
              currency: paymentIntent.currency
            },
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            requiresAction: true,
            paymentData: {
              paymentIntentId: paymentIntent.id,
              clientSecret: paymentIntent.client_secret,
              amount: paymentIntent.amount,
              currency: paymentIntent.currency,
              status: paymentIntent.status,
              orderData: orderData,
              billingAddress: billingAddress,
              createdAt: new Date(),
              userId: userId.toString(),
              useSavedCard: useSavedCard
            },
            message: 'Payment requires additional authentication'
          });
        }
      }

      // Store payment intent data temporarily
      const paymentData = {
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        status: paymentIntent.status,
        orderData: orderData,
        billingAddress: billingAddress,
        createdAt: new Date(),
        userId: userId.toString(),
        useSavedCard: useSavedCard
      };

      res.json({
        success: true,
        paymentIntent: {
          id: paymentIntent.id,
          clientSecret: paymentIntent.client_secret,
          status: paymentIntent.status,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency
        },
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        paymentData,
        message: useSavedCard ? 'Saved card payment initiated successfully' : 'Payment intent created successfully'
      });

    } catch (error) {
      console.error('❌ Error creating payment intent:', {
        message: error.message,
        type: error.type,
        code: error.code,
        param: error.param,
        stack: error.stack
      });

      let errorMessage = `Payment setup failed: ${error.message}`;
      let statusCode = 500;

      if (error.type === 'StripeCardError') {
        errorMessage = error.message;
        statusCode = 400;
      }
      else if (error.type === 'StripeInvalidRequestError') {
        if (error.message.includes('automatic_payment_methods') && error.message.includes('payment_method_types')) {
          errorMessage = 'Payment configuration error. Please contact support.';
          statusCode = 400;
        }
        else if (error.message.includes('payment method provided')) {
          errorMessage = 'The saved payment method is invalid or expired. Please add a new card.';
          statusCode = 400;
        }
        else if (error.message.includes('customer')) {
          errorMessage = 'Payment setup issue. Please try removing and re-adding your payment method.';
          statusCode = 400;
        }
        else {
          errorMessage = 'Invalid payment request. Please check the amount and try again.';
          statusCode = 400;
        }
      }
      else if (error.code === 'parameter_unknown') {
        if (error.param && error.param.includes('payment_method_types')) {
          errorMessage = `This payment method (${paymentMethod}) is not enabled in your Stripe account. Please enable it in Stripe dashboard under "Payment Methods" settings.`;
          statusCode = 400;
        }
      }
      else if (error.code === 'payment_method_not_available') {
        errorMessage = `This payment method is not available in your region or for your currency.`;
        statusCode = 400;
      }
      else if (error.code === 'payment_method_unexpected_state') {
        errorMessage = 'The saved payment method is not in a valid state. Please try adding the card again.';
        statusCode = 400;
      }

      throw new HttpError(errorMessage, statusCode);
    }
  });

  // Helper function to generate order hash for validation
  static generateOrderHash(orderData) {
    const crypto = require('crypto');
    const data = `${orderData.subtotal}|${orderData.shipping}|${orderData.tax}|${orderData.total}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }


  static verifyPayment = async (req, res) => {
    try {
      const { paymentIntentId, userId } = req.body;

      console.log('🔄 Verifying payment:', { paymentIntentId, userId });

      if (!paymentIntentId) {
        return res.status(400).json({
          success: false,
          error: 'Payment intent ID is required'
        });
      }

      // Verify with Stripe
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

      if (!paymentIntent) {
        return res.status(404).json({
          success: false,
          error: 'Payment intent not found'
        });
      }

      console.log('✅ Payment intent status:', paymentIntent.status);

      // Check if order already exists
      let order = await Order.findOne({
        'paymentDetails.stripe.paymentIntentId': paymentIntentId
      }).populate('customer', 'firstName lastName email');

      return res.json({
        success: true,
        paymentIntent: {
          id: paymentIntent.id,
          status: paymentIntent.status,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          payment_method_types: paymentIntent.payment_method_types,
          metadata: paymentIntent.metadata,
          created: paymentIntent.created,
          last_payment_error: paymentIntent.last_payment_error
        },
        order: order ? order.formatOrder() : null,
        exists: !!order
      });

    } catch (error) {
      console.error('❌ Error verifying payment:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Failed to verify payment'
      });
    }
  };


  // In OrderController.js - Update createOrder method
  static createOrder = asyncHandler(async (req, res) => {
    const {
      paymentIntentId,
      paymentIntent,
      billingAddress,
      notes,
      orderDataHash
    } = req.body;

    const userId = req.user._id;

    console.log('🟢 OrderController.createOrder called:', {
      userId,
      paymentIntentId: paymentIntentId || paymentIntent?.paymentIntentId,
      hasPaymentIntent: !!paymentIntent,
      hasBillingAddress: !!billingAddress,
      orderDataHash
    });

    const finalPaymentIntentId = paymentIntentId || paymentIntent?.paymentIntentId;

    if (!finalPaymentIntentId) {
      throw new HttpError('Payment intent ID is required', 400);
    }

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      throw new HttpError('User not found', 404);
    }

    // Verify payment intent with Stripe
    let stripePaymentIntent;
    try {
      stripePaymentIntent = await stripe.paymentIntents.retrieve(finalPaymentIntentId);
      console.log('🟢 Retrieved payment intent:', {
        id: stripePaymentIntent.id,
        status: stripePaymentIntent.status,
        amount: stripePaymentIntent.amount,
        currency: stripePaymentIntent.currency,
        metadata: stripePaymentIntent.metadata
      });
    } catch (error) {
      console.error('❌ Error retrieving payment intent:', error);
      throw new HttpError(`Payment verification failed: ${error.message}`, 500);
    }

    // Check payment intent status
    if (stripePaymentIntent.status !== 'succeeded') {
      console.warn('⚠️ Payment intent not succeeded:', stripePaymentIntent.status);
      throw new HttpError(`Payment not completed. Status: ${stripePaymentIntent.status}`, 400);
    }

    // Verify payment intent belongs to user
    if (stripePaymentIntent.metadata.userId !== userId.toString()) {
      throw new HttpError('Payment intent does not belong to this user', 403);
    }

    // Extract order data from metadata
    let orderData;
    try {
      // Always try to get order data from metadata first
      if (stripePaymentIntent.metadata.orderItems) {
        console.log('✅ Using order data from metadata');
        orderData = {
          items: JSON.parse(stripePaymentIntent.metadata.orderItems || '[]'),
          subtotal: parseFloat(stripePaymentIntent.metadata.orderSubtotal || '0'),
          tax: parseFloat(stripePaymentIntent.metadata.orderTax || '0'),
          shipping: parseFloat(stripePaymentIntent.metadata.orderShipping || '0'),
          total: parseFloat(stripePaymentIntent.metadata.orderTotal || '0'),
          shippingAddress: JSON.parse(stripePaymentIntent.metadata.shippingAddress || '{}'),
          shippingMethod: stripePaymentIntent.metadata.shippingMethod || 'standard',
          paymentMethod: stripePaymentIntent.metadata.paymentMethod || 'stripe'
        };
        console.log('📦 Order items from metadata:', orderData.items);
      } else {
        // If no metadata, try to reconstruct from request body
        console.log('⚠️ No metadata found, checking request body');
        orderData = {
          items: req.body.items || [],
          subtotal: req.body.orderTotals?.subtotal || req.body.subtotal || 0,
          tax: req.body.orderTotals?.tax || req.body.tax || 0,
          shipping: req.body.orderTotals?.shipping || req.body.shipping || 0,
          total: req.body.orderTotals?.total || req.body.total || 0,
          shippingAddress: req.body.shippingAddress || {},
          shippingMethod: req.body.shippingMethod || 'standard',
          paymentMethod: req.body.paymentMethod || 'stripe'
        };
        console.log('📦 Order items from request body:', orderData.items);
      }
    } catch (error) {
      console.error('❌ Error parsing order data:', error);
      throw new HttpError('Invalid order data format', 400);
    }

    // Verify we have items
    if (!orderData.items || orderData.items.length === 0) {
      console.error('❌ No order items found');
      throw new HttpError('No order items provided', 400);
    }

    // Verify order data hash if provided
    if (orderDataHash && stripePaymentIntent.metadata.orderDataHash && orderDataHash !== stripePaymentIntent.metadata.orderDataHash) {
      console.warn('⚠️ Order data hash mismatch:', {
        provided: orderDataHash,
        stored: stripePaymentIntent.metadata.orderDataHash
      });
      // Continue anyway, but log the warning
    }

    // Re-validate stock availability and prepare order items
    const orderItems = [];
    for (const item of orderData.items) {
      const product = await Product.findById(item.productId || item.product);
      if (!product) {
        throw new HttpError(`Product no longer available: ${item.productId || item.product}`, 400);
      }

      const productId = item.productId || item.product;

      // Debug logging
      console.log('🔍 Checking product:', {
        productId: product._id,
        productName: product.name,
        itemColor: item.colorValue,
        itemSize: item.sizeValue,
        itemQuantity: item.quantity
      });

      if (item.colorValue && item.sizeValue) {
        // Check if product has color variants
        const hasColorVariants = product.colors?.hasColors;

        if (hasColorVariants) {
          // Find variant in the variants array
          const variant = product.variants.find(v =>
            v.color?.value === item.colorValue &&
            v.size?.value === item.sizeValue
          );

          if (!variant) {
            console.error('❌ Variant not found:', {
              color: item.colorValue,
              size: item.sizeValue,
              availableVariants: product.variants.map(v => ({
                color: v.color?.value,
                size: v.size?.value
              }))
            });
            throw new HttpError(`Variant no longer available for product: ${product.name}`, 400);
          }

          if (variant.quantity < item.quantity) {
            throw new HttpError(`Insufficient stock for ${product.name}. Available: ${variant.quantity}, Requested: ${item.quantity}`, 400);
          }

          console.log('✅ Variant found and validated:', {
            color: variant.color?.value,
            size: variant.size?.value,
            quantity: variant.quantity,
            price: variant.price
          });
        }
      } else if (item.sizeValue) {
        // Size-only variant
        const variant = product.variants.find(v =>
          v.size?.value === item.sizeValue
        );

        if (!variant) {
          throw new HttpError(`Size variant no longer available for product: ${product.name}`, 400);
        }

        if (variant.quantity < item.quantity) {
          throw new HttpError(`Insufficient stock for ${product.name}. Available: ${variant.quantity}, Requested: ${item.quantity}`, 400);
        }
      } else {
        // Simple product
        if (product.quantity < item.quantity) {
          throw new HttpError(`Insufficient stock for ${product.name}. Available: ${product.quantity}, Requested: ${item.quantity}`, 400);
        }
      }

      orderItems.push({
        product: productId,
        variant: item.colorValue || item.sizeValue ? {
          colorValue: item.colorValue,
          sizeValue: item.sizeValue
        } : undefined,
        quantity: item.quantity,
        price: item.price,
        total: item.price * item.quantity
      });
    }

    // Create order
    const order = new Order({
      customer: userId,
      items: orderItems,
      subtotal: Number(orderData.subtotal.toFixed(2)),
      tax: Number(orderData.tax.toFixed(2)),
      shipping: Number(orderData.shipping.toFixed(2)),
      discount: 0,
      total: Number(orderData.total.toFixed(2)),
      shippingAddress: orderData.shippingAddress,
      billingAddress: billingAddress?.billingSame ? orderData.shippingAddress : billingAddress,
      shippingMethod: orderData.shippingMethod,
      payment: {
        method: orderData.paymentMethod,
        status: 'completed',
        transactionId: finalPaymentIntentId,
        paymentIntentId: finalPaymentIntentId,
        paymentDate: new Date(),
        requiresPayment: true
      },
      status: 'confirmed',
      notes
    });

    try {
      // ✅ FIXED: Save the order first
      await order.save();
      console.log('✅ Order saved successfully:', order.orderNumber);

      // ✅ FIXED: Update product quantities WITHOUT transactions
      const updatePromises = [];

      for (const item of order.items) {
        const product = await Product.findById(item.product);

        if (!product) {
          console.error(`❌ Product not found for order item: ${item.product}`);
          continue;
        }

        console.log('📦 Updating product:', {
          productId: product._id,
          productName: product.name,
          itemVariant: item.variant,
          itemQuantity: item.quantity
        });

        const hasColorVariants = product.colors?.hasColors;
        let quantityUpdated = false;

        if (item.variant?.colorValue && item.variant?.sizeValue && hasColorVariants) {
          // Update in variants array
          const variantIndex = product.variants.findIndex(v =>
            v.color?.value === item.variant.colorValue &&
            v.size?.value === item.variant.sizeValue
          );

          if (variantIndex !== -1) {
            const oldQuantity = product.variants[variantIndex].quantity;
            const newQuantity = oldQuantity - item.quantity;
            product.variants[variantIndex].quantity = newQuantity > 0 ? newQuantity : 0;
            quantityUpdated = true;

            console.log('✅ Updated variant quantity:', {
              variantIndex,
              oldQuantity,
              newQuantity: product.variants[variantIndex].quantity,
              color: item.variant.colorValue,
              size: item.variant.sizeValue
            });
          }

          // Also update in colors.availableColors.quantityConfig.quantities
          const colorIndex = product.colors.availableColors.findIndex(
            color => color.value === item.variant.colorValue
          );

          if (colorIndex !== -1) {
            const quantityIndex = product.colors.availableColors[colorIndex]
              .quantityConfig.quantities.findIndex(
                q => q.size?.value === item.variant.sizeValue
              );

            if (quantityIndex !== -1) {
              const oldQuantity = product.colors.availableColors[colorIndex]
                .quantityConfig.quantities[quantityIndex].quantity;
              const newQuantity = oldQuantity - item.quantity;
              product.colors.availableColors[colorIndex]
                .quantityConfig.quantities[quantityIndex].quantity = newQuantity > 0 ? newQuantity : 0;

              // Recalculate color totals
              const colorTotal = product.colors.availableColors[colorIndex]
                .quantityConfig.quantities.reduce((sum, q) => sum + q.quantity, 0);

              product.colors.availableColors[colorIndex].quantityConfig.totalQuantity = colorTotal;
              product.colors.availableColors[colorIndex].quantityConfig.availableQuantity = colorTotal;
              product.colors.availableColors[colorIndex].quantityConfig.inStock = colorTotal > 0;
              product.colors.availableColors[colorIndex].quantityConfig.isLowStock =
                colorTotal > 0 && colorTotal <= product.colors.availableColors[colorIndex].quantityConfig.lowStockThreshold;

              console.log('✅ Updated color variant quantity:', {
                colorIndex,
                quantityIndex,
                oldQuantity,
                newQuantity: product.colors.availableColors[colorIndex].quantityConfig.quantities[quantityIndex].quantity,
                colorTotal
              });
            }
          }
        } else if (item.variant?.sizeValue && !hasColorVariants) {
          // Size-only variant
          const variantIndex = product.variants.findIndex(
            v => v.size?.value === item.variant.sizeValue
          );

          if (variantIndex !== -1) {
            const oldQuantity = product.variants[variantIndex].quantity;
            const newQuantity = oldQuantity - item.quantity;
            product.variants[variantIndex].quantity = newQuantity > 0 ? newQuantity : 0;
            quantityUpdated = true;

            console.log('✅ Updated size-only variant:', {
              variantIndex,
              oldQuantity,
              newQuantity: product.variants[variantIndex].quantity,
              size: item.variant.sizeValue
            });
          }
        } else {
          // Simple product without variants
          const oldQuantity = product.quantity;
          const newQuantity = oldQuantity - item.quantity;
          product.quantity = newQuantity > 0 ? newQuantity : 0;
          quantityUpdated = true;

          console.log('✅ Updated simple product quantity:', {
            oldQuantity,
            newQuantity: product.quantity
          });
        }

        // Update sales count
        product.salesCount += item.quantity;

        // Update overall product stock status
        if (product.variants && product.variants.length > 0) {
          // Calculate total quantity from all variants
          const totalQuantity = product.variants.reduce((sum, variant) => sum + (variant.quantity || 0), 0);
          product.quantity = totalQuantity;
          product.inStock = totalQuantity > 0;
          product.isLowStock = totalQuantity > 0 && totalQuantity <= product.lowStockThreshold;

          console.log('📊 Updated product totals:', {
            totalQuantity,
            inStock: product.inStock,
            isLowStock: product.isLowStock
          });
        } else {
          product.inStock = product.quantity > 0;
          product.isLowStock = product.quantity > 0 && product.quantity <= product.lowStockThreshold;
        }

        updatePromises.push(product.save());
      }

      // Save all product updates
      await Promise.all(updatePromises);
      console.log('✅ All product quantities updated successfully');

      // Send order confirmation email
      try {
        setImmediate(async () => {
          try {
            await emailService.sendPaymentConfirmation(
              user.email,
              user.firstName,
              order
            );
            console.log('✅ Order confirmation email sent (async)');
          } catch (emailError) {
            console.error('Failed to send payment confirmation email:', emailError);
            // Log to error tracking service (Sentry, etc.)
          }
        });
      } catch (emailError) {
        console.error('Failed to send payment confirmation email:', emailError);
        // Don't throw error - email failure shouldn't fail the order
      }

      res.status(201).json({
        success: true,
        order: {
          _id: order._id,
          orderNumber: order.orderNumber,
          total: order.total,
          status: order.status,
          payment: order.payment,
          formattedTotal: order.formattedTotal,
          formattedDate: order.formattedDate
        },
        message: 'Order created successfully'
      });

    } catch (error) {
      console.error('❌ Error creating order:', error);

      // If order was saved but product updates failed, try to delete the order
      if (order && order._id) {
        try {
          await Order.findByIdAndDelete(order._id);
          console.log('✅ Deleted order due to failure:', order.orderNumber);
        } catch (deleteError) {
          console.error('❌ Failed to delete order:', deleteError);
        }
      }

      // Refund payment
      try {
        await stripe.refunds.create({
          payment_intent: finalPaymentIntentId,
          reason: 'requested_by_customer'
        });
        console.log('✅ Payment refunded due to order creation failure');
      } catch (refundError) {
        console.error('❌ Failed to refund payment:', refundError);
      }

      throw new HttpError(`Failed to create order: ${error.message}`, 500);
    }
  });

  static confirmPayment = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const {
      paymentIntentId,
      paymentMethod = 'stripe'
    } = req.body;

    const userId = req.user._id;

    console.log('🟢 OrderController.confirmPayment called:', {
      orderId,
      paymentIntentId,
      paymentMethod,
      userId
    });

    if (!paymentIntentId) {
      throw new HttpError('Payment intent ID is required', 400);
    }

    // Find the order
    const order = await Order.findOne({
      _id: orderId,
      customer: userId
    });

    if (!order) {
      throw new HttpError('Order not found', 404);
    }

    // Check if order is already completed
    if (order.payment.status === 'completed') {
      console.log('⚠️ Payment already confirmed for order:', orderId);
      return res.json({
        success: true,
        order: order.formatOrder(),
        message: 'Payment already confirmed'
      });
    }

    // Verify payment intent with Stripe
    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      console.log('🟢 Retrieved payment intent:', {
        id: paymentIntent.id,
        status: paymentIntent.status,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        customer: paymentIntent.customer,
        paymentMethod: paymentIntent.payment_method,
        metadata: paymentIntent.metadata
      });
    } catch (error) {
      console.error('❌ Error retrieving payment intent:', error);
      throw new HttpError(`Payment verification failed: ${error.message}`, 500);
    }

    // Check payment intent status
    if (paymentIntent.status !== 'succeeded') {
      console.warn('⚠️ Payment intent not succeeded:', paymentIntent.status);

      // Check if payment is still processing
      if (paymentIntent.status === 'processing') {
        throw new HttpError('Payment is still processing. Please wait for confirmation.', 400);
      }

      // Check if payment requires additional action
      if (paymentIntent.status === 'requires_action' || paymentIntent.status === 'requires_confirmation') {
        throw new HttpError('Payment requires additional action. Please complete the payment process.', 400);
      }

      // Check if payment requires a payment method
      if (paymentIntent.status === 'requires_payment_method') {
        throw new HttpError('Payment method is required. Please provide a valid payment method.', 400);
      }

      throw new HttpError(`Payment not completed. Status: ${paymentIntent.status}`, 400);
    }

    // Verify payment intent belongs to user
    if (paymentIntent.metadata.userId !== userId.toString()) {
      throw new HttpError('Payment intent does not belong to this user', 403);
    }

    // Verify amount matches order total (allowing small rounding differences)
    const orderAmountInCents = Math.round(order.total * 100);
    const paymentAmountInCents = paymentIntent.amount;
    const amountDifference = Math.abs(orderAmountInCents - paymentAmountInCents);

    if (amountDifference > 1) {
      console.error('❌ Amount mismatch:', {
        orderAmountInCents,
        paymentAmountInCents,
        difference: amountDifference
      });
      throw new HttpError(`Payment amount ($${(paymentAmountInCents / 100).toFixed(2)}) does not match order total ($${order.total.toFixed(2)})`, 400);
    }

    // Start transaction for updating order and products
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Update product quantities and sales count
      for (const item of order.items) {
        const product = await Product.findById(item.product).session(session);

        if (!product) {
          throw new HttpError(`Product not found: ${item.product}`, 404);
        }

        // Update variant quantity
        if (item.variant && item.variant.colorValue && item.variant.sizeValue) {
          const variantIndex = product.variants.findIndex(v =>
            v.color && v.color.value === item.variant.colorValue &&
            v.size && v.size.value === item.variant.sizeValue
          );

          if (variantIndex !== -1) {
            const variant = product.variants[variantIndex];

            // Reduce quantity
            variant.quantity -= item.quantity;
            if (variant.quantity < 0) variant.quantity = 0;

            product.variants[variantIndex] = variant;
          }
        } else {
          // For simple products without variants
          product.quantity -= item.quantity;
          if (product.quantity < 0) product.quantity = 0;
        }

        // Update sales count
        product.salesCount += item.quantity;

        // Recalculate color quantities if product has colors
        if (product.colors && product.colors.hasColors) {
          product.updateColorQuantities();
        }

        await product.save({ session });
      }

      // Update order status
      order.payment.status = 'completed';
      order.payment.paymentDate = new Date();
      order.payment.transactionId = paymentIntentId;
      order.status = 'confirmed';

      // Update payment details
      if (!order.paymentDetails) {
        order.paymentDetails = {};
      }
      order.paymentDetails.stripe = {
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        paymentMethodTypes: paymentIntent.payment_method_types,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        lastConfirmed: new Date()
      };

      await order.save({ session });

      await session.commitTransaction();
      session.endSession();

      console.log('✅ Payment confirmed successfully for order:', {
        orderId: order._id,
        orderNumber: order.orderNumber,
        paymentStatus: order.payment.status,
        orderStatus: order.status
      });

      // Send payment confirmation email (optional)
      const user = await User.findById(userId);
      if (user) {
        try {
          // await emailService.sendPaymentConfirmation(user.email, user.firstName, order);
          console.log('📧 Payment confirmation email would be sent to:', user.email);
        } catch (emailError) {
          console.error('Failed to send payment confirmation email:', emailError);
        }
      }

      res.json({
        success: true,
        order: order.formatOrder(),
        message: 'Payment confirmed successfully'
      });

    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('❌ Failed to confirm payment:', error);

      if (error.name === 'ValidationError') {
        console.error('Validation error details:', error.errors);
      }

      throw new HttpError(`Failed to confirm payment: ${error.message}`, 500);
    }
  });

  // @desc    Check payment confirmation status
  // @route   GET /api/orders/:id/payment-status
  // @access  Private
  static checkPaymentStatus = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const userId = req.user._id;

    console.log('🟢 Checking payment status for order:', { orderId, userId });

    // Find the order
    const order = await Order.findOne({
      _id: orderId,
      customer: userId
    }).populate('items.product', 'name images');

    if (!order) {
      throw new HttpError('Order not found', 404);
    }

    // If payment is already completed, return the status
    if (order.payment.status === 'completed') {
      return res.json({
        success: true,
        paymentStatus: 'completed',
        orderStatus: order.status,
        order: order.formatOrder(),
        message: 'Payment already completed'
      });
    }

    // If there's a payment intent ID, check with Stripe
    if (order.payment.transactionId || order.payment.paymentIntentId) {
      const paymentIntentId = order.payment.transactionId || order.payment.paymentIntentId;

      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        console.log('🟢 Payment intent status:', {
          id: paymentIntent.id,
          status: paymentIntent.status,
          amount: paymentIntent.amount
        });

        // If payment is succeeded, update order status
        if (paymentIntent.status === 'succeeded' && order.payment.status !== 'completed') {
          console.log('🟢 Auto-confirming payment for order:', orderId);

          // Call confirmPayment internally
          req.body = { paymentIntentId: paymentIntent.id };
          await OrderController.confirmPayment(req, res);
          return;
        }

        res.json({
          success: true,
          paymentStatus: paymentIntent.status,
          orderStatus: order.status,
          stripeStatus: paymentIntent.status,
          lastPaymentError: paymentIntent.last_payment_error,
          order: order.formatOrder(),
          requiresAction: ['requires_action', 'requires_confirmation'].includes(paymentIntent.status)
        });

      } catch (error) {
        console.error('❌ Error checking payment intent:', error);

        res.json({
          success: true,
          paymentStatus: order.payment.status,
          orderStatus: order.status,
          stripeError: error.message,
          order: order.formatOrder()
        });
      }
    } else {
      // No payment intent found
      res.json({
        success: true,
        paymentStatus: order.payment.status,
        orderStatus: order.status,
        order: order.formatOrder(),
        message: 'No payment intent associated with this order'
      });
    }
  });

  // @desc    Handle failed payment
  // @route   POST /api/orders/:id/payment-failed
  // @access  Private
  static handlePaymentFailure = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const {
      paymentIntentId,
      errorMessage
    } = req.body;

    const userId = req.user._id;

    console.log('🔴 Handling payment failure for order:', {
      orderId,
      paymentIntentId,
      userId,
      errorMessage
    });

    // Find the order
    const order = await Order.findOne({
      _id: orderId,
      customer: userId
    });

    if (!order) {
      throw new HttpError('Order not found', 404);
    }

    // Check if payment is already completed
    if (order.payment.status === 'completed') {
      throw new HttpError('Payment is already completed for this order', 400);
    }

    // Update order status
    order.payment.status = 'failed';
    order.status = 'cancelled';
    order.cancellationReason = errorMessage || 'Payment failed';

    // Update payment details
    if (paymentIntentId && !order.paymentDetails?.stripe) {
      if (!order.paymentDetails) {
        order.paymentDetails = {};
      }
      order.paymentDetails.stripe = {
        paymentIntentId: paymentIntentId,
        status: 'failed',
        error: errorMessage,
        lastUpdated: new Date()
      };
    }

    await order.save();

    console.log('✅ Order marked as failed:', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      paymentStatus: order.payment.status,
      orderStatus: order.status
    });

    // Send payment failure email
    const user = await User.findById(userId);
    if (user) {
      try {
        setImmediate(async () => {

          await emailService.sendPaymentFailure(
            user?.email,
            user?.firstName,
            order,
            error.message
          );

        });
      } catch (emailError) {
        console.error('Failed to send payment failure email:', emailError);
      }
    }

    res.json({
      success: true,
      order: order.formatOrder(),
      message: 'Payment failure recorded'
    });
  });

  // @desc    Cancel order
  // @route   PUT /api/orders/:id/cancel
  // @access  Private
  static cancelOrder = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const { reason } = req.body;
    const userId = req.user._id;

    const order = await Order.findOne({ _id: orderId, customer: userId });
    if (!order) {
      throw new HttpError('Order not found', 404);
    }

    // Check if order can be cancelled
    if (!['pending', 'confirmed'].includes(order.status)) {
      throw new HttpError('Order cannot be cancelled at this stage', 400);
    }

    // If payment was made with Stripe, try to refund
    if (order.payment.status === 'completed' && order.payment.transactionId) {
      try {
        // Create a refund
        const refund = await stripe.refunds.create({
          payment_intent: order.payment.transactionId,
          reason: 'requested_by_customer'
        });

        console.log('🟢 Created Stripe refund:', {
          refundId: refund.id,
          status: refund.status,
          amount: refund.amount
        });

        // Update order status
        order.status = 'refunded';
        order.payment.status = 'refunded';

      } catch (refundError) {
        console.error('❌ Failed to create refund:', refundError);
        // Continue with cancellation even if refund fails
        order.status = 'cancelled';
      }
    } else {
      // Just cancel the order
      order.status = 'cancelled';
    }

    order.cancellationReason = reason;

    // Restore product quantities if order was confirmed and cancelled (not refunded)
    if (order.status === 'cancelled' && order.payment.status === 'completed') {
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        for (const item of order.items) {
          const product = await Product.findById(item.product).session(session);

          if (product) {
            if (item.variant && item.variant.colorValue && item.variant.sizeValue) {
              const variantIndex = product.variants.findIndex(v =>
                v.color && v.color.value === item.variant.colorValue &&
                v.size && v.size.value === item.variant.sizeValue
              );

              if (variantIndex !== -1) {
                const variant = product.variants[variantIndex];
                variant.quantity += item.quantity;
                product.variants[variantIndex] = variant;
              }
            } else {
              product.quantity += item.quantity;
            }

            // Reduce sales count
            product.salesCount -= item.quantity;
            if (product.salesCount < 0) product.salesCount = 0;

            // Recalculate color quantities if needed
            if (product.colors.hasColors) {
              product.updateColorQuantities();
            }

            await product.save({ session });
          }
        }

        await session.commitTransaction();
        session.endSession();
      } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Error restoring product quantities:', error);
      }
    }

    await order.save();

    // Get user for email
    const user = await User.findById(userId);

    // Send cancellation email
    if (user) {
      setImmediate(async () => {
        try {
          await emailService.sendOrderCancellation(
            user.email,
            user.firstName,
            order,
            reason
          );
          console.log('✅ Cancellation email sent (async)');
        } catch (emailError) {
          console.error('Failed to send cancellation email:', emailError);
          // Log to error tracking service (Sentry, DataDog, etc.)
        }
      });
    }

    res.json({
      success: true,
      order,
      message: order.status === 'refunded' ? 'Order refunded successfully' : 'Order cancelled successfully'
    });
  });

  // @desc    Get user's orders
  // @route   GET /api/orders
  // @access  Private
  static getOrders = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const orders = await Order.find({ customer: userId })
      .populate({
        path: 'items.product',
        select: 'name images seo colors',
        populate: {
          path: 'colors.availableColors',
          select: 'name value hexCode price images'
        }
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Order.countDocuments({ customer: userId });

    res.json({
      success: true,
      orders: orders.map(order => order.formatOrder()),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  });

  // @desc    Get single order
  // @route   GET /api/orders/:id
  // @access  Private
  static getOrder = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const userId = req.user._id;

    const order = await Order.findOne({ _id: orderId, customer: userId })
      .populate({
        path: 'items.product',
        select: 'name description images colors priceRange variants specifications',
        populate: {
          path: 'colors.availableColors',
          select: 'name value hexCode price images'
        }
      });

    if (!order) {
      throw new HttpError('Order not found', 404);
    }

    res.json({
      success: true,
      order: order.formatOrder()
    });
  });

  // @desc    Update order status (for admin)
  // @route   PUT /api/orders/:id/status
  // @access  Private/Admin
  static updateOrderStatus = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const { status, trackingNumber, carrier, estimatedDelivery } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      throw new HttpError('Order not found', 404);
    }

    // Validate status transition
    const validTransitions = {
      'pending': ['confirmed', 'cancelled'],
      'confirmed': ['processing', 'cancelled'],
      'processing': ['shipped', 'cancelled'],
      'shipped': ['delivered'],
      'delivered': ['refunded'],
      'cancelled': [],
      'refunded': []
    };

    if (!validTransitions[order.status]?.includes(status)) {
      throw new HttpError(`Invalid status transition from ${order.status} to ${status}`, 400);
    }

    order.status = status;

    // Update shipping info if provided
    if (trackingNumber) order.trackingNumber = trackingNumber;
    if (carrier) order.carrier = carrier;
    if (estimatedDelivery) order.estimatedDelivery = estimatedDelivery;

    await order.save();

    // Get user for notification
    const user = await User.findById(order.customer);

    // Send status update email
    if (user) {
      setImmediate(async () => {
        try {
          await emailService.sendOrderStatusUpdate(
            user.email,
            user.firstName,
            order
          );
          console.log('✅ Status update email sent (async)');
        } catch (emailError) {
          console.error('Failed to send status update email:', emailError);
          // Log to error tracking service
        }
      });
    }

    res.json({
      success: true,
      order: order.formatOrder(),
      message: `Order status updated to ${status}`
    });
  });

  // @desc    Get all orders (for admin)
  // @route   GET /api/orders/admin/all
  // @access  Private/Admin
  static getAllOrders = asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const { status, dateFrom, dateTo, customer, orderNumber } = req.query;

    // Build query
    const query = {};

    if (status) query.status = status;
    if (customer) query.customer = customer;
    if (orderNumber) query.orderNumber = orderNumber.toUpperCase();

    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    const orders = await Order.find(query)
      .populate('customer', 'firstName lastName email')
      .populate({
        path: 'items.product',
        select: 'name images colors'
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Order.countDocuments(query);

    // Calculate statistics - include refunded in cancelled count
    const stats = {
      total: await Order.countDocuments({}),
      pending: await Order.countDocuments({ status: 'pending' }),
      confirmed: await Order.countDocuments({ status: 'confirmed' }),
      processing: await Order.countDocuments({ status: 'processing' }),
      shipped: await Order.countDocuments({ status: 'shipped' }),
      delivered: await Order.countDocuments({ status: 'delivered' }),
      cancelled: await Order.countDocuments({
        $or: [
          { status: 'cancelled' },
          { status: 'refunded' },
          { status: 'partially_refunded' }
        ]
      })
    };

    // Calculate revenue - EXCLUDE refunded and cancelled orders
    const revenueResult = await Order.aggregate([
      {
        $match: {
          status: {
            $in: ['delivered', 'shipped', 'processing', 'confirmed'],
            $nin: ['cancelled', 'refunded', 'partially_refunded']
          }
        }
      },
      { $group: { _id: null, totalRevenue: { $sum: '$total' } } }
    ]);

    stats.totalRevenue = revenueResult[0]?.totalRevenue || 0;

    res.json({
      success: true,
      orders: orders.map(order => order.formatOrder()),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      },
      stats
    });
  });

  // @desc    Search orders by order number
  // @route   GET /api/orders/search/:orderNumber
  // @access  Private/Admin
  static searchOrderByNumber = asyncHandler(async (req, res) => {
    const { orderNumber } = req.params;

    if (!orderNumber || orderNumber.trim() === '') {
      throw new HttpError('Order number is required', 400);
    }

    const order = await Order.findByOrderNumber(orderNumber)
      .populate('customer', 'firstName lastName email')
      .populate({
        path: 'items.product',
        select: 'name images colors'
      });

    if (!order) {
      throw new HttpError('Order not found', 404);
    }

    res.json({
      success: true,
      order: order.formatOrder()
    });
  });

  // @desc    Get order statistics for dashboard
  // @route   GET /api/orders/stats/dashboard
  // @access  Private/Admin
  static getDashboardStats = asyncHandler(async (req, res) => {
    const stats = await Order.getOrderStats();

    res.json({
      success: true,
      stats
    });
  });

  // @desc    Get recent orders
  // @route   GET /api/orders/recent
  // @access  Private/Admin
  static getRecentOrders = asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 10;

    const orders = await Order.getRecentOrders(limit);

    res.json({
      success: true,
      orders: orders.map(order => order.formatOrder())
    });
  });

  // @desc    Webhook for Stripe events
  // @route   POST /api/orders/webhook
  // @access  Public (Stripe calls this)
  static handleWebhook = asyncHandler(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded':
        const paymentIntent = event.data.object;
        await OrderController.handlePaymentSuccess(paymentIntent);
        break;
      case 'payment_intent.payment_failed':
        const failedPayment = event.data.object;
        await OrderController.handlePaymentFailure(failedPayment);
        break;
      case 'payment_intent.canceled':
        const canceledPayment = event.data.object;
        await OrderController.handlePaymentCancellation(canceledPayment);
        break;
      case 'checkout.session.completed':
        const session = event.data.object;
        await OrderController.handleCheckoutSessionCompleted(session);
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  });

  static async handlePaymentSuccess(paymentIntent) {
    console.log('🟢 Webhook: Payment intent succeeded:', paymentIntent.id);

    try {
      // Find order by payment intent ID
      const order = await Order.findOne({
        $or: [
          { 'payment.transactionId': paymentIntent.id },
          { 'payment.paymentIntentId': paymentIntent.id },
          { 'paymentDetails.stripe.paymentIntentId': paymentIntent.id }
        ]
      });

      if (!order) {
        console.warn('⚠️ No order found for payment intent:', paymentIntent.id);
        return;
      }

      // Check if payment is already completed
      if (order.payment.status === 'completed') {
        console.log('⚠️ Payment already completed for order:', order._id);
        return;
      }

      // Start session for updating order and products
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // Update product quantities
        for (const item of order.items) {
          const product = await Product.findById(item.product).session(session);

          if (product) {
            if (item.variant && item.variant.colorValue && item.variant.sizeValue) {
              const variantIndex = product.variants.findIndex(v =>
                v.color && v.color.value === item.variant.colorValue &&
                v.size && v.size.value === item.variant.sizeValue
              );

              if (variantIndex !== -1) {
                const variant = product.variants[variantIndex];
                variant.quantity -= item.quantity;
                if (variant.quantity < 0) variant.quantity = 0;
                product.variants[variantIndex] = variant;
              }
            } else {
              product.quantity -= item.quantity;
              if (product.quantity < 0) product.quantity = 0;
            }

            // Update sales count
            product.salesCount += item.quantity;

            // Recalculate color quantities if needed
            if (product.colors.hasColors) {
              product.updateColorQuantities();
            }

            await product.save({ session });
          }
        }

        // Update order status
        order.payment.status = 'completed';
        order.payment.paymentDate = new Date();
        order.status = 'confirmed';

        // Update payment details
        if (!order.paymentDetails) {
          order.paymentDetails = {};
        }
        order.paymentDetails.stripe = {
          paymentIntentId: paymentIntent.id,
          status: paymentIntent.status,
          paymentMethodTypes: paymentIntent.payment_method_types,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          lastWebhookUpdate: new Date()
        };

        await order.save({ session });

        await session.commitTransaction();
        session.endSession();

        console.log('✅ Webhook: Order updated successfully:', {
          orderId: order._id,
          orderNumber: order.orderNumber,
          status: order.status
        });

        // Send confirmation email
        const user = await User.findById(order.customer);
        if (user) {
          setImmediate(async () => {
            try {
              await emailService.sendPaymentConfirmation(
                user.email,
                user.firstName,
                order
              );
              console.log('✅ Payment confirmation email sent (async)');
            } catch (emailError) {
              console.error('Failed to send payment confirmation email:', emailError);
              // Log to error tracking service
            }
          });
        }
        // Continue with transaction commit
        await session.commitTransaction();
        session.endSession();
      } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('❌ Error handling payment success:', error);
      }
    } catch (error) {
      console.error('❌ Error finding order for payment success:', error);
    }
  }

  static async handlePaymentFailure(paymentIntent) {
    console.log('🔴 Webhook: Payment intent failed:', paymentIntent.id);

    try {
      const order = await Order.findOne({
        $or: [
          { 'payment.transactionId': paymentIntent.id },
          { 'payment.paymentIntentId': paymentIntent.id }
        ]
      });

      if (order && order.payment.status === 'pending') {
        order.payment.status = 'failed';
        order.status = 'cancelled';
        await order.save();

        console.log('🟡 Webhook: Order marked as failed:', order._id);

        // Send failure email
        const user = await User.findById(order.customer);
        if (user) {
          setImmediate(async () => {
            try {
              await emailService.sendPaymentFailure(
                user.email,
                user.firstName,
                order
              );
              console.log('✅ Payment failure email sent (async)');
            } catch (emailError) {
              console.error('Failed to send payment failure email:', emailError);
              // Log to error tracking service
            }
          });
        }
      }
    } catch (error) {
      console.error('❌ Error handling payment failure:', error);
    }
  }

  static async handlePaymentCancellation(paymentIntent) {
    console.log('🟡 Webhook: Payment intent canceled:', paymentIntent.id);

    try {
      const order = await Order.findOne({
        $or: [
          { 'payment.transactionId': paymentIntent.id },
          { 'payment.paymentIntentId': paymentIntent.id }
        ]
      });

      if (order && order.payment.status === 'pending') {
        order.payment.status = 'cancelled';
        order.status = 'cancelled';
        order.cancellationReason = 'Payment canceled by user';
        await order.save();

        console.log('🟡 Webhook: Order marked as canceled:', order._id);
      }
    } catch (error) {
      console.error('❌ Error handling payment cancellation:', error);
    }
  }

  static async handleCheckoutSessionCompleted(session) {
    try {
      console.log('Checkout session completed:', session.id);
    } catch (error) {
      console.error('Error handling checkout session completed:', error);
    }
  }

  // OrderController.js - Add these methods

  // @desc    Get order by ID (for admin)
  // @route   GET /api/orders/admin/:orderId
  // @access  Private/Admin
  static getOrderById = asyncHandler(async (req, res) => {
    const { orderId } = req.params;

    console.log('🟢 Admin get order by ID:', { orderId });

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      throw new HttpError('Invalid order ID format', 400);
    }

    const order = await Order.findById(orderId)
      .populate('customer', 'firstName lastName email phone')
      .populate({
        path: 'items.product',
        select: 'name description images colors priceRange variants specifications',
        populate: {
          path: 'colors.availableColors',
          select: 'name value hexCode price images quantityConfig'
        }
      });

    if (!order) {
      throw new HttpError('Order not found', 404);
    }

    res.json({
      success: true,
      order: order.formatOrder()
    });
  });

  // @desc    Update order details (admin)
  // @route   PUT /api/orders/admin/:orderId
  // @access  Private/Admin
  static updateOrder = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const updates = req.body;

    console.log('🟢 Admin update order:', { orderId, updates });

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      throw new HttpError('Invalid order ID format', 400);
    }

    // Find the order
    const order = await Order.findById(orderId);
    if (!order) {
      throw new HttpError('Order not found', 404);
    }

    // Allowed fields for update
    const allowedUpdates = [
      'shippingAddress',
      'billingAddress',
      'notes',
      'trackingNumber',
      'carrier',
      'estimatedDelivery',
      'adminNotes'
    ];

    // Filter updates to only allowed fields
    const filteredUpdates = {};
    Object.keys(updates).forEach(key => {
      if (allowedUpdates.includes(key)) {
        filteredUpdates[key] = updates[key];
      }
    });

    // Handle shipping address update
    if (filteredUpdates.shippingAddress) {
      order.shippingAddress = {
        ...order.shippingAddress,
        ...filteredUpdates.shippingAddress
      };
    }

    // Handle billing address update
    if (filteredUpdates.billingAddress) {
      order.billingAddress = {
        ...order.billingAddress,
        ...filteredUpdates.billingAddress
      };
    }

    // Update other fields
    if (filteredUpdates.notes !== undefined) order.notes = filteredUpdates.notes;
    if (filteredUpdates.adminNotes !== undefined) order.adminNotes = filteredUpdates.adminNotes;
    if (filteredUpdates.trackingNumber !== undefined) order.trackingNumber = filteredUpdates.trackingNumber;
    if (filteredUpdates.carrier !== undefined) order.carrier = filteredUpdates.carrier;
    if (filteredUpdates.estimatedDelivery !== undefined) order.estimatedDelivery = filteredUpdates.estimatedDelivery;

    // Save the order
    await order.save();

    console.log('✅ Order updated successfully:', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      updatedFields: Object.keys(filteredUpdates)
    });

    res.json({
      success: true,
      order: order.formatOrder(),
      message: 'Order updated successfully'
    });
  });

  // @desc    Cancel order (admin)
  // @route   PUT /api/orders/admin/:orderId/cancel
  // @access  Private/Admin
  static cancelOrderAdmin = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const { reason } = req.body;

    console.log('🟢 Admin cancel order:', { orderId, reason });

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      throw new HttpError('Invalid order ID format', 400);
    }

    if (!reason || reason.trim() === '') {
      throw new HttpError('Cancellation reason is required', 400);
    }

    // Find the order
    const order = await Order.findById(orderId)
      .populate('customer', 'firstName lastName email');

    if (!order) {
      throw new HttpError('Order not found', 404);
    }

    // Check if order can be cancelled
    const cancellableStatuses = ['pending', 'confirmed', 'processing'];
    if (!cancellableStatuses.includes(order.status)) {
      throw new HttpError(`Order cannot be cancelled from status: ${order.status}`, 400);
    }

    // Start transaction for updating order and products
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Restore product quantities
      for (const item of order.items) {
        const product = await Product.findById(item.product).session(session);

        if (product) {
          if (item.variant && item.variant.colorValue && item.variant.sizeValue) {
            const variantIndex = product.variants.findIndex(v =>
              v.color && v.color.value === item.variant.colorValue &&
              v.size && v.size.value === item.variant.sizeValue
            );

            if (variantIndex !== -1) {
              const variant = product.variants[variantIndex];
              variant.quantity += item.quantity;
              product.variants[variantIndex] = variant;
            }
          } else {
            product.quantity += item.quantity;
          }

          // Reduce sales count
          product.salesCount -= item.quantity;
          if (product.salesCount < 0) product.salesCount = 0;

          // Recalculate color quantities if needed
          if (product.colors.hasColors) {
            product.updateColorQuantities();
          }

          await product.save({ session });
        }
      }

      // Update order status
      order.status = 'cancelled';
      order.cancellationReason = reason.trim();
      order.cancelledAt = new Date();
      order.cancelledBy = req.user._id;

      // If payment was completed, mark as refunded
      if (order.payment.status === 'completed') {
        order.payment.status = 'refunded';
        order.refundedAt = new Date();
      }

      await order.save({ session });

      await session.commitTransaction();
      session.endSession();

      console.log('✅ Order cancelled successfully:', {
        orderId: order._id,
        orderNumber: order.orderNumber
      });

      // Send cancellation email to customer
      if (order.customer) {
        setImmediate(async () => {
          try {
            await emailService.sendOrderCancellation(
              order.customer.email,
              order.customer.firstName,
              order,
              reason
            );
            console.log('✅ Cancellation email sent (async)');
          } catch (emailError) {
            console.error('Failed to send cancellation email:', emailError);
            // Log to error tracking service (Sentry, DataDog, etc.)
          }
        });
      }

      res.json({
        success: true,
        order: order.formatOrder(),
        message: 'Order cancelled successfully'
      });

    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('❌ Error cancelling order:', error);
      throw new HttpError(`Failed to cancel order: ${error.message}`, 500);
    }
  });

  // @desc    Refund order (admin)
  // @route   PUT /api/orders/admin/:orderId/refund
  // @access  Private/Admin
  static refundOrder = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const { refundAmount, reason } = req.body;

    console.log('🟢 Admin refund order:', { orderId, refundAmount, reason });

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      throw new HttpError('Invalid order ID format', 400);
    }

    // Find the order
    const order = await Order.findById(orderId)
      .populate('customer', 'firstName lastName email');

    if (!order) {
      throw new HttpError('Order not found', 404);
    }

    // Check if order can be refunded
    if (order.payment.status === 'refunded') {
      throw new HttpError('Order is already refunded', 400);
    }

    if (order.payment.status !== 'completed') {
      throw new HttpError('Only completed payments can be refunded', 400);
    }

    if (!order.payment.transactionId) {
      throw new HttpError('No transaction ID found for refund', 400);
    }

    // Validate refund amount
    const maxRefundAmount = order.total;
    const refundAmountValue = refundAmount ? parseFloat(refundAmount) : maxRefundAmount;

    if (refundAmountValue <= 0 || refundAmountValue > maxRefundAmount) {
      throw new HttpError(`Refund amount must be between 0 and ${maxRefundAmount}`, 400);
    }

    // Process Stripe refund
    let refund;
    try {
      const refundParams = {
        payment_intent: order.payment.transactionId,
        amount: Math.round(refundAmountValue * 100), // Convert to cents
        reason: reason || 'requested_by_customer'
      };

      refund = await stripe.refunds.create(refundParams);

      console.log('✅ Stripe refund created:', {
        refundId: refund.id,
        amount: refund.amount,
        status: refund.status
      });
    } catch (stripeError) {
      console.error('❌ Stripe refund error:', stripeError);
      throw new HttpError(`Failed to process refund: ${stripeError.message}`, 500);
    }

    // Start transaction for updating order and products
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Restore product quantities for full refunds
      if (refundAmountValue === maxRefundAmount) {
        for (const item of order.items) {
          const product = await Product.findById(item.product).session(session);

          if (product) {
            if (item.variant && item.variant.colorValue && item.variant.sizeValue) {
              const variantIndex = product.variants.findIndex(v =>
                v.color && v.color.value === item.variant.colorValue &&
                v.size && v.size.value === item.variant.sizeValue
              );

              if (variantIndex !== -1) {
                const variant = product.variants[variantIndex];
                variant.quantity += item.quantity;
                product.variants[variantIndex] = variant;
              }
            } else {
              product.quantity += item.quantity;
            }

            // Reduce sales count
            product.salesCount -= item.quantity;
            if (product.salesCount < 0) product.salesCount = 0;

            // Recalculate color quantities if needed
            if (product.colors.hasColors) {
              product.updateColorQuantities();
            }

            await product.save({ session });
          }
        }

        // Update order status
        order.status = 'refunded';
      } else {
        // Partial refund
        order.status = 'partially_refunded';
      }

      // Update payment status
      order.payment.status = 'refunded';
      order.refundedAt = new Date();
      order.refundedBy = req.user._id;
      order.refundReason = reason;
      order.refundAmount = refundAmountValue;

      // Store refund details
      if (!order.refundDetails) {
        order.refundDetails = [];
      }

      order.refundDetails.push({
        refundId: refund.id,
        amount: refundAmountValue,
        reason: reason,
        stripeRefundId: refund.id,
        status: refund.status,
        processedAt: new Date(),
        processedBy: req.user._id
      });

      await order.save({ session });

      await session.commitTransaction();
      session.endSession();

      console.log('✅ Order refunded successfully:', {
        orderId: order._id,
        orderNumber: order.orderNumber,
        refundAmount: refundAmountValue
      });

      // Send refund email to customer
      if (order.customer) {
        setImmediate(async () => {
          try {
            await emailService.sendOrderRefund(
              order.customer.email,
              order.customer.firstName,
              order,
              refundAmountValue,
              reason
            );
            console.log('✅ Refund email sent (async)');
          } catch (emailError) {
            console.error('Failed to send refund email:', emailError);
            // Log to error tracking service
          }
        });
      }
      res.json({
        success: true,
        order: order.formatOrder(),
        refund: {
          id: refund.id,
          amount: refundAmountValue,
          status: refund.status
        },
        message: refundAmountValue === maxRefundAmount ? 'Order fully refunded' : 'Order partially refunded'
      });

    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('❌ Error updating order after refund:', error);
      throw new HttpError(`Failed to update order: ${error.message}`, 500);
    }
  });

  // @desc    Get order status history
  // @route   GET /api/orders/:orderId/status-history
  // @access  Private/Admin
  static getStatusHistory = asyncHandler(async (req, res) => {
    const { orderId } = req.params;

    console.log('🟢 Get order status history:', { orderId });

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      throw new HttpError('Invalid order ID format', 400);
    }

    const order = await Order.findById(orderId)
      .select('statusHistory createdAt updatedAt status');

    if (!order) {
      throw new HttpError('Order not found', 404);
    }

    // If order doesn't have statusHistory array, create it from existing data
    if (!order.statusHistory || order.statusHistory.length === 0) {
      const statusHistory = [
        {
          status: 'pending',
          timestamp: order.createdAt,
          note: 'Order created'
        }
      ];

      if (order.updatedAt && order.status !== 'pending') {
        statusHistory.push({
          status: order.status,
          timestamp: order.updatedAt,
          note: 'Status updated'
        });
      }

      order.statusHistory = statusHistory;
      await order.save();
    }

    res.json({
      success: true,
      statusHistory: order.statusHistory,
      currentStatus: order.status
    });
  });

  // @desc    Update order status with history tracking
  // @route   PUT /api/orders/admin/:orderId/status
  // @access  Private/Admin
  static updateOrderStatusAdmin = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const { status, trackingNumber, note } = req.body;

    console.log('🟢 Admin update order status:', { orderId, status, trackingNumber, note });

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      throw new HttpError('Invalid order ID format', 400);
    }

    // Validate status
    const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded'];
    if (!validStatuses.includes(status)) {
      throw new HttpError(`Invalid status: ${status}`, 400);
    }

    // Find the order
    const order = await Order.findById(orderId)
      .populate('customer', 'firstName lastName email');

    if (!order) {
      throw new HttpError('Order not found', 404);
    }

    // Save previous status for history
    const previousStatus = order.status;

    // Update order status
    order.status = status;
    if (trackingNumber) order.trackingNumber = trackingNumber;
    order.updatedAt = new Date();

    // Add to status history
    if (!order.statusHistory) {
      order.statusHistory = [];
    }

    order.statusHistory.push({
      status: status,
      previousStatus: previousStatus,
      timestamp: new Date(),
      updatedBy: req.user._id,
      note: note || `Status changed from ${previousStatus} to ${status}`,
      trackingNumber: trackingNumber || undefined
    });

    // Save the order
    await order.save();

    console.log('✅ Order status updated:', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      previousStatus,
      newStatus: status
    });

    // Send status update email to customer
    if (order.customer) {
      setImmediate(async () => {
        try {
          await emailService.sendOrderStatusUpdate(
            order.customer.email,
            order.customer.firstName,
            order
          );
          console.log('✅ Status update email sent (async)');
        } catch (emailError) {
          console.error('Failed to send status update email:', emailError);
          // Log to error tracking service
        }
      });
    }
    res.json({
      success: true,
      order: order.formatOrder(),
      statusHistory: order.statusHistory,
      message: `Order status updated from ${previousStatus} to ${status}`
    });
  });

  // @desc    Add order note (admin)
  // @route   POST /api/orders/admin/:orderId/notes
  // @access  Private/Admin
  static addOrderNote = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const { note, isInternal = true } = req.body;

    console.log('🟢 Add order note:', { orderId, note, isInternal });

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      throw new HttpError('Invalid order ID format', 400);
    }

    if (!note || note.trim() === '') {
      throw new HttpError('Note content is required', 400);
    }

    const order = await Order.findById(orderId);
    if (!order) {
      throw new HttpError('Order not found', 404);
    }

    // Initialize notes array if not exists
    if (!order.adminNotes) {
      order.adminNotes = [];
    }

    // Add new note
    order.adminNotes.push({
      note: note.trim(),
      addedBy: req.user._id,
      addedAt: new Date(),
      isInternal: isInternal
    });

    await order.save();

    res.json({
      success: true,
      notes: order.adminNotes,
      message: 'Note added successfully'
    });
  });

  // @desc    Get order notes (admin)
  // @route   GET /api/orders/admin/:orderId/notes
  // @access  Private/Admin
  static getOrderNotes = asyncHandler(async (req, res) => {
    const { orderId } = req.params;

    console.log('🟢 Get order notes:', { orderId });

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      throw new HttpError('Invalid order ID format', 400);
    }

    const order = await Order.findById(orderId).select('adminNotes notes');
    if (!order) {
      throw new HttpError('Order not found', 404);
    }

    res.json({
      success: true,
      adminNotes: order.adminNotes || [],
      customerNotes: order.notes || '',
      message: 'Notes retrieved successfully'
    });
  });

  // Helper method to generate order hash for verification
  static generateOrderHash(orderData) {
    const dataString = JSON.stringify({
      items: orderData.items,
      subtotal: orderData.subtotal,
      shipping: orderData.shipping,
      tax: orderData.tax,
      shippingMethod: orderData.shippingMethod
    });

    // Simple hash for demo - use crypto in production
    let hash = 0;
    for (let i = 0; i < dataString.length; i++) {
      const char = dataString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }





}

module.exports = OrderController;