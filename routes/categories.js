// routes/categoryRoutes.js
const express = require('express');
const router = express.Router();
const CategoryController = require('../controllers/CategoryController');
const { uploadFiles } = require('../middleware/upload-file');
const { protect, requireRole } = require('../middleware/authentication');

// Public routes
router.get('/categories', CategoryController.getCategories);
router.get('/category/sex-options', CategoryController.getSexOptions);
router.get('/category/sex/:sex', CategoryController.getCategoriesBySex);
router.get('/category/sex/:sex/tree', CategoryController.getCategoryTreeBySex);
router.get('/category/navigation', CategoryController.getNavigationCategories);
router.get('/category/:slug', CategoryController.getCategoryBySlug);
router.get('/category/stats/sex/:sex', CategoryController.getCategoryStatsBySex);
router.get('/category/getOne/:id', CategoryController.getCategoryById);

// Admin routes
router.post('/category/new', protect, requireRole("admin"), uploadFiles.single('image'), CategoryController.createCategory);
router.put('/category/update/:id', protect, requireRole("admin"), uploadFiles.single('image'), CategoryController.updateCategory);
router.delete('/category/delete/:id', protect, requireRole("admin"), CategoryController.deleteCategory);
router.patch('/category/:id/toggle-status', protect, requireRole("admin"), CategoryController.toggleCategoryStatus);

module.exports = router; 