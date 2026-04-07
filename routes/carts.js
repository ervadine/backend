const express = require('express');
const router = express.Router();
const CartController = require('../controllers/CartController');

// GET /api/cart/items - Get user's cart
router.get('/cart/items', CartController.getCart);

// POST /api/cart/add-item - Add item to cart
router.post('/cart/add-item', CartController.addToCart);

// PUT /api/cart/update-item/:itemId - Update cart item quantity
router.put('/cart/update-item/:itemId', CartController.updateCartItem);

// DELETE /api/cart/delete-item/:itemId - Remove item from cart
router.delete('/cart/delete-item/:itemId', CartController.removeFromCart);

// DELETE /api/cart/clear-items - Clear entire cart
router.delete('/cart/clear-items', CartController.clearCart);

// POST /api/cart/apply-coupon - Apply coupon to cart
router.post('/cart/apply-coupon', CartController.applyCoupon);

// DELETE /api/cart/remove-coupon - Remove coupon from cart
router.delete('/cart/remove-coupon', CartController.removeCoupon);

// GET /api/cart/summary - Get cart summary
router.get('/cart/summary', CartController.getCartSummary);

// Additional routes
router.get('/cart/count', CartController.getCartCount);
router.get('/cart/check-product', CartController.checkProductInCart);
router.get('/cart/validate', CartController.validateCart);

module.exports = router;