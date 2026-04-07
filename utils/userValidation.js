const { body } = require('express-validator');
const validator = require('validator');
const User = require('../models/User');

const validateUserRegistration = [
  body('firstName')
    .trim()
    .notEmpty()
    .withMessage('First name is required')
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage('First name can only contain letters, spaces, hyphens, and apostrophes'),

  body('lastName')
    .trim()
    .notEmpty()
    .withMessage('Last name is required')
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage('Last name can only contain letters, spaces, hyphens, and apostrophes'),

  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail()
    .isLength({ max: 100 })
    .withMessage('Email must be less than 100 characters')
    .custom(async (email) => {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        throw new Error('Email already exists');
      }
      return true;
    }),

  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
    .isLength({ max: 128 })
    .withMessage('Password must be less than 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number')
    .matches(/^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]*$/)
    .withMessage('Password contains invalid characters'),

  body('phone')
    .optional({ checkFalsy: true })
    .custom((value) => {
      if (value && !/^\+?[1-9]\d{1,14}$/.test(value)) {
        throw new Error('Please provide a valid phone number with country code');
      }
      return true;
    })
    .isLength({ max: 20 })
    .withMessage('Phone number must be less than 20 characters'),

  body('role')
    .optional()
    .isIn(['customer', 'admin'])
    .withMessage('Role must be either customer or admin')
];

const validateUserLogin = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail()
    .notEmpty()
    .withMessage('Email is required'),

  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 1 })
    .withMessage('Password is required')
];

const validateUserUpdate = [
  body('firstName')
    .optional({ checkFalsy: true })
    .trim()
    .notEmpty()
    .withMessage('First name cannot be empty')
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage('First name can only contain letters, spaces, hyphens, and apostrophes'),

  body('lastName')
    .optional({ checkFalsy: true })
    .trim()
    .notEmpty()
    .withMessage('Last name cannot be empty')
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage('Last name can only contain letters, spaces, hyphens, and apostrophes'),

  body('phone')
    .optional({ checkFalsy: true })
    .custom((value) => {
      if (value && !/^\+?[1-9]\d{1,14}$/.test(value)) {
        throw new Error('Please provide a valid phone number with country code');
      }
      return true;
    })
    .isLength({ max: 20 })
    .withMessage('Phone number must be less than 20 characters'),

  body('role')
    .optional()
    .isIn(['customer', 'admin'])
    .withMessage('Role must be either customer or admin'),

  // Remove the avatar validation or make it optional and skip when file is present
  body('avatar')
    .optional()
    .custom((value, { req }) => {
      // Skip validation if this is a file upload (multer will handle it)
      if (req.file) {
        return true;
      }
      // If it's a URL string, validate it
      if (value && typeof value === 'string') {
        const urlPattern = /^(http|https):\/\/[^ "]+$/;
        if (!urlPattern.test(value)) {
          throw new Error('Avatar must be a valid URL');
        }
      }
      return true;
    })
];

const validateAddress = [
  body('addresses')
    .isArray({ min: 1 })
    .withMessage('Addresses must be an array with at least one address')
    .custom((addresses) => {
      if (addresses.length > 10) {
        throw new Error('Cannot have more than 10 addresses');
      }
      return true;
    }),



  body('addresses.*.street')
    .notEmpty()
    .withMessage('Street address is required')
    .trim()
    .isLength({ min: 5, max: 255 })
    .withMessage('Street address must be between 5 and 255 characters')
    .matches(/^[a-zA-Z0-9\s,.-]+$/)
    .withMessage('Street address contains invalid characters'),

  body('addresses.*.city')
    .notEmpty()
    .withMessage('City is required')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('City must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s-]+$/)
    .withMessage('City can only contain letters, spaces, and hyphens'),

  body('addresses.*.state')
    .notEmpty()
    .withMessage('State is required')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('State must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s-]+$/)
    .withMessage('State can only contain letters, spaces, and hyphens'),

  body('addresses.*.zipCode')
    .notEmpty()
    .withMessage('Zip code is required')
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Zip code must be between 3 and 20 characters')
    .matches(/^[a-zA-Z0-9-\s]+$/)
    .withMessage('Zip code contains invalid characters'),

  body('addresses.*.country')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Country must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s-]+$/)
    .withMessage('Country can only contain letters, spaces, and hyphens'),

  body('addresses.*.isDefault')
    .optional()
    .isBoolean()
    .withMessage('isDefault must be a boolean value'),

  body('addresses')
    .custom((addresses) => {
      const defaultAddresses = addresses.filter(addr => addr.isDefault);
      if (defaultAddresses.length > 1) {
        throw new Error('Only one address can be set as default');
      }
      return true;
    })
];

const validatePasswordChange = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required')
    .isLength({ min: 1 })
    .withMessage('Current password is required'),

  body('newPassword')
    .notEmpty()
    .withMessage('New password is required')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters long')
    .isLength({ max: 128 })
    .withMessage('New password must be less than 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('New password must contain at least one uppercase letter, one lowercase letter, and one number')
    .matches(/^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]*$/)
    .withMessage('New password contains invalid characters')
    .custom((newPassword, { req }) => {
      if (newPassword === req.body.currentPassword) {
        throw new Error('New password must be different from current password');
      }
      return true;
    })
];

const validateForgotPassword = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail()
    .notEmpty()
    .withMessage('Email is required')
    .isLength({ max: 100 })
    .withMessage('Email must be less than 100 characters')
];

const validateResetPassword = [
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
    .isLength({ max: 128 })
    .withMessage('Password must be less than 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number')
    .matches(/^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]*$/)
    .withMessage('Password contains invalid characters')
];

const validateAdminUserUpdate = [
  body('firstName')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('First name cannot be empty')
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage('First name can only contain letters, spaces, hyphens, and apostrophes'),

  body('lastName')
    .optional()
    .trim()
    .notEmpty() 
    .withMessage('Last name cannot be empty')
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage('Last name can only contain letters, spaces, hyphens, and apostrophes'),

  body('phone')
    .optional({ checkFalsy: true })
    .custom((value) => {
      if (value && !/^\+?[1-9]\d{1,14}$/.test(value)) {
        throw new Error('Please provide a valid phone number with country code');
      }
      return true;
    })
    .isLength({ max: 20 })
    .withMessage('Phone number must be less than 20 characters'),

  body('role')
    .optional()
    .isIn(['customer', 'admin'])
    .withMessage('Role must be either customer or admin'),

  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean value'),

  body('emailVerified')
    .optional()
    .isBoolean()
    .withMessage('emailVerified must be a boolean value')
];

const validateBulkUserActions = [
  body('userIds')
    .isArray({ min: 1 })
    .withMessage('User IDs must be an array with at least one ID')
    .custom((userIds) => {
      if (userIds.length > 100) {
        throw new Error('Cannot process more than 100 users at once');
      }
      
      // Validate each ID is a valid MongoDB ObjectId
      const objectIdRegex = /^[0-9a-fA-F]{24}$/;
      for (const id of userIds) {
        if (!objectIdRegex.test(id)) {
          throw new Error(`Invalid user ID: ${id}`);
        }
      }
      return true;
    }),

  body('action')
    .isIn(['activate', 'deactivate', 'delete'])
    .withMessage('Action must be activate, deactivate, or delete')
];

const validatePaymentCard = [
  // Stripe PaymentMethod ID (replaces cardNumber and paymentToken)
  body('stripePaymentMethodId')
    .notEmpty()
    .withMessage('Stripe PaymentMethod ID is required')
    .isString()
    .withMessage('Stripe PaymentMethod ID must be a string')
    .matches(/^pm_[a-zA-Z0-9]+$/)
    .withMessage('Invalid Stripe PaymentMethod ID format'),

  body('cardholderName')
    .notEmpty()
    .withMessage('Cardholder name is required')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Cardholder name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage('Cardholder name can only contain letters, spaces, hyphens, and apostrophes'),

  // Optional fields that will come from Stripe or be auto-detected
  body('expiryMonth')
    .optional()
    .isInt({ min: 1, max: 12 })
    .withMessage('Expiry month must be between 1 and 12'),

  body('expiryYear')
    .optional()
    .isInt({ min: new Date().getFullYear(), max: new Date().getFullYear() + 20 })
    .withMessage(`Expiry year must be between ${new Date().getFullYear()} and ${new Date().getFullYear() + 20}`),

  body('cardType')
    .optional()
    .isIn(['Visa', 'MasterCard', 'American Express', 'Discover', 'Unknown'])
    .withMessage('Invalid card type'),

  body('isDefault')
    .optional()
    .isBoolean()
    .withMessage('isDefault must be a boolean value'),

  body('billingAddress')
    .optional()
    .isObject()
    .withMessage('Billing address must be an object'),

  body('billingAddress.street')
    .optional()
    .trim()
    .isLength({ min: 5, max: 255 })
    .withMessage('Billing street must be between 5 and 255 characters'),

  body('billingAddress.apt')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Apartment/suite must be less than 100 characters'),

  body('billingAddress.city')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Billing city must be between 2 and 100 characters'),

  body('billingAddress.state')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Billing state must be between 2 and 100 characters'),

  body('billingAddress.zipCode')
    .optional()
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Billing zip code must be between 3 and 20 characters'),

  body('billingAddress.country')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Billing country must be between 2 and 100 characters'),

  body('metadata')
    .optional()
    .isObject()
    .withMessage('Metadata must be an object')
];

const validatePaymentCardUpdate = [
  body('cardholderName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Cardholder name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage('Cardholder name can only contain letters, spaces, hyphens, and apostrophes'),

  body('expiryMonth')
    .optional()
    .isInt({ min: 1, max: 12 })
    .withMessage('Expiry month must be between 1 and 12'),

  body('expiryYear')
    .optional()
    .isInt({ min: new Date().getFullYear(), max: new Date().getFullYear() + 20 })
    .withMessage(`Expiry year must be between ${new Date().getFullYear()} and ${new Date().getFullYear() + 20}`)
    .custom((expiryYear, { req }) => {
      if (req.body.expiryMonth && expiryYear) {
        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth() + 1;
        const expiryMonth = parseInt(req.body.expiryMonth);
        
        if (expiryYear < currentYear) {
          throw new Error('Card has expired');
        }
        if (expiryYear === currentYear && expiryMonth < currentMonth) {
          throw new Error('Card has expired');
        }
      }
      return true;
    }),

  body('isDefault')
    .optional()
    .isBoolean()
    .withMessage('isDefault must be a boolean value'),

  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean value'),

  body('billingAddress')
    .optional()
    .isObject()
    .withMessage('Billing address must be an object'),

  body('billingAddress.street')
    .optional()
    .trim()
    .isLength({ min: 5, max: 255 })
    .withMessage('Billing street must be between 5 and 255 characters'),

  body('billingAddress.city')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Billing city must be between 2 and 100 characters'),

  body('billingAddress.state')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Billing state must be between 2 and 100 characters'),

  body('billingAddress.zipCode')
    .optional()
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Billing zip code must be between 3 and 20 characters'),

  body('billingAddress.country')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Billing country must be between 2 and 100 characters'),

  body('metadata')
    .optional()
    .isObject()
    .withMessage('Metadata must be an object')
];

// Helper function to detect card type from card number (for frontend validation)
const detectCardType = (cardNumber) => {
  const patterns = {
    'Visa': /^4[0-9]{12}(?:[0-9]{3})?$/,
    'MasterCard': /^5[1-5][0-9]{14}$|^2(?:2(?:2[1-9]|[3-9][0-9])|[3-6][0-9][0-9]|7(?:[01][0-9]|20))[0-9]{12}$/,
    'American Express': /^3[47][0-9]{13}$/,
    'Discover': /^6(?:011|5[0-9]{2})[0-9]{12}$/
  };
  
  for (const [type, pattern] of Object.entries(patterns)) {
    if (pattern.test(cardNumber.replace(/\s/g, ''))) {
      return type;
    }
  }
  return 'Other';
};

// Helper function to get last 4 digits from card number
const getLastFourDigits = (cardNumber) => {
  const cleaned = cardNumber.replace(/\s/g, '');
  return cleaned.slice(-4);
};

module.exports = {
  validateUserRegistration,
  validateUserLogin,
  validateUserUpdate,
  validateAddress,
  validatePasswordChange,
  validateForgotPassword,
  validateResetPassword,
  validateAdminUserUpdate,
  validateBulkUserActions,
   validatePaymentCard,      // Add this
  validatePaymentCardUpdate, // Add this
  detectCardType,           // Add this helper
  getLastFourDigits         // Add this helper
};