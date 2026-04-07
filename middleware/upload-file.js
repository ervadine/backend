// backend/middleware/upload-file.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const fileExtension = path.extname(file.originalname);
    cb(null, 'image-' + uniqueSuffix + fileExtension);
  }
});

// File filter function
const fileFilter = (req, file, cb) => {
  // Check if file is an image
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

// Configure multer for multiple files
const uploadFiles = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit per file
    files: 10 // Allow up to 10 files (adjust as needed)
  }
});


const uploadAvatar = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit for avatar
  }
});


// Error handling middleware for multer
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 5MB per file.'
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Maximum 10 files are allowed.'
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Unexpected field name. Use "images" as field name.'
      });
    }
  } else if (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
  next();
};

// Cleanup uploaded files after request
const cleanupUploads = (req, res, next) => {
  // Store the original send function
  const originalSend = res.send;

  // Override the send function
  res.send = function (data) {
    // Cleanup uploaded files after response is sent
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          try {
            fs.unlinkSync(file.path);
            console.log('Cleaned up uploaded file:', file.path);
          } catch (error) {
            console.error('Error cleaning up file:', error);
          }
        }
      });
    }
    
    // Call the original send function
    originalSend.call(this, data);
  };

  next();
};

module.exports = {
  uploadFiles,
  uploadAvatar,
  handleMulterError,
  cleanupUploads
};