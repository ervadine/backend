const mongoose = require('mongoose');

const visitorSchema = new mongoose.Schema({
  ipAddress: {
    type: String,
    required: [true, 'IP address is required'],
    trim: true,
    match: [/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^([a-fA-F0-9:]+:+)+[a-fA-F0-9]+$/, 'Please enter a valid IP address']
  },
  visitDateTime: {
    type: Date,
    required: [true, 'Visit date and time is required'],
    default: Date.now
  },
  userAgent: {
    type: String,
    trim: true
  },
  referrer: {
    type: String,
    trim: true
  },
  pageVisited: {
    type: String,
    required: [true, 'Page visited is required'],
    trim: true
  },
  country: {
    type: String,
    trim: true
  },
  city: {
    type: String,
    trim: true
  },
  region: {
    type: String,
    trim: true
  },
  browser: {
    name: { type: String, trim: true },
    version: { type: String, trim: true }
  },
  os: {
    name: { type: String, trim: true },
    version: { type: String, trim: true }
  },
  device: {
    type: {
      type: String,
      enum: ['desktop', 'mobile', 'tablet', 'bot', 'unknown'],
      default: 'unknown'
    },
    isMobile: { type: Boolean, default: false },
    isTablet: { type: Boolean, default: false },
    isDesktop: { type: Boolean, default: false }
  },
  sessionId: {
    type: String,
    trim: true
  },
  duration: {
    type: Number, // Duration in seconds
    min: 0
  },
  actions: [{
    actionType: {
      type: String,
      enum: ['page_view', 'click', 'form_submit', 'purchase', 'download', 'scroll', 'hover'],
      required: true
    },
    actionTarget: String,
    timestamp: { type: Date, default: Date.now },
    metadata: mongoose.Schema.Types.Mixed
  }]
}, {
  timestamps: true,
  _id: true // Ensure each visitor has its own ID
});

const logoSchema = new mongoose.Schema({
    url: {
        type: String,
        required: true
    },
    public_id: {
        type: String,
        required: true
    },
    format: {
        type: String,
        required: true
    }
}, { _id: false });

const companySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Company name is required'],
    trim: true,
    maxlength: [100, 'Company name cannot exceed 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    match: [/^[\+]?[1-9][\d]{0,15}$/, 'Please enter a valid phone number']
  }, 
  address: {
    street: {
      type: String,
      required: [true, 'Street address is required'],
      trim: true
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true
    },
    state: {
      type: String,
      required: [true, 'State is required'],
      trim: true
    },
    zipCode: {
      type: String,
      required: [true, 'Zip code is required'],
      trim: true
    },
    country: {
      type: String,
      required: [true, 'Country is required'],
      trim: true,
      default: 'United States'
    }
  },
  policy: {
    privacyPolicy: {
      type: String,
      required: [true, 'Privacy policy is required']
    },
    termsOfService: {
      type: String,
      required: [true, 'Terms of service is required']
    },
    returnPolicy: {
      type: String,
      required: [true, 'Return policy is required']
    },
    shippingPolicy: {
      type: String,
      required: [true, 'Shipping policy is required']
    }
  },
  socialMedia: {
    facebook: { type: String, trim: true },
    twitter: { type: String, trim: true },
    instagram: { type: String, trim: true },
    linkedin: { type: String, trim: true }
  },
  logo: {
    type: logoSchema,
    trim: true
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  businessHours: {
    monday: { type: String, default: '9:00 AM - 6:00 PM' },
    tuesday: { type: String, default: '9:00 AM - 6:00 PM' },
    wednesday: { type: String, default: '9:00 AM - 6:00 PM' },
    thursday: { type: String, default: '9:00 AM - 6:00 PM' },
    friday: { type: String, default: '9:00 AM - 6:00 PM' },
    saturday: { type: String, default: '10:00 AM - 4:00 PM' },
    sunday: { type: String, default: 'Closed' }
  },
  currency: {
    type: String,
    default: 'USD'
  },
  taxSettings: {
    taxRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    taxNumber: {
      type: String,
      trim: true
    }
  },
  visitors: {
    type: [visitorSchema],
    default: []
  },
  analyticsSettings: {
    trackVisitors: {
      type: Boolean,
      default: true
    },
    storeIpAddress: {
      type: Boolean,
      default: true
    },
    anonymizeIp: {
      type: Boolean,
      default: false
    },
    retentionDays: {
      type: Number,
      default: 90,
      min: 1,
      max: 730
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index for better query performance
companySchema.index({ name: 1 });
companySchema.index({ email: 1 }, { unique: true });
companySchema.index({ 'visitors.visitDateTime': -1 });
companySchema.index({ 'visitors.ipAddress': 1 });
companySchema.index({ 'visitors.country': 1 });

// Static method to get active company
companySchema.statics.getActiveCompany = function() {
  return this.findOne({ isActive: true });
};

// Static method to add a visitor
companySchema.statics.addVisitor = async function(companyId, visitorData) {
  const company = await this.findById(companyId);
  if (!company) {
    throw new Error('Company not found');
  }

  // Anonymize IP if setting is enabled
  if (company.analyticsSettings.anonymizeIp && visitorData.ipAddress) {
    visitorData.ipAddress = visitorData.ipAddress.replace(/\.\d+$/, '.0');
  }

  // Don't store IP if setting is disabled
  if (!company.analyticsSettings.storeIpAddress) {
    visitorData.ipAddress = 'anonymous';
  }

  company.visitors.push(visitorData);
  
  // Clean old visitors based on retention days
  const retentionDate = new Date();
  retentionDate.setDate(retentionDate.getDate() - company.analyticsSettings.retentionDays);
  company.visitors = company.visitors.filter(visitor => 
    visitor.visitDateTime > retentionDate
  );

  return company.save();
};

// Static method to get visitor statistics
companySchema.statics.getVisitorStats = async function(companyId, startDate, endDate) {
  const company = await this.findById(companyId).select('visitors');
  if (!company) {
    throw new Error('Company not found');
  }

  const filteredVisitors = company.visitors.filter(visitor => {
    const visitDate = new Date(visitor.visitDateTime);
    return (!startDate || visitDate >= new Date(startDate)) &&
           (!endDate || visitDate <= new Date(endDate));
  });

  const stats = {
    totalVisits: filteredVisitors.length,
    uniqueVisitors: new Set(filteredVisitors.map(v => v.ipAddress)).size,
    byCountry: {},
    byDevice: {},
    byBrowser: {},
    visitsByDate: {},
    averageDuration: 0
  };

  let totalDuration = 0;
  let durationCount = 0;

  filteredVisitors.forEach(visitor => {
    // Count by country
    if (visitor.country) {
      stats.byCountry[visitor.country] = (stats.byCountry[visitor.country] || 0) + 1;
    }

    // Count by device
    if (visitor.device && visitor.device.type) {
      stats.byDevice[visitor.device.type] = (stats.byDevice[visitor.device.type] || 0) + 1;
    }

    // Count by browser
    if (visitor.browser && visitor.browser.name) {
      stats.byBrowser[visitor.browser.name] = (stats.byBrowser[visitor.browser.name] || 0) + 1;
    }

    // Group by date
    const dateKey = visitor.visitDateTime.toISOString().split('T')[0];
    stats.visitsByDate[dateKey] = (stats.visitsByDate[dateKey] || 0) + 1;

    // Calculate duration
    if (visitor.duration) {
      totalDuration += visitor.duration;
      durationCount++;
    }
  });

  if (durationCount > 0) {
    stats.averageDuration = Math.round(totalDuration / durationCount);
  }

  return stats;
};

// Instance method to get formatted address
companySchema.methods.getFormattedAddress = function() {
  const addr = this.address;
  return `${addr.street}, ${addr.city}, ${addr.state} ${addr.zipCode}, ${addr.country}`;
};

// Instance method to get recent visitors
companySchema.methods.getRecentVisitors = function(limit = 10) {
  return this.visitors
    .sort((a, b) => new Date(b.visitDateTime) - new Date(a.visitDateTime))
    .slice(0, limit);
};

// Instance method to clear old visitors
companySchema.methods.clearOldVisitors = function() {
  const retentionDate = new Date();
  retentionDate.setDate(retentionDate.getDate() - this.analyticsSettings.retentionDays);
  
  const initialCount = this.visitors.length;
  this.visitors = this.visitors.filter(visitor => 
    visitor.visitDateTime > retentionDate
  );
  
  return {
    removed: initialCount - this.visitors.length,
    remaining: this.visitors.length
  };
};

// Middleware to limit number of stored visitors (prevent unbounded growth)
companySchema.pre('save', function(next) {
  const MAX_VISITORS = 100000; // Maximum number of visitors to store
  
  if (this.visitors.length > MAX_VISITORS) {
    // Keep only the most recent MAX_VISITORS
    this.visitors = this.visitors
      .sort((a, b) => new Date(b.visitDateTime) - new Date(a.visitDateTime))
      .slice(0, MAX_VISITORS);
  }
  next();
});

const Company = mongoose.model('Company', companySchema);

module.exports = Company;