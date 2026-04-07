// controllers/CompanyController.js
const asyncHandler = require("express-async-handler");
const HttpError = require('../middleware/HttpError');
const Company = require('../models/Company');
const { createVisitorData } = require('../helpers/visitorHelper');
const { uploadSingleImage, deleteImage, uploadToCloudinary } = require('../utils/cloudinary');
const fs = require('fs');
const path = require('path');

class CompanyController {
    
    // @desc    Get company information
    // @route   GET /api/company
    // @access  Public
    getCompany = asyncHandler(async (req, res) => {
        const company = await Company.getActiveCompany(); 
        
       

        // Track visitor if tracking is enabled
        if (company?.analyticsSettings?.trackVisitors) {
            try {
                const visitorData = createVisitorData(req, '/api/v1/company');
                await Company.addVisitor(company._id, visitorData);
            } catch (error) {
                console.error('Error tracking visitor:', error);
                // Don't throw error to prevent breaking the main response
            }
        }

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

        // Track visitor if tracking is enabled
        if (company.analyticsSettings.trackVisitors) {
            try {
                const visitorData = createVisitorData(req, '/api/company/policies');
                await Company.addVisitor(company._id, visitorData);
            } catch (error) {
                console.error('Error tracking visitor:', error);
            }
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
            .select('name email phone address socialMedia businessHours logo analyticsSettings');
        
        if (!company) {
            throw new HttpError('Company not found', 404);
        }

        // Track visitor if tracking is enabled
        if (company.analyticsSettings.trackVisitors) {
            try {
                const visitorData = createVisitorData(req, '/api/company/contact');
                await Company.addVisitor(company._id, visitorData);
            } catch (error) {
                console.error('Error tracking visitor:', error);
            }
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

    // @desc    Get visitor statistics
    // @route   GET /api/company/analytics/visitors
    // @access  Private/Admin
    getVisitorStats = asyncHandler(async (req, res) => {
        const company = await Company.getActiveCompany();
        
        if (!company) {
            throw new HttpError('Company not found', 404);
        }

        const { startDate, endDate } = req.query;

        const stats = await Company.getVisitorStats(
            company._id,
            startDate,
            endDate
        );

        res.status(200).json({
            success: true,
            data: {
                stats,
                analyticsSettings: company.analyticsSettings
            }
        });
    });

    // @desc    Get recent visitors
    // @route   GET /api/company/analytics/visitors/recent
    // @access  Private/Admin
    getRecentVisitors = asyncHandler(async (req, res) => {
        const company = await Company.getActiveCompany()
            .select('visitors name analyticsSettings logo');
        
        if (!company) {
            throw new HttpError('Company not found', 404);
        }

        const limit = parseInt(req.query.limit) || 10;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;

        // Get sorted visitors
        const sortedVisitors = company.visitors
            .sort((a, b) => new Date(b.visitDateTime) - new Date(a.visitDateTime));

        const paginatedVisitors = sortedVisitors.slice(skip, skip + limit);

        // Apply IP anonymization for response if needed
        const visitorsForResponse = paginatedVisitors.map(visitor => {
            const visitorObj = visitor.toObject ? visitor.toObject() : { ...visitor };
            
            // Only show partial IP if anonymization is enabled
            if (company.analyticsSettings.anonymizeIp && visitorObj.ipAddress) {
                const ipParts = visitorObj.ipAddress.split('.');
                if (ipParts.length === 4) {
                    visitorObj.ipAddress = `${ipParts[0]}.${ipParts[1]}.*.*`;
                } else if (visitorObj.ipAddress.includes(':')) {
                    // For IPv6
                    visitorObj.ipAddress = visitorObj.ipAddress.replace(
                        /([a-f0-9]{4}):([a-f0-9]{4})$/, 
                        '$1:****'
                    );
                }
            }

            return visitorObj;
        });

        res.status(200).json({
            success: true,
            data: {
                company: {
                    name: company.name,
                    logo: company.logo
                },
                visitors: visitorsForResponse,
                pagination: {
                    total: company.visitors.length,
                    page,
                    limit,
                    totalPages: Math.ceil(company.visitors.length / limit)
                }
            }
        });
    });

    // @desc    Track a visitor manually (for specific pages)
    // @route   POST /api/company/analytics/visitors/track
    // @access  Public
    trackVisitor = asyncHandler(async (req, res) => {
        const company = await Company.getActiveCompany();
        
        if (!company) {
            throw new HttpError('Company not found', 404);
        }

        // Check if visitor tracking is enabled
        if (!company.analyticsSettings.trackVisitors) {
            return res.status(200).json({
                success: true,
                message: 'Visitor tracking is disabled',
                data: null
            });
        }

        const { pageVisited, duration, actions } = req.body;
        
        if (!pageVisited) {
            throw new HttpError('Page visited is required', 400);
        }

        // Create visitor data
        const visitorData = createVisitorData(req, pageVisited);
        
        // Add additional data if provided
        if (duration !== undefined) {
            visitorData.duration = duration;
        }
        
        if (actions && Array.isArray(actions)) {
            visitorData.actions = actions;
        }

        // Add visitor to company
        await Company.addVisitor(company._id, visitorData);

        res.status(201).json({
            success: true,
            message: 'Visitor tracked successfully'
        });
    });

    // @desc    Update analytics settings
    // @route   PUT /api/company/analytics/settings
    // @access  Private/Admin
    updateAnalyticsSettings = asyncHandler(async (req, res) => {
        const company = await Company.getActiveCompany();
        
        if (!company) {
            throw new HttpError('Company not found', 404);
        }

        const { analyticsSettings } = req.body;

        if (!analyticsSettings) {
            throw new HttpError('Analytics settings are required', 400);
        }

        // Validate analytics settings
        const validSettings = {
            trackVisitors: typeof analyticsSettings.trackVisitors === 'boolean',
            storeIpAddress: typeof analyticsSettings.storeIpAddress === 'boolean',
            anonymizeIp: typeof analyticsSettings.anonymizeIp === 'boolean',
            retentionDays: typeof analyticsSettings.retentionDays === 'number' &&
                          analyticsSettings.retentionDays >= 1 &&
                          analyticsSettings.retentionDays <= 730
        };

        // Check if all settings are valid
        const allValid = Object.values(validSettings).every(v => v === true);
        if (!allValid) {
            throw new HttpError('Invalid analytics settings', 400);
        }

        // Update analytics settings
        company.analyticsSettings = analyticsSettings;
        await company.save();

        res.status(200).json({
            success: true,
            message: 'Analytics settings updated successfully',
            data: {
                analyticsSettings: company.analyticsSettings
            }
        });
    });

    // @desc    Clear old visitors (older than retention period)
    // @route   DELETE /api/company/analytics/visitors/cleanup
    // @access  Private/Admin
    cleanupVisitors = asyncHandler(async (req, res) => {
        const company = await Company.getActiveCompany();
        
        if (!company) {
            throw new HttpError('Company not found', 404);
        }

        const result = company.clearOldVisitors();
        await company.save();

        res.status(200).json({
            success: true,
            message: 'Visitor cleanup completed',
            data: result
        });
    });

    // @desc    Get visitor demographics
    // @route   GET /api/company/analytics/demographics
    // @access  Private/Admin
    getVisitorDemographics = asyncHandler(async (req, res) => {
        const company = await Company.getActiveCompany()
            .select('visitors name logo');
        
        if (!company) {
            throw new HttpError('Company not found', 404);
        }

        const demographics = {
            countries: {},
            cities: {},
            devices: {},
            browsers: {},
            operatingSystems: {}
        };

        company.visitors.forEach(visitor => {
            // Country demographics
            if (visitor.country) {
                demographics.countries[visitor.country] = 
                    (demographics.countries[visitor.country] || 0) + 1;
            }

            // City demographics
            if (visitor.city) {
                demographics.cities[visitor.city] = 
                    (demographics.cities[visitor.city] || 0) + 1;
            }

            // Device demographics
            if (visitor.device && visitor.device.type) {
                demographics.devices[visitor.device.type] = 
                    (demographics.devices[visitor.device.type] || 0) + 1;
            }

            // Browser demographics
            if (visitor.browser && visitor.browser.name) {
                demographics.browsers[visitor.browser.name] = 
                    (demographics.browsers[visitor.browser.name] || 0) + 1;
            }

            // OS demographics
            if (visitor.os && visitor.os.name) {
                demographics.operatingSystems[visitor.os.name] = 
                    (demographics.operatingSystems[visitor.os.name] || 0) + 1;
            }
        });

        // Convert to arrays for easier consumption
        const formatData = (obj) => {
            return Object.entries(obj)
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count);
        };

        res.status(200).json({
            success: true,
            data: {
                company: {
                    name: company.name,
                    logo: company.logo
                },
                totalVisitors: company.visitors.length,
                countries: formatData(demographics.countries),
                cities: formatData(demographics.cities),
                devices: formatData(demographics.devices),
                browsers: formatData(demographics.browsers),
                operatingSystems: formatData(demographics.operatingSystems)
            }
        });
    });

    // @desc    Get visitor activity timeline
    // @route   GET /api/company/analytics/activity
    // @access  Private/Admin
    getVisitorActivity = asyncHandler(async (req, res) => {
        const company = await Company.getActiveCompany()
            .select('visitors name logo');
        
        if (!company) {
            throw new HttpError('Company not found', 404);
        }

        const { days = 30 } = req.query;
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - parseInt(days));

        // Filter visitors from the last N days
        const recentVisitors = company.visitors.filter(visitor => 
            new Date(visitor.visitDateTime) >= daysAgo
        );

        // Group by hour of day
        const hourlyActivity = Array(24).fill(0);
        // Group by day of week
        const dailyActivity = Array(7).fill(0);
        // Group by date
        const dateActivity = {};

        recentVisitors.forEach(visitor => {
            const date = new Date(visitor.visitDateTime);
            
            // Hourly activity
            const hour = date.getHours();
            hourlyActivity[hour]++;
            
            // Daily activity (0 = Sunday, 1 = Monday, etc.)
            const day = date.getDay();
            dailyActivity[day]++;
            
            // Date activity
            const dateStr = date.toISOString().split('T')[0];
            dateActivity[dateStr] = (dateActivity[dateStr] || 0) + 1;
        });

        // Format date activity for response
        const formattedDateActivity = Object.entries(dateActivity)
            .map(([date, count]) => ({ date, count }))
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        res.status(200).json({
            success: true,
            data: {
                company: {
                    name: company.name,
                    logo: company.logo
                },
                period: `${days} days`,
                totalVisits: recentVisitors.length,
                hourlyActivity,
                dailyActivity,
                dateActivity: formattedDateActivity,
                daysOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
            }
        });
    });

    // @desc    Export visitor data
    // @route   GET /api/company/analytics/visitors/export
    // @access  Private/Admin
    exportVisitorData = asyncHandler(async (req, res) => {
        const company = await Company.getActiveCompany()
            .select('visitors name logo');
        
        if (!company) {
            throw new HttpError('Company not found', 404);
        }

        const { format = 'json' } = req.query;
        const { startDate, endDate } = req.query;

        // Filter visitors by date range if provided
        let filteredVisitors = company.visitors;
        if (startDate || endDate) {
            filteredVisitors = company.visitors.filter(visitor => {
                const visitDate = new Date(visitor.visitDateTime);
                return (!startDate || visitDate >= new Date(startDate)) &&
                       (!endDate || visitDate <= new Date(endDate));
            });
        }

        if (format === 'csv') {
            // Convert to CSV
            const headers = [
                'IP Address',
                'Visit Date Time',
                'Page Visited',
                'Country',
                'City',
                'Browser',
                'OS',
                'Device Type',
                'Duration (seconds)',
                'User Agent'
            ];

            const csvRows = filteredVisitors.map(visitor => [
                company.analyticsSettings.anonymizeIp && visitor.ipAddress 
                    ? this.anonymizeIp(visitor.ipAddress)
                    : visitor.ipAddress || '',
                visitor.visitDateTime.toISOString(),
                visitor.pageVisited,
                visitor.country || '',
                visitor.city || '',
                visitor.browser?.name || '',
                visitor.os?.name || '',
                visitor.device?.type || '',
                visitor.duration || '',
                visitor.userAgent || ''
            ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(','));

            const csvContent = [headers.join(','), ...csvRows].join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 
                `attachment; filename="${company.name}-visitors-${new Date().toISOString().split('T')[0]}.csv"`);
            
            return res.send(csvContent);
        }

        // Default JSON response
        res.status(200).json({
            success: true,
            data: {
                company: {
                    name: company.name,
                    logo: company.logo
                },
                totalVisitors: filteredVisitors.length,
                exportDate: new Date().toISOString(),
                visitors: filteredVisitors.map(visitor => {
                    const visitorObj = visitor.toObject ? visitor.toObject() : { ...visitor };
                    
                    // Apply IP anonymization if enabled
                    if (company.analyticsSettings.anonymizeIp && visitorObj.ipAddress) {
                        visitorObj.ipAddress = this.anonymizeIp(visitorObj.ipAddress);
                    }
                    
                    return visitorObj;
                })
            }
        });
    });

    // Helper method to anonymize IP address
    anonymizeIp(ip) {
        if (!ip) return '';
        
        if (ip.includes('.')) {
            // IPv4
            const ipParts = ip.split('.');
            if (ipParts.length === 4) {
                return `${ipParts[0]}.${ipParts[1]}.*.*`;
            }
        } else if (ip.includes(':')) {
            // IPv6
            return ip.replace(/([a-f0-9]{4}):([a-f0-9]{4})$/, '$1:****');
        }
        
        return ip;
    }
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