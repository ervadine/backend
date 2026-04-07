const jwt = require('jsonwebtoken');
const User = require('../models/User');
const asyncHandler = require('express-async-handler');

const protect = asyncHandler(async (req, res, next) => {
  // Check if Authorization header exists
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer')) {
    // No token provided - user is not authenticated
    // But we still continue (no error) - let route handlers check if auth is needed
    req.user = null;
    return next();
  }

  try {
    // Extract and verify token
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);

    // Find user
    req.user = await User.findById(decoded.userId).select('-password');
    
    if (!req.user) {
      req.user = null;
      return next();
    }

    if (!req.user.isActive) {
      req.user = null;
      return next();
    }

    // Update last login
    await User.findByIdAndUpdate(decoded.userId, { 
      lastLogin: new Date() 
    });

    next();
  } catch (error) {
    console.error('Token verification error:', error);
    // Token is invalid - user is not authenticated
    req.user = null;
    next();
  }
});

// Optional: Create a stricter middleware for routes that REQUIRE authentication
const requireAuth = asyncHandler(async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: {
        status: 401,
        message: 'Authentication required'
      }
    });
  }
  
  if (!req.user.isActive) {
    return res.status(401).json({
      error: {
        status: 401,
        message: 'Account has been deactivated'
      }
    });
  }
  
  next();
});

// Role-based access control (combine with requireAuth)
const requireRole = (...roles) => {
  return asyncHandler(async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: {
          status: 401,
          message: 'Authentication required'
        }
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: {
          status: 403,
          message: `Access denied. Required roles: ${roles.join(', ')}`
        }
      });
    }

    next();
  });
};


const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET_KEY,
    { expiresIn: process.env.JWT_TOKEN_EXP || "30d" }
  );
};


module.exports = {
  protect,       // Sets req.user if valid token exists, otherwise req.user = null
  requireAuth,   // Ensures req.user exists
  requireRole,   // Combines requireAuth with role check
  generateToken
};