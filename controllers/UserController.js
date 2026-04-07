const asyncHandler = require("express-async-handler");
const HttpError = require('../middleware/HttpError');
const User = require('../models/User')
const mongoose = require('mongoose');
const {generateToken} = require('../middleware/authentication');
const { validationResult } = require('express-validator');
const crypto = require('crypto');
const { emailService } = require('../services/service-email');
const { uploadToCloudinary, deleteImage } = require('../utils/cloudinary');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

class UserController {
  
  // Helper method to handle validation
  handleValidation(req, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new HttpError('Validation failed', 400, errors.array()));
    }
    return null;
  }

// Add this method to your UserController class (after the existing getUsers method)

// @desc    Get all users with comprehensive search (Admin only)
// @route   GET /api/users/all
// @access  Private/Admin
getAllUsers = asyncHandler(async (req, res, next) => {
  try {
    // Extract query parameters with defaults
    const {
      page = 1,
      limit = 50, // Higher default for "all" users
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search,
      firstName,
      lastName,
      email,
      role,
      isActive,
      emailVerified,
      dateFrom,
      dateTo,
      lastLoginFrom,
      lastLoginTo
    } = req.query;

    // Build filter object
    const filter = {};

    // Multi-field search (if search parameter provided)
    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      filter.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { 
          $expr: {
            $regexMatch: {
              input: { $concat: ["$firstName", " ", "$lastName"] },
              regex: search,
              options: "i"
            }
          }
        }
      ];
    }

    // Individual field filters (override search if provided individually)
    if (firstName) {
      filter.firstName = { $regex: firstName, $options: 'i' };
    }
    
    if (lastName) {
      filter.lastName = { $regex: lastName, $options: 'i' };
    }
    
    if (email) {
      filter.email = { $regex: email, $options: 'i' };
    }
    
    if (role) {
      // Handle multiple roles (comma-separated)
      if (role.includes(',')) {
        filter.role = { $in: role.split(',').map(r => r.trim()) };
      } else {
        filter.role = role;
      }
    }
    
    if (isActive !== undefined) {
      filter.isActive = isActive === 'true' || isActive === true;
    }
    
    if (emailVerified !== undefined) {
      filter.emailVerified = emailVerified === 'true' || emailVerified === true;
    }

    // Date range filters
    const dateFilters = {};
    
    // Registration date range
    if (dateFrom || dateTo) {
      dateFilters.createdAt = {};
      if (dateFrom) {
        const fromDate = new Date(dateFrom);
        fromDate.setHours(0, 0, 0, 0);
        dateFilters.createdAt.$gte = fromDate;
      }
      if (dateTo) {
        const toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59, 999);
        dateFilters.createdAt.$lte = toDate;
      }
    }

    // Last login date range
    if (lastLoginFrom || lastLoginTo) {
      dateFilters.lastLogin = {};
      if (lastLoginFrom) {
        const fromDate = new Date(lastLoginFrom);
        fromDate.setHours(0, 0, 0, 0);
        dateFilters.lastLogin.$gte = fromDate;
      }
      if (lastLoginTo) {
        const toDate = new Date(lastLoginTo);
        toDate.setHours(23, 59, 59, 999);
        dateFilters.lastLogin.$lte = toDate;
      }
    }

    // Merge date filters if any exist
    if (Object.keys(dateFilters).length > 0) {
      Object.assign(filter, dateFilters);
    }

    // Parse pagination parameters
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(parseInt(limit), 100); // Cap at 100 users per request
    const skip = (pageNum - 1) * limitNum;

    // Validate sort order
    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    
    // Define allowed sort fields with default mappings
    const allowedSortFields = {
      'firstName': 'firstName',
      'lastName': 'lastName', 
      'email': 'email',
      'createdAt': 'createdAt',
      'updatedAt': 'updatedAt',
      'lastLogin': 'lastLogin',
      'role': 'role',
      'name': ['lastName', 'firstName'] // Combined name sort
    };
    
    let sort = {};
    if (sortBy === 'name') {
      // Special handling for name sorting (lastName then firstName)
      sort.lastName = sortDirection;
      sort.firstName = sortDirection;
    } else {
      const sortField = allowedSortFields[sortBy] || 'createdAt';
      sort[sortField] = sortDirection;
    }

    // Build projection (fields to return)
    const projection = {
      password: 0,
      emailVerificationToken: 0,
      resetPasswordToken: 0,
      resetPasswordExpires: 0,
      emailVerificationExpires: 0
    };

    // Execute query with pagination
    const users = await User.find(filter, projection)
      .skip(skip)
      .limit(limitNum)
      .sort(sort)
      .lean(); // Use lean() for better performance

    // Get total count for pagination
    const total = await User.countDocuments(filter);

    // Calculate additional statistics
    const userStats = {
      totalUsers: total,
      activeUsers: await User.countDocuments({ ...filter, isActive: true }),
      inactiveUsers: await User.countDocuments({ ...filter, isActive: false }),
      verifiedUsers: await User.countDocuments({ ...filter, emailVerified: true }),
      unverifiedUsers: await User.countDocuments({ ...filter, emailVerified: false }),
      byRole: {}
    };

    // Get count by role
    const roles = ['admin', 'customer', 'manager', 'staff'];
    for (const role of roles) {
      userStats.byRole[role] = await User.countDocuments({ ...filter, role });
    }

    // Add derived fields to users (like fullName) for easier frontend consumption
    const enhancedUsers = users.map(user => ({
      ...user,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
      initials: `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase()
    }));

    res.json({
      success: true,
      data: {
        users: enhancedUsers,
        stats: userStats,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
          hasNextPage: (pageNum * limitNum) < total,
          hasPrevPage: pageNum > 1,
          showing: `${skip + 1} - ${Math.min(skip + limitNum, total)} of ${total}`
        },
        filters: {
          applied: Object.keys(filter).length > 0,
          search,
          firstName,
          lastName,
          email,
          role,
          isActive,
          emailVerified,
          dateRange: {
            from: dateFrom,
            to: dateTo
          },
          lastLoginRange: {
            from: lastLoginFrom,
            to: lastLoginTo
          }
        },
        sort: {
          by: sortBy,
          order: sortOrder,
          direction: sortDirection
        }
      },
      message: `Found ${total} user${total !== 1 ? 's' : ''}`
    });
  } catch (error) {
    console.error('Get all users error:', error);
    return next(new HttpError('Failed to fetch users', 500));
  }
});



  // @desc    Register a new user
  // @route   POST /api/users/register
  // @access  Public
register = asyncHandler(async (req, res, next) => {
  
  const { firstName, lastName, email, password, confirmPassword, phone, role } = req.body;

  // Check if passwords match
  if (password !== confirmPassword) {
    return next(new HttpError('Passwords do not match', 400));
  }
 
  // Check if user already exists
  const existingUser = await User.findOne({email});
  if (existingUser) {
    return next(new HttpError('User with this email already exists', 400));
  }

  // Generate email verification token
  const emailVerificationToken = crypto.randomBytes(32).toString('hex');
  const emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

  const user = await User.create({
    firstName,
    lastName,
    email,
    password,
    phone,
    role: role || 'customer', // Default to customer if not provided
    emailVerificationToken,
    emailVerificationExpires
  });

 // Send verification email
setImmediate(async () => {
  try {
    await emailService.sendVerificationEmail(
      user.email,
      `${user.firstName} ${user.lastName}`,
      emailVerificationToken
    );
    console.log('✅ Verification email sent (async)');
  } catch (emailError) {
    console.error('Failed to send verification email:', emailError);
    // Log to error tracking service
    // Continue with registration even if email fails
  }
});
  // Generate token using the imported function
  const token = generateToken(user._id);

  res.status(201).json({
    success: true,
    data: {
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email, 
        phone: user.phone,
        role: user.role,
        avatar: user.avatar,
        emailVerified: user.emailVerified,
        isActive: user.isActive
      },
      token,
      expiresIn: process.env.JWT_TOKEN_EXP || "30d"
    },
    message: 'Registration successful. Please check your email to verify your account.'
  });
});

  // @desc    Verify email
  // @route   GET /api/users/verify-email/:token
  // @access  Public
  verifyEmail = asyncHandler(async (req, res, next) => {
    const { token } = req.params;

    if (!token) {
      return next(new HttpError('Verification token is required', 400));
    }

    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return next(new HttpError('Invalid or expired verification token', 400));
    }

    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Email verified successfully'
    });
  });

  // @desc    Resend verification email
  // @route   POST /api/users/resend-verification
  // @access  Private
  resendVerification = asyncHandler(async (req, res, next) => {
    const user = await User.findById(req.user._id);

    if (!user) {
      return next(new HttpError('User not found', 404));
    }

    if (user.emailVerified) {
      return next(new HttpError('Email is already verified', 400));
    }

    // Generate new verification token
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    const emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    user.emailVerificationToken = emailVerificationToken;
    user.emailVerificationExpires = emailVerificationExpires;
    await user.save();

    // Send verification email
    try {
    setImmediate(async () => {
  try {
    await emailService.sendVerificationEmail(
      user.email,
      `${user.firstName} ${user.lastName}`,
      emailVerificationToken
    );
    console.log('✅ Verification email sent (async)');
  } catch (emailError) {
    console.error('Failed to send verification email:', emailError);
    // Log to error tracking service
  }
});

      res.json({
        success: true,
        message: 'Verification email sent successfully'
      });
    } catch (error) {
      console.error('Failed to send verification email:', error);
      return next(new HttpError('Failed to send verification email', 500));
    }
  });

  // @desc    Login user
  // @route   POST /api/users/login
  // @access  Public
  login = asyncHandler(async (req, res, next) => {
    // Apply validation manually
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new HttpError('Validation failed', 400, errors.array()));
    }

    const { email, password } = req.body;

    // Find user and include password for comparison
    const user = await User.findOne({ email }).select('+password');
    
    if (!user) {
      return next(new HttpError('Invalid email or password', 401));
    }

    if (!(await user.comparePassword(password))) {
      return next(new HttpError('Invalid email or password', 401));
    }

    if (!user.isActive) {
      return next(new HttpError('Account has been deactivated. Please contact support.', 401));
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const token = generateToken(user._id);

    res.json({
      success: true,
      data: {
        user: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          role: user.role,
          avatar: user.avatar,
          emailVerified: user.emailVerified,
          isActive: user.isActive
        },
        token,
        expiresIn: process.env.JWT_TOKEN_EXP || "30d"
      },
      message: 'Login successful'
    });
  });

  // @desc    Forgot password
  // @route   POST /api/users/forgot-password
  // @access  Public
  forgotPassword = asyncHandler(async (req, res, next) => {
    // Apply validation manually
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new HttpError('Validation failed', 400, errors.array()));
    }

    const { email } = req.body;

    const user = await User.findOne({ email, isActive: true });

    if (!user) {
      // Don't reveal if email exists or not for security
      return res.json({
        success: true,
        message: 'If the email exists, a password reset link has been sent'
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = Date.now() + 60 * 60 * 1000; // 1 hour

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetTokenExpires;
    await user.save({ validateBeforeSave: false });

    // Send password reset email
    try {
    setImmediate(async () => {
  try {
    await emailService.sendPasswordResetEmail(
      user.email,
      `${user.firstName} ${user.lastName}`,
      resetToken
    );
    console.log('✅ Password reset email sent (async)');
  } catch (emailError) {
    console.error('Failed to send password reset email:', emailError);
    // Log to error tracking service
  }
});

      res.json({
        success: true,
        message: 'If the email exists, a password reset link has been sent'
      });
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      
      // Clear the reset token if email fails
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save({ validateBeforeSave: false });

      return next(new HttpError('Failed to send password reset email', 500));
    }
  });

  // @desc    Reset password
  // @route   POST /api/users/reset-password/:token
  // @access  Public
  resetPassword = asyncHandler(async (req, res, next) => {
    // Apply validation manually
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new HttpError('Validation failed', 400, errors.array()));
    }

    const { token } = req.params;
    const { password } = req.body;

    if (!token) {
      return next(new HttpError('Reset token is required', 400));
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() },
      isActive: true
    });

    if (!user) {
      return next(new HttpError('Invalid or expired reset token', 400));
    }

    // Update password and clear reset token
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    // Send confirmation email
    try {
     setImmediate(async () => {
  try {
    await emailService.sendPasswordResetConfirmation(
      user.email,
      `${user.firstName} ${user.lastName}`
    );
    console.log('✅ Password reset confirmation email sent (async)');
  } catch (emailError) {
    console.error('Failed to send password reset confirmation email:', emailError);
    // Log to error tracking service
  }
});
    } catch (emailError) {
      console.error('Failed to send password reset confirmation:', emailError);
      // Continue even if email fails
    }

    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  });

  // @desc    Get current user profile
  // @route   GET /api/users/profile
  // @access  Private
  getProfile = asyncHandler(async (req, res, next) => {
    const user = await User.findById(req.user._id) 
      .populate('wishlist', 'name price images   sizeConfig   colors ratings')
      .select('-password -emailVerificationToken -resetPasswordToken');

    if (!user) {
      return next(new HttpError('User not found', 404));
    }

    res.json({
      success: true,
      data: { user }
    });
  });

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
updateProfile = asyncHandler(async (req, res, next) => {
  // Apply validation manually
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log('Validation errors:', errors.array());
    return next(new HttpError('Validation failed', 400, errors.array()));
  }

  const { firstName, lastName, phone, avatar } = req.body;
  
  // Prepare update object
  const updateData = {};
  if (firstName) updateData.firstName = firstName;
  if (lastName) updateData.lastName = lastName;
  if (phone) updateData.phone = phone;

  // Handle avatar upload if file exists
  if (req.file) {
    console.log('File uploaded:', req.file);
    
    try {
      const uploadResult = await uploadToCloudinary(req.file.path, 'profiles');
      
      if (!uploadResult.success) {
        throw new Error('Failed to upload avatar image');
      }

      // Set avatar as object with all required fields
      updateData.avatar = {
        url: uploadResult.data.url,
        public_id: uploadResult.data.public_id,
        alt: `${firstName || ''} ${lastName || ''}`.trim() || 'User Avatar'
      };
      
      console.log('Avatar object to save:', updateData.avatar);
      
    } catch (uploadError) {
      console.error('Cloudinary upload error:', uploadError);
      return next(new HttpError('Failed to upload avatar image', 500));
    }
  } else if (avatar) {
    // Handle if avatar is being updated via URL (not file upload)
    // Check if avatar is a string (URL) or already an object
    if (typeof avatar === 'string') {
      updateData.avatar = {
        url: avatar,
        public_id: '',
        alt: `${firstName || ''} ${lastName || ''}`.trim() || 'User Avatar'
      };
    } else if (typeof avatar === 'object' && avatar.url) {
      // If it's already an object with url, use it directly
      updateData.avatar = avatar;
    }
  }

  // Update user with proper error handling
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $set: updateData }, // Use $set to ensure proper merging
    { 
      new: true, 
      runValidators: true,
      select: '-password -emailVerificationToken -resetPasswordToken'
    }
  );

  if (!user) {
    return next(new HttpError('User not found', 404));
  }

  // Clean up the uploaded file from local storage after Cloudinary upload
  if (req.file && req.file.path) {
    try {
      const fs = require('fs');
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
        console.log('Cleaned up local file:', req.file.path);
      }
    } catch (cleanupError) {
      console.error('Error cleaning up file:', cleanupError);
    }
  }

  res.json({
    success: true,
    data: { user },
    message: 'Profile updated successfully'
  });
});

  // @desc    Change password
  // @route   PUT /api/users/change-password
  // @access  Private
  changePassword = asyncHandler(async (req, res, next) => {
    // Apply validation manually
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new HttpError('Validation failed', 400, errors.array()));
    }

    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user._id).select('+password');
    
    if (!user) {
      return next(new HttpError('User not found', 404));
    }

    if (!(await user.comparePassword(currentPassword))) {
      return next(new HttpError('Current password is incorrect', 400));
    }

    user.password = newPassword;
    await user.save();

    // Send confirmation email
    try {
   setImmediate(async () => {
  try {
    await emailService.sendPasswordChangeConfirmation(
      user.email,
      `${user.firstName} ${user.lastName}`
    );
    console.log('✅ Password change confirmation email sent (async)');
  } catch (emailError) {
    console.error('Failed to send password change confirmation email:', emailError);
    // Log to error tracking service
  }
});
    } catch (emailError) {
      console.error('Failed to send password change confirmation:', emailError);
      // Continue even if email fails
    }

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  });

 // @desc    Add/Update user addresses
// @route   PUT /api/users/addresses
// @access  Private
updateAddresses = asyncHandler(async (req, res, next) => {
  // Apply validation manually
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new HttpError(`Validation failed ${errors.array()}`, 400));
  }

  const { addresses, phone } = req.body;

  // Validate that addresses is an array
  if (!Array.isArray(addresses)) {
    return next(new HttpError('Addresses must be an array', 400));
  }

  // Validate that only one address is set as default
  const defaultAddresses = addresses.filter(addr => addr.isDefault);
  if (defaultAddresses.length > 1) {
    return next(new HttpError('Only one address can be set as default', 400));
  }

  // Validate phone if provided
  if (phone && !/^\+?[1-9]\d{1,14}$/.test(phone)) {
    return next(new HttpError('Please provide a valid phone number', 400));
  }

  try {
    // Transform addresses to match MongoDB schema - INCLUDING APT FIELD
    const transformedAddresses = addresses.map((address, index) => { 
      // Create address object with proper field mapping
      const addressObj = {
        street: address.street?.trim(),
        apt: address.apt?.trim() || '', // Handle apt field
        city: address.city?.trim(),
        state: address.state?.trim(),
        zipCode: address.zipCode?.trim(),
        country: address.country?.trim() || 'USA',
        isDefault: Boolean(address.isDefault)
      };

      // Only include _id if it exists and is valid
      if (address._id && mongoose.Types.ObjectId.isValid(address._id)) {
        addressObj._id = address._id;
      } else if (address.id && mongoose.Types.ObjectId.isValid(address.id)) {
        addressObj._id = address.id;
      }
      // If no valid ID exists, MongoDB will create one automatically

      return addressObj;
    });

    // If no address is set as default and there are addresses, set the first one as default
    if (transformedAddresses.length > 0 && !transformedAddresses.some(addr => addr.isDefault)) {
      transformedAddresses[0].isDefault = true;
    }

    // Ensure only one address is default
    let foundDefault = false;
    transformedAddresses.forEach(addr => {
      if (addr.isDefault) {
        if (foundDefault) {
          addr.isDefault = false;
        } else {
          foundDefault = true;
        }
      }
    });

    // Prepare update object
    const updateData = {
      addresses: transformedAddresses
    };

    // Add phone to update if provided
    if (phone !== undefined) {
      updateData.phone = phone.trim();
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateData,
      { 
        new: true, 
        runValidators: true,
        select: '-password -emailVerificationToken -resetPasswordToken'
      }
    );

    if (!user) {
      return next(new HttpError('User not found', 404));
    }

    res.json({
      success: true,
      data: { 
        addresses: user.addresses,
        phone: user.phone 
      },
      message: 'Addresses and phone updated successfully'
    });
  } catch (error) {
    console.error('Update addresses error:', error);
    
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return next(new HttpError(`Validation failed: ${validationErrors.join(', ')}`, 400));
    }
    
    if (error.name === 'CastError') {
      return next(new HttpError('Invalid address ID format', 400));
    }
    
    return next(new HttpError('Failed to update addresses', 500));
  }
});

  // @desc    Add to wishlist
  // @route   POST /api/users/wishlist/:productId
  // @access  Private
  addToWishlist = asyncHandler(async (req, res, next) => {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return next(new HttpError('Invalid product ID', 400));
    }

    const user = await User.findById(req.user._id);
    
    if (!user) {
      return next(new HttpError('User not found', 404));
    }

    if (user.wishlist.includes(productId)) {
      return next(new HttpError('Product already in wishlist', 400));
    }

    user.wishlist.push(productId);
    await user.save();

    await user.populate('wishlist', 'name price images');

    res.json({
      success: true,
      data: { wishlist: user.wishlist },
      message: 'Product added to wishlist'
    });
  });

  // @desc    Remove from wishlist
  // @route   DELETE /api/users/wishlist/:productId
  // @access  Private
  removeFromWishlist = asyncHandler(async (req, res, next) => {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return next(new HttpError('Invalid product ID', 400));
    }

    const user = await User.findById(req.user._id);
    
    if (!user) {
      return next(new HttpError('User not found', 404));
    }

    user.wishlist = user.wishlist.filter(id => id.toString() !== productId);
    await user.save();

    await user.populate('wishlist', 'name price images');

    res.json({
      success: true,
      data: { wishlist: user.wishlist },
      message: 'Product removed from wishlist'
    });
  });

 // Update your existing getUsers method to this:

// @desc    Get users with basic pagination and search (Admin only)
// @route   GET /api/users
// @access  Private/Admin
getUsers = asyncHandler(async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const search = req.query.search;
  const firstName = req.query.firstName;
  const lastName = req.query.lastName;
  const email = req.query.email;
  const role = req.query.role;
  const isActive = req.query.isActive;
  const emailVerified = req.query.emailVerified;

  // Build filter
  const filter = {};
  
  // Multi-field search
  if (search) {
    const searchRegex = { $regex: search, $options: 'i' };
    filter.$or = [
      { firstName: searchRegex },
      { lastName: searchRegex },
      { email: searchRegex },
      { phone: searchRegex }
    ];
  }
  
  // Individual field filters
  if (firstName) {
    filter.firstName = { $regex: firstName, $options: 'i' };
  }
  
  if (lastName) {
    filter.lastName = { $regex: lastName, $options: 'i' };
  }
  
  if (email) {
    filter.email = { $regex: email, $options: 'i' };
  }
  
  if (role) filter.role = role;
  if (isActive !== undefined) filter.isActive = isActive === 'true';
  if (emailVerified !== undefined) filter.emailVerified = emailVerified === 'true';

  const users = await User.find(filter)
    .select('-password -emailVerificationToken -resetPasswordToken')
    .skip(skip)
    .limit(limit)
    .sort({ createdAt: -1 });

  const total = await User.countDocuments(filter);

  res.json({
    success: true,
    data: { 
      users: users.map(user => ({
        ...user.toObject(),
        fullName: `${user.firstName} ${user.lastName}`.trim()
      }))
    },
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

  // @desc    Get user by ID (Admin only)
  // @route   GET /api/users/:id
  // @access  Private/Admin
  getUserById = asyncHandler(async (req, res, next) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new HttpError('Invalid user ID', 400));
    }

    const user = await User.findById(id)
      .select('-password -emailVerificationToken -resetPasswordToken')
      .populate('wishlist', 'name price images');

    if (!user) {
      return next(new HttpError('User not found', 404));
    }

    res.json({
      success: true,
      data: { user }
    });
  });

  // @desc    Update user (Admin only)
  // @route   PUT /api/users/:id
  // @access  Private/Admin
  updateUser = asyncHandler(async (req, res, next) => {
    // Apply validation manually
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new HttpError('Validation failed', 400, errors.array()));
    }

    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new HttpError('Invalid user ID', 400));
    }

    const user = await User.findByIdAndUpdate(
      id,
      req.body,
      { 
        new: true, 
        runValidators: true,
        select: '-password -emailVerificationToken -resetPasswordToken'
      }
    );

    if (!user) {
      return next(new HttpError('User not found', 404));
    }

    res.json({
      success: true,
      data: { user },
      message: 'User updated successfully'
    });
  });

  // @desc    Delete user (Admin only)
  // @route   DELETE /api/users/:id
  // @access  Private/Admin
  deleteUser = asyncHandler(async (req, res, next) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new HttpError('Invalid user ID', 400));
    }

    const user = await User.findById(id);

    if (!user) {
      return next(new HttpError('User not found', 404));
    }

    // Prevent self-deletion
    if (user._id.toString() === req.user._id.toString()) {
      return next(new HttpError('Cannot delete your own account', 400));
    }

    // Send account deactivation email
    try {
     setImmediate(async () => {
  try {
    await emailService.sendAccountDeactivationEmail(
      user.email,
      `${user.firstName} ${user.lastName}`
    );
    console.log('✅ Account deactivation email sent (async)');
  } catch (emailError) {
    console.error('Failed to send account deactivation email:', emailError);
    // Log to error tracking service
  }
});
    } catch (emailError) {
      console.error('Failed to send deactivation email:', emailError);
      // Continue even if email fails
    }

    // Soft delete by setting isActive to false
    user.isActive = false;
    await user.save();

    res.json({
      success: true,
      message: 'User deactivated successfully'
    });
  });

  // @desc    Reactivate user (Admin only)
  // @route   PUT /api/users/:id/reactivate
  // @access  Private/Admin
  reactivateUser = asyncHandler(async (req, res, next) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new HttpError('Invalid user ID', 400));
    }

    const user = await User.findById(id);

    if (!user) {
      return next(new HttpError('User not found', 404));
    }

    // Send account reactivation email
    try {
    setImmediate(async () => {
  try {
    await emailService.sendAccountReactivationEmail(
      user.email,
      `${user.firstName} ${user.lastName}`
    );
    console.log('✅ Account reactivation email sent (async)');
  } catch (emailError) {
    console.error('Failed to send account reactivation email:', emailError);
    // Log to error tracking service
  }
});
    } catch (emailError) {
      console.error('Failed to send reactivation email:', emailError);
      // Continue even if email fails
    }

    user.isActive = true;
    await user.save();

    res.json({
      success: true,
      message: 'User reactivated successfully'
    });
  });

  // @desc    Get recently registered users
// @route   GET /api/users/recent
// @access  Private/Admin
getRecentUsers = asyncHandler(async (req, res, next) => {
  const { limit = 10, days = 7 } = req.query;
  
  // Parse limit to number and validate
  const limitNumber = parseInt(limit);
  if (isNaN(limitNumber) || limitNumber <= 0) {
    return next(new HttpError('Invalid limit parameter', 400));
  }
  
  // Parse days to number and validate
  const daysNumber = parseInt(days);
  if (isNaN(daysNumber) || daysNumber <= 0) {
    return next(new HttpError('Invalid days parameter', 400));
  }
  
  // Calculate date threshold
  const dateThreshold = new Date();
  dateThreshold.setDate(dateThreshold.getDate() - daysNumber);
  
  try {
    // Get recent users within the specified timeframe
    const recentUsers = await User.find({
      createdAt: { $gte: dateThreshold }
    })
    .select('-password -emailVerificationToken -resetPasswordToken')
    .sort({ createdAt: -1 })
    .limit(limitNumber);
    
    // Get total count for the same timeframe
    const totalRecentUsers = await User.countDocuments({
      createdAt: { $gte: dateThreshold }
    });
    
    // Get additional statistics
    const stats = {
      totalRecentUsers,
      timeframe: `${days} days`,
      activeUsers: 0,
      verifiedUsers: 0,
      averagePerDay: 0
    };
    
    // Calculate additional stats if we have users
    if (recentUsers.length > 0) {
      stats.activeUsers = recentUsers.filter(user => user.isActive).length;
      stats.verifiedUsers = recentUsers.filter(user => user.emailVerified).length;
      stats.averagePerDay = (totalRecentUsers / daysNumber).toFixed(1);
    }
    
    res.json({
      success: true,
      data: {
        users: recentUsers,
        stats,
        timeframe: {
          startDate: dateThreshold,
          endDate: new Date(),
          days: daysNumber
        },
        query: {
          limit: limitNumber,
          days: daysNumber
        }
      },
      message: `Found ${totalRecentUsers} users registered in the last ${days} days`
    });
  } catch (error) {
    console.error('Get recent users error:', error);
    return next(new HttpError('Failed to fetch recent users', 500));
  }
});

  // @desc    Get user statistics (Admin only)
  // @route   GET /api/users/stats
  // @access  Private/Admin
  getUserStats = asyncHandler(async (req, res, next) => {
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ isActive: true });
    const verifiedUsers = await User.countDocuments({ emailVerified: true });
    const adminUsers = await User.countDocuments({ role: 'admin' });

    // Get new users in the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const newUsers = await User.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
    });

    res.json({
      success: true,
      data: {
        totalUsers,
        activeUsers,
        verifiedUsers,
        adminUsers,
        newUsers
      }
    });
  });



addPaymentCard = asyncHandler(async (req, res, next) => {


  const {
    stripePaymentMethodId,
    cardholderName,
    expiryMonth,
    expiryYear,
    cardType,
    isDefault = false,
    billingAddress,
    metadata
  } = req.body;

  // Validate that stripePaymentMethodId is provided
  if (!stripePaymentMethodId) {
    return next(new HttpError('Stripe PaymentMethod ID is required', 400));
  }

  // Get user
  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new HttpError('User not found', 404));
  }

  try {
    // STEP 1: Retrieve the PaymentMethod from Stripe
    const stripePaymentMethod = await stripe.paymentMethods.retrieve(stripePaymentMethodId);
    
    console.log('✅ Stripe PaymentMethod retrieved:', {
      id: stripePaymentMethod.id,
      last4: stripePaymentMethod.card?.last4,
      brand: stripePaymentMethod.card?.brand,
      type: stripePaymentMethod.type
    });

    // Validate that it's a card payment method
    if (stripePaymentMethod.type !== 'card') {
      return next(new HttpError('Invalid payment method type', 400));
    }

    // Check if card already exists for this user
    const cardExists = user.paymentCards.some(
      card => card.stripePaymentMethodId === stripePaymentMethodId
    );
    
    if (cardExists) {
      return next(new HttpError('This card has already been added', 400));
    }

    // STEP 2: Get or create Stripe Customer
    let stripeCustomerId = user.stripeCustomerId;
    
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        metadata: {
          userId: user._id.toString(),
          userEmail: user.email
        }
      });
      stripeCustomerId = customer.id;
      user.stripeCustomerId = stripeCustomerId;
      await user.save();
      console.log('✅ Stripe Customer created:', stripeCustomerId);
    }

    // STEP 3: Attach PaymentMethod to Customer if not already attached
    try {
      await stripe.paymentMethods.attach(stripePaymentMethod.id, {
        customer: stripeCustomerId,
      });
      console.log('✅ PaymentMethod attached to customer');
    } catch (attachError) {
      // If already attached, this will throw an error - that's fine
      console.log('ℹ️ PaymentMethod may already be attached:', attachError.message);
    }

    // STEP 4: If this card is set as default, update other cards
    if (isDefault) {
      user.paymentCards.forEach(card => {
        card.isDefault = false;
      });
      
      // Also update default payment method in Stripe
      await stripe.customers.update(stripeCustomerId, {
        invoice_settings: {
          default_payment_method: stripePaymentMethod.id,
        },
      });
    }

    // STEP 5: Create card record using data from Stripe
    const detectedCardType = cardType || stripePaymentMethod.card?.brand || 'Unknown';
    const lastFourDigits = stripePaymentMethod.card?.last4 || '****';
    const finalExpiryMonth = expiryMonth || stripePaymentMethod.card?.exp_month;
    const finalExpiryYear = expiryYear || stripePaymentMethod.card?.exp_year;

    // Validate expiry date
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;
    
    if (finalExpiryYear < currentYear || 
        (finalExpiryYear === currentYear && finalExpiryMonth < currentMonth)) {
      return next(new HttpError('Card has expired', 400));
    }

    const newCard = {
      lastFourDigits: lastFourDigits,
      cardholderName: cardholderName,
      expiryMonth: parseInt(finalExpiryMonth),
      expiryYear: parseInt(finalExpiryYear),
      cardType: detectedCardType,
      stripePaymentMethodId: stripePaymentMethod.id,
      isDefault: isDefault || user.paymentCards.length === 0,
      billingAddress: billingAddress || {},
      metadata: metadata || new Map(),
      isActive: true,
    };

    user.paymentCards.push(newCard);
    await user.save();

    // Return the added card (excluding sensitive data)
    const addedCard = user.paymentCards[user.paymentCards.length - 1];
    
    res.status(201).json({
      success: true,
      data: {
        card: {
          _id: addedCard._id,
          cardholderName: addedCard.cardholderName,
          lastFourDigits: addedCard.lastFourDigits,
          expiryMonth: addedCard.expiryMonth,
          expiryYear: addedCard.expiryYear,
          cardType: addedCard.cardType,
          isDefault: addedCard.isDefault,
          stripePaymentMethodId: addedCard.stripePaymentMethodId,
          billingAddress: addedCard.billingAddress
        }
      },
      message: 'Payment card added successfully'
    });
    
  } catch (stripeError) {
    console.error('❌ Stripe error:', stripeError);
    
    if (stripeError.type === 'StripeCardError') {
      return next(new HttpError(stripeError.message, 400));
    } else if (stripeError.code === 'resource_missing') {
      return next(new HttpError('Invalid payment method ID', 400));
    } else {
      return next(new HttpError('Failed to add payment card. Please try again.', 500));
    }
  }
});

// Helper method to detect card type
detectCardType(cardNumber) {
  if (/^4/.test(cardNumber)) return 'Visa';
  if (/^5[1-5]/.test(cardNumber)) return 'MasterCard';
  if (/^3[47]/.test(cardNumber)) return 'American Express';
  if (/^6(?:011|5)/.test(cardNumber)) return 'Discover';
  return 'Other';
}

// @desc    Get all payment cards for logged-in user
// @route   GET /api/users/payment-cards
// @access  Private
getPaymentCards = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  
  if (!user) {
    return next(new HttpError('User not found', 404));
  }

  // Return masked card information with stripePaymentMethodId
  const maskedCards = user.paymentCards.map(card => ({
    _id: card._id,
    cardholderName: card.cardholderName,
    maskedNumber: `**** **** **** ${card.lastFourDigits}`,
    lastFourDigits: card.lastFourDigits,
    expiryMonth: card.expiryMonth,
    expiryYear: card.expiryYear,
    cardType: card.cardType,
    isDefault: card.isDefault,
    isActive: card.isActive,
    lastUsed: card.lastUsed,
    stripePaymentMethodId: card.stripePaymentMethodId, // Add this line - CRITICAL for saved card payments
    billingAddress: card.billingAddress
  }));

  res.json({
    success: true,
    data: {
      cards: maskedCards,
      total: user.paymentCards.length
    }
  });
});

// @desc    Get a specific payment card by ID
// @route   GET /api/users/payment-cards/:cardId
// @access  Private
getPaymentCardById = asyncHandler(async (req, res, next) => {
  const { cardId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(cardId)) {
    return next(new HttpError('Invalid card ID', 400));
  }

  const user = await User.findById(req.user._id);
  
  if (!user) {
    return next(new HttpError('User not found', 404));
  }

  const card = user.paymentCards.id(cardId);
  if (!card) {
    return next(new HttpError('Payment card not found', 404));
  }

  res.json({
    success: true,
    data: {
      card: {
        _id: card._id,
        cardholderName: card.cardholderName,
        maskedNumber: `**** **** **** ${card.lastFourDigits}`,
        lastFourDigits: card.lastFourDigits,
        expiryMonth: card.expiryMonth,
        expiryYear: card.expiryYear,
        cardType: card.cardType,
        isDefault: card.isDefault,
        isActive: card.isActive,
        lastUsed: card.lastUsed,
        billingAddress: card.billingAddress,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt
      }
    }
  });
});

// @desc    Update a payment card
// @route   PUT /api/users/payment-cards/:cardId
// @access  Private
updatePaymentCard = asyncHandler(async (req, res, next) => {
  const { cardId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(cardId)) {
    return next(new HttpError('Invalid card ID', 400));
  }



  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new HttpError('User not found', 404));
  }

  const card = user.paymentCards.id(cardId);
  if (!card) {
    return next(new HttpError('Payment card not found', 404));
  }

  const {
    cardholderName,
    expiryMonth,
    expiryYear,
    isDefault,
    billingAddress,
    isActive
  } = req.body;

  // Update basic fields if provided
  if (cardholderName) card.cardholderName = cardholderName;
  if (expiryMonth) card.expiryMonth = expiryMonth;
  if (expiryYear) card.expiryYear = expiryYear;
  if (isActive !== undefined) card.isActive = isActive;

  // Update billing address if provided
  if (billingAddress) {
    // Validate billing address fields
    const addressFields = ['street', 'city', 'state', 'zipCode', 'country'];
    const invalidFields = addressFields.filter(field => 
      billingAddress[field] !== undefined && 
      typeof billingAddress[field] !== 'string'
    );
    
    if (invalidFields.length > 0) {
      return next(new HttpError(`Invalid billing address fields: ${invalidFields.join(', ')}`, 400));
    }

    // Update only provided fields, preserve existing ones
    card.billingAddress = {
      street: billingAddress.street !== undefined ? billingAddress.street : card.billingAddress?.street,
      city: billingAddress.city !== undefined ? billingAddress.city : card.billingAddress?.city,
      state: billingAddress.state !== undefined ? billingAddress.state : card.billingAddress?.state,
      zipCode: billingAddress.zipCode !== undefined ? billingAddress.zipCode : card.billingAddress?.zipCode,
      country: billingAddress.country !== undefined ? billingAddress.country : card.billingAddress?.country || 'US',
    };
  }

  // Handle default card logic
  if (isDefault === true) {
    // Unset all other default cards
    user.paymentCards.forEach(c => {
      if (c._id.toString() !== cardId) {
        c.isDefault = false;
      }
    });
    card.isDefault = true;
  } else if (isDefault === false && card.isDefault) {
    // If explicitly setting to false and it was default, don't allow
    // unless there's another card to be default
    const otherCards = user.paymentCards.filter(c => c._id.toString() !== cardId);
    if (otherCards.length > 0) {
      card.isDefault = false;
      // Optionally set another card as default
      if (!otherCards.some(c => c.isDefault)) {
        otherCards[0].isDefault = true;
      }
    } else {
      return next(new HttpError('Cannot unset default card when it is the only card', 400));
    }
  }

  // Validate expiry date if updated
  if (expiryMonth || expiryYear) {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;
    
    const finalExpiryMonth = expiryMonth || card.expiryMonth;
    const finalExpiryYear = expiryYear || card.expiryYear;
    
    if (finalExpiryYear < currentYear || 
        (finalExpiryYear === currentYear && finalExpiryMonth < currentMonth)) {
      return next(new HttpError('Card has expired', 400));
    }
  }

  await user.save();

  // Return updated card with billing address
  res.json({
    success: true,
    data: {
      card: {
        _id: card._id,
        cardholderName: card.cardholderName,
        lastFourDigits: card.lastFourDigits,
        expiryMonth: card.expiryMonth,
        expiryYear: card.expiryYear,
        cardType: card.cardType,
        isDefault: card.isDefault,
        isActive: card.isActive,
        billingAddress: card.billingAddress || {
          street: '',
          city: '',
          state: '',
          zipCode: '',
          country: 'US'
        }
      }
    },
    message: 'Payment card updated successfully'
  });
});

deletePaymentCard = asyncHandler(async (req, res, next) => {
  const { cardId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(cardId)) {
    return next(new HttpError('Invalid card ID', 400));
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new HttpError('User not found', 404));
  }

  const card = user.paymentCards.id(cardId);
  if (!card) {
    return next(new HttpError('Payment card not found', 404));
  }

  const wasDefault = card.isDefault;
  
  // Remove the card using pull
  user.paymentCards.pull(cardId);
  
  // If we removed the default card and there are other cards, set a new default
  if (wasDefault && user.paymentCards.length > 0) {
    user.paymentCards[0].isDefault = true;
  }

  await user.save();

  res.json({
    success: true,
    message: 'Payment card deleted successfully'
  });
});

// @desc    Set a payment card as default
// @route   PUT /api/users/payment-cards/:cardId/default
// @access  Private
setDefaultPaymentCard = asyncHandler(async (req, res, next) => {
  const { cardId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(cardId)) {
    return next(new HttpError('Invalid card ID', 400));
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new HttpError('User not found', 404));
  }

  const card = user.paymentCards.id(cardId);
  if (!card) {
    return next(new HttpError('Payment card not found', 404));
  }

  if (!card.isActive) {
    return next(new HttpError('Cannot set inactive card as default', 400));
  }

  // Unset all cards as default
  user.paymentCards.forEach(c => {
    c.isDefault = false;
  });
  
  // Set selected card as default
  card.isDefault = true;
  await user.save();

  res.json({
    success: true,
    data: {
      card: {
        _id: card._id,
        lastFourDigits: card.lastFourDigits,
        cardType: card.cardType,
        isDefault: card.isDefault
      }
    },
    message: 'Default payment card updated successfully'
  });
});

// @desc    Update last used timestamp for a payment card
// @route   PUT /api/users/payment-cards/:cardId/last-used
// @access  Private (usually called internally when card is used for payment)
updateCardLastUsed = asyncHandler(async (req, res, next) => {
  const { cardId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(cardId)) {
    return next(new HttpError('Invalid card ID', 400));
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new HttpError('User not found', 404));
  }

  const card = user.paymentCards.id(cardId);
  if (!card) {
    return next(new HttpError('Payment card not found', 404));
  }

  card.lastUsed = new Date();
  await user.save();

  res.json({
    success: true,
    message: 'Card last used timestamp updated'
  });
});


}

module.exports =new UserController();