const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  // Sender Information
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
  },
  
  phone: {
    type: String,
    trim: true,
    match: [/^[\+]?[1-9][\d]{0,15}$/, 'Please provide a valid phone number']
  },
  
  // Message Details
  subject: {
    type: String,
    required: [true, 'Subject is required'],
    trim: true,
    minlength: [5, 'Subject must be at least 5 characters'],
    maxlength: [200, 'Subject cannot exceed 200 characters']
  },
  
  message: {
    type: String,
    required: [true, 'Message is required'],
    trim: true,
    minlength: [10, 'Message must be at least 10 characters'],
    maxlength: [5000, 'Message cannot exceed 5000 characters']
  },
  
  // Category/Type
  category: {
    type: String,
    enum: {
      values: ['general', 'support', 'sales',  'contact-form','technical', 'feedback', 'complaint', 'partnership', 'damaged_item','other']
    },
    default: 'general'
  },
  
  // Status Tracking
  status: {
    type: String,
    enum: {
      values: ['new', 'read', 'replied', 'archived', 'deleted']
    },
    default: 'new'
  },
  
  priority: {
    type: String,
    enum: {
      values: ['low', 'medium', 'high', 'urgent']
    },
    default: 'medium'
  },
  
  // Reply Information
  reply: {
    content: {
      type: String,
      trim: true,
      maxlength: [5000, 'Reply cannot exceed 5000 characters']
    },
    repliedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    repliedAt: {
      type: Date
    }
  },
  
  // Metadata
  ipAddress: {
    type: String,
    trim: true
  },
  
  userAgent: {
    type: String,
    trim: true
  },
  
  source: {
    type: String,
    enum: ['contact_form', 'order_page', 'product_page', 'app', 'api', 'other'],
    default: 'contact_form'
  },
  
  pageUrl: {
    type: String,
    trim: true
  },
  
  // Attachments (if needed in future)
  attachments: [{
    filename: String,
    originalname: String,
    mimetype: String,
    size: Number,
    url: String,
    public_id: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Customer/User Reference (if logged in)
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  
  // Statistics
  readCount: {
    type: Number,
    default: 0
  },
  
  lastReadAt: {
    type: Date
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for formatted createdAt
messageSchema.virtual('formattedCreatedAt').get(function() {
  return this.createdAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
});

// Virtual for formatted updatedAt
messageSchema.virtual('formattedUpdatedAt').get(function() {
  return this.updatedAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
});

// Virtual for reply info
messageSchema.virtual('hasReply').get(function() {
  return !!this.reply?.content;
});

// Indexes for efficient queries
messageSchema.index({ status: 1, createdAt: -1 });
messageSchema.index({ email: 1, createdAt: -1 });
messageSchema.index({ priority: 1, createdAt: -1 });
messageSchema.index({ category: 1, createdAt: -1 });
messageSchema.index({ user: 1, createdAt: -1 });

// Pre-save middleware to update updatedAt
messageSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Instance method to mark as read
messageSchema.methods.markAsRead = function() {
  this.status = 'read';
  this.readCount += 1;
  this.lastReadAt = new Date();
  return this.save();
};

// Instance method to add reply
messageSchema.methods.addReply = function(content, repliedBy) {
  this.reply = {
    content,
    repliedBy,
    repliedAt: new Date()
  };
  this.status = 'replied';
  return this.save();
};

// Instance method to archive
messageSchema.methods.archive = function() {
  this.status = 'archived';
  return this.save();
};

// Instance method to restore from archive
messageSchema.methods.restore = function() {
  if (this.status === 'archived') {
    this.status = 'new';
  }
  return this.save();
};

// Static method to get statistics
messageSchema.statics.getStatistics = async function() {
  try {
    // Get total counts by status using simple queries
    const [
      total,
      newCount,
      readCount,
      repliedCount,
      archivedCount,
      deletedCount
    ] = await Promise.all([
      this.countDocuments(),
      this.countDocuments({ status: 'new' }),
      this.countDocuments({ status: 'read' }),
      this.countDocuments({ status: 'replied' }),
      this.countDocuments({ status: 'archived' }),
      this.countDocuments({ status: 'deleted' })
    ]);

    // Get priority counts
    const priorityCounts = await this.aggregate([
      {
        $group: {
          _id: '$priority',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get category counts
    const categoryCounts = await this.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get daily counts for last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentStats = await this.aggregate([
      {
        $match: {
          createdAt: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt'
            }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      },
      {
        $project: {
          date: '$_id',
          count: 1,
          _id: 0
        }
      }
    ]);

    // Calculate response rate
    const responseRate = total > 0 ? Math.round((repliedCount / total) * 100) : 0;

    // Convert priority counts to object
    const priorityStats = {};
    priorityCounts.forEach(item => {
      priorityStats[item._id] = item.count;
    });

    // Convert category counts to object
    const categoryStats = {};
    categoryCounts.forEach(item => {
      categoryStats[item._id] = item.count;
    });

    return {
      total,
      new: newCount,
      read: readCount,
      replied: repliedCount,
      archived: archivedCount,
      deleted: deletedCount,
      priorityStats,
      categoryStats,
      recentStats,
      summary: {
        responseRate: `${responseRate}%`,
        avgResponseTime: '24h', // You can calculate this if you track reply times
        totalCategories: Object.keys(categoryStats).length,
        totalPriorities: Object.keys(priorityStats).length
      }
    };
  } catch (error) {
    console.error('Error in getStatistics:', error);
    // Return default stats in case of error
    return {
      total: 0,
      new: 0,
      read: 0,
      replied: 0,
      archived: 0,
      deleted: 0,
      priorityStats: {},
      categoryStats: {},
      recentStats: [],
      summary: {
        responseRate: '0%',
        avgResponseTime: '0h',
        totalCategories: 0,
        totalPriorities: 0
      }
    };
  }
};

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;