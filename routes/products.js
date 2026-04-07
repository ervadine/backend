const express = require('express');
const router = express.Router();
const ProductController = require('../controllers/ProductController');
const { protect, requireRole } = require('../middleware/authentication');
const { uploadFiles,handleMulterError,cleanupUploads } = require('../middleware/upload-file');

// Public routes
router.get('/products', ProductController.getAllProducts);
router.get('/product/featured', ProductController.getFeaturedProducts);
router.get('/product/featured/:sex', ProductController.getFeaturedProductsBySex);
//router.get('/product/sex/:sex', ProductController.getProductsBySex);
//router.get('/product/category/:categoryId/sex/:sex', ProductController.getProductsByCategoryAndSex);
router.get('/search/color', ProductController.searchByColor);
router.get('/product/colors/available', ProductController.getAvailableColors);
router.get('/product/colors/multiple', ProductController.getProductsByMultipleColors);
router.get('/product/:id', ProductController.getProduct);
router.get('/product/:id/related', ProductController.getRelatedProducts);
//router.get('/product/:slug', ProductController.getProductBySlug);
router.post('/products/by-brands', ProductController.getProductsByBrands);
router.get('/product/validate/:id', ProductController.validateProductId);
//router.get('/product/category/:categoryId', ProductController.getProductsByCategory);
//router.get('/products/category-slug/:slug', ProductController.getProductsByCategorySlug);

// Admin routes with image upload
router.post('/upload-product-images', protect, requireRole('admin'),

  uploadFiles.array('images', 10), // Allow up to 10 files
  handleMulterError, // Add error handling middleware
  cleanupUploads, // Add cleanup middleware
 ProductController.uploadProductImages);
router.post('/create-product',  
  protect, 
  requireRole('admin'),  
  uploadFiles.array('images', 26), // Allow up to 10 files
  handleMulterError, // Add error handling middleware
  cleanupUploads, // Add cleanup middleware
  ProductController.createProduct
);
router.put('/product/update/:id', protect, requireRole('admin'),


  uploadFiles.array('images', 26), // Allow up to 10 files
  handleMulterError, // Add error handling middleware
  cleanupUploads, // Add cleanup middleware
ProductController.updateProduct);


router.patch('/product/:id/status', protect, requireRole('admin'), ProductController.toggleProductStatus);
router.patch('/product/:id/inventory', protect, requireRole('admin'), ProductController.updateInventory);
router.delete('/delete-product/:id', protect, requireRole('admin'), ProductController.deleteProduct);
router.get('/products/on-sale', protect,ProductController.getProductsOnSale);
router.get('/product/category/stats', protect, requireRole('admin'),ProductController.getProductsOnSale);
router.get('/products/new-arrivals', protect, requireRole('admin'),ProductController.getNewArrivals);


router.post('/product/:id/colors/:colorValue/images', uploadFiles.array('images'), ProductController.addColorImages);
router.delete('/product/:id/colors/:colorValue/image', ProductController.deleteColorImages);
router.patch('/product/:id/colors/:colorValue/primary-image', ProductController.setColorPrimaryImage);
router.get('/product/:id/colors/:colorValue/images', ProductController.getColorImages);

// Display order management
router.patch('/product/:id/colors/display-order', ProductController.updateColorDisplayOrder);
router.patch('/product/:id/colors/:colorValue/images/display-order', ProductController.updateImageDisplayOrder);


router.post('/products/by-ids', ProductController.getProductsByIds);
router.patch('/products/bulk/update', protect, requireRole('admin'), ProductController.bulkUpdateProducts);
router.get('/product/stats/sex/:sex', protect, requireRole('admin'), ProductController.getProductStatsBySex);
router.get('/product/inventory/low-stock', protect, requireRole('admin'), ProductController.getLowStockProducts);
router.get('/products/best-selling',protect, requireRole('admin'),ProductController.getBestSellingProducts);
module.exports = router; 