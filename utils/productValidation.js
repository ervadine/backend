// validations/productValidation.js
const { body, param, query } = require('express-validator');
const mongoose = require('mongoose');

const createProductValidation = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Product name is required')
    .isLength({ max: 200 })
    .withMessage('Product name cannot exceed 200 characters'),

  body('description')
    .trim()
    .notEmpty()
    .withMessage('Product description is required')
    .isLength({ max: 2000 })
    .withMessage('Description cannot exceed 2000 characters'),

  body('price')
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),

  body('comparePrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Compare price must be a positive number'),

  body('cost')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Cost must be a positive number'),

  body('quantity')
    .isInt({ min: 0 })
    .withMessage('Quantity must be a non-negative integer'),

  body('category')
    .notEmpty()
    .withMessage('Category is required')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid category ID'),

  body('brand')
    .optional()
    .custom((value) => {
      if (value && !mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid brand ID');
      }
      return true;
    }),

  body('images')
    .optional()
    .isArray()
    .withMessage('Images must be an array'),

  body('images.*.url')
    .if(body('images').exists())
    .notEmpty()
    .withMessage('Image URL is required')
    .isURL()
    .withMessage('Invalid image URL'),

  body('variants')
    .optional()
    .isArray()
    .withMessage('Variants must be an array'),

  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array'),

  body('specifications')
    .optional()
    .isArray()
    .withMessage('Specifications must be an array'),

  body('seo.title')
    .optional()
    .isLength({ max: 60 })
    .withMessage('SEO title cannot exceed 60 characters'),

  body('seo.description')
    .optional()
    .isLength({ max: 160 })
    .withMessage('SEO description cannot exceed 160 characters')
];

const updateProductValidation = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid product ID'),

  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Product name cannot be empty')
    .isLength({ max: 200 })
    .withMessage('Product name cannot exceed 200 characters'),

  body('price')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),

  body('category')
    .optional()
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid category ID'),

  body('brand')
    .optional()
    .custom((value) => {
      if (value && !mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid brand ID');
      }
      return true;
    })
];

const getProductsValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),

  query('category')
    .optional()
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid category ID'),

  query('brand')
    .optional()
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid brand ID'),

  query('minPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Minimum price must be a positive number'),

  query('maxPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Maximum price must be a positive number')
];

const idParamValidation = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid product ID')
];

module.exports = {
  createProductValidation,
  updateProductValidation,
  getProductsValidation,
  idParamValidation
};