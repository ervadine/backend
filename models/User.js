const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const validator = require('validator');
// In your User.js model - update paymentCardSchema
const paymentCardSchema = new mongoose.Schema({
  _id: {
    type: mongoose.Schema.Types.ObjectId,
    default: () => new mongoose.Types.ObjectId()
  },
  lastFourDigits: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^\d{4}$/.test(v);
      },
      message: 'Last four digits must be exactly 4 digits'
    }
  },
  cardholderName: {
    type: String,
    required: [true, 'Cardholder name is required'],
    trim: true,
    maxlength: 100
  },
  expiryMonth: {
    type: Number,
    required: [true, 'Expiry month is required'],
    min: 1,
    max: 12
  },
  expiryYear: {
    type: Number,
    required: [true, 'Expiry year is required'],
    validate: {
      validator: function(v) {
        const currentYear = new Date().getFullYear();
        return v >= currentYear && v <= currentYear + 20;
      },
      message: 'Expiry year must be current year or up to 20 years in the future'
    }
  },
  cardType: {
    type: String,
    enum: ['Visa', 'MasterCard', 'American Express', 'Discover', 'Other'],
    required: true
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  // ADD THIS - Stripe Payment Method ID
  stripePaymentMethodId: {
    type: String,
    required: true,
     index:true
  },
   stripeCustomerId: {
    type: String,
    select: false, // Don't return by default
    index: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  billingAddress: {
    street: String,
    apt: String,
    city: String,
    state: String,
    zipCode: String,
    country: String
  },
  lastUsed: {
    type: Date
  },
  metadata: {
    type: Map,
    of: String
  }
}, {
  timestamps: true
});

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: 50
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    maxlength: 50
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    validate: [validator.isEmail, 'Please provide a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 6,
    select: false
  },
  phone: {
    type: String,
    validate: {
      validator: function(v) {
        return !v || /^\+?[1-9]\d{1,14}$/.test(v);
      },
      message: 'Please provide a valid phone number'
    }
  },
avatar: {
    url: {
        type: String,
        default: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'
    },
    public_id: {
        type: String,
        default: ''
    },
    alt: {
        type: String,
        default: 'User Avatar'
    }
},
  role: {
    type: String,
    enum: ['customer', 'admin'],
    default: 'customer'
  },
  addresses: [{
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      default: () => new mongoose.Types.ObjectId()
    },
    street: {
      type: String,
      required: true
    },
    apt: {
      type: String,
      trim: true,
      maxlength: 50,
      default: ''
    },
    city: {
      type: String,
      required: true
    },
    state: {
      type: String,
      required: true
    },
    zipCode: {
      type: String,
      required: true
    },
    country: {
      type: String,
      required: true,
      default: 'USA'
    },
    isDefault: {
      type: Boolean,
      default: false
    }
  }],
  // New payment cards field
  paymentCards: {
    type: [paymentCardSchema],
    default: [],
    validate: {
      validator: function(cards) {
        // Ensure only one default card
        const defaultCards = cards.filter(card => card.isDefault === true);
        return defaultCards.length <= 1;
      },
      message: 'Only one payment card can be set as default'
    }
  },
  wishlist: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: String,
  emailVerificationExpires: Date,
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  lastLogin: {
    type: Date
  },
  // Optional: Store payment processor customer ID at user level
  paymentProcessorCustomerId: {
    type: String,
    select: false
  }
}, {
  timestamps: true
});

// Index for better query performance
userSchema.index({ email: 1 });
userSchema.index({ 'addresses.zipCode': 1 });
userSchema.index({ emailVerificationToken: 1 });
userSchema.index({ resetPasswordToken: 1 });
userSchema.index({ 'paymentCards.paymentToken': 1 });
userSchema.index({ 'paymentCards.isDefault': 1 });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Ensure only one default card before saving
userSchema.pre('save', function(next) {
  if (this.paymentCards && this.paymentCards.length > 0) {
    const defaultCards = this.paymentCards.filter(card => card.isDefault === true);
    
    if (defaultCards.length > 1) {
      // Keep only the first default card, set others to false
      let foundFirst = false;
      this.paymentCards.forEach(card => {
        if (card.isDefault) {
          if (!foundFirst) {
            foundFirst = true;
          } else {
            card.isDefault = false;
          }
        }
      });
    }
    
    // If no default card and there are cards, set the first one as default
    if (defaultCards.length === 0 && this.paymentCards.length > 0) {
      this.paymentCards[0].isDefault = true;
    }
  }
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to add a payment card
userSchema.methods.addPaymentCard = async function(cardData) {
  // Ensure only one default card
  if (cardData.isDefault) {
    this.paymentCards.forEach(card => {
      card.isDefault = false;
    });
  }
  
  this.paymentCards.push(cardData);
  return await this.save();
};

// Method to update a payment card
userSchema.methods.updatePaymentCard = async function(cardId, updateData) {
  const card = this.paymentCards.id(cardId);
  if (!card) {
    throw new Error('Payment card not found');
  }
  
  // If setting this card as default, unset others
  if (updateData.isDefault) {
    this.paymentCards.forEach(c => {
      if (c._id.toString() !== cardId) {
        c.isDefault = false;
      }
    });
  }
  
  Object.assign(card, updateData);
  return await this.save();
};

userSchema.methods.deletePaymentCard = async function(cardId) {
  // Find the card index
  const cardIndex = this.paymentCards.findIndex(
    card => card._id.toString() === cardId
  );
  
  if (cardIndex === -1) {
    throw new Error('Payment card not found');
  }
  
  const wasDefault = this.paymentCards[cardIndex].isDefault;
  
  // Remove the card using splice
  this.paymentCards.splice(cardIndex, 1);
  
  // If we removed the default card and there are other cards, set a new default
  if (wasDefault && this.paymentCards.length > 0) {
    this.paymentCards[0].isDefault = true;
  }
  
  return await this.save();
};

// Method to get default payment card
userSchema.methods.getDefaultPaymentCard = function() {
  return this.paymentCards.find(card => card.isDefault === true);
};

// Method to mask card number for display
userSchema.methods.getMaskedCardNumber = function(cardId) {
  const card = this.paymentCards.id(cardId);
  if (!card) return null;
  return `**** **** **** ${card.lastFourDigits}`;
};

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

const User = mongoose.model('User', userSchema);
module.exports = User;