// routes/orderRoutes.js
const express = require('express');
const router = express.Router();
const OrderController = require('../controllers/OrderController');
const { protect, requireRole } = require('../middleware/authentication');

// Public webhook route (no authentication)
router.post('/webhook', express.raw({ type: 'application/json' }), OrderController.handleWebhook);

// Validate order before payment (no admin required, but protected)
router.post('/orders/validate', protect, OrderController.validateOrder);

// Create payment intent for checkout
router.post('/orders/create-payment-intent', protect, OrderController.createPaymentIntent);

// Create new order
router.post('/orders/create-order', protect, OrderController.createOrder);

// Get user's orders
router.get('/orders', protect, OrderController.getOrders);

// Get single order
router.get('/orders/:orderId', protect, OrderController.getOrder);

// Confirm payment for order
router.post('/orders/:orderId/confirm-payment', protect, OrderController.confirmPayment);

// Check payment status
router.get('/orders/:orderId/payment-status', protect, OrderController.checkPaymentStatus);
// Handle payment failure
router.post('/orders/:orderId/payment-failed', protect, OrderController.handlePaymentFailure);

// Cancel order
router.put('/orders/:orderId/cancel', protect, OrderController.cancelOrder);
router.post('/orders/verify-payment', protect, OrderController.verifyPayment);
// ==================== ADMIN ROUTES ====================

// Get all orders (admin only)
router.get('/orders/admin/all', protect, OrderController.getAllOrders);

// Get single order by ID (admin only)
router.get('/orders/admin/:orderId', protect, requireRole("admin"), OrderController.getOrderById);

// Update order details (admin only)
router.put('/orders/admin/:orderId', protect, requireRole("admin"), OrderController.updateOrder);

// Update order status (admin only)
router.put('/orders/admin/:orderId/status', protect, requireRole("admin"), OrderController.updateOrderStatusAdmin);

// Cancel order (admin only)
router.put('/orders/admin/:orderId/cancel', protect, requireRole("admin"), OrderController.cancelOrderAdmin);

// Refund order (admin only)
router.put('/orders/admin/:orderId/refund', protect, requireRole("admin"), OrderController.refundOrder);

// Get order notes (admin only)
router.get('/orders/admin/:orderId/notes', protect, requireRole("admin"), OrderController.getOrderNotes);

// Add order note (admin only)
router.post('/orders/admin/:orderId/notes', protect, requireRole("admin"), OrderController.addOrderNote);

// Get status history (admin only)
router.get('/orders/admin/:orderId/status-history', protect, requireRole("admin"), OrderController.getStatusHistory);

// Search order by order number (admin only)
router.get('/orders/admin/search/:orderNumber', protect, requireRole("admin"), OrderController.searchOrderByNumber);

// Get dashboard statistics (admin only)
router.get('/orders/admin/stats/dashboard', protect, requireRole("admin"), OrderController.getDashboardStats);

// Get recent orders (admin only)
router.get('/orders/admin/recent', protect, requireRole("admin"), OrderController.getRecentOrders);

module.exports = router;