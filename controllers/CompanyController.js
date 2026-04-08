// controllers/CompanyController.js
const asyncHandler = require("express-async-handler");
const HttpError = require('../middleware/HttpError');
const Company = require('../models/Company');
const { uploadSingleImage, deleteImage, uploadToCloudinary } = require('../utils/cloudinary');
const fs = require('fs');
const path = require('path');

class CompanyController {
    
    // @desc    Get company information
    // @route   GET /api/company
    // @access  Public
    getCompany = asyncHandler(async (req, res) => {
        const company = await Company.getActiveCompany(); 
        
        res.status(200).json({
            success: true,
            data: company
        });
    });

    // @desc    Create company information
    // @route   POST /api/company
    // @access  Private/Admin
    createCompany = asyncHandler(async (req, res) => {
        let companyData;
        
        // Check if data comes as FormData with a 'data' field
        if (req.body.data) {
            companyData = JSON.parse(req.body.data);
        } else {
            companyData = req.body;
        }

        const {
            name,
            email,
            phone,
            address,
            policy,
            socialMedia,
            description,
            businessHours,
            currency,
            taxSettings,
            analyticsSettings
        } = companyData;

        // Check if company already exists
        const existingCompany = await Company.findOne();
        if (existingCompany) {
            throw new HttpError('Company information already exists. Use update instead.', 400);
        }

        // Handle logo upload if provided as file
        let logoData = null;
        if (req.file) {
            const uploadResult = await uploadSingleImage(req.file, 'company/logos');
            if (!uploadResult.success) {
                throw new HttpError(`Failed to upload logo: ${uploadResult.error}`, 500);
            }
            logoData = {
                url: uploadResult.data.url,
                public_id: uploadResult.data.public_id,
                format: uploadResult.data.format
            };
        }

        const company = await Company.create({
            name,
            email,
            phone,
            address,
            policy,
            socialMedia,
            logo: logoData,
            description,
            businessHours,
            currency,
            taxSettings,
            analyticsSettings
        });

        res.status(201).json({
            success: true,
            message: 'Company information created successfully',
            data: company
        });
    });

    // @desc    Update company information
    // @route   PUT /api/company
    // @access  Private/Admin
    updateCompany = asyncHandler(async (req, res) => {
        const {
            name,
            email,
            phone,
            address,
            policy,
            socialMedia,
            logo,
            description,
            businessHours,
            currency,
            taxSettings,
            analyticsSettings,
            isActive
        } = req.body;

        let company = await Company.getActiveCompany();
        
        if (!company) {
            throw new HttpError('Company not found', 404);
        }

        // Handle logo upload if a new file is provided
        let logoData = logo;
        if (req.file) {
            // Delete old logo from Cloudinary if exists
            if (company.logo && company.logo.public_id) {
                await deleteImage(company.logo.public_id).catch(err => 
                    console.error('Error deleting old logo:', err)
                );
            }

            // Upload new logo
            const uploadResult = await uploadSingleImage(req.file, 'company/logos');
            if (!uploadResult.success) {
                throw new HttpError(`Failed to upload logo: ${uploadResult.error}`, 500);
            }
            logoData = {
                url: uploadResult.data.url,
                public_id: uploadResult.data.public_id,
                format: uploadResult.data.format
            };
        }

        company = await Company.findByIdAndUpdate(
            company._id,
            {
                name,
                email,
                phone,
                address,
                policy,
                socialMedia,
                logo: logoData,
                description,
                businessHours,
                currency,
                taxSettings,
                analyticsSettings,
                isActive
            },
            {
                new: true,
                runValidators: true
            }
        );

        res.status(200).json({
            success: true,
            message: 'Company information updated successfully',
            data: company
        });
    });

    // @desc    Update specific company fields
    // @route   PATCH /api/company
    // @access  Private/Admin
    patchCompany = asyncHandler(async (req, res) => {
        const updates = req.body;
        const allowedUpdates = [
            'name', 'email', 'phone', 'address', 'policy', 
            'socialMedia', 'logo', 'description', 'businessHours', 
            'currency', 'taxSettings', 'analyticsSettings', 'isActive'
        ];
        
        const isValidOperation = Object.keys(updates).every(update => 
            allowedUpdates.includes(update)
        );

        if (!isValidOperation) {
            throw new HttpError('Invalid updates', 400);
        }

        let company = await Company.getActiveCompany();
        
        if (!company) {
            throw new HttpError('Company not found', 404);
        }

        // Handle logo upload if a new file is provided
        if (req.file) {
            // Delete old logo from Cloudinary if exists
            if (company.logo && company.logo.public_id) {
                await deleteImage(company.logo.public_id).catch(err => 
                    console.error('Error deleting old logo:', err)
                );
            }

            // Upload new logo
            const uploadResult = await uploadSingleImage(req.file, 'company/logos');
            if (!uploadResult.success) {
                throw new HttpError(`Failed to upload logo: ${uploadResult.error}`, 500);
            }
            
            updates.logo = {
                url: uploadResult.data.url,
                public_id: uploadResult.data.public_id,
                format: uploadResult.data.format
            };
        }

        // Parse stringified objects
        const fieldsToParse = ['taxSettings', 'analyticsSettings', 'policy', 'socialMedia', 'businessHours', 'address'];
        
        fieldsToParse.forEach(field => {
            if (updates[field] && typeof updates[field] === 'string') {
                try {
                    updates[field] = JSON.parse(updates[field]);
                } catch (err) {
                    console.error(`Error parsing ${field}:`, err);
                    // If parsing fails, remove the field to avoid validation errors
                    delete updates[field];
                }
            }
        });

        Object.keys(updates).forEach(update => {
            company[update] = updates[update];
        });

        await company.save();

        res.status(200).json({
            success: true,
            message: 'Company information updated successfully',
            data: company
        });
    });

    // @desc    Delete company information
    // @route   DELETE /api/company
    // @access  Private/Admin
    deleteCompany = asyncHandler(async (req, res) => {
        const company = await Company.getActiveCompany();
        
        if (!company) {
            throw new HttpError('Company not found', 404);
        }

        // Delete logo from Cloudinary if exists
        if (company.logo && company.logo.public_id) {
            await deleteImage(company.logo.public_id).catch(err => 
                console.error('Error deleting logo:', err)
            );
        }

        await Company.findByIdAndDelete(company._id);

        res.status(200).json({
            success: true,
            message: 'Company information deleted successfully'
        });
    });

    // @desc    Upload company logo
    // @route   POST /api/company/upload-logo
    // @access  Private/Admin
    uploadLogo = asyncHandler(async (req, res) => {
        if (!req.file) {
            throw new HttpError('Please upload a logo file', 400);
        }

        // Validate file type
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
        if (!allowedTypes.includes(req.file.mimetype)) {
            // Clean up the uploaded file
            if (req.file.path) {
                fs.unlinkSync(req.file.path);
            }
            throw new HttpError('Only JPG, PNG, GIF, and WebP images are allowed', 400);
        }

        let company = await Company.getActiveCompany();
        
        if (!company) {
            throw new HttpError('Company not found', 404);
        }

        // Delete old logo from Cloudinary if exists
        if (company.logo && company.logo.public_id) {
            await deleteImage(company.logo.public_id).catch(err => 
                console.error('Error deleting old logo:', err)
            );
        }

        // Upload new logo to Cloudinary
        const uploadResult = await uploadSingleImage(req.file, 'company/logos');
        
        // Clean up the uploaded file
        if (req.file.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        if (!uploadResult.success) {
            throw new HttpError(`Failed to upload logo: ${uploadResult.error}`, 500);
        }

        // Update company with new logo
        company.logo = {
            url: uploadResult.data.url,
            public_id: uploadResult.data.public_id,
            format: uploadResult.data.format
        };
        
        await company.save();

        res.status(200).json({
            success: true,
            message: 'Logo uploaded successfully',
            data: {
                logo: company.logo
            }
        });
    });

    // @desc    Delete company logo
    // @route   DELETE /api/company/logo
    // @access  Private/Admin
    deleteLogo = asyncHandler(async (req, res) => {
        const company = await Company.getActiveCompany();
        
        if (!company) {
            throw new HttpError('Company not found', 404);
        }

        if (!company.logo || !company.logo.public_id) {
            throw new HttpError('No logo found to delete', 404);
        }

        // Delete logo from Cloudinary
        const deleteResult = await deleteImage(company.logo.public_id);
        if (!deleteResult.success) {
            throw new HttpError(`Failed to delete logo: ${deleteResult.error}`, 500);
        }

        // Remove logo from company
        company.logo = undefined;
        await company.save();

        res.status(200).json({
            success: true,
            message: 'Logo deleted successfully'
        });
    });

    // @desc    Get company policies
    // @route   GET /api/company/policies
    // @access  Public
    getPolicies = asyncHandler(async (req, res) => {
        const company = await Company.getActiveCompany()
            .select('name policy logo');
        
        if (!company) {
            throw new HttpError('Company not found', 404);
        }

        res.status(200).json({
            success: true,
            data: {
                companyName: company.name,
                logo: company.logo,
                policies: company.policy
            }
        });
    });

    // @desc    Get company contact information
    // @route   GET /api/company/contact
    // @access  Public
    getContactInfo = asyncHandler(async (req, res) => {
        const company = await Company.getActiveCompany()
            .select('name email phone address socialMedia businessHours logo');
        
        if (!company) {
            throw new HttpError('Company not found', 404);
        }

        res.status(200).json({
            success: true,
            data: {
                name: company.name,
                email: company.email,
                phone: company.phone,
                address: company.address,
                formattedAddress: company.getFormattedAddress ? company.getFormattedAddress() : '',
                socialMedia: company.socialMedia,
                businessHours: company.businessHours,
                logo: company.logo
            }
        });
    });

    getTaxSettings = asyncHandler(async (req, res) => {
        const company = await Company.getActiveCompany()
            .select('name taxSettings currency');
        
        if (!company) {
            throw new HttpError('Company not found', 404);
        }

        // Check if taxSettings exists, provide defaults if not
        const taxSettings = company.taxSettings || {
            taxRate: 0,
            taxNumber: ''
        };

        res.status(200).json({
            success: true,
            data: {
                companyName: company.name,
                currency: company.currency,
                taxSettings: {
                    taxRate: taxSettings.taxRate || 0,
                    taxNumber: taxSettings.taxNumber || '',
                    isTaxEnabled: (taxSettings.taxRate || 0) > 0
                }
            }
        });
    });
}

module.exports = new CompanyController();
