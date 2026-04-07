const express = require('express');
const router = express.Router();
const MessageController = require('../controllers/MessageController');
const { protect, requireRole } = require('../middleware/authentication');

// Public routes
router.post('/messages/send', MessageController.createMessage);

// Admin routes (protected)



router.get('/messages',protect,requireRole('admin'), MessageController.getMessages);
router.get('/messages/stats',protect, MessageController.getStatistics);
router.get('/messages/export',protect,requireRole('admin'), MessageController.exportMessages);
router.get('/messages/user/:userId',protect,requireRole('admin'), MessageController.getMessagesByUser);
router.get('/messages/email/:email',protect,requireRole('admin'), MessageController.getMessagesByEmail);
router.get('/messages/getOne/:id',protect,requireRole('admin'), MessageController.getMessage);

router.put('/messages/:id/status',protect,requireRole('admin'), MessageController.updateStatus);
router.patch('/messages/:id/priority',protect,requireRole('admin'), MessageController.updatePriority);
router.patch('/messages/:id/read',protect,requireRole('admin'), MessageController.markAsRead);
router.patch('/messages/:id/archive',protect,requireRole('admin'), MessageController.archiveMessage);
router.patch('/messages/:id/restore',protect,requireRole('admin'), MessageController.restoreMessage);
router.put('/messages/:id/reply',protect,requireRole('admin'), MessageController.addReply);
router.patch('/messages/bulk/status',protect,requireRole('admin'), MessageController.bulkUpdateStatus);
router.delete('/messages/delete/:id',protect,requireRole('admin'), MessageController.deleteMessage);

module.exports = router;  