// controllers/CategoryController.js
const asyncHandler = require("express-async-handler");
const HttpError = require('../middleware/HttpError');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { uploadToCloudinary, deleteImage } = require('../utils/cloudinary');

class CategoryController {
  
  // Get all categories with advanced filtering
  static getCategories = asyncHandler(async (req, res) => {
    const { 
      sex, 
      includeInactive = 'false', 
      parentOnly = 'false', 
      withProducts = 'false',
      page = 1,
      limit = 50,
      search
    } = req.query;
    
    let filter = {};
    
    // Filter by sex if provided
    if (sex && ['men', 'women', 'unisex', 'kids', 'baby'].includes(sex)) {
      filter.$or = [
        { sex: sex },
        { sex: 'unisex' }
      ];
    }
    
    // Filter by active status
    if (includeInactive === 'false') {
      filter.isActive = true;
    }
    
    // Filter by parent if only top-level categories are needed
    if (parentOnly === 'true') {
      filter.parent = null;
    }
    
    // Search functionality
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'seo.slug': { $regex: search, $options: 'i' } }
      ];
    }
    
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    
    // Get categories with pagination
    const categories = await Category.find(filter)
      .populate({
        path: 'children',
        match: includeInactive === 'false' ? { isActive: true } : {},
        select: 'name sex isActive sortOrder image seo',
        options: { sort: { sortOrder: 1, name: 1 } }
      })
      .populate('parent', 'name sex seo.slug')
      .select('name description sex parent image isActive sortOrder seo customFields createdAt')
      .sort({ sortOrder: 1, name: 1 })
      .skip(skip)
      .limit(limitNum);
    
    const total = await Category.countDocuments(filter);
    
    // If requested, include product counts for each category
    let enhancedCategories = categories;
    if (withProducts === 'true' && sex) {
      enhancedCategories = await Promise.all(
        categories.map(async (category) => {
          const productCount = await Product.countDocuments({
            category: category._id,
            isActive: true,
            $or: [
              { sex: sex },
              { sex: 'unisex' }
            ]
          });
          
          const categoryObj = category.toObject();
          categoryObj.productCount = productCount;
          return categoryObj;
        })
      );
    }
    
    res.status(200).json({
      success: true,
      count: enhancedCategories.length,
      total,
      pagination: {
        page: pageNum,
        pages: Math.ceil(total / limitNum),
        limit: limitNum
      },
      data: enhancedCategories
    });
  });

  // Get categories by sex with hierarchy
  static getCategoriesBySex = asyncHandler(async (req, res) => {
    const { sex } = req.params;
    const { includeChildren = 'true', withProductCounts = 'false' } = req.query;
    
    if (!['men', 'women', 'unisex', 'kids', 'baby'].includes(sex)) {
      throw new HttpError('Invalid sex parameter. Must be: men, women, unisex, kids, or baby', 400);
    }
    
    let categories;
    
    // Base match filter
    const baseMatch = {
      $or: [
        { sex: sex },
        { sex: 'unisex' }
      ],
      isActive: true
    };
    
    if (includeChildren === 'true') {
      // Get categories with full hierarchy
      categories = await Category.aggregate([
        {
          $match: {
            ...baseMatch,
            parent: null
          }
        },
        {
          $lookup: {
            from: 'categories',
            localField: '_id',
            foreignField: 'parent',
            as: 'children',
            pipeline: [
              {
                $match: baseMatch
              },
              {
                $lookup: {
                  from: 'categories',
                  localField: '_id',
                  foreignField: 'parent',
                  as: 'subChildren',
                  pipeline: [
                    {
                      $match: baseMatch
                    },
                    { 
                      $project: {
                        name: 1,
                        description: 1,
                        sex: 1,
                        image: 1,
                        sortOrder: 1,
                        seo: 1,
                        isActive: 1
                      }
                    },
                    { $sort: { sortOrder: 1, name: 1 } }
                  ]
                }
              },
              {
                $project: {
                  name: 1,
                  description: 1,
                  sex: 1,
                  image: 1,
                  sortOrder: 1,
                  seo: 1,
                  isActive: 1,
                  subChildren: 1
                }
              },
              { $sort: { sortOrder: 1, name: 1 } }
            ]
          }
        },
        {
          $project: {
            name: 1,
            description: 1,
            sex: 1,
            image: 1,
            sortOrder: 1,
            seo: 1,
            isActive: 1,
            children: 1
          }
        },
        { $sort: { sortOrder: 1, name: 1 } }
      ]);
    } else {
      // Get flat list of categories for the specified sex
      categories = await Category.find(baseMatch)
      .select('name description sex parent image sortOrder seo isActive')
      .populate('parent', 'name sex seo.slug')
      .sort({ sortOrder: 1, name: 1 });
    }
    
    // Add product counts if requested
    if (withProductCounts === 'true') {
      categories = await Promise.all(
        categories.map(async (category) => {
          const productCount = await Product.countDocuments({
            category: category._id,
            isActive: true,
            $or: [
              { sex: sex },
              { sex: 'unisex' }
            ]
          });
          
          const categoryObj = category.toObject ? category.toObject() : category;
          return {
            ...categoryObj,
            productCount
          };
        })
      );
    }
    
    res.status(200).json({
      success: true,
      sex: sex,
      count: categories.length,
      data: categories
    });
  });

  // Get category tree by sex
  static getCategoryTreeBySex = asyncHandler(async (req, res) => {
    const { sex } = req.params;
    
    if (!['men', 'women', 'unisex', 'kids', 'baby'].includes(sex)) {
      throw new HttpError('Invalid sex parameter', 400);
    }
    
    const buildTree = async (parentId = null) => {
      const filter = {
        parent: parentId,
        isActive: true,
        $or: [
          { sex: sex },
          { sex: 'unisex' }
        ]
      };
      
      const categories = await Category.find(filter)
      .select('name description sex image sortOrder seo customFields isActive')
      .sort({ sortOrder: 1, name: 1 });
      
      const categoriesWithChildren = await Promise.all(
        categories.map(async (category) => {
          const children = await buildTree(category._id);
          const categoryObj = category.toObject();
          return {
            ...categoryObj,
            children
          };
        })
      );
      
      return categoriesWithChildren;
    };
    
    const categoryTree = await buildTree();
    
    res.status(200).json({
      success: true,
      sex: sex,
      count: categoryTree.length,
      data: categoryTree
    });
  });

  // Get categories for navigation (optimized for menus)
  static getNavigationCategories = asyncHandler(async (req, res) => {
    const { sex } = req.query;
    
    let filter = { 
      isActive: true,
      parent: null 
    };
    
    if (sex && ['men', 'women', 'unisex', 'kids', 'baby'].includes(sex)) {
      filter.$or = [
        { sex: sex },
        { sex: 'unisex' }
      ];
    }
    
    const categories = await Category.find(filter)
      .populate({
        path: 'children',
        match: { 
          isActive: true,
          ...(sex && {
            $or: [
              { sex: sex },
              { sex: 'unisex' }
            ]
          })
        },
        select: 'name sex image seo sortOrder',
        options: { sort: { sortOrder: 1, name: 1 } },
        populate: {
          path: 'children',
          match: { 
            isActive: true,
            ...(sex && {
              $or: [
                { sex: sex },
                { sex: 'unisex' }
              ]
            })
          },
          select: 'name sex image seo sortOrder',
          options: { sort: { sortOrder: 1, name: 1 } }
        }
      })
      .select('name sex image seo sortOrder')
      .sort({ sortOrder: 1, name: 1 });
    
    res.status(200).json({
      success: true,
      sex: sex || 'all',
      count: categories.length,
      data: categories
    });
  });

  // Get category by slug with sex context
  static getCategoryBySlug = asyncHandler(async (req, res) => {
    const { slug, sex } = req.params;
    
    let filter = { 
      'seo.slug': slug,
      isActive: true 
    };
    
    if (sex && ['men', 'women', 'unisex', 'kids', 'baby'].includes(sex)) {
      filter.$or = [
        { sex: sex },
        { sex: 'unisex' }
      ];
    }
    
    const category = await Category.findOne(filter)
      .populate({
        path: 'parent',
        select: 'name sex seo.slug image'
      })
      .populate({
        path: 'children',
        match: { 
          isActive: true,
          ...(sex && {
            $or: [
              { sex: sex },
              { sex: 'unisex' }
            ]
          })
        },
        select: 'name description sex image sortOrder seo customFields',
        options: { sort: { sortOrder: 1, name: 1 } }
      });
    
    if (!category) {
      throw new HttpError('Category not found', 404);
    }
    
    // Get product count for this category
    const productCount = await Product.countDocuments({
      category: category._id,
      isActive: true,
      ...(sex && {
        $or: [
          { sex: sex },
          { sex: 'unisex' }
        ]
      })
    });
    
    const categoryWithCount = {
      ...category.toObject(),
      productCount
    };
    
    res.status(200).json({
      success: true,
      data: categoryWithCount
    });
  });

  // Create category with image upload support
  static createCategory = asyncHandler(async (req, res) => {
    const { name, description, sex, parent, image, sortOrder, seo, customFields, isActive = true } = req.body;
    
    // Validate required fields
    if (!name) {
      throw new HttpError('Category name is required', 400);
    }
    
    // Check if category with same name already exists
    const existingCategory = await Category.findOne({ 
      name,
      ...(parent && { parent })
    });
    if (existingCategory) {
      throw new HttpError('Category with this name already exists in this parent category', 400);
    }
    
    // Validate sex
    if (sex && !['men', 'women', 'unisex', 'kids', 'baby'].includes(sex)) {
      throw new HttpError('Invalid sex value', 400);
    }
    
    // Generate slug if not provided
    let slug = seo?.slug;
    if (!slug) {
      slug = name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    }
    
    // Check if slug is unique
    const existingSlug = await Category.findOne({ 'seo.slug': slug });
    if (existingSlug) {
      throw new HttpError('Slug already exists', 400);
    }
    
    // Handle image upload if file is provided
    let imageData = image;
    if (req.file) {
      const uploadResult = await uploadToCloudinary(req.file.path, 'categories');
      
      if (!uploadResult.success) {
        throw new HttpError('Failed to upload category image', 500);
      }

      imageData = {
        url: uploadResult.data.url,
        public_id: uploadResult.data.public_id,
        alt: name
      };
    }
    
    const category = new Category({
      name: name.trim(),
      description: description?.trim(),
      sex: sex || 'unisex',
      parent: parent || null,
      image: imageData,
      sortOrder: sortOrder || 0,
      seo: {
        title: seo?.title || name,
        description: seo?.description || description,
        slug,
        ...seo
      },
      customFields,
      isActive
    });
    
    await category.save();
    
    // If this is a subcategory, add to parent's children array
    if (parent) {
      await Category.findByIdAndUpdate(parent, {
        $addToSet: { children: category._id }
      });
    }
    
    await category.populate('parent', 'name sex seo.slug');
    
    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: category
    });
  });

  // Update category with image handling
  static updateCategory = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    
    const category = await Category.findById(id);
    if (!category) {
      throw new HttpError('Category not found', 404);
    }
    
    // Store original values for comparison
    const originalName = category.name;
    const originalSlug = category.seo?.slug;
    
    // Validate sex if provided
    if (updates.sex && !['men', 'women', 'unisex', 'kids', 'baby'].includes(updates.sex)) {
      throw new HttpError('Invalid sex value', 400);
    }
    
    // Check name uniqueness if name is being updated
    if (updates.name && updates.name !== originalName) {
      const existingCategory = await Category.findOne({ 
        name: updates.name,
        _id: { $ne: id },
        ...(updates.parent && { parent: updates.parent })
      });
      if (existingCategory) {
        throw new HttpError('Category with this name already exists in this parent category', 400);
      }
    }
    
    // Handle slug logic
    let newSlug = null;
    
    // Case 1: Custom slug provided - validate uniqueness
    if (updates.seo?.slug && updates.seo.slug !== originalSlug) {
      const existingSlug = await Category.findOne({ 
        'seo.slug': updates.seo.slug,
        _id: { $ne: id }
      });
      if (existingSlug) {
        throw new HttpError('Slug already exists', 400);
      }
      newSlug = updates.seo.slug;
    }
    // Case 2: Name changed but no custom slug provided - auto-generate slug
    else if (updates.name && updates.name !== originalName && !updates.seo?.slug) {
      newSlug = category.generateSlug(updates.name);
      
      // Check if auto-generated slug is unique
      const existingSlug = await Category.findOne({ 
        'seo.slug': newSlug,
        _id: { $ne: id }
      });
      
      if (existingSlug) {
        // If auto-generated slug exists, append ID to make it unique
        newSlug = `${newSlug}-${id.toString().slice(-6)}`;
      }
      
      // Ensure the final slug is unique
      const finalSlugCheck = await Category.findOne({ 
        'seo.slug': newSlug,
        _id: { $ne: id }
      });
      
      if (finalSlugCheck) {
        // If still not unique, append timestamp
        newSlug = `${newSlug}-${Date.now().toString().slice(-6)}`;
      }
    }
    
    // Apply the new slug if generated
    if (newSlug) {
      updates.seo = updates.seo || {};
      updates.seo.slug = newSlug;
    }
    
    // Handle image upload if new file is provided
    if (req.file) {
      // Delete old image from Cloudinary if exists
      if (category.image?.public_id) {
        await deleteImage(category.image.public_id);
      }
      
      const uploadResult = await uploadToCloudinary(req.file.path, 'categories');
      
      if (!uploadResult.success) {
        throw new HttpError('Failed to upload category image', 500);
      }

      updates.image = {
        url: uploadResult.data.url,
        public_id: uploadResult.data.public_id,
        alt: updates.name || category.name
      };
    }
    
    // Handle parent change
    if (updates.parent !== undefined && updates.parent !== category.parent?.toString()) {
      const oldParent = category.parent;
      const newParent = updates.parent;
      
      // Remove from old parent's children array
      if (oldParent) {
        await Category.findByIdAndUpdate(oldParent, {
          $pull: { children: category._id }
        });
      }
      
      // Add to new parent's children array
      if (newParent) {
        await Category.findByIdAndUpdate(newParent, {
          $addToSet: { children: category._id }
        });
      }
    }
    
    // Update fields - handle nested seo object properly
    Object.keys(updates).forEach(key => {
      if (key === 'seo') {
        // Merge seo updates with existing seo data
        category.seo = { 
          ...category.seo.toObject?.() || category.seo, 
          ...updates.seo 
        };
      } else if (key !== 'parent') { // parent is handled separately
        category[key] = updates[key];
      }
    });
    
    category.updatedAt = new Date();
    await category.save();
    
    await category.populate('parent', 'name sex seo.slug');
    await category.populate('children', 'name sex seo.slug sortOrder');
    
    res.status(200).json({
      success: true,
      message: 'Category updated successfully',
      data: category
    });
  });

  // Get available sex options
  static getSexOptions = asyncHandler(async (req, res) => {
    const sexOptions = [
      { value: 'men', label: 'Men', description: 'Products for men' },
      { value: 'women', label: 'Women', description: 'Products for women' },
      { value: 'unisex', label: 'Unisex', description: 'Products for all genders' },
      { value: 'kids', label: 'Kids', description: 'Products for children' },
      { value: 'baby', label: 'Baby', description: 'Products for babies' }
    ];
    
    res.status(200).json({
      success: true,
      data: sexOptions
    });
  });

  // Get category statistics by sex
  static getCategoryStatsBySex = asyncHandler(async (req, res) => {
    const { sex } = req.params;
    
    if (!['men', 'women', 'unisex', 'kids', 'baby'].includes(sex)) {
      throw new HttpError('Invalid sex parameter', 400);
    }
    
    const stats = await Category.aggregate([
      {
        $match: {
          isActive: true,
          $or: [
            { sex: sex },
            { sex: 'unisex' }
          ]
        }
      },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: 'category',
          as: 'products',
          pipeline: [
            {
              $match: {
                isActive: true,
                $or: [
                  { sex: sex },
                  { sex: 'unisex' }
                ]
              }
            },
            {
              $project: {
                price: 1,
                quantity: 1,
                isActive: 1
              }
            }
          ]
        }
      },
      {
        $project: {
          name: 1,
          sex: 1,
          'seo.slug': 1,
          productCount: { $size: '$products' },
          totalStock: { $sum: '$products.quantity' },
          averagePrice: { 
            $cond: {
              if: { $gt: [{ $size: '$products' }, 0] },
              then: { $avg: '$products.price' },
              else: 0
            }
          },
          hasProducts: { $gt: [{ $size: '$products' }, 0] }
        }
      },
      {
        $sort: { productCount: -1, name: 1 }
      }
    ]);
    
    // Calculate overall statistics
    const totalCategories = stats.length;
    const totalProducts = stats.reduce((sum, stat) => sum + stat.productCount, 0);
    const totalStock = stats.reduce((sum, stat) => sum + stat.totalStock, 0);
    const categoriesWithProducts = stats.filter(stat => stat.hasProducts).length;
    
    res.status(200).json({
      success: true,
      sex: sex,
      summary: {
        totalCategories,
        totalProducts,
        totalStock,
        categoriesWithProducts,
        categoriesWithoutProducts: totalCategories - categoriesWithProducts
      },
      data: stats
    }); 
  });

  // Get single category by ID
  static getCategoryById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    const category = await Category.findById(id)
      .populate('parent', 'name sex seo.slug image')
      .populate({
        path: 'children',
        match: { isActive: true },
        select: 'name description sex image sortOrder seo isActive',
        options: { sort: { sortOrder: 1, name: 1 } }
      });
    
    if (!category) {
      throw new HttpError('Category not found', 404);
    }
    
    // Get product count
    const productCount = await Product.countDocuments({
      category: id,
      isActive: true
    });
    
    const categoryWithCount = {
      ...category.toObject(),
      productCount
    };
    
    res.status(200).json({
      success: true,
      data: categoryWithCount
    });
  });

  // Delete category
  static deleteCategory = asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    const category = await Category.findById(id);
    if (!category) {
      throw new HttpError('Category not found', 404);
    }
    
    // Check if category has products
    const productCount = await Product.countDocuments({ category: id });
    if (productCount > 0) {
      throw new HttpError('Cannot delete category with associated products', 400);
    }
    
    // Check if category has children
    if (category.children && category.children.length > 0) {
      throw new HttpError('Cannot delete category with subcategories. Please delete subcategories first.', 400);
    }
    
    // Delete image from Cloudinary if exists
    if (category.image?.public_id) {
      await deleteImage(category.image.public_id);
    }
    
    // Remove from parent's children array if exists
    if (category.parent) {
      await Category.findByIdAndUpdate(category.parent, {
        $pull: { children: category._id }
      });
    }
    
    await Category.findByIdAndDelete(id);
    
    res.status(200).json({
      success: true,
      message: 'Category deleted successfully'
    });
  });

  // Toggle category active status
  static toggleCategoryStatus = asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    const category = await Category.findById(id);
    if (!category) {
      throw new HttpError('Category not found', 404);
    }
    
    category.isActive = !category.isActive;
    category.updatedAt = new Date();
    await category.save();
    
    res.status(200).json({
      success: true,
      message: `Category ${category.isActive ? 'activated' : 'deactivated'} successfully`,
      data: {
        _id: category._id,
        name: category.name,
        isActive: category.isActive
      }
    });
  });

  // Bulk update categories (sort order, status, etc.)
  static bulkUpdateCategories = asyncHandler(async (req, res) => {
    const { updates } = req.body;
    
    if (!Array.isArray(updates) || updates.length === 0) {
      throw new HttpError('Updates array is required', 400);
    }
    
    const updatePromises = updates.map(async (update) => {
      const { id, sortOrder, isActive } = update;
      
      if (!id) {
        throw new HttpError('Category ID is required for each update', 400);
      }
      
      const updateData = {};
      if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
      if (isActive !== undefined) updateData.isActive = isActive;
      
      return Category.findByIdAndUpdate(
        id,
        updateData,
        { new: true, runValidators: true }
      );
    });
    
    const updatedCategories = await Promise.all(updatePromises);
    
    res.status(200).json({
      success: true,
      message: `${updatedCategories.length} categories updated successfully`,
      data: updatedCategories
    });
  });

  // Search categories with autocomplete
  static searchCategories = asyncHandler(async (req, res) => {
    const { query, sex, limit = 10 } = req.query;
    
    if (!query || query.length < 2) {
      throw new HttpError('Search query must be at least 2 characters', 400);
    }
    
    let filter = {
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } },
        { 'seo.slug': { $regex: query, $options: 'i' } }
      ],
      isActive: true
    };
    
    // Filter by sex if provided
    if (sex && ['men', 'women', 'unisex', 'kids', 'baby'].includes(sex)) {
      filter.$or = [
        { sex: sex },
        { sex: 'unisex' }
      ];
    }
    
    const categories = await Category.find(filter)
      .select('name sex image seo sortOrder')
      .populate('parent', 'name sex seo.slug')
      .limit(parseInt(limit))
      .sort({ sortOrder: 1, name: 1 });
    
    res.status(200).json({
      success: true,
      query,
      count: categories.length,
      data: categories
    }); 
  });
}

module.exports = CategoryController;