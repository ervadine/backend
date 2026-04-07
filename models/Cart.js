const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  selectedColor: {
    type: String,
    default: null
  },
  selectedSize: {
    type: String,
    default: null
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  price: {
    type: Number,
    required: true
  },
  addedAt: {
    type: Date,
    default: Date.now
  }
});

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  sessionId: {
    type: String,
    default: null
  },
  items: [cartItemSchema],
  coupon: {
    code: String,
    discount: Number,
    discountType: {
      type: String,
      enum: ['percentage', 'fixed']
    },
    appliedAt: Date
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound index to ensure uniqueness
cartSchema.index({ user: 1, sessionId: 1 }, { unique: true, sparse: true });

// Remove problematic indexes on connection
mongoose.connection.on('connected', async () => {
  console.log('🔄 Checking and fixing cart indexes...');
  
  const indexesToRemove = ['user_1', 'sessionId_1', 'user_sparse_unique'];
  
  for (const indexName of indexesToRemove) {
    try {
      await mongoose.connection.db.collection('carts').dropIndex(indexName);
      console.log(`✅ Dropped index: ${indexName}`);
    } catch (error) {
      if (error.codeName === 'IndexNotFound') {
        console.log(`ℹ️  Index not found: ${indexName}`);
      } else {
        console.log(`❌ Error dropping index ${indexName}:`, error.message);
      }
    }
  }
  
  // Create the compound index
  try {
    await mongoose.connection.db.collection('carts').createIndex(
      { user: 1, sessionId: 1 },
      { unique: true, sparse: true, name: "user_session_unique" }
    );
    console.log('✅ Created compound index: user_session_unique');
  } catch (error) {
    console.log('ℹ️  Compound index already exists or error:', error.message);
  }
});

// Virtual for total items count
cartSchema.virtual('itemCount').get(function() {
  return this.items.reduce((total, item) => total + item.quantity, 0);
});

// Virtual for subtotal (before discount)
cartSchema.virtual('subtotal').get(function() {
  return this.items.reduce((total, item) => {
    const itemPrice = item.price || 0;
    const itemQuantity = item.quantity || 0;
    return total + (itemPrice * itemQuantity);
  }, 0);
});

// Virtual for total price (same as subtotal)
cartSchema.virtual('totalPrice').get(function() {
  return this.subtotal;
});

// Virtual for discount amount
cartSchema.virtual('discountAmount').get(function() {
  if (!this.coupon || !this.coupon.discount) {
    return 0;
  }
  
  const subtotal = this.subtotal;
  
  if (this.coupon.discountType === 'percentage') {
    return (subtotal * this.coupon.discount) / 100;
  } else {
    return Math.min(this.coupon.discount, subtotal);
  }
});

// Virtual for discounted total
cartSchema.virtual('discountedTotal').get(function() {
  const subtotal = this.subtotal;
  const discountAmount = this.discountAmount;
  return Math.max(0, subtotal - discountAmount);
});

// Method to calculate totals with proper error handling
cartSchema.methods.calculateTotals = function() {
  const subtotal = this.subtotal;
  const discountAmount = this.discountAmount;
  const discountedTotal = this.discountedTotal;
  const itemCount = this.itemCount;
  
  return {
    subtotal,
    discountAmount,
    discountedTotal,
    itemCount,
    coupon: this.coupon ? {
      code: this.coupon.code,
      discount: this.coupon.discount,
      discountType: this.coupon.discountType,
      discountAmount: discountAmount
    } : null
  };
};

// Ensure virtuals are included in JSON output
cartSchema.set('toJSON', { 
  virtuals: true,
  transform: function(doc, ret) {
    // Calculate and include totals explicitly
    const totals = doc.calculateTotals ? doc.calculateTotals() : {
      subtotal: ret.subtotal,
      discountAmount: ret.discountAmount,
      discountedTotal: ret.discountedTotal,
      itemCount: ret.itemCount
    };
    
    return {
      ...ret,
      ...totals
    };
  }
});

cartSchema.set('toObject', { 
  virtuals: true,
  transform: function(doc, ret) {
    const totals = doc.calculateTotals ? doc.calculateTotals() : {
      subtotal: ret.subtotal,
      discountAmount: ret.discountAmount,
      discountedTotal: ret.discountedTotal,
      itemCount: ret.itemCount
    };
    
    return {
      ...ret,
      ...totals
    };
  }
});

module.exports = mongoose.model('Cart', cartSchema);