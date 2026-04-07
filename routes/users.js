const express = require('express');
const router = express.Router();
const UserController = require('../controllers/UserController');
const { protect, requireRole } = require('../middleware/authentication');
const { uploadAvatar, handleMulterError, uploadFiles } = require('../middleware/upload-file');
const {
  validateUserRegistration,
  validateUserLogin,
  validateUserUpdate,
  validateAddress,
  validatePasswordChange,
  validateForgotPassword,
  validateResetPassword,
  validatePaymentCard, // Add this validation 
  validatePaymentCardUpdate // Add this validation
} = require('../utils/userValidation');

// PUBLIC
router.post('/users/register', validateUserRegistration, UserController.register);
router.post('/users/login', validateUserLogin, UserController.login);
router.get('/users/verify-email/:token', UserController.verifyEmail);
router.post('/users/forgot-password', validateForgotPassword, UserController.forgotPassword);
router.post('/users/reset-password/:token', validateResetPassword, UserController.resetPassword);

// PROTECTED
router.get('/users/profile', protect, UserController.getProfile);
router.put('/users/update-profile',uploadAvatar.single('avatar'),handleMulterError, protect,  validateUserUpdate,UserController.updateProfile);
router.put('/users/change-password', protect, validatePasswordChange, UserController.changePassword);
router.put('/users/addresses', protect, validateAddress, UserController.updateAddresses);
router.post('/users/wishlist/:productId', protect, UserController.addToWishlist);
router.delete('/users/wishlist/:productId', protect, UserController.removeFromWishlist);
router.post('/users/resend-verification', protect, UserController.resendVerification);

// PAYMENT CARD ROUTES (PROTECTED)
router.get('/users/payment-cards', protect, UserController.getPaymentCards);
router.get('/users/payment-cards/:cardId', protect, UserController.getPaymentCardById);
router.post('/users/payment-cards', protect, validatePaymentCard, UserController.addPaymentCard);
router.put('/users/payment-cards/:cardId', protect, validatePaymentCardUpdate, UserController.updatePaymentCard);
router.delete('/users/payment-cards/:cardId', protect, UserController.deletePaymentCard);
router.put('/users/payment-cards/:cardId/default', protect, UserController.setDefaultPaymentCard);
router.put('/users/payment-cards/:cardId/last-used', protect, UserController.updateCardLastUsed);

// ADMIN
router.get('/users/all', protect, requireRole('admin'), UserController.getAllUsers);
router.get('/users', protect, requireRole('admin'), UserController.getUsers);
router.get('/users/stats', protect, requireRole('admin'), UserController.getUserStats);
router.get('/users/recent', protect, requireRole('admin'), UserController.getRecentUsers);
router.get('/users/:id', protect, requireRole('admin'), UserController.getUserById);
router.put('/users/update/:id', protect, requireRole('admin'), validateUserUpdate, UserController.updateUser);
router.delete('/users/delete/:id', protect, requireRole('admin'), UserController.deleteUser);
router.put('/users/:id/reactivate', protect, requireRole('admin'), UserController.reactivateUser);



module.exports = router;