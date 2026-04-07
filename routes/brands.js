// backend/routes/brandRoutes.js
const express = require('express');
const router = express.Router();
const BrandController = require('../controllers/BrandController');
const { protect, requireRole } = require('../middleware/authentication');
const { uploadFiles } = require('../middleware/upload-file');

// Public routes
router.get('/brands', BrandController.getAllBrands);
router.get('/brands/active', BrandController.getActiveBrands);
router.get('/brands/featured', BrandController.getFeaturedBrands);
router.get('/brands/search', BrandController.searchBrands);
router.get('/brands/slug/:slug', BrandController.getBrandBySlug);
router.get('/brands/getOne/:id', BrandController.getBrandById);
router.get('/brands/:id/products', BrandController.getProductsByBrand);

// Protected Admin routes
router.post(
  '/brands/create',
  protect,
  requireRole('admin'), 
  uploadFiles.single('logo'),
  BrandController.createBrand
);

router.put(
  '/brands/update/:id',
  protect,
  requireRole('admin'),
  uploadFiles.single('logo'),
  BrandController.updateBrand
);

router.delete(
  '/brands/:id',
  protect,
  requireRole('admin'),
  BrandController.deleteBrand
);

// Logo management routes
router.post(
  '/brands/:id/logo',
  protect,
  requireRole('admin'),
  uploadFiles.single('logo'),
  BrandController.uploadLogo
);

router.delete(
  '/brands/:id/logo',
  protect,
  requireRole('admin'),
  BrandController.deleteLogo
);

// Bulk operations
router.patch(
  '/brands/bulk/status',
  protect,
  requireRole('admin'),
  BrandController.bulkUpdateStatus
);

module.exports = router;