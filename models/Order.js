// models/Order.js - Updated with admin fields
const mongoose = require('mongoose');

// Helper function to generate random order number
const generateRandomString = (length) => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    result += characters.charAt(randomIndex);
  }
  
  return result;
};

// Helper function to generate unique order number
const generateUniqueOrderNumber = async () => {
  let isUnique = false;
  let attempts = 0;
  const maxAttempts = 10;
  let orderNumber = '';
  
  while (!isUnique && attempts < maxAttempts) {
    const randomPart = generateRandomString(8);
    orderNumber = `ORD${randomPart}`;
    
    try {
      const existingOrder = await mongoose.model('Order')
        .findOne({ orderNumber: orderNumber })
        .select('orderNumber')
        .lean();
      
      if (!existingOrder) {
        isUnique = true;
        console.log(`✅ Generated unique order number: ${orderNumber}`);
      } else {
        attempts++;
        console.log(`🔄 Order number collision: ${orderNumber}, attempt ${attempts}/${maxAttempts}`);
      }
    } catch (error) {
      console.error('Error checking order number uniqueness:', error);
      attempts++;
    }
  }
  
  if (!isUnique) {
    const timestamp = Date.now().toString().slice(-6);
    const randomPart = generateRandomString(2);
    orderNumber = `ORD${timestamp}${randomPart}`;
    console.log(`⚠️ Using fallback order number: ${orderNumber}`);
  }
  
  return orderNumber;
};

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,
    required: true,
    uppercase: true,
    trim: true,
    index: true,
    validate: {
      validator: function(v) {
        return /^ORD[A-Z0-9]{8}$/.test(v);
      },
      message: props => `${props.value} is not a valid order number! Must be ORD followed by 8 alphanumeric characters.`
    }
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    variant: {
      colorValue: String,
      sizeValue: String,
      price: Number
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    total: {
      type: Number,
      required: true,
      min: 0
    }
  }],
  subtotal: {
    type: Number,
    required: true,
    min: 0
  },
  tax: {
    type: Number,
    default: 0,
    min: 0
  },
  shipping: {
    type: Number,
    default: 0,
    min: 0
  },
  discount: {
    type: Number,
    default: 0,
    min: 0
  },
  total: {
    type: Number,
    required: true,
    min: 0
  },
  
  // Shipping Address
  shippingAddress: {
    firstName: String,
    lastName: String,
    email: String,
    phone: String,
    street: String,
    apartment: String,
    city: String,
    state: String,
    zipCode: String,
    country: String
  },
  
  // Billing Address
  billingAddress: {
    firstName: String,
    lastName: String,
    email: String,
    street: String,
    apartment: String,
    city: String,
    state: String,
    zipCode: String,
    country: String,
    billingSame: {
      type: Boolean,
      default: true
    }
  },
  
  // Payment Information
  payment: {
    method: {
      type: String,
      enum: ['credit_card', 'paypal', 'stripe', 'cash_on_delivery', 'klarna', 'afterpay'],
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded', 'cancelled'],
      default: 'pending'
    },
    transactionId: String,
    paymentIntentId: String,
    paymentDate: Date
  },
  
  paymentDetails: {
    stripe: {
      paymentIntentId: String,
      clientSecret: String,
      status: String,
      paymentMethodTypes: [String],
      amount: Number,
      currency: String
    }
  },
  
  // Order Status
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded', 'partially_refunded'],
    default: 'pending'
  },
  
  // Shipping Information
  shippingMethod: {
    type: String,
    required: true
  },
  trackingNumber: String,
  carrier: String,
  estimatedDelivery: Date,
  
  // Customer Notes
  notes: String,
  
  // Admin Notes
  adminNotes: [{
    note: {
      type: String,
      required: true
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    addedAt: {
      type: Date,
      default: Date.now
    },
    isInternal: {
      type: Boolean,
      default: true
    }
  }],
  
  // Status History
  statusHistory: [{
    status: {
      type: String,
      required: true
    },
    previousStatus: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    note: String,
    trackingNumber: String
  }],
  
  // Cancellation Information
  cancellationReason: String,
  cancelledAt: Date,
  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Refund Information
  refundAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  refundReason: String,
  refundedAt: Date,
  refundedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  refundDetails: [{
    refundId: String,
    amount: Number,
    reason: String,
    stripeRefundId: String,
    status: String,
    processedAt: {
      type: Date,
      default: Date.now
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  
  // Internal Flags
  requiresAttention: {
    type: Boolean,
    default: false
  },
  priorityLevel: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      // Remove sensitive fields when converting to JSON
      delete ret.__v;
      delete ret.paymentDetails?.stripe?.clientSecret;
      return ret;
    }
  },
  toObject: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.__v;
      delete ret.paymentDetails?.stripe?.clientSecret;
      return ret;
    }
  }
});

// ==================== INDEXES ====================
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ 'payment.status': 1 });
orderSchema.index({ 'payment.transactionId': 1 });
orderSchema.index({ 'payment.paymentIntentId': 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ requiresAttention: 1 });
orderSchema.index({ priorityLevel: 1 });
orderSchema.index({ 'shippingAddress.email': 1 });
orderSchema.index({ total: -1 });

// ==================== VIRTUAL PROPERTIES ====================
// Formatted order date
orderSchema.virtual('formattedDate').get(function() {
  return this.createdAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
});

// Formatted date with time
orderSchema.virtual('formattedDateTime').get(function() {
  return this.createdAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
});

// Formatted total
orderSchema.virtual('formattedTotal').get(function() {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(this.total);
});

// Formatted subtotal
orderSchema.virtual('formattedSubtotal').get(function() {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(this.subtotal);
});

// Formatted tax
orderSchema.virtual('formattedTax').get(function() {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(this.tax);
});

// Formatted shipping
orderSchema.virtual('formattedShipping').get(function() {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(this.shipping);
});

// Order status with color
orderSchema.virtual('statusColor').get(function() {
  const statusColors = {
    'pending': 'warning',
    'confirmed': 'info',
    'processing': 'primary',
    'shipped': 'primary',
    'delivered': 'success',
    'completed': 'success',
    'cancelled': 'danger',
    'refunded': 'secondary',
    'partially_refunded': 'secondary'
  };
  return statusColors[this.status] || 'secondary';
});

// Customer full name
orderSchema.virtual('customerFullName').get(function() {
  if (this.shippingAddress) {
    return `${this.shippingAddress.firstName || ''} ${this.shippingAddress.lastName || ''}`.trim();
  }
  return '';
});

// Item count
orderSchema.virtual('itemCount').get(function() {
  return this.items.reduce((total, item) => total + (item.quantity || 1), 0);
});

// Is refundable
orderSchema.virtual('isRefundable').get(function() {
  const refundableStatuses = ['delivered', 'completed', 'shipped', 'processing'];
  return refundableStatuses.includes(this.status) && 
         this.payment.status === 'completed' &&
         !['refunded', 'partially_refunded'].includes(this.payment.status);
});

// Is cancellable
orderSchema.virtual('isCancellable').get(function() {
  const cancellableStatuses = ['pending', 'confirmed', 'processing'];
  return cancellableStatuses.includes(this.status) && 
         this.payment.status !== 'refunded';
});

// ==================== PRE-SAVE MIDDLEWARE ====================
// Generate unique order number
orderSchema.pre('validate', async function(next) {
  if (this.isNew && !this.orderNumber) {
    try {
      this.orderNumber = await generateUniqueOrderNumber();
    } catch (error) {
      console.error('Failed to generate order number:', error);
      const timestamp = Date.now().toString().slice(-8);
      this.orderNumber = `ORD${timestamp}`;
    }
  }
  next();
});

// Format order number
orderSchema.pre('save', function(next) {
  if (this.isModified('orderNumber') && this.orderNumber) {
    this.orderNumber = this.orderNumber.toUpperCase();
    
    if (!/^ORD[A-Z0-9]{8}$/.test(this.orderNumber)) {
      return next(new Error('Invalid order number format. Must be ORD followed by 8 alphanumeric characters.'));
    }
  }
  next();
});

// Calculate totals
orderSchema.pre('save', function(next) {
  // Calculate subtotal from items
  if (this.items && this.items.length > 0) {
    this.subtotal = this.items.reduce((sum, item) => {
      const itemTotal = (item.price || 0) * (item.quantity || 1);
      return sum + itemTotal;
    }, 0);
  } else {
    this.subtotal = 0;
  }
  
  // Ensure tax, shipping, and discount are numbers
  this.tax = Number(this.tax) || 0;
  this.shipping = Number(this.shipping) || 0;
  this.discount = Number(this.discount) || 0;
  
  // Calculate total
  this.total = this.subtotal + this.tax + this.shipping - this.discount;
  
  // Ensure total is not negative
  if (this.total < 0) this.total = 0;
  
  next();
});

// Initialize status history if not exists
orderSchema.pre('save', function(next) {
  if (this.isNew) {
    if (!this.statusHistory || this.statusHistory.length === 0) {
      this.statusHistory = [{
        status: this.status || 'pending',
        timestamp: this.createdAt || new Date(),
        note: 'Order created'
      }];
    }
  }
  
  // Track status changes - FIXED VERSION
  if (this.isModified('status') && !this.isNew) {
    // Get the original status from the database document
    const originalStatus = this._originalStatus || (this._originalDoc && this._originalDoc.status) || 'pending';
    
    if (originalStatus !== this.status) {
      if (!this.statusHistory) {
        this.statusHistory = [];
      }
      
      this.statusHistory.push({
        status: this.status,
        previousStatus: originalStatus,
        timestamp: new Date(),
        note: `Status changed from ${originalStatus} to ${this.status}`,
        trackingNumber: this.trackingNumber || undefined
      });
    }
  }
  
  next();
});

// Additional middleware to capture original document before save
orderSchema.pre('save', function(next) {
  if (!this.isNew) {
    // Store the original status before it gets modified
    this._originalStatus = this.get('status');
    
    // Alternatively, store the entire original document
    if (!this._originalDoc) {
      this.constructor.findById(this._id, 'status')
        .then(originalDoc => {
          this._originalDoc = originalDoc;
          next();
        })
        .catch(next);
      return;
    }
  }
  next();
});

// ==================== STATIC METHODS ====================
// Find by order number
orderSchema.statics.findByOrderNumber = function(orderNumber) {
  return this.findOne({ orderNumber: orderNumber.toUpperCase() });
};

// Get recent orders
orderSchema.statics.getRecentOrders = function(limit = 10) {
  return this.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('customer', 'firstName lastName email')
    .populate('items.product', 'name images');
};

// Get order statistics
orderSchema.statics.getOrderStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: '$total' },
        avgOrderValue: { $avg: '$total' }
      }
    }
  ]);
  
  const statusStats = await this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        total: { $sum: '$total' }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);
  
  const paymentStats = await this.aggregate([
    {
      $group: {
        _id: '$payment.method',
        count: { $sum: 1 },
        total: { $sum: '$total' }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);
  
  const monthlyStats = await this.aggregate([
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        },
        count: { $sum: 1 },
        revenue: { $sum: '$total' }
      }
    },
    {
      $sort: { '_id.year': -1, '_id.month': -1 }
    },
    {
      $limit: 12
    }
  ]);
  
  return {
    overview: stats[0] || { 
      totalOrders: 0, 
      totalRevenue: 0, 
      avgOrderValue: 0 
    },
    byStatus: statusStats,
    byPaymentMethod: paymentStats,
    monthly: monthlyStats
  };
};

// Get dashboard stats
orderSchema.statics.getDashboardStats = async function() {
  const today = new Date();
  const startOfToday = new Date(today.setHours(0, 0, 0, 0));
  const startOfWeek = new Date(today.setDate(today.getDate() - today.getDay()));
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  
  const [
    totalOrders,
    todayOrders,
    thisWeekOrders,
    thisMonthOrders,
    pendingOrders,
    processingOrders,
    deliveredOrders,
    revenueStats
  ] = await Promise.all([
    this.countDocuments(),
    this.countDocuments({ createdAt: { $gte: startOfToday } }),
    this.countDocuments({ createdAt: { $gte: startOfWeek } }),
    this.countDocuments({ createdAt: { $gte: startOfMonth } }),
    this.countDocuments({ status: 'pending' }),
    this.countDocuments({ status: 'processing' }),
    this.countDocuments({ status: 'delivered' }),
    this.aggregate([
      {
        $match: {
          status: { $in: ['delivered', 'shipped', 'processing', 'confirmed'] }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$total' },
          avgOrderValue: { $avg: '$total' }
        }
      }
    ])
  ]);
  
  return {
    total: totalOrders,
    today: todayOrders,
    thisWeek: thisWeekOrders,
    thisMonth: thisMonthOrders,
    pending: pendingOrders,
    processing: processingOrders,
    delivered: deliveredOrders,
    totalRevenue: revenueStats[0]?.totalRevenue || 0,
    avgOrderValue: revenueStats[0]?.avgOrderValue || 0,
    cancelled: await this.countDocuments({ status: 'cancelled' }),
    refunded: await this.countDocuments({ status: 'refunded' })
  };
};

// ==================== INSTANCE METHODS ====================
// Format order for API response
orderSchema.methods.formatOrder = function() {
  const order = {
    id: this._id,
    orderNumber: this.orderNumber,
    customer: this.customer,
    items: this.items,
    subtotal: this.subtotal,
    tax: this.tax,
    shipping: this.shipping,
    discount: this.discount,
    total: this.total,
    shippingAddress: this.shippingAddress,
    billingAddress: this.billingAddress,
    payment: this.payment,
    status: this.status,
    shippingMethod: this.shippingMethod,
    trackingNumber: this.trackingNumber,
    carrier: this.carrier,
    estimatedDelivery: this.estimatedDelivery,
    notes: this.notes,
    adminNotes: this.adminNotes || [],
    statusHistory: this.statusHistory || [],
    cancellationReason: this.cancellationReason,
    cancelledAt: this.cancelledAt,
    refundAmount: this.refundAmount,
    refundReason: this.refundReason,
    refundedAt: this.refundedAt,
    refundDetails: this.refundDetails || [],
    requiresAttention: this.requiresAttention,
    priorityLevel: this.priorityLevel,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    formattedDate: this.formattedDate,
    formattedDateTime: this.formattedDateTime,
    formattedTotal: this.formattedTotal,
    formattedSubtotal: this.formattedSubtotal,
    formattedTax: this.formattedTax,
    formattedShipping: this.formattedShipping,
    statusColor: this.statusColor,
    customerFullName: this.customerFullName,
    itemCount: this.itemCount,
    isRefundable: this.isRefundable,
    isCancellable: this.isCancellable
  };
  
  return order;
};

// Add admin note
orderSchema.methods.addAdminNote = function(note, userId, isInternal = true) {
  if (!this.adminNotes) {
    this.adminNotes = [];
  }
  
  this.adminNotes.push({
    note,
    addedBy: userId,
    addedAt: new Date(),
    isInternal
  });
  
  return this.adminNotes;
};

// Update status with history
orderSchema.methods.updateStatus = function(newStatus, userId, note = '', trackingNumber = null) {
  const previousStatus = this.status;
  this.status = newStatus;
  
  if (trackingNumber) {
    this.trackingNumber = trackingNumber;
  }
  
  if (!this.statusHistory) {
    this.statusHistory = [];
  }
  
  this.statusHistory.push({
    status: newStatus,
    previousStatus: previousStatus,
    timestamp: new Date(),
    updatedBy: userId,
    note: note || `Status changed from ${previousStatus} to ${newStatus}`,
    trackingNumber: trackingNumber || undefined
  });
  
  return this;
};

// Cancel order
orderSchema.methods.cancel = function(reason, userId) {
  this.status = 'cancelled';
  this.cancellationReason = reason;
  this.cancelledAt = new Date();
  this.cancelledBy = userId;
  
  if (this.payment.status === 'completed') {
    this.payment.status = 'refunded';
    this.refundedAt = new Date();
    this.refundedBy = userId;
  }
  
  return this;
};

// Process refund
orderSchema.methods.processRefund = function(amount, reason, userId, stripeRefundId = null) {
  this.refundAmount = amount;
  this.refundReason = reason;
  this.refundedAt = new Date();
  this.refundedBy = userId;
  
  if (amount >= this.total) {
    this.status = 'refunded';
    this.payment.status = 'refunded';
  } else {
    this.status = 'partially_refunded';
  }
  
  if (!this.refundDetails) {
    this.refundDetails = [];
  }
  
  this.refundDetails.push({
    refundId: `REF${Date.now().toString().slice(-8)}`,
    amount: amount,
    reason: reason,
    stripeRefundId: stripeRefundId,
    status: 'completed',
    processedAt: new Date(),
    processedBy: userId
  });
  
  return this;
};

// ==================== POST-SAVE MIDDLEWARE ====================
// Update inventory after order is confirmed
orderSchema.post('save', async function(doc, next) {
  if (doc.isModified('status') && doc.status === 'confirmed') {
    try {
      console.log(`Order ${doc.orderNumber} confirmed, inventory should be updated.`);
      // Note: Inventory updates should be handled in the controller
    } catch (error) {
      console.error('Error updating inventory:', error);
    }
  }
  next();
});

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;