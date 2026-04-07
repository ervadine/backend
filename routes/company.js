// routes/companyRoutes.js
const express = require('express');
const router = express.Router();
const companyController = require('../controllers/CompanyController');
const { requireRole, protect } = require('../middleware/authentication');
const { uploadFiles, handleMulterError, cleanupUploads } = require('../middleware/upload-file');

// Public routes
router.get('/company', companyController.getCompany);
router.get('/company/policies', companyController.getPolicies);
router.get('/company/contact', companyController.getContactInfo);
router.get('/company/tax-rate', companyController.getTaxSettings);



router.post('/company/analytics/visitors/track', companyController.trackVisitor);

// Admin routes with logo upload support
router.post('/company/create', 
    protect, 
    requireRole('admin'),
    uploadFiles.single('logo'),
    handleMulterError,
    cleanupUploads,
    companyController.createCompany
);

router.put('/company/update', 
    protect, 
    requireRole('admin'),
    uploadFiles.single('logo'),
    handleMulterError,
    cleanupUploads,
    companyController.updateCompany
);

router.patch('/company/patch', 
    protect, 
    requireRole('admin'),
    uploadFiles.single('logo'),
    handleMulterError,
    cleanupUploads,
    companyController.patchCompany
);

// Special logo upload routes
router.post('/company/upload-logo',
    protect,
    requireRole('admin'),
    uploadFiles.single('logo'),
    handleMulterError,
    cleanupUploads,
    companyController.uploadLogo
);

router.delete('/company/delete-logo',
    protect,
    requireRole('admin'),
    companyController.deleteLogo
);

router.delete('/company/delete', 
    protect, 
    requireRole('admin'), 
    companyController.deleteCompany
);

// Analytics routes (admin only)
router.get('/company/analytics/visitors', protect, requireRole('admin'), companyController.getVisitorStats);
router.get('/company/analytics/visitors/recent', protect, requireRole('admin'), companyController.getRecentVisitors);
router.put('/company/analytics/settings', protect, requireRole('admin'), companyController.updateAnalyticsSettings);
router.delete('/company/analytics/visitors/cleanup', protect, requireRole('admin'), companyController.cleanupVisitors);
router.get('/company/analytics/demographics', protect, requireRole('admin'), companyController.getVisitorDemographics);
router.get('/company/analytics/activity', protect, requireRole('admin'), companyController.getVisitorActivity);
router.get('/company/analytics/visitors/export', protect, requireRole('admin'), companyController.exportVisitorData);

module.exports = router;