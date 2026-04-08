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



module.exports = router;
