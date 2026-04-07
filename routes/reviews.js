const express = require('express');
const router = express.Router();
const ReviewController = require('../controllers/ReviewController');
const { protect } = require('../middleware/authentication');

// Public routes
router.get('/products/:productId/reviews', ReviewController.getProductReviews);
router.get('/reviews/:id', ReviewController.getReview);

// Protected routes
router.post('/products/:productId/reviews',  protect, ReviewController.createReview);
router.put('/reviews/:id',  protect, ReviewController.updateReview);
router.delete('/reviews/:id',  protect, ReviewController.deleteReview);
router.post('/reviews/:id/helpful',  protect, ReviewController.markHelpful);
router.get('/users/me/reviews',  protect, ReviewController.getUserReviews);

module.exports = router; 