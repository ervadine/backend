// controllers/MessageController.js
const asyncHandler = require("express-async-handler");
const Message = require('../models/Message');
const { emailService } = require('../services/service-email');
const HttpError = require('../middleware/HttpError');

class MessageController {
  /**
   * @desc    Create a new message
   * @route   POST /api/messages
   * @access  Public
   */
  static createMessage = asyncHandler(async (req, res, next) => {
    const {
      name,
      email,
      phone,
      subject, 
      message,
      category,
      source 
    } = req.body;

    // Create message with metadata
    const newMessage = new Message({
      name,
      email,
      phone,
      subject,
      message,
      category,
      source,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      pageUrl: req.headers.referer
    });

    // If user is logged in, associate with their account
    if (req.user) {
      newMessage.user = req.user._id;
    }

    await newMessage.save();

    // Send notification to admin using setImmediate (non-blocking)
    setImmediate(async () => {
      try {
        await emailService.sendEmail({
          to: process.env.ADMIN_EMAIL || 'admin@example.com',
          subject: `New ${category || 'general'} message from ${name}`,
          html: `
            <!DOCTYPE html>
            <html> 
            <head>
              <meta charset="utf-8">
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .message-box { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
                .info-label { font-weight: bold; color: #495057; }
              </style>
            </head>
            <body>
              <div class="container">
                <h2>New Message Received</h2>
                <div class="message-box">
                  <p><span class="info-label">From:</span> ${name} (${email})</p>
                  <p><span class="info-label">Phone:</span> ${phone || 'Not provided'}</p>
                  <p><span class="info-label">Subject:</span> ${subject}</p>
                  <p><span class="info-label">Category:</span> ${category || 'general'}</p>
                  <p><span class="info-label">Message:</span></p>
                  <p>${message?.replace(/\n/g, '<br>') || ''}</p>
                  <p><span class="info-label">Received:</span> ${new Date().toLocaleString()}</p>
                  <p><span class="info-label">IP:</span> ${req.ip}</p>
                </div>
              </div>
            </body>
            </html>
          `
        });
      } catch (emailError) {
        console.error('Failed to send admin notification:', emailError);
        // Don't fail the request if email fails
      }
    });

    res.status(201).json({
      success: true,
      data: newMessage,
      message: 'Message sent successfully. We\'ll get back to you soon.'
    });
  });

  /**
   * @desc    Get all messages (with pagination, filtering, sorting)
   * @route   GET /api/messages
   * @access  Private/Admin
   */
  static getMessages = asyncHandler(async (req, res, next) => {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    // Build query
    const query = {};

    // Filter by status
    if (req.query.status && req.query.status !== 'all') {
      query.status = req.query.status;
    }

    // Filter by category
    if (req.query.category && req.query.category !== 'all') {
      query.category = req.query.category;
    }

    // Filter by priority
    if (req.query.priority && req.query.priority !== 'all') {
      query.priority = req.query.priority;
    }

    // Filter by date range
    if (req.query.startDate || req.query.endDate) {
      query.createdAt = {};
      if (req.query.startDate) {
        query.createdAt.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        query.createdAt.$lte = new Date(req.query.endDate);
      }
    }

    // Search in name, email, subject, or message
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      query.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { subject: searchRegex },
        { message: searchRegex }
      ];
    }

    // Execute query with pagination
    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'firstName lastName email')
      .populate('reply.repliedBy', 'firstName lastName email')
      .exec();

    const total = await Message.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    res.status(200).json({
      success: true,
      data: messages,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    });
  });

  /**
   * @desc    Get single message by ID
   * @route   GET /api/messages/:id
   * @access  Private/Admin
   */
  static getMessage = asyncHandler(async (req, res, next) => {
    const message = await Message.findById(req.params.id)
      .populate('user', 'firstName lastName email')
      .populate('reply.repliedBy', 'firstName lastName email')
      .populate('order', 'orderNumber');

    if (!message) {
      return next(new HttpError('Message not found', 404));
    }

    // Mark as read if requested
    if (req.query.markRead === 'true') {
      await message.markAsRead();
    }

    res.status(200).json({
      success: true,
      data: message
    });
  });

  /**
   * @desc    Update message status
   * @route   PATCH /api/messages/:id/status
   * @access  Private/Admin
   */
  static updateStatus = asyncHandler(async (req, res, next) => {
    const { status } = req.body;
    
    const message = await Message.findById(req.params.id);
    if (!message) {
      return next(new HttpError('Message not found', 404));
    }

    // Validate status
    const validStatuses = ['new', 'read', 'replied', 'archived', 'deleted'];
    if (!validStatuses.includes(status)) {
      return next(new HttpError('Invalid status value', 400));
    }

    message.status = status;
    
    // Update read count if marking as read
    if (status === 'read') {
      message.readCount += 1;
      message.lastReadAt = new Date();
    }
    
    await message.save();

    res.status(200).json({
      success: true,
      data: message,
      message: `Message status updated to ${status}`
    });
  });

  /**
   * @desc    Update message priority
   * @route   PATCH /api/messages/:id/priority
   * @access  Private/Admin
   */
  static updatePriority = asyncHandler(async (req, res, next) => {
    const { priority } = req.body;
    
    const message = await Message.findById(req.params.id);
    if (!message) {
      return next(new HttpError('Message not found', 404));
    }

    // Validate priority
    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    if (!validPriorities.includes(priority)) {
      return next(new HttpError('Invalid priority value', 400));
    }

    message.priority = priority;
    await message.save();

    res.status(200).json({
      success: true,
      data: message,
      message: `Message priority updated to ${priority}`
    });
  });

  /**
   * @desc    Add reply to message
   * @route   POST /api/messages/:id/reply
   * @access  Private/Admin
   */
  static addReply = asyncHandler(async (req, res, next) => {
    const { replyContent } = req.body;
    
    if (!replyContent || replyContent.trim().length < 1) {
      return next(new HttpError('Reply content is required', 400));
    }

    const message = await Message.findById(req.params.id)
      .populate('user', 'firstName lastName email');
     
    if (!message) {
      return next(new HttpError('Message not found', 404));
    }

    // Add reply using instance method
    await message.addReply(replyContent.trim(), req.user._id);

    // Send email reply to sender using setImmediate (non-blocking)
    if (replyContent.trim().length > 0) {
      setImmediate(async () => {
        try {
          await emailService.sendEmail({
            to: message.email,
            subject: `Re: ${message.subject}`,
            html: `
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <style>
                  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                  .original-message { background: #f8f9fa; padding: 15px; border-left: 4px solid #007bff; margin: 20px 0; }
                  .reply-message { background: #e8f5e9; padding: 15px; border-left: 4px solid #28a745; margin: 20px 0; }
                  .info-label { font-weight: bold; color: #495057; }
                </style>
              </head>
              <body>
                <div class="container">
                  <h2>Re: ${message.subject}</h2>
                  <p>Hello ${message.name},</p>
                  <p>Thank you for contacting us. Here's our response to your message:</p>
                  
                  <div class="reply-message">
                    <p>${replyContent.replace(/\n/g, '<br>')}</p>
                  </div>
                  
                  <div class="original-message">
                    <p><span class="info-label">Your original message:</span></p>
                    <p>${message.message?.replace(/\n/g, '<br>') || ''}</p>
                    <p><span class="info-label">Sent:</span> ${message.createdAt.toLocaleDateString()}</p>
                  </div>
                  
                  <p>If you have any further questions, please don't hesitate to reply to this email.</p>
                  <p>Best regards,<br>${process.env.APP_NAME || 'Customer Support'}</p>
                </div>
              </body>
              </html>
            `
          });
        } catch (emailError) {
          console.error('Failed to send reply email:', emailError);
          // Don't fail the request if email fails
        }
      });
    }

    const updatedMessage = await Message.findById(req.params.id)
      .populate('reply.repliedBy', 'firstName lastName email');

    res.status(200).json({
      success: true,
      data: updatedMessage,
      message: 'Reply added successfully'
    });
  });

  /**
   * @desc    Mark message as read
   * @route   PATCH /api/messages/:id/read
   * @access  Private/Admin
   */
  static markAsRead = asyncHandler(async (req, res, next) => {
    const message = await Message.findById(req.params.id);
    if (!message) {
      return next(new HttpError('Message not found', 404));
    }

    await message.markAsRead();

    res.status(200).json({
      success: true,
      data: message,
      message: 'Message marked as read'
    });
  });

  /**
   * @desc    Archive message
   * @route   PATCH /api/messages/:id/archive
   * @access  Private/Admin
   */
  static archiveMessage = asyncHandler(async (req, res, next) => {
    const message = await Message.findById(req.params.id);
    if (!message) {
      return next(new HttpError('Message not found', 404));
    }

    await message.archive();

    res.status(200).json({
      success: true,
      data: message,
      message: 'Message archived successfully'
    });
  });

  /**
   * @desc    Restore message from archive
   * @route   PATCH /api/messages/:id/restore
   * @access  Private/Admin
   */
  static restoreMessage = asyncHandler(async (req, res, next) => {
    const message = await Message.findById(req.params.id);
    if (!message) {
      return next(new HttpError('Message not found', 404));
    }

    await message.restore();

    res.status(200).json({
      success: true,
      data: message,
      message: 'Message restored successfully'
    });
  });

  /**
   * @desc    Delete message (soft delete)
   * @route   DELETE /api/messages/:id
   * @access  Private/Admin
   */
  static deleteMessage = asyncHandler(async (req, res, next) => {
    const message = await Message.findById(req.params.id);
    if (!message) {
      return next(new HttpError('Message not found', 404));
    }

    // Soft delete by updating status
    message.status = 'deleted';
    await message.save();

    res.status(200).json({
      success: true,
      message: 'Message deleted successfully'
    });
  });

  /**
   * @desc    Get message statistics
   * @route   GET /api/messages/stats
   * @access  Private/Admin
   */
  static getStatistics = asyncHandler(async (req, res, next) => {
    const stats = await Message.getStatistics();
    
    // Additional stats by date range if provided
    let dateRangeStats = {};
    if (req.query.startDate || req.query.endDate) {
      const dateQuery = {};
      if (req.query.startDate) {
        dateQuery.createdAt = { $gte: new Date(req.query.startDate) };
      }
      if (req.query.endDate) {
        dateQuery.createdAt = { 
          ...dateQuery.createdAt,
          $lte: new Date(req.query.endDate) 
        };
      }
      
      const dateRangeCount = await Message.countDocuments(dateQuery);
      dateRangeStats = {
        dateRangeCount,
        startDate: req.query.startDate,
        endDate: req.query.endDate
      };
    }

    // Recent messages count (last 7 days)
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    const recentCount = await Message.countDocuments({
      createdAt: { $gte: lastWeek }
    });

    // Unread messages count
    const unreadCount = await Message.countDocuments({ status: 'new' });

    res.status(200).json({
      success: true,
      data: {
        ...stats,
        recentCount,
        unreadCount,
        ...dateRangeStats
      }
    });
  });

  /**
   * @desc    Get messages by user
   * @route   GET /api/messages/user/:userId
   * @access  Private/Admin
   */
  static getMessagesByUser = asyncHandler(async (req, res, next) => {
    const messages = await Message.find({ user: req.params.userId })
      .sort({ createdAt: -1 })
      .populate('user', 'firstName lastName email')
      .exec();

    res.status(200).json({
      success: true,
      data: messages,
      count: messages.length
    });
  });

  /**
   * @desc    Get messages by email
   * @route   GET /api/messages/email/:email
   * @access  Private/Admin
   */
  static getMessagesByEmail = asyncHandler(async (req, res, next) => {
    const messages = await Message.find({ email: req.params.email })
      .sort({ createdAt: -1 })
      .populate('user', 'firstName lastName email')
      .exec();

    res.status(200).json({
      success: true,
      data: messages,
      count: messages.length
    });
  });

  /**
   * @desc    Bulk update message status
   * @route   PATCH /api/messages/bulk/status
   * @access  Private/Admin
   */
  static bulkUpdateStatus = asyncHandler(async (req, res, next) => {
    const { messageIds, status } = req.body;

    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return next(new HttpError('Please provide message IDs', 400));
    }

    // Validate status
    const validStatuses = ['new', 'read', 'replied', 'archived', 'deleted'];
    if (!validStatuses.includes(status)) {
      return next(new HttpError('Invalid status value', 400));
    }

    const result = await Message.updateMany(
      { _id: { $in: messageIds } },
      { $set: { status } }
    );

    res.status(200).json({
      success: true,
      message: `${result.modifiedCount} messages updated`,
      modifiedCount: result.modifiedCount
    });
  });

  /**
   * @desc    Export messages to CSV
   * @route   GET /api/messages/export
   * @access  Private/Admin
   */
  static exportMessages = asyncHandler(async (req, res, next) => {
    const messages = await Message.find({})
      .sort({ createdAt: -1 })
      .populate('user', 'firstName lastName email')
      .lean();

    // Convert to CSV format
    const csvHeaders = [
      'ID',
      'Name',
      'Email',
      'Phone',
      'Subject',
      'Message',
      'Category',
      'Status',
      'Priority',
      'Created At',
      'User ID',
      'User Name'
    ];

    const csvRows = messages.map(msg => [
      msg._id,
      `"${msg.name}"`,
      msg.email,
      msg.phone || '',
      `"${msg.subject}"`,
      `"${msg.message?.replace(/"/g, '""') || ''}"`,
      msg.category,
      msg.status,
      msg.priority,
      msg.createdAt.toISOString(),
      msg.user?._id || '',
      msg.user ? `${msg.user.firstName} ${msg.user.lastName}` : ''
    ]);

    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map(row => row.join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=messages-${Date.now()}.csv`);
    res.status(200).send(csvContent);
  });
}

module.exports = MessageController;