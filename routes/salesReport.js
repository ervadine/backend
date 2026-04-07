// routes/salesRoutes.js
const express = require('express');
const router = express.Router();
const SalesReportController = require('../controllers/SalesReportController');
const { protect, requireRole } = require('../middleware/authentication');

// Sales Report Routes

router.route('/sales/report')
  .get( protect, requireRole("admin"), SalesReportController.getSalesReport);

router.route('/sales/stats')
  .get( protect, requireRole("admin"), SalesReportController.getSalesStats);

router.route('/sales/top-products')
  .get( protect, requireRole("admin"), SalesReportController.getTopProducts);

router.route('/sales/by-category')
  .get( protect, requireRole("admin"), SalesReportController.getSalesByCategory);

router.route('/sales/customer-stats')
  .get( protect, requireRole("admin"), SalesReportController.getCustomerStats);

router.route('/sales/export')
  .get( protect, requireRole("admin"), SalesReportController.exportSalesReport);

router.route('/sales/dashboard')
  .get( protect, requireRole("admin"), SalesReportController.getDashboardData);

module.exports = router;