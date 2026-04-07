// backend/controllers/BrandController.js
const asyncHandler = require("express-async-handler");
const HttpError = require('../middleware/HttpError');
const Brand = require('../models/Brand');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const { 
  uploadToCloudinary, 
  deleteImage,
  deleteMultipleImages 
} = require('../utils/cloudinary');
const slugify = require('slugify');

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

class BrandController {
  
  /** 
   * @desc    Get all brands
   * @route   GET /api/brands
   * @access  Public
   */
  static getAllBrands = asyncHandler(async (req, res) => {
    const {
      page = 1,
      limit = 10,
      status,
      isFeatured,
      search,
      sortBy = 'name',
      sortOrder = 'asc'
    } = req.query;

    // Build filter object
    const filter = {};
    if (status) filter.status = status;
    if (isFeatured !== undefined) filter.isFeatured = isFeatured === 'true';
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort,
      populate: 'createdBy updatedBy',
      select: '-__v'
    };

    const brands = await Brand.paginate(filter, options);

    // Add optimized logo URLs
    const brandsWithOptimizedLogos = brands.docs.map(brand => {
      const brandObj = brand.toObject();
      if (brand.hasLogo()) {
        brandObj.logoOptimized = brand.getOptimizedLogo(300, 300);
        brandObj.logoThumbnail = brand.logoThumbnail;
      }
      return brandObj;
    });

    res.status(200).json({
      success: true,
      data: brandsWithOptimizedLogos,
      pagination: {
        total: brands.totalDocs,
        limit: brands.limit,
        page: brands.page,
        pages: brands.totalPages,
        hasNext: brands.hasNextPage,
        hasPrev: brands.hasPrevPage
      }
    });
  });

  /**
   * @desc    Get single brand by ID
   * @route   GET /api/brands/:id
   * @access  Public
   */
  static getBrandById = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      throw new HttpError('Invalid brand ID format', 400);
    }

    const brand = await Brand.findById(id)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .populate('productCount');

    if (!brand) {
      throw new HttpError('Brand not found', 404);
    }

    // Add optimized logo URLs
    const brandObj = brand.toObject();
    if (brand.hasLogo()) {
      brandObj.logoOptimized = brand.getOptimizedLogo(500, 500);
      brandObj.logoThumbnail = brand.logoThumbnail;
    }

    res.status(200).json({
      success: true,
      data: brandObj
    });
  });

  /**
   * @desc    Get brand by slug
   * @route   GET /api/brands/slug/:slug
   * @access  Public
   */
  static getBrandBySlug = asyncHandler(async (req, res) => {
    const { slug } = req.params;

    const brand = await Brand.findOne({ slug })
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .populate('productCount');

    if (!brand) {
      throw new HttpError('Brand not found', 404);
    }

    // Add optimized logo URLs
    const brandObj = brand.toObject();
    if (brand.hasLogo()) {
      brandObj.logoOptimized = brand.getOptimizedLogo(500, 500);
      brandObj.logoThumbnail = brand.logoThumbnail;
    }

    res.status(200).json({
      success: true,
      data: brandObj
    });
  });

  /**
   * @desc    Create new brand
   * @route   POST /api/brands
   * @access  Private/Admin
   */
  static createBrand = asyncHandler(async (req, res) => {
    const {
      name,
      description,
      website,
      status,
      isFeatured,
      metaTitle,
      metaDescription,
      seoKeywords,
      socialMedia,
      contactEmail,
      sortOrder
    } = req.body;

    // Validation
    if (!name || name.trim().length < 2) {
      throw new HttpError('Brand name is required and must be at least 2 characters long', 400);
    }

    // Check if brand already exists
    const slug = slugify(name.trim(), { lower: true, strict: true });
    const existingBrand = await Brand.findOne({ 
      $or: [
        { name: name.trim() },
        { slug }
      ] 
    });

    if (existingBrand) {
      throw new HttpError('Brand with this name already exists', 409);
    }

    // Handle logo upload to Cloudinary
    let logo = {};
    if (req.file) {
      const uploadResult = await uploadToCloudinary(req.file.path, 'brands', {
        transformation: [
          { width: 800, height: 800, crop: 'limit', quality: 'auto' },
          { format: 'webp' }
        ]
      });

      if (!uploadResult.success) {
        throw new HttpError(`Logo upload failed: ${uploadResult.error}`, 500);
      }

      logo = {
        public_id: uploadResult.data.public_id,
        url: uploadResult.data.url,
        alt: `${name.trim()} logo`,
        width: uploadResult.data.width,
        height: uploadResult.data.height,
        format: uploadResult.data.format,
        bytes: uploadResult.data.bytes
      };
    }

    // Parse social media if it's a string
    let parsedSocialMedia = {};
    if (socialMedia) {
      if (typeof socialMedia === 'string') {
        try {
          parsedSocialMedia = JSON.parse(socialMedia);
        } catch (error) {
          parsedSocialMedia = {};
        }
      } else {
        parsedSocialMedia = socialMedia;
      }
    }

    // Parse SEO keywords
    let parsedSeoKeywords = [];
    if (seoKeywords) {
      if (typeof seoKeywords === 'string') {
        try {
          parsedSeoKeywords = JSON.parse(seoKeywords);
        } catch (error) {
          parsedSeoKeywords = seoKeywords.split(',').map(kw => kw.trim());
        }
      } else {
        parsedSeoKeywords = seoKeywords;
      }
    }

    const brandData = {
      name: name.trim(),
      slug,
      description: description?.trim(),
      website,
      status: status || 'active',
      isFeatured: isFeatured || false,
      metaTitle: metaTitle?.trim(),
      metaDescription: metaDescription?.trim(),
      seoKeywords: parsedSeoKeywords,
      socialMedia: parsedSocialMedia,
      contactEmail,
      sortOrder: sortOrder || 0,
      createdBy: req.user._id,
      updatedBy: req.user._id,
      ...(Object.keys(logo).length > 0 && { logo })
    };

    const brand = await Brand.create(brandData);

    res.status(201).json({
      success: true,
      message: 'Brand created successfully',
      data: brand
    });
  });

  /**
   * @desc    Update brand
   * @route   PUT /api/brands/:id
   * @access  Private/Admin
   */
  static updateBrand = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      throw new HttpError('Invalid brand ID format', 400);
    }

    const {
      name,
      description,
      website,
      status,
      isFeatured,
      metaTitle,
      metaDescription,
      seoKeywords,
      socialMedia,
      contactEmail,
      sortOrder,
      removeLogo
    } = req.body;

    const brand = await Brand.findById(id);
    if (!brand) {
      throw new HttpError('Brand not found', 404);
    }

    // Check if new name conflicts with existing brands
    let slug = brand.slug;
    if (name && name.trim() !== brand.name) {
      slug = slugify(name.trim(), { lower: true, strict: true });
      const existingBrand = await Brand.findOne({
        $and: [
          { _id: { $ne: id } },
          { 
            $or: [
              { name: name.trim() },
              { slug }
            ] 
          }
        ]
      });

      if (existingBrand) {
        throw new HttpError('Brand with this name already exists', 409);
      }
    }

    // Handle logo operations
    let logoUpdate = {};
    
    // Remove existing logo if requested
    if (removeLogo === 'true' && brand.logo?.public_id) {
      const deleteResult = await deleteImage(brand.logo.public_id);
      if (!deleteResult.success) {
        console.warn('Failed to delete old logo from Cloudinary:', deleteResult.error);
      }
      logoUpdate.logo = {};
    }
    
    // Upload new logo if provided
    if (req.file) {
      // Delete old logo if exists
      if (brand.logo?.public_id) {
        await deleteImage(brand.logo.public_id);
      }

      const uploadResult = await uploadToCloudinary(req.file.path, 'brands', {
        transformation: [
          { width: 800, height: 800, crop: 'limit', quality: 'auto' },
          { format: 'webp' }
        ]
      });

      if (!uploadResult.success) {
        throw new HttpError(`Logo upload failed: ${uploadResult.error}`, 500);
      }

      logoUpdate.logo = {
        public_id: uploadResult.data.public_id,
        url: uploadResult.data.url,
        alt: `${name?.trim() || brand.name} logo`,
        width: uploadResult.data.width,
        height: uploadResult.data.height,
        format: uploadResult.data.format,
        bytes: uploadResult.data.bytes
      };
    }

    // Parse social media if it's a string
    let parsedSocialMedia = brand.socialMedia;
    if (socialMedia !== undefined) {
      if (typeof socialMedia === 'string') {
        try {
          parsedSocialMedia = JSON.parse(socialMedia);
        } catch (error) {
          parsedSocialMedia = brand.socialMedia;
        }
      } else {
        parsedSocialMedia = socialMedia;
      }
    }

    // Parse SEO keywords
    let parsedSeoKeywords = brand.seoKeywords;
    if (seoKeywords !== undefined) {
      if (typeof seoKeywords === 'string') {
        try {
          parsedSeoKeywords = JSON.parse(seoKeywords);
        } catch (error) {
          parsedSeoKeywords = seoKeywords.split(',').map(kw => kw.trim());
        }
      } else {
        parsedSeoKeywords = seoKeywords;
      }
    }

    const updateData = {
      ...(name && { name: name.trim() }),
      ...(slug && { slug }),
      ...(description !== undefined && { description: description?.trim() }),
      ...(website !== undefined && { website }),
      ...(status && { status }),
      ...(isFeatured !== undefined && { isFeatured }),
      ...(metaTitle !== undefined && { metaTitle: metaTitle?.trim() }),
      ...(metaDescription !== undefined && { metaDescription: metaDescription?.trim() }),
      ...(parsedSeoKeywords && { seoKeywords: parsedSeoKeywords }),
      ...(parsedSocialMedia && { socialMedia: parsedSocialMedia }),
      ...(contactEmail !== undefined && { contactEmail }),
      ...(sortOrder !== undefined && { sortOrder }),
      updatedBy: req.user._id,
      ...logoUpdate
    };

    const updatedBrand = await Brand.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('createdBy updatedBy');

    res.status(200).json({
      success: true,
      message: 'Brand updated successfully',
      data: updatedBrand
    });
  });

  /**
   * @desc    Delete brand
   * @route   DELETE /api/brands/:id
   * @access  Private/Admin
   */
  static deleteBrand = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      throw new HttpError('Invalid brand ID format', 400);
    }

    const brand = await Brand.findById(id);
    if (!brand) {
      throw new HttpError('Brand not found', 404);
    }

    // Check if brand has associated products
    const productCount = await Product.countDocuments({ brand: id });
    if (productCount > 0) {
      throw new HttpError(
        `Cannot delete brand. There are ${productCount} products associated with this brand.`,
        400
      );
    }

    // Delete logo from Cloudinary if exists
    if (brand.logo?.public_id) {
      const deleteResult = await deleteImage(brand.logo.public_id);
      if (!deleteResult.success) {
        console.warn('Failed to delete logo from Cloudinary during brand deletion:', deleteResult.error);
      }
    }

    await Brand.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Brand deleted successfully'
    });
  });

  /**
   * @desc    Upload brand logo
   * @route   POST /api/brands/:id/logo
   * @access  Private/Admin
   */
  static uploadLogo = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      throw new HttpError('Invalid brand ID format', 400);
    }

    if (!req.file) {
      throw new HttpError('Logo file is required', 400);
    }

    const brand = await Brand.findById(id);
    if (!brand) {
      throw new HttpError('Brand not found', 404);
    }

    // Delete old logo if exists
    if (brand.logo?.public_id) {
      await deleteImage(brand.logo.public_id);
    }

    // Upload new logo
    const uploadResult = await uploadToCloudinary(req.file.path, 'brands', {
      transformation: [
        { width: 800, height: 800, crop: 'limit', quality: 'auto' },
        { format: 'webp' }
      ]
    });

    if (!uploadResult.success) {
      throw new HttpError(`Logo upload failed: ${uploadResult.error}`, 500);
    }

    // Update brand with new logo
    brand.logo = {
      public_id: uploadResult.data.public_id,
      url: uploadResult.data.url,
      alt: `${brand.name} logo`,
      width: uploadResult.data.width,
      height: uploadResult.data.height,
      format: uploadResult.data.format,
      bytes: uploadResult.data.bytes
    };
    brand.updatedBy = req.user._id;
    
    await brand.save();

    // Add optimized URLs
    const brandObj = brand.toObject();
    brandObj.logoOptimized = brand.getOptimizedLogo(500, 500);
    brandObj.logoThumbnail = brand.logoThumbnail;

    res.status(200).json({
      success: true,
      message: 'Logo uploaded successfully',
      data: {
        logo: brandObj.logo,
        logoOptimized: brandObj.logoOptimized,
        logoThumbnail: brandObj.logoThumbnail
      }
    });
  });

  /**
   * @desc    Delete brand logo
   * @route   DELETE /api/brands/:id/logo
   * @access  Private/Admin
   */
  static deleteLogo = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      throw new HttpError('Invalid brand ID format', 400);
    }

    const brand = await Brand.findById(id);
    if (!brand) {
      throw new HttpError('Brand not found', 404);
    }

    if (!brand.logo?.public_id) {
      throw new HttpError('Brand does not have a logo', 400);
    }

    // Delete logo from Cloudinary
    const deleteResult = await deleteImage(brand.logo.public_id);
    if (!deleteResult.success) {
      throw new HttpError(`Failed to delete logo: ${deleteResult.error}`, 500);
    }

    // Remove logo from brand
    brand.logo = {};
    brand.updatedBy = req.user._id;
    
    await brand.save();

    res.status(200).json({
      success: true,
      message: 'Logo deleted successfully'
    });
  });

  /**
   * @desc    Get active brands
   * @route   GET /api/brands/active
   * @access  Public
   */
  static getActiveBrands = asyncHandler(async (req, res) => {
    const brands = await Brand.findActive().populate('productCount');

    // Add optimized logo URLs
    const brandsWithOptimizedLogos = brands.map(brand => {
      const brandObj = brand.toObject();
      if (brand.hasLogo()) {
        brandObj.logoOptimized = brand.getOptimizedLogo(300, 300);
        brandObj.logoThumbnail = brand.logoThumbnail;
      }
      return brandObj;
    });

    res.status(200).json({
      success: true,
      count: brands.length,
      data: brandsWithOptimizedLogos
    });
  });

  /**
   * @desc    Get featured brands
   * @route   GET /api/brands/featured
   * @access  Public
   */
  static getFeaturedBrands = asyncHandler(async (req, res) => {
    const brands = await Brand.findFeatured().populate('productCount');

    // Add optimized logo URLs
    const brandsWithOptimizedLogos = brands.map(brand => {
      const brandObj = brand.toObject();
      if (brand.hasLogo()) {
        brandObj.logoOptimized = brand.getOptimizedLogo(300, 300);
        brandObj.logoThumbnail = brand.logoThumbnail;
      }
      return brandObj;
    });

    res.status(200).json({
      success: true,
      count: brands.length,
      data: brandsWithOptimizedLogos
    });
  });

  /**
   * @desc    Get products by brand
   * @route   GET /api/brands/:id/products
   * @access  Public
   */
  static getProductsByBrand = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const {
      page = 1,
      limit = 10,
      sortBy = 'name',
      sortOrder = 'asc'
    } = req.query;

    if (!isValidObjectId(id)) {
      throw new HttpError('Invalid brand ID format', 400);
    }

    const brand = await Brand.findById(id);
    if (!brand) {
      throw new HttpError('Brand not found', 404);
    }

    // Build filter
    const filter = { brand: id, isActive: true };

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort,
      populate: 'category',
      select: 'name price images ratings isFeatured slug'
    };

    const products = await Product.paginate(filter, options);

    // Add optimized brand logo
    const brandObj = brand.toObject();
    if (brand.hasLogo()) {
      brandObj.logoOptimized = brand.getOptimizedLogo(200, 200);
    }

    res.status(200).json({
      success: true,
      brand: {
        _id: brand._id,
        name: brand.name,
        slug: brand.slug,
        logo: brandObj.logoOptimized || brand.logo?.url
      },
      data: products.docs,
      pagination: {
        total: products.totalDocs,
        limit: products.limit,
        page: products.page,
        pages: products.totalPages,
        hasNext: products.hasNextPage,
        hasPrev: products.hasPrevPage
      }
    });
  });

  /**
   * @desc    Bulk update brands status
   * @route   PATCH /api/brands/bulk/status
   * @access  Private/Admin
   */
  static bulkUpdateStatus = asyncHandler(async (req, res) => {
    const { ids, status } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      throw new HttpError('Brand IDs array is required', 400);
    }

    if (!['active', 'inactive', 'pending'].includes(status)) {
      throw new HttpError('Invalid status value', 400);
    }

    // Validate all IDs
    const invalidIds = ids.filter(id => !isValidObjectId(id));
    if (invalidIds.length > 0) {
      throw new HttpError(`Invalid brand IDs: ${invalidIds.join(', ')}`, 400);
    }

    const result = await Brand.updateMany(
      { _id: { $in: ids } },
      { 
        status,
        updatedBy: req.user.userId,
        updatedAt: new Date()
      }
    );

    res.status(200).json({
      success: true,
      message: `Updated status for ${result.modifiedCount} brands`,
      modifiedCount: result.modifiedCount
    });
  });

  /**
   * @desc    Search brands
   * @route   GET /api/brands/search
   * @access  Public
   */
  static searchBrands = asyncHandler(async (req, res) => {
    const { q, limit = 10 } = req.query;

    if (!q || q.trim().length < 2) {
      throw new HttpError('Search query must be at least 2 characters long', 400);
    }

    const brands = await Brand.find({
      status: 'active',
      $or: [
        { name: { $regex: q.trim(), $options: 'i' } },
        { description: { $regex: q.trim(), $options: 'i' } }
      ]
    })
    .limit(parseInt(limit))
    .select('name slug logo description')
    .sort({ name: 1 });

    // Add optimized logo URLs
    const brandsWithOptimizedLogos = brands.map(brand => {
      const brandObj = brand.toObject();
      if (brand.hasLogo()) {
        brandObj.logoOptimized = brand.getOptimizedLogo(100, 100);
      }
      return brandObj;
    });

    res.status(200).json({
      success: true,
      count: brands.length,
      data: brandsWithOptimizedLogos
    });
  });
}

module.exports = BrandController;