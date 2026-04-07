const asyncHandler = require("express-async-handler");
const HttpError = require('../middleware/HttpError');
const Product = require('../models/Product');
const Category = require('../models/Category');
const mongoose = require('mongoose');
const {
  uploadToCloudinary,
  uploadMultipleImages,
  deleteImage,
  deleteMultipleImages
} = require('../utils/cloudinary');
const ProductHelpers = require('../helpers/ProductHelpers');

class ProductController {



    static getProductsOnSale = asyncHandler(async (req, res) => {
    try {
      const { 
        page = 1, 
        limit = 10,
        category,
        minDiscount = 0,
        maxDiscount = 100,
        sortBy = 'discountPercentage',
        sortOrder = 'desc'
      } = req.query;

      // Build base query for discounted products
      let query = {
        isActive: true,
        'colors.hasColors': true,
        'colors.availableColors.comparePrice': { $exists: true, $gt: 0 },
        $expr: {
          $gt: [
            { $arrayElemAt: ['$colors.availableColors.comparePrice', 0] },
            { $arrayElemAt: ['$colors.availableColors.price', 0] }
          ]
        }
      };

      // Filter by category if provided
      if (category) {
        query.category = category;
      }

      // Calculate skip for pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Build aggregation pipeline
      const pipeline = [
        { $match: query },
        
        // Calculate discount percentage for each product
        {
          $addFields: {
            discountPercentage: {
              $cond: {
                if: {
                  $and: [
                    { $gt: [{ $arrayElemAt: ['$colors.availableColors.comparePrice', 0] }, 0] },
                    { $gt: [{ $arrayElemAt: ['$colors.availableColors.comparePrice', 0] }, { $arrayElemAt: ['$colors.availableColors.price', 0] }] }
                  ]
                },
                then: {
                  $multiply: [
                    {
                      $divide: [
                        { $subtract: [
                          { $arrayElemAt: ['$colors.availableColors.comparePrice', 0] },
                          { $arrayElemAt: ['$colors.availableColors.price', 0] }
                        ] },
                        { $arrayElemAt: ['$colors.availableColors.comparePrice', 0] }
                      ]
                    },
                    100
                  ]
                },
                else: 0
              }
            },
            // Get first color for price calculations
            firstColorPrice: { $arrayElemAt: ['$colors.availableColors.price', 0] },
            firstColorComparePrice: { $arrayElemAt: ['$colors.availableColors.comparePrice', 0] }
          }
        },
        
        // Filter by discount percentage range
        {
          $match: {
            discountPercentage: { $gte: parseFloat(minDiscount), $lte: parseFloat(maxDiscount) }
          }
        },
        
        // Populate category and brand
        {
          $lookup: {
            from: 'categories',
            localField: 'category',
            foreignField: '_id',
            as: 'category'
          }
        },
        { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'brands',
            localField: 'brand',
            foreignField: '_id',
            as: 'brand'
          }
        },
        { $unwind: { path: '$brand', preserveNullAndEmptyArrays: true } },
        
        // Project only necessary fields for performance
        {
          $project: {
            name: 1,
            description: 1,
            shortDescription: 1,
            'seo.slug': 1,
            discountPercentage: 1,
            firstColorPrice: 1,
            firstColorComparePrice: 1,
            salesCount: 1,
            ratings: 1,
            viewCount: 1,
            wishlistCount: 1,
            isFeatured: 1,
            isNew: 1,
            isBestSeller: 1,
            category: {
              _id: 1,
              name: 1,
              path: 1
            },
            brand: {
              _id: 1,
              name: 1,
              logoUrl: 1,
              logoThumbnail: 1
            },
            colors: {
              hasColors: 1,
              availableColors: {
                name: 1,
                value: 1,
                hexCode: 1,
                price: 1,
                comparePrice: 1,
                images: { $slice: ['$colors.availableColors.images', 1] } // Get only first image
              }
            },
            meta: {
              createdAt: 1,
              updatedAt: 1
            },
            variants: { $slice: ['$variants', 5] } // Limit variants for performance
          }
        }
      ];

      // Add sorting
      const sortOptions = {};
      switch (sortBy) {
        case 'discountPercentage':
          sortOptions.discountPercentage = sortOrder === 'desc' ? -1 : 1;
          break;
        case 'price':
          sortOptions.firstColorPrice = sortOrder === 'desc' ? -1 : 1;
          break;
        case 'sales':
          sortOptions.salesCount = sortOrder === 'desc' ? -1 : 1;
          break;
        case 'date':
          sortOptions['meta.createdAt'] = sortOrder === 'desc' ? -1 : 1;
          break;
        default:
          sortOptions.discountPercentage = -1;
      }

      // Get total count for pagination
      const countPipeline = [...pipeline];
      countPipeline.splice(countPipeline.length - 1, 1); // Remove project stage
      const countResult = await Product.aggregate([
        ...countPipeline,
        { $count: 'total' }
      ]);

      const total = countResult.length > 0 ? countResult[0].total : 0;
      const pages = Math.ceil(total / parseInt(limit));

      // Add pagination and sorting to main pipeline
      pipeline.push({ $sort: sortOptions });
      pipeline.push({ $skip: skip });
      pipeline.push({ $limit: parseInt(limit) });

      // Execute query
      const products = await Product.aggregate(pipeline);

      // Format response
      const formattedProducts = products.map(product => {
        const primaryColor = product.colors.availableColors[0];
        const primaryImage = primaryColor?.images?.[0] || null;
        
        return {
          ...product,
          displayPrice: primaryColor?.comparePrice 
            ? `$${primaryColor.price.toFixed(2)} (Was $${primaryColor.comparePrice.toFixed(2)})`
            : `$${primaryColor?.price.toFixed(2) || '0.00'}`,
          primaryImage,
          hasDiscount: product.discountPercentage > 0,
          price: primaryColor?.price || 0,
          comparePrice: primaryColor?.comparePrice || 0
        };
      });

      // Get discount statistics
      const statsPipeline = [
        { $match: query },
        {
          $addFields: {
            discountPercentage: {
              $cond: {
                if: {
                  $and: [
                    { $gt: [{ $arrayElemAt: ['$colors.availableColors.comparePrice', 0] }, 0] },
                    { $gt: [{ $arrayElemAt: ['$colors.availableColors.comparePrice', 0] }, { $arrayElemAt: ['$colors.availableColors.price', 0] }] }
                  ]
                },
                then: {
                  $multiply: [
                    {
                      $divide: [
                        { $subtract: [
                          { $arrayElemAt: ['$colors.availableColors.comparePrice', 0] },
                          { $arrayElemAt: ['$colors.availableColors.price', 0] }
                        ] },
                        { $arrayElemAt: ['$colors.availableColors.comparePrice', 0] }
                      ]
                },
                    100
                  ]
                },
                else: 0
              }
            }
          }
        },
        {
          $group: {
            _id: null,
            totalProducts: { $sum: 1 },
            avgDiscount: { $avg: '$discountPercentage' },
            maxDiscount: { $max: '$discountPercentage' },
            minDiscount: { $min: '$discountPercentage' },
            totalDiscountBands: {
              $push: {
                $cond: [
                  { $gte: ['$discountPercentage', 50] },
                  '50+',
                  {
                    $cond: [
                      { $gte: ['$discountPercentage', 30] },
                      '30-49',
                      {
                        $cond: [
                          { $gte: ['$discountPercentage', 20] },
                          '20-29',
                          {
                            $cond: [
                              { $gte: ['$discountPercentage', 10] },
                              '10-19',
                              '0-9'
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            }
          }
        }
      ];

      const stats = await Product.aggregate(statsPipeline);
      const statistics = stats.length > 0 ? stats[0] : {
        totalProducts: 0,
        avgDiscount: 0,
        maxDiscount: 0,
        minDiscount: 0,
        totalDiscountBands: []
      };

      // Calculate discount bands distribution
      const discountBands = {
        '0-9': 0,
        '10-19': 0,
        '20-29': 0,
        '30-49': 0,
        '50+': 0
      };

      statistics.totalDiscountBands?.forEach(band => {
        discountBands[band] = (discountBands[band] || 0) + 1;
      });

      res.json({
        success: true,
        data: formattedProducts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages
        },
        statistics: {
          ...statistics,
          discountBands,
          totalDiscountBands: undefined // Remove array from response
        },
        filters: {
          applied: {
            category: category || 'all',
            minDiscount: parseFloat(minDiscount),
            maxDiscount: parseFloat(maxDiscount),
            sortBy,
            sortOrder
          },
          available: {
            // You can add available filters here
          }
        }
      });

    } catch (error) {
      console.error('Error fetching products on sale:', error);
      throw new HttpError('Failed to fetch products on sale', 500);
    }
  });

  /**
   * Get new arrivals/products
   * Products marked as isNew = true or recently created
   */
static getNewArrivals = asyncHandler(async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 12,
      days = 30, // Default to last 30 days
      category,
      sortBy = 'date',
      sortOrder = 'desc'
    } = req.query;

    // Calculate date threshold
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(days));

    // Build query
    let query = {
      isActive: true,
      $or: [
        { isNew: true },
        { 'meta.createdAt': { $gte: daysAgo } }
      ]
    };

    // Filter by category if provided
    if (category) {
      query.category = category;
    }

    // Calculate skip for pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build aggregation pipeline
    const pipeline = [
      { $match: query },
      
      // Add flag for isRecentlyCreated
      {
        $addFields: {
          isRecentlyCreated: {
            $gte: ['$meta.createdAt', daysAgo]
          },
          daysSinceCreation: {
            $floor: {
              $divide: [
                { $subtract: [new Date(), '$meta.createdAt'] },
                1000 * 60 * 60 * 24 // Milliseconds in a day
              ]
            }
          }
        }
      },
      
      // Populate category and brand
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category'
        }
      },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'brands',
          localField: 'brand',
          foreignField: '_id',
          as: 'brand'
        }
      },
      { $unwind: { path: '$brand', preserveNullAndEmptyArrays: true } },
      
      // Project only necessary fields
      {
        $project: {
          name: 1,
          description: 1,
          shortDescription: 1,
          'seo.slug': 1,
          isNew: 1,
          isRecentlyCreated: 1,
          daysSinceCreation: 1,
          salesCount: 1,
          ratings: 1,
          viewCount: 1,
          wishlistCount: 1,
          isFeatured: 1,
          isBestSeller: 1,
          category: {
            _id: 1,
            name: 1,
            path: 1
          },
          brand: {
            _id: 1,
            name: 1,
            logoUrl: 1,
            logoThumbnail: 1
          },
          colors: {
            hasColors: 1,
            availableColors: {
              $map: {
                input: '$colors.availableColors',
                as: 'color',
                in: {
                  name: '$$color.name',
                  value: '$$color.value',
                  hexCode: '$$color.hexCode',
                  price: '$$color.price',
                  comparePrice: '$$color.comparePrice',
                  images: { $slice: ['$$color.images', 1] }
                }
              }
            }
          },
          meta: {
            createdAt: 1,
            updatedAt: 1
          },
          variants: { $slice: ['$variants', 3] }
        }
      }
    ];

    // Add sorting
    const sortOptions = {};
    switch (sortBy) {
      case 'date':
        sortOptions['meta.createdAt'] = sortOrder === 'desc' ? -1 : 1;
        break;
      case 'popularity':
        sortOptions.viewCount = sortOrder === 'desc' ? -1 : 1;
        break;
      case 'sales':
        sortOptions.salesCount = sortOrder === 'desc' ? -1 : 1;
        break;
      case 'price':
        // Sort by first color price
        pipeline.push({
          $addFields: {
            minPrice: { $min: '$colors.availableColors.price' }
          }
        });
        sortOptions.minPrice = sortOrder === 'desc' ? -1 : 1;
        break;
      default:
        sortOptions['meta.createdAt'] = -1;
    }

    // Get total count
    const countPipeline = [...pipeline];
    countPipeline.splice(countPipeline.length - 1, 1); // Remove project stage
    const countResult = await Product.aggregate([
      ...countPipeline,
      { $count: 'total' }
    ]);

    const total = countResult.length > 0 ? countResult[0].total : 0;
    const pages = Math.ceil(total / parseInt(limit));

    // Add pagination and sorting
    if (sortBy !== 'price') {
      pipeline.push({ $sort: sortOptions });
    }
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: parseInt(limit) });

    // Execute query
    const products = await Product.aggregate(pipeline);

    // Format response
    const formattedProducts = products.map(product => {
      const primaryColor = product.colors.availableColors?.[0];
      const primaryImage = primaryColor?.images?.[0] || null;
      
      // Calculate discount percentage if comparePrice exists
      const discountPercentage = primaryColor?.comparePrice && primaryColor.comparePrice > primaryColor.price
        ? Math.round(((primaryColor.comparePrice - primaryColor.price) / primaryColor.comparePrice) * 100)
        : 0;

      return {
        ...product,
        displayPrice: primaryColor?.comparePrice && primaryColor.comparePrice > primaryColor.price
          ? `$${primaryColor.price.toFixed(2)} (Was $${primaryColor.comparePrice.toFixed(2)})`
          : `$${primaryColor?.price.toFixed(2) || '0.00'}`,
        primaryImage,
        hasDiscount: discountPercentage > 0,
        discountPercentage,
        price: primaryColor?.price || 0,
        comparePrice: primaryColor?.comparePrice || 0
      };
    });

    // Get statistics
    const statsPipeline = [
      { $match: query },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          totalNewFlagged: {
            $sum: { $cond: [{ $eq: ['$isNew', true] }, 1, 0] }
          },
          totalRecentlyCreated: {
            $sum: { $cond: [{ $gte: ['$meta.createdAt', daysAgo] }, 1, 0] }
          },
          avgPrice: {
            $avg: { $arrayElemAt: ['$colors.availableColors.price', 0] }
          },
          avgRating: { $avg: '$ratings.average' }
        }
      }
    ];

    const stats = await Product.aggregate(statsPipeline);
    const statistics = stats.length > 0 ? stats[0] : {
      totalProducts: 0,
      totalNewFlagged: 0,
      totalRecentlyCreated: 0,
      avgPrice: 0,
      avgRating: 0
    };

    // Get category distribution
    const categoryPipeline = [
      { $match: query },
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category'
        }
      },
      { $unwind: '$category' },
      {
        $group: {
          _id: '$category.name',
          count: { $sum: 1 },
          avgPrice: { $avg: { $arrayElemAt: ['$colors.availableColors.price', 0] } }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ];

    const categoryDistribution = await Product.aggregate(categoryPipeline);

    res.json({
      success: true,
      data: formattedProducts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages
      },
      statistics: {
        ...statistics,
        categoryDistribution
      },
      filters: {
        applied: {
          days: parseInt(days),
          category: category || 'all',
          sortBy,
          sortOrder
        }
      }
    });

  } catch (error) {
    console.error('Error fetching new arrivals:', error);
    throw new HttpError('Failed to fetch new arrivals', 500);
  }
});

  /**
   * Get category statistics
   * Comprehensive stats for all categories or specific category
   */
  static getCategoryStats = asyncHandler(async (req, res) => {
    try {
      const { categoryId, includeProducts = false, limit = 5 } = req.query;

      let matchQuery = { isActive: true };
      if (categoryId) {
        matchQuery.category = mongoose.Types.ObjectId(categoryId);
      }

      // Main statistics pipeline
      const pipeline = [
        { $match: matchQuery },
        {
          $lookup: {
            from: 'categories',
            localField: 'category',
            foreignField: '_id',
            as: 'category'
          }
        },
        { $unwind: '$category' },
        {
          $group: {
            _id: '$category._id',
            categoryName: { $first: '$category.name' },
            categoryPath: { $first: '$category.path' },
            totalProducts: { $sum: 1 },
            totalInStock: {
              $sum: {
                $cond: [
                  { $gt: ['$totalQuantity', 0] },
                  1,
                  0
                ]
              }
            },
            totalOutOfStock: {
              $sum: {
                $cond: [
                  { $eq: ['$totalQuantity', 0] },
                  1,
                  0
                ]
              }
            },
            totalLowStock: {
              $sum: {
                $cond: [
                  { $and: [
                    { $gt: ['$totalQuantity', 0] },
                    { $lte: ['$totalQuantity', '$lowStockThreshold'] }
                  ]},
                  1,
                  0
                ]
              }
            },
            avgPrice: {
              $avg: { $arrayElemAt: ['$colors.availableColors.price', 0] }
            },
            minPrice: {
              $min: { $arrayElemAt: ['$colors.availableColors.price', 0] }
            },
            maxPrice: {
              $max: { $arrayElemAt: ['$colors.availableColors.price', 0] }
            },
            totalSales: { $sum: '$salesCount' },
            totalViews: { $sum: '$viewCount' },
            totalWishlist: { $sum: '$wishlistCount' },
            avgRating: { $avg: '$ratings.average' },
            totalFeatured: { $sum: { $cond: [{ $eq: ['$isFeatured', true] }, 1, 0] } },
            totalNew: { $sum: { $cond: [{ $eq: ['$isNew', true] }, 1, 0] } },
            totalBestSeller: { $sum: { $cond: [{ $eq: ['$isBestSeller', true] }, 1, 0] } },
            totalDiscounted: {
              $sum: {
                $cond: [{
                  $and: [
                    { $gt: [{ $arrayElemAt: ['$colors.availableColors.comparePrice', 0] }, 0] },
                    { $gt: [
                      { $arrayElemAt: ['$colors.availableColors.comparePrice', 0] },
                      { $arrayElemAt: ['$colors.availableColors.price', 0] }
                    ]}
                  ]
                }, 1, 0]
              }
            },
            // Collect sample products if needed
            sampleProducts: { $push: '$$ROOT' }
          }
        },
        {
          $project: {
            categoryName: 1,
            categoryPath: 1,
            totalProducts: 1,
            stockStatus: {
              inStock: '$totalInStock',
              outOfStock: '$totalOutOfStock',
              lowStock: '$totalLowStock',
              inStockPercentage: {
                $multiply: [
                  { $divide: ['$totalInStock', '$totalProducts'] },
                  100
                ]
              }
            },
            priceRange: {
              average: { $round: ['$avgPrice', 2] },
              minimum: '$minPrice',
              maximum: '$maxPrice',
              range: {
                $concat: [
                  '$',
                  { $toString: { $round: ['$minPrice', 2] } },
                  ' - $',
                  { $toString: { $round: ['$maxPrice', 2] } }
                ]
              }
            },
            performance: {
              totalSales: '$totalSales',
              totalViews: '$totalViews',
              totalWishlist: '$totalWishlist',
              conversionRate: {
                $cond: [
                  { $gt: ['$totalViews', 0] },
                  {
                    $multiply: [
                      { $divide: ['$totalSales', '$totalViews'] },
                      100
                    ]
                  },
                  0
                ]
              },
              wishlistRate: {
                $cond: [
                  { $gt: ['$totalViews', 0] },
                  {
                    $multiply: [
                      { $divide: ['$totalWishlist', '$totalViews'] },
                      100
                    ]
                  },
                  0
                ]
              }
            },
            ratings: {
              average: { $round: ['$avgRating', 1] },
              total: {
                $sum: '$ratings.count'
              }
            },
            flags: {
              featured: '$totalFeatured',
              new: '$totalNew',
              bestSeller: '$totalBestSeller',
              discounted: '$totalDiscounted',
              discountedPercentage: {
                $cond: [
                  { $gt: ['$totalProducts', 0] },
                  {
                    $multiply: [
                      { $divide: ['$totalDiscounted', '$totalProducts'] },
                      100
                    ]
                  },
                  0
                ]
              }
            },
            // Limit sample products
            sampleProducts: {
              $slice: ['$sampleProducts', parseInt(limit)]
            }
          }
        },
        { $sort: { totalProducts: -1 } }
      ];

      const categoryStats = await Product.aggregate(pipeline);

      // Process sample products if includeProducts is true
      if (includeProducts === 'true' && categoryStats.length > 0) {
        categoryStats.forEach(category => {
          category.sampleProducts = category.sampleProducts.map(product => {
            const primaryColor = product.colors?.availableColors?.[0];
            return {
              _id: product._id,
              name: product.name,
              seo: product.seo,
              primaryImage: primaryColor?.images?.[0] || null,
              price: primaryColor?.price || 0,
              comparePrice: primaryColor?.comparePrice || 0,
              discountPercentage: primaryColor?.comparePrice && primaryColor.comparePrice > primaryColor.price
                ? Math.round(((primaryColor.comparePrice - primaryColor.price) / primaryColor.comparePrice) * 100)
                : 0,
              inStock: product.totalQuantity > 0,
              isLowStock: product.totalQuantity > 0 && product.totalQuantity <= product.lowStockThreshold,
              salesCount: product.salesCount,
              ratings: product.ratings
            };
          });
        });
      } else {
        // Remove sampleProducts from response if not needed
        categoryStats.forEach(category => {
          delete category.sampleProducts;
        });
      }

      // Overall summary statistics
      const summaryPipeline = [
        { $match: { isActive: true } },
        {
          $group: {
            _id: null,
            totalProducts: { $sum: 1 },
            totalCategories: { $addToSet: '$category' },
            avgPriceOverall: { $avg: { $arrayElemAt: ['$colors.availableColors.price', 0] } },
            totalSalesOverall: { $sum: '$salesCount' },
            totalViewsOverall: { $sum: '$viewCount' },
            productsWithDiscount: {
              $sum: {
                $cond: [{
                  $and: [
                    { $gt: [{ $arrayElemAt: ['$colors.availableColors.comparePrice', 0] }, 0] },
                    { $gt: [
                      { $arrayElemAt: ['$colors.availableColors.comparePrice', 0] },
                      { $arrayElemAt: ['$colors.availableColors.price', 0] }
                    ]}
                  ]
                }, 1, 0]
              }
            }
          }
        },
        {
          $project: {
            totalProducts: 1,
            totalCategories: { $size: '$totalCategories' },
            avgPriceOverall: { $round: ['$avgPriceOverall', 2] },
            totalSalesOverall: 1,
            totalViewsOverall: 1,
            conversionRateOverall: {
              $cond: [
                { $gt: ['$totalViewsOverall', 0] },
                {
                  $multiply: [
                    { $divide: ['$totalSalesOverall', '$totalViewsOverall'] },
                    100
                  ]
                },
                0
              ]
            },
            discountPenetration: {
              $cond: [
                { $gt: ['$totalProducts', 0] },
                {
                  $multiply: [
                    { $divide: ['$productsWithDiscount', '$totalProducts'] },
                    100
                  ]
                },
                0
              ]
            }
          }
        }
      ];

      const summaryResult = await Product.aggregate(summaryPipeline);
      const summary = summaryResult.length > 0 ? summaryResult[0] : {
        totalProducts: 0,
        totalCategories: 0,
        avgPriceOverall: 0,
        totalSalesOverall: 0,
        totalViewsOverall: 0,
        conversionRateOverall: 0,
        discountPenetration: 0
      };

      res.json({
        success: true,
        data: categoryStats,
        summary,
        timestamp: new Date()
      });

    } catch (error) {
      console.error('Error fetching category statistics:', error);
      throw new HttpError('Failed to fetch category statistics', 500);
    }
  });


  static getAllProducts = asyncHandler(async (req, res) => {
  try {
    // Extract parameters from both params and query
    const params = { ...req.params, ...req.query };
    
    const {
      // Main identifiers
      slug,
      category,
      categoryId,
      brandIds,
      
      // ADDED: Subcategory filter
      subcategory,
      
      // Pagination and sorting
      page = 1,
      limit = 12,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      
      // Price filters
      minPrice,
      maxPrice,
      minColorPrice,
      maxColorPrice,
      colorPriceRange,
      
      // Stock and status filters
      inStock,
      featured,
      onSale,
      newArrivals,
      
      // Color filters
      color,
      colors,
      hasColors,
      
      // Size filters
      size,
      sizes,
      hasSizes,
      
      // Brand and material
      brand,
      material,
      
      // Rating filters
      rating,
      minRating,
      maxRating,
      
      // Discount filters
      discountPercentage,
      
      // Search and tags
      search,
      tags,
      
      // Category specific
      sex,
      
      // Accessory filters
      accessories,
      accessoryType,
      categorySlug,
      
      // Extract array parameters properly
      ...otherParams
    } = params;

    // Handle array parameters (from query string like ?accessories[]=watches&accessories[]=jewelry)
    const accessoryArray = req.query.accessories 
      ? (Array.isArray(req.query.accessories) 
          ? req.query.accessories 
          : [req.query.accessories])
      : [];

    const colorArray = req.query.colors 
      ? (Array.isArray(req.query.colors) 
          ? req.query.colors 
          : req.query.colors.split(','))
      : [];

    const sizeArray = req.query.sizes 
      ? (Array.isArray(req.query.sizes) 
          ? req.query.sizes 
          : req.query.sizes.split(','))
      : [];

    const tagArray = req.query.tags 
      ? (Array.isArray(req.query.tags) 
          ? req.query.tags 
          : req.query.tags.split(','))
      : [];

    // ADDED: Handle subcategory array
    const subcategoryArray = req.query.subcategory 
      ? (Array.isArray(req.query.subcategory) 
          ? req.query.subcategory 
          : req.query.subcategory.split(','))
      : [];

    // Extract brandIds from request body if present
    let multipleBrandIds = [];
    if (req.body && req.body.brandIds) {
      multipleBrandIds = Array.isArray(req.body.brandIds) 
        ? req.body.brandIds 
        : req.body.brandIds.split(',');
    }

    // Initialize filter
    const filter = {
      isActive: true
    };

    // Handle accessory type filtering (priority: route param > query param)
    let resolvedAccessoryType = req.params.accessoryType || accessoryType;

    // Handle accessory filtering
    if (resolvedAccessoryType || accessoryArray.length > 0) {
      const validAccessories = [
        'electronics', 'beauty', 'jewelry', 'watches', 'bags', 'wallets', 
        'belts', 'hats', 'scarves', 'gloves', 'sunglasses', 'ties', 
        'socks', 'underwear', 'other'
      ];

      // Validate accessory type(s)
      const accessoriesToFilter = resolvedAccessoryType 
        ? [resolvedAccessoryType] 
        : accessoryArray;

      const invalidAccessories = accessoriesToFilter.filter(
        acc => !validAccessories.includes(acc)
      );

      if (invalidAccessories.length > 0) {
        throw new HttpError(
          `Invalid accessory types: ${invalidAccessories.join(', ')}`, 
          400
        );
      }

      // Find categories that have these accessory types
      const categoryIds = await Category.find({
        accessories: { $in: accessoriesToFilter },
        isActive: true
      }).distinct('_id');

      if (categoryIds.length === 0) {
        // Return empty response if no categories found
        return res.json({
          success: true,
          data: [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: 0,
            pages: 0
          },
          filters: {},
          filterMetadata: {},
          summary: {
            totalProducts: 0,
            showing: 0,
            priceAnalysis: null
          },
          ...(resolvedAccessoryType && { accessoryType: resolvedAccessoryType }),
          ...(accessoryArray.length > 0 && { accessories: accessoryArray })
        });
      }

      filter.category = { $in: categoryIds };
    }

    // Handle category filtering by slug (only if not already filtered by accessory)
    if (!resolvedAccessoryType && accessoryArray.length === 0 && slug) {
      const categoryDoc = await Category.findOne({ 
        'seo.slug': slug, 
        isActive: true 
      });
      
      if (!categoryDoc) {
        throw new HttpError('Category not found or inactive', 404);
      }
      
      filter.category = categoryDoc._id;
    }

    // Handle category ID filtering (only if not already filtered by accessory or slug)
    if (!resolvedAccessoryType && accessoryArray.length === 0 && !slug && categoryId && ProductHelpers.isValidObjectId(categoryId)) {
      filter.category = categoryId;
    }

    // Handle category slug from query (alternative to slug param)
    if (!resolvedAccessoryType && accessoryArray.length === 0 && categorySlug) {
      const categoryDoc = await Category.findOne({ 
        'seo.slug': categorySlug, 
        isActive: true 
      });
      
      if (categoryDoc) {
        filter.category = categoryDoc._id;
      }
    }

    // ADDED: Handle subcategory filtering
    if (subcategory || subcategoryArray.length > 0) {
      // Get all valid subcategories from the enum
      const allSubcategories = Product.getAllSubcategories();
      
      // Determine which subcategories to filter
      const subcategoriesToFilter = subcategory 
        ? [subcategory] 
        : subcategoryArray.length > 0 
          ? subcategoryArray 
          : [];

      // Validate subcategories
      const invalidSubcategories = subcategoriesToFilter.filter(
        sc => !allSubcategories.includes(sc)
      );

      if (invalidSubcategories.length > 0) {
        throw new HttpError(
          `Invalid subcategories: ${invalidSubcategories.join(', ')}. Valid subcategories are: ${allSubcategories.slice(0, 20).join(', ')}${allSubcategories.length > 20 ? '...' : ''}`,
          400
        );
      }

      if (subcategoriesToFilter.length > 0) {
        filter.subcategory = subcategoriesToFilter.length === 1 
          ? subcategoriesToFilter[0] 
          : { $in: subcategoriesToFilter };
      }
    }

    // Handle multiple brands filtering
    if (multipleBrandIds.length > 0) {
      const validBrandIds = multipleBrandIds.filter(id => ProductHelpers.isValidObjectId(id));
      if (validBrandIds.length > 0) {
        filter.brand = { $in: validBrandIds };
      }
    }

    // Handle single brand filtering
    if (brand && ProductHelpers.isValidObjectId(brand)) {
      filter.brand = brand;
    }

    // Handle sex filtering - include unisex products for all sex categories
    if (sex) {
      if (sex === 'unisex') {
        filter.sex = 'unisex';
      } else {
        filter.$or = [
          { sex: sex },
          { sex: 'unisex' }
        ];
      }
    }

    // Handle color price filtering
    if (minColorPrice || maxColorPrice) {
      filter['colors.availableColors.price'] = {
        ...(minColorPrice && { $gte: parseFloat(minColorPrice) }),
        ...(maxColorPrice && { $lte: parseFloat(maxColorPrice) })
      };
    }

    // Handle regular price filtering (for backward compatibility)
    if (minPrice || maxPrice) {
      filter['colors.availableColors.price'] = {
        ...(minPrice && { $gte: parseFloat(minPrice) }),
        ...(maxPrice && { $lte: parseFloat(maxPrice) })
      };
    }

    // Handle discount percentage filtering
    if (discountPercentage) {
      const minDiscount = parseFloat(discountPercentage);
      if (!isNaN(minDiscount) && minDiscount >= 0 && minDiscount <= 100) {
        filter.$or = [
          {
            'colors.availableColors.price': { $exists: true },
            'colors.availableColors.comparePrice': { $exists: true, $ne: null },
            $expr: {
              $gte: [
                {
                  $multiply: [
                    {
                      $divide: [
                        { $subtract: ['$colors.availableColors.comparePrice', '$colors.availableColors.price'] },
                        '$colors.availableColors.comparePrice'
                      ]
                    },
                    100
                  ]
                },
                minDiscount
              ]
            }
          }
        ];
      }
    }

    // Single color filtering
    if (color) {
      filter.$or = [
        { 'colors.availableColors.name': { $regex: color, $options: 'i' } },
        { 'colors.availableColors.value': { $regex: color, $options: 'i' } }
      ];
    }

    // Multiple colors filtering
    if (colorArray.length > 0) {
      filter['colors.availableColors.value'] = { $in: colorArray };
    }

    // Has colors filter
    if (hasColors === 'true') {
      filter['colors.hasColors'] = true;
    } else if (hasColors === 'false') {
      filter['colors.hasColors'] = false;
    }

    // Size filtering
    if (size) {
      filter.$or = [
        { 'sizeConfig.availableSizes.value': size },
        { 'sizeConfig.availableSizes.displayText': { $regex: size, $options: 'i' } },
        { 'variants.size.value': size }
      ];
    }

    // Multiple sizes filtering
    if (sizeArray.length > 0) {
      filter.$or = [
        { 'sizeConfig.availableSizes.value': { $in: sizeArray } },
        { 'variants.size.value': { $in: sizeArray } }
      ];
    }

    // Has sizes filter
    if (hasSizes === 'true') {
      filter['sizeConfig.hasSizes'] = true;
    } else if (hasSizes === 'false') {
      filter['sizeConfig.hasSizes'] = false;
    }

    // Material filtering
    if (material) {
      filter.material = { $regex: material, $options: 'i' };
    }

    // Stock filtering
    if (inStock === 'true') {
      filter.$or = [
        { quantity: { $gt: 0 } },
        { 'variants.quantity': { $gt: 0 } }
      ];
    }

    // Featured products
    if (featured === 'true') {
      filter.isFeatured = true;
    }

    // On sale products
    if (onSale === 'true') {
      filter.$or = [
        {
          'colors.availableColors.comparePrice': { 
            $exists: true, 
            $ne: null,
            $gt: '$colors.availableColors.price'
          }
        }
      ];
    }

    // New arrivals (products created in the last 30 days)
    if (newArrivals === 'true') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      filter.createdAt = { $gte: thirtyDaysAgo };
    }

    // Rating filtering - handle both single rating and min/max range
    if (rating) {
      const ratingNum = parseFloat(rating);
      if (!isNaN(ratingNum) && ratingNum >= 1 && ratingNum <= 5) {
        filter['ratings.average'] = { $gte: ratingNum };
      }
    } else if (minRating || maxRating) {
      filter['ratings.average'] = {
        ...(minRating && { $gte: parseFloat(minRating) }),
        ...(maxRating && { $lte: parseFloat(maxRating) })
      };
    }

    // Tags filtering
    if (tagArray.length > 0) {
      filter.tags = { $in: tagArray.map(tag => new RegExp(tag, 'i')) };
    }

    // Search functionality
    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      filter.$or = [
        { name: searchRegex },
        { description: searchRegex },
        { shortDescription: searchRegex },
        { tags: { $in: [new RegExp(search, 'i')] } },
        // ADDED: Search in subcategory field
        { subcategory: searchRegex }
      ];
    }

    // Build sort options
    const sortOptions = ProductHelpers.buildSortOptions(sortBy, sortOrder);

    // Build pagination
    const paginationOptions = ProductHelpers.buildPaginationOptions(page, limit);

    // Execute query with population
    const products = await Product.find(filter)
      .populate('category', 'name slug description sex image parent children accessories')
      .populate('brand', 'name logo')
      .sort(sortOptions)
      .skip(paginationOptions.skip)
      .limit(paginationOptions.limit);

    // Get total count for pagination
    const total = await Product.countDocuments(filter);

    // Get category info if slug is provided
    let categoryInfo = null;
    if (slug && !resolvedAccessoryType && accessoryArray.length === 0) {
      categoryInfo = await Category.findOne({ 
        'seo.slug': slug, 
        isActive: true 
      }).select('_id name slug sex description image parent children accessories');
    }

    // Get aggregation data for filter options
    const aggregationData = await Product.aggregate([
      { $match: filter },
      {
        $facet: {
          // Color price range
          colorPriceRange: [
            { $unwind: '$colors.availableColors' },
            {
              $group: {
                _id: null,
                minColorPrice: { $min: '$colors.availableColors.price' },
                maxColorPrice: { $max: '$colors.availableColors.price' }
              }
            }
          ],
          // Available colors
          colors: [
            { $unwind: '$colors.availableColors' },
            {
              $group: {
                _id: {
                  name: '$colors.availableColors.name',
                  value: '$colors.availableColors.value',
                  hexCode: '$colors.availableColors.hexCode'
                },
                count: { $sum: 1 },
                avgPrice: { $avg: '$colors.availableColors.price' },
                minPrice: { $min: '$colors.availableColors.price' },
                maxPrice: { $max: '$colors.availableColors.price' }
              }
            },
            {
              $project: {
                _id: 0,
                name: '$_id.name',
                value: '$_id.value',
                hexCode: '$_id.hexCode',
                count: 1,
                avgPrice: { $round: ['$avgPrice', 2] },
                minPrice: { $round: ['$minPrice', 2] },
                maxPrice: { $round: ['$maxPrice', 2] }
              }
            },
            { $sort: { count: -1, name: 1 } }
          ],
          // Available sizes
          sizes: [
            { $unwind: '$sizeConfig.availableSizes' },
            {
              $group: {
                _id: {
                  value: '$sizeConfig.availableSizes.value',
                  displayText: '$sizeConfig.availableSizes.displayText',
                  type: '$sizeConfig.availableSizes.type'
                },
                count: { $sum: 1 }
              }
            },
            {
              $project: {
                _id: 0,
                value: '$_id.value',
                displayText: '$_id.displayText',
                type: '$_id.type',
                count: 1
              }
            },
            { $sort: { count: -1, 'displayText': 1 } }
          ],
          // Available brands
          brands: [
            { $match: { brand: { $ne: null } } },
            {
              $lookup: {
                from: 'brands',
                localField: 'brand',
                foreignField: '_id',
                as: 'brandInfo'
              }
            },
            { $unwind: '$brandInfo' },
            {
              $group: {
                _id: '$brandInfo._id',
                name: { $first: '$brandInfo.name' },
                logo: { $first: '$brandInfo.logo' },
                count: { $sum: 1 }
              }
            },
            {
              $project: {
                _id: 1,
                name: 1,
                logo: 1,
                count: 1
              }
            },
            { $sort: { count: -1, name: 1 } }
          ],
          // Available materials
          materials: [
            { $match: { material: { $ne: null, $ne: '' } } },
            {
              $group: {
                _id: '$material',
                count: { $sum: 1 }
              }
            },
            {
              $project: {
                _id: 0,
                material: '$_id',
                count: 1
              }
            },
            { $sort: { count: -1, material: 1 } }
          ],
          // ADDED: Available subcategories
          subcategories: [
            { $match: { subcategory: { $ne: null, $ne: '' } } },
            {
              $group: {
                _id: '$subcategory',
                count: { $sum: 1 },
                avgRating: { $avg: '$ratings.average' },
                avgPrice: { $avg: { $arrayElemAt: ['$colors.availableColors.price', 0] } }
              }
            },
            {
              $project: {
                _id: 0,
                subcategory: '$_id',
                count: 1,
                avgRating: { $round: ['$avgRating', 1] },
                avgPrice: { $round: ['$avgPrice', 2] }
              }
            },
            { $sort: { count: -1, subcategory: 1 } }
          ],
          // Rating distribution
          ratings: [
            { $match: { 'ratings.average': { $gte: 0 } } },
            {
              $bucket: {
                groupBy: '$ratings.average',
                boundaries: [0, 1, 2, 3, 4, 5],
                default: 'other',
                output: {
                  count: { $sum: 1 }
                }
              }
            }
          ],
          // Discount distribution
          discounts: [
            { $match: { 
              'colors.availableColors.comparePrice': { $exists: true, $ne: null }
            }},
            {
              $project: {
                discountPercentage: {
                  $multiply: [
                    {
                      $divide: [
                        { $subtract: [{ $arrayElemAt: ['$colors.availableColors.comparePrice', 0] }, 
                         { $arrayElemAt: ['$colors.availableColors.price', 0] }] },
                        { $arrayElemAt: ['$colors.availableColors.comparePrice', 0] }
                      ]
                    },
                    100
                  ]
                }
              }
            },
            {
              $bucket: {
                groupBy: '$discountPercentage',
                boundaries: [0, 10, 20, 30, 40, 50, 100],
                default: 'other',
                output: {
                  count: { $sum: 1 }
                }
              }
            }
          ],
          // Accessory types distribution
          accessoryTypes: [
            { $match: { category: { $ne: null } } },
            {
              $lookup: {
                from: 'categories',
                localField: 'category',
                foreignField: '_id',
                as: 'categoryInfo'
              }
            },
            { $unwind: '$categoryInfo' },
            { $unwind: '$categoryInfo.accessories' },
            {
              $group: {
                _id: '$categoryInfo.accessories',
                count: { $sum: 1 }
              }
            },
            {
              $project: {
                _id: 0,
                accessoryType: '$_id',
                count: 1
              }
            },
            { $sort: { count: -1 } }
          ]
        }
      }
    ]);

    const facetData = aggregationData[0] || {};

    const pagination = {
      page: paginationOptions.page,
      limit: paginationOptions.limit,
      total,
      pages: Math.ceil(total / paginationOptions.limit)
    };

    // Enhance products with color data
    const enhancedProducts = products.map(product => 
      ProductHelpers.enhanceProductWithColorData(product)
    );

    // Add price analysis
    const priceAnalysis = ProductHelpers.analyzeProductPrices(enhancedProducts);

    // Build response
    const response = {
      success: true,
      data: enhancedProducts,
      pagination,
      filters: {
        // Price range
        priceRange: facetData.colorPriceRange?.[0] || { 
          minColorPrice: 0, 
          maxColorPrice: 0 
        },
        // Colors
        colors: (facetData.colors || []).map(color => ({
          ...color,
          checked: colorArray.includes(color.value)
        })),
        // Sizes
        sizes: facetData.sizes || [],
        // Brands
        brands: facetData.brands || [],
        // Materials
        materials: facetData.materials || [],
        // ADDED: Subcategories
        subcategories: facetData.subcategories || [],
        // Accessory types
        accessoryTypes: facetData.accessoryTypes || [],
        // Ratings
        ratings: facetData.ratings || [],
        // Discounts
        discounts: facetData.discounts || []
      },
      ...(categoryInfo && {
        category: {
          _id: categoryInfo._id,
          name: categoryInfo.name,
          slug: categoryInfo.slug,
          sex: categoryInfo.sex,
          description: categoryInfo.description,
          image: categoryInfo.image,
          parent: categoryInfo.parent,
          children: categoryInfo.children,
          accessories: categoryInfo.accessories
        }
      }),
      ...(resolvedAccessoryType && { accessoryType: resolvedAccessoryType }),
      ...(accessoryArray.length > 0 && { accessories: accessoryArray }),
      appliedFilters: {
        ...(slug && { slug }),
        ...(categoryId && { categoryId }),
        ...(category && { category }),
        ...(brand && { brand }),
        ...(multipleBrandIds.length > 0 && { brandIds: multipleBrandIds }),
        // ADDED: Subcategory filters
        ...(subcategory && { subcategory }),
        ...(subcategoryArray.length > 0 && { subcategories: subcategoryArray }),
        ...(resolvedAccessoryType && { accessoryType: resolvedAccessoryType }),
        ...(accessoryArray.length > 0 && { accessories: accessoryArray }),
        ...(minColorPrice && { minColorPrice: parseFloat(minColorPrice) }),
        ...(maxColorPrice && { maxColorPrice: parseFloat(maxColorPrice) }),
        ...(minPrice && { minPrice: parseFloat(minPrice) }),
        ...(maxPrice && { maxPrice: parseFloat(maxPrice) }),
        ...(color && { color }),
        ...(colorArray.length > 0 && { colors: colorArray }),
        ...(size && { size }),
        ...(sizeArray.length > 0 && { sizes: sizeArray }),
        ...(material && { material }),
        ...(inStock && { inStock: inStock === 'true' }),
        ...(featured && { featured: featured === 'true' }),
        ...(onSale && { onSale: onSale === 'true' }),
        ...(newArrivals && { newArrivals: newArrivals === 'true' }),
        ...(discountPercentage && { discountPercentage: parseFloat(discountPercentage) }),
        ...(rating && { rating: parseFloat(rating) }),
        ...(minRating && { minRating: parseFloat(minRating) }),
        ...(maxRating && { maxRating: parseFloat(maxRating) }),
        ...(search && { search }),
        ...(tagArray.length > 0 && { tags: tagArray }),
        ...(sex && { sex }),
        ...(hasColors && { hasColors: hasColors === 'true' }),
        ...(hasSizes && { hasSizes: hasSizes === 'true' }),
        sortBy,
        sortOrder
      },
      summary: {
        totalProducts: total,
        showing: enhancedProducts.length,
        priceAnalysis,
        // ADDED: Subcategory summary if filtering by subcategory
        ...(subcategory && { subcategory }),
        ...(subcategoryArray.length > 0 && { subcategories: subcategoryArray })
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching products:', error);
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError('Failed to fetch products', 500);
  }
});



static getProductsByBrands = asyncHandler(async (req, res) => {
  const { brandIds } = req.body;
  const { 
    page = 1, 
    limit = 12, 
    sortBy = 'createdAt', 
    sortOrder = 'desc',
    minPrice,
    maxPrice,
    inStock,
    featured,
    color,
    colors,
    size,
    sizes,
    search,
    sex,
    material,
    tags,
    minRating,
    maxRating,
    minColorPrice,
    maxColorPrice,
    onSale,
    discountPercentage
  } = req.query;

  // Validate brand IDs
  if (!brandIds || !Array.isArray(brandIds) || brandIds.length === 0) {
    throw new HttpError('Brand IDs array is required', 400);
  }

  // Validate all brand IDs
  const validBrandIds = brandIds.filter(id => ProductHelpers.isValidObjectId(id));
  if (validBrandIds.length === 0) {
    throw new HttpError('No valid brand IDs provided', 400);
  }

  // Build filter using helper
  const filter = ProductHelpers.buildProductFilter({
    minPrice,
    maxPrice,
    inStock,
    featured,
    color,
    colors,
    size,
    sizes,
    search,
    sex,
    material,
    tags,
    minRating,
    maxRating
  });

  // Add brand filter
  filter.brand = { $in: validBrandIds };
  filter.isActive = true;

  // Handle color price range filtering
  if (minColorPrice || maxColorPrice) {
    filter['colors.availableColors.price'] = {
      ...(minColorPrice && { $gte: parseFloat(minColorPrice) }),
      ...(maxColorPrice && { $lte: parseFloat(maxColorPrice) })
    };
  }

  // Handle discount percentage filtering
  if (discountPercentage) {
    const minDiscount = parseFloat(discountPercentage);
    if (!isNaN(minDiscount) && minDiscount >= 0 && minDiscount <= 100) {
      filter.$or = [
        // Products with color-level discounts
        {
          'colors.availableColors.price': { $exists: true },
          'colors.availableColors.comparePrice': { $exists: true, $ne: null },
          $expr: {
            $gte: [
              {
                $multiply: [
                  {
                    $divide: [
                      { $subtract: ['$colors.availableColors.comparePrice', '$colors.availableColors.price'] },
                      '$colors.availableColors.comparePrice'
                    ]
                  },
                  100
                ]
              },
              minDiscount
            ]
          }
        }
      ];
    }
  }

  // Handle onSale filter
  if (onSale === 'true') {
    filter.$or = [
      // Products with color-level sale prices
      {
        'colors.availableColors.comparePrice': { 
          $exists: true, 
          $ne: null,
          $gt: '$colors.availableColors.price'
        }
      }
    ];
  }

  // Build sort options
  const sortOptions = ProductHelpers.buildSortOptions(sortBy, sortOrder);

  // Build pagination
  const paginationOptions = ProductHelpers.buildPaginationOptions(page, limit);

  // Execute query with population
  const products = await Product.find(filter)
    .populate('category', 'name slug description sex accessories')
    .populate('brand', 'name logo description')
    .sort(sortOptions)
    .skip(paginationOptions.skip)
    .limit(paginationOptions.limit);

  // Get total count for pagination
  const total = await Product.countDocuments(filter);

  // Get brand information for the response
  const Brand = require('../models/Brand'); // You'll need to import your Brand model
  const brands = await Brand.find({ _id: { $in: validBrandIds } }).select('name logo description');

  // Get aggregation data for filter options
  const aggregationData = await Product.aggregate([
    { $match: filter },
    {
      $facet: {
        // Color price range
        colorPriceRange: [
          { $unwind: '$colors.availableColors' },
          {
            $group: {
              _id: null,
              minColorPrice: { $min: '$colors.availableColors.price' },
              maxColorPrice: { $max: '$colors.availableColors.price' }
            }
          }
        ],
        // Available colors
        colors: [
          { $unwind: '$colors.availableColors' },
          {
            $group: {
              _id: {
                name: '$colors.availableColors.name',
                value: '$colors.availableColors.value',
                hexCode: '$colors.availableColors.hexCode'
              },
              count: { $sum: 1 },
              avgPrice: { $avg: '$colors.availableColors.price' },
              minPrice: { $min: '$colors.availableColors.price' },
              maxPrice: { $max: '$colors.availableColors.price' }
            }
          },
          {
            $project: {
              _id: 0,
              name: '$_id.name',
              value: '$_id.value',
              hexCode: '$_id.hexCode',
              count: 1,
              avgPrice: { $round: ['$avgPrice', 2] },
              minPrice: { $round: ['$minPrice', 2] },
              maxPrice: { $round: ['$maxPrice', 2] }
            }
          },
          { $sort: { count: -1, name: 1 } }
        ],
        // Available sizes
        sizes: [
          { $unwind: '$sizeConfig.availableSizes' },
          {
            $group: {
              _id: {
                value: '$sizeConfig.availableSizes.value',
                displayText: '$sizeConfig.availableSizes.displayText',
                type: '$sizeConfig.availableSizes.type'
              },
              count: { $sum: 1 }
            }
          },
          {
            $project: {
              _id: 0,
              value: '$_id.value',
              displayText: '$_id.displayText',
              type: '$_id.type',
              count: 1
            }
          },
          { $sort: { count: -1, 'displayText': 1 } }
        ],
        // Categories represented in these products
        categories: [
          { $match: { category: { $ne: null } } },
          {
            $lookup: {
              from: 'categories',
              localField: 'category',
              foreignField: '_id',
              as: 'categoryInfo'
            }
          },
          { $unwind: '$categoryInfo' },
          {
            $group: {
              _id: '$categoryInfo._id',
              name: { $first: '$categoryInfo.name' },
              slug: { $first: '$categoryInfo.seo.slug' },
              sex: { $first: '$categoryInfo.sex' },
              count: { $sum: 1 }
            }
          },
          {
            $project: {
              _id: 1,
              name: 1,
              slug: 1,
              sex: 1,
              count: 1
            }
          },
          { $sort: { count: -1, name: 1 } }
        ],
        // Available materials
        materials: [
          { $match: { material: { $ne: null, $ne: '' } } },
          {
            $group: {
              _id: '$material',
              count: { $sum: 1 }
            }
          },
          {
            $project: {
              _id: 0,
              material: '$_id',
              count: 1
            }
          },
          { $sort: { count: -1, material: 1 } }
        ],
        // Rating distribution
        ratings: [
          { $match: { 'ratings.average': { $gte: 0 } } },
          {
            $bucket: {
              groupBy: '$ratings.average',
              boundaries: [0, 1, 2, 3, 4, 5],
              default: 'other',
              output: {
                count: { $sum: 1 }
              }
            }
          }
        ],
        // Discount distribution
        discounts: [
          { $match: { 
            'colors.availableColors.comparePrice': { $exists: true, $ne: null }
          }},
          {
            $project: {
              discountPercentage: {
                $multiply: [
                  {
                    $divide: [
                      { $subtract: [{ $arrayElemAt: ['$colors.availableColors.comparePrice', 0] }, 
                       { $arrayElemAt: ['$colors.availableColors.price', 0] }] },
                      { $arrayElemAt: ['$colors.availableColors.comparePrice', 0] }
                    ]
                  },
                  100
                ]
              }
            }
          },
          {
            $bucket: {
              groupBy: '$discountPercentage',
              boundaries: [0, 10, 20, 30, 40, 50, 100],
              default: 'other',
              output: {
                count: { $sum: 1 }
              }
            }
          }
        ]
      }
    }
  ]);

  const facetData = aggregationData[0] || {};

  const pagination = {
    page: paginationOptions.page,
    limit: paginationOptions.limit,
    total,
    pages: Math.ceil(total / paginationOptions.limit)
  };

  // Enhance products with color data
  const enhancedProducts = products.map(product => 
    ProductHelpers.enhanceProductWithColorData(product)
  );

  // Add price analysis
  const priceAnalysis = ProductHelpers.analyzeProductPrices(enhancedProducts);

  // Build response with filter options
  const response = ProductHelpers.formatPaginatedResponse(
    enhancedProducts,
    pagination,
    { 
      brands: brands.map(brand => ({
        _id: brand._id,
        name: brand.name,
        logo: brand.logo,
        description: brand.description
      })),
      filters: {
        colorPriceRange: facetData.colorPriceRange?.[0] || { minColorPrice: 0, maxColorPrice: 0 },
        colors: facetData.colors || [],
        sizes: facetData.sizes || [],
        categories: facetData.categories || [],
        materials: facetData.materials || [],
        ratings: facetData.ratings || [],
        discounts: facetData.discounts || []
      },
      priceAnalysis: priceAnalysis,
      appliedFilters: {
        brandIds: validBrandIds,
        ...(minColorPrice && { minColorPrice: parseFloat(minColorPrice) }),
        ...(maxColorPrice && { maxColorPrice: parseFloat(maxColorPrice) }),
        ...(color && { color }),
        ...(colors && { colors: Array.isArray(colors) ? colors : colors.split(',') }),
        ...(size && { size }),
        ...(sizes && { sizes: Array.isArray(sizes) ? sizes : sizes.split(',') }),
        ...(sex && { sex }),
        ...(material && { material }),
        ...(tags && { tags: Array.isArray(tags) ? tags : tags.split(',') }),
        ...(inStock && { inStock: inStock === 'true' }),
        ...(featured && { featured: featured === 'true' }),
        ...(onSale && { onSale: onSale === 'true' }),
        ...(discountPercentage && { discountPercentage: parseFloat(discountPercentage) }),
        ...(minRating && { minRating: parseFloat(minRating) }),
        ...(maxRating && { maxRating: parseFloat(maxRating) }),
        ...(search && { search }),
        sortBy,
        sortOrder
      }
    }
  );

  res.json(response);



}); 

  // Get single product by ID
 static getProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!ProductHelpers.isValidObjectId(id)) {
    throw new HttpError('Invalid product ID', 400);
  }

  const product = await Product.findById(id)
    .populate('category', 'name slug description sex customFields')
    .populate('brand', 'name logo')
    .populate('reviews');

  if (!product) {
    throw new HttpError('Product not found', 404);
  }

  // FIX: Use findOneAndUpdate to handle concurrent updates safely
  // This avoids version conflicts when multiple users view the product
  try {
    await Product.findOneAndUpdate(
      { _id: id },
      { $inc: { viewCount: 1 } }, // Atomic increment
      { new: false } // Don't return the updated document
    );
  } catch (error) {
    console.error('Error updating view count:', error);
    // Don't throw error, just log it - we still want to return the product
  }

  const enhancedProduct = ProductHelpers.enhanceProductWithColorData(product);
  
  // Add detailed price information
  enhancedProduct.colorPriceSummary = ProductHelpers.getColorPriceSummary(product);
  
  res.json(ProductHelpers.formatSuccessResponse(enhancedProduct, 'Product fetched successfully'));
});






  // Create new product
static createProduct = asyncHandler(async (req, res) => {
    const productData = req.body;
    const files = req.files || [];

    // Parse JSON strings from form data
    const jsonFields = [
        'sizeConfig', 'colors', 'variants', 'tags',
        'specifications', 'careInstructions', 'seo',
        'shipping', 'tax', 'dimensions', 'colorImages'
    ];
    
    jsonFields.forEach(field => {
        if (productData[field] && typeof productData[field] === 'string') {
            try {
                productData[field] = JSON.parse(productData[field]);
            } catch (e) {
                console.error(`Error parsing ${field}:`, e.message);
            }
        }
    });

    // Validate product data
    const validation = ProductHelpers.validateProductData(productData);
    if (!validation.isValid) {
      throw new HttpError(`Invalid product data: ${validation.errors.join(', ')}`, 400);
    }

    // Validate category
    if (!ProductHelpers.isValidObjectId(productData.category)) {
      throw new HttpError('Invalid category ID', 400);
    }

    const category = await Category.findById(productData.category);
    if (!category) {
      throw new HttpError('Category not found', 404);
    }

    // ADDED: Validate subcategory if provided
    if (productData.subcategory) {
      const allSubcategories = Product.getAllSubcategories();
      
      // Check if subcategory exists in enum
      if (!allSubcategories.includes(productData.subcategory)) {
        throw new HttpError(`Invalid subcategory: ${productData.subcategory}. Valid subcategories are: ${allSubcategories.slice(0, 20).join(', ')}${allSubcategories.length > 20 ? '...' : ''}`, 400);
      }
      
      // Optional: Validate subcategory matches category type
      // You can add logic here to ensure subcategory belongs to appropriate category type
      // For example: if category is 'Shoes', subcategory should be from SHOES enum
    }

    // Validate sex compatibility with category
    if (productData.sex && category.sex !== 'unisex' && productData.sex !== category.sex) {
      throw new HttpError(`Product sex (${productData.sex}) is not compatible with category sex (${category.sex})`, 400);
    }

    // Set sex from category if not provided
    if (!productData.sex) {
      productData.sex = category.sex;
    }

    // Generate slug if not provided
    if (!productData.seo?.slug || productData.seo.slug === '') {
        const existingSlugs = await Product.distinct('seo.slug');
        productData.seo = productData.seo || {};
        productData.seo.slug = ProductHelpers.generateSlug(productData.name, existingSlugs);
    }

    // Check for duplicate SKU if provided
    if (productData.sku) {
      const existingProduct = await Product.findOne({ sku: productData.sku });
      if (existingProduct) {
        throw new HttpError('Product with this SKU already exists', 400);
      }
    }

    // Validate color prices - NOW REQUIRED
    if (productData.colors?.hasColors && productData.colors.availableColors) {
      productData.colors.availableColors.forEach((color, index) => {
        // Price is now required for each color
        if (color.price === undefined || color.price === null) {
          throw new HttpError(`Price is required for color: ${color.name}`, 400);
        }
        
        if (color.price < 0) {
          throw new HttpError(`Invalid price for color ${color.name}: Price cannot be negative`, 400);
        }
        
        // If comparePrice is provided, ensure it's greater than price
        if (color.comparePrice !== undefined && color.comparePrice !== null) {
          if (color.comparePrice < 0) {
            throw new HttpError(`Invalid compare price for color ${color.name}: Compare price cannot be negative`, 400);
          }
          if (color.comparePrice < color.price) {
            throw new HttpError(`Invalid compare price for color ${color.name}: Compare price must be greater than or equal to price`, 400);
          }
        }
        
        // Validate quantityConfig quantities prices
        if (color.quantityConfig?.quantities) {
          color.quantityConfig.quantities.forEach((quantity, qIndex) => {
            if (quantity.price !== undefined && quantity.price < 0) {
              throw new HttpError(`Invalid price for quantity ${qIndex} of color ${color.name}: Price cannot be negative`, 400);
            }
            if (quantity.comparePrice !== undefined && quantity.comparePrice !== null) {
              if (quantity.comparePrice < 0) {
                throw new HttpError(`Invalid compare price for quantity ${qIndex} of color ${color.name}: Compare price cannot be negative`, 400);
              }
              if (quantity.comparePrice < (quantity.price || 0)) {
                throw new HttpError(`Invalid compare price for quantity ${qIndex} of color ${color.name}: Compare price must be greater than or equal to price`, 400);
              }
            }
          });
        }
      });
    } else {
      // If product doesn't have colors, we need to provide at least one color with price
      throw new HttpError('Product must have at least one color with price', 400);
    }

    let uploadedImages = [];
    
    // Handle image uploads and color mapping
    if (files && files.length > 0) {
      try {
        // Upload all images first
        const uploadResult = await uploadMultipleImages(files, 'products');
        
        if (!uploadResult.success) {
          throw new Error(uploadResult.error || 'Image upload failed');
        }
        
        uploadedImages = uploadResult.data || [];
        console.log(`Successfully uploaded ${uploadedImages.length} images`);
        
        // Extract color images mapping - handle different formats
        let colorImagesData = productData.colorImages || [];
        
        // Process color-images mapping
        const imageColorMap = {};
        
        if (colorImagesData && Array.isArray(colorImagesData) && colorImagesData.length > 0) {
          // Map each image to its color
          colorImagesData.forEach((colorValue, index) => {
            if (colorValue && typeof colorValue === 'string') {
              if (!imageColorMap[colorValue]) {
                imageColorMap[colorValue] = [];
              }
              // Store the image index that belongs to this color
              imageColorMap[colorValue].push(index);
            }
          });
          
          console.log('Image color mapping:', imageColorMap);
        }
        
        // Product must have colors, distribute images to appropriate colors
        if (productData.colors?.hasColors && 
            productData.colors.availableColors?.length > 0) {
          
          console.log('Available colors:', productData.colors.availableColors.map(c => c.value));
          
          // Initialize images array for each color
          const imagesByColor = {};
          productData.colors.availableColors.forEach(color => {
            imagesByColor[color.value] = [];
          });
          
          // Method 1: If we have explicit mapping from colorImagesData
          if (Object.keys(imageColorMap).length > 0) {
            console.log('Using explicit image-color mapping');
            
            Object.keys(imageColorMap).forEach(colorValue => {
              if (imagesByColor[colorValue]) {
                const imageIndexes = imageColorMap[colorValue];
                imageIndexes.forEach((imgIndex, index) => {
                  if (uploadedImages[imgIndex]) {
                    const imageData = {
                      url: uploadedImages[imgIndex].url || uploadedImages[imgIndex].secure_url,
                      public_id: uploadedImages[imgIndex].public_id,
                      alt: `${productData.name} - ${colorValue} - Image ${index + 1}`,
                      isPrimary: imagesByColor[colorValue].length === 0,
                      displayOrder: imagesByColor[colorValue].length
                    };
                    imagesByColor[colorValue].push(imageData);
                    console.log(`Assigned image index ${imgIndex} to color ${colorValue}`);
                  }
                });
              }
            });
          }
          // Method 2: Even distribution across colors
          else if (uploadedImages.length > 0) {
            console.log('No explicit mapping, distributing images evenly');
            
            const colors = productData.colors.availableColors;
            const imagesPerColor = Math.max(1, Math.floor(uploadedImages.length / colors.length));
            
            let imageIndex = 0;
            colors.forEach(color => {
              const colorValue = color.value;
              for (let i = 0; i < imagesPerColor && imageIndex < uploadedImages.length; i++) {
                const img = uploadedImages[imageIndex];
                const imageData = {
                  url: img.url || img.secure_url,
                  public_id: img.public_id,
                  alt: `${productData.name} - ${colorValue} - Image ${i + 1}`,
                  isPrimary: imagesByColor[colorValue].length === 0,
                  displayOrder: imagesByColor[colorValue].length
                };
                imagesByColor[colorValue].push(imageData);
                console.log(`Distributed image ${imageIndex} to color ${colorValue}`);
                imageIndex++;
              }
            });
            
            // Distribute any remaining images
            while (imageIndex < uploadedImages.length) {
              const colorIndex = imageIndex % colors.length;
              const colorValue = colors[colorIndex].value;
              const img = uploadedImages[imageIndex];
              
              const imageData = {
                url: img.url || img.secure_url,
                public_id: img.public_id,
                alt: `${productData.name} - ${colorValue} - Image ${imagesByColor[colorValue].length + 1}`,
                isPrimary: false, // Only first image should be primary
                displayOrder: imagesByColor[colorValue].length
              };
              imagesByColor[colorValue].push(imageData);
              console.log(`Distributed remaining image ${imageIndex} to color ${colorValue}`);
              imageIndex++;
            }
          }
          
          // Assign images back to colors in productData
          productData.colors.availableColors.forEach((color, index) => {
            if (imagesByColor[color.value]) {
              color.images = imagesByColor[color.value];
              console.log(`Color ${color.value} got ${color.images.length} images`);
            } else {
              color.images = [];
              console.log(`Color ${color.value} got 0 images (no mapping found)`);
            }
          });
        }
      } catch (uploadError) {
        console.error('Image upload error:', uploadError);
        throw new HttpError(`Image upload failed: ${uploadError.message}`, 500);
      }
    } else {
      console.log('No files uploaded');
    }

    // ADDED: Log subcategory information
    console.log('Product subcategory:', productData.subcategory || 'Not specified');

    // Create the product
    const product = new Product({
      ...productData,
      meta: {
        createdBy: req.user._id,
        updatedBy: req.user._id
      }
    });

    // Log the product data before saving
    console.log('Product data before save:', JSON.stringify({
      subcategory: product.subcategory,
      colors: product.colors,
      colorsCount: product.colors?.availableColors?.length || 0,
      imagesPerColor: product.colors?.availableColors?.map(c => ({
        color: c.value,
        price: c.price,
        comparePrice: c.comparePrice,
        imageCount: c.images?.length || 0
      }))
    }, null, 2));

    await product.save();

    const enhancedProduct = ProductHelpers.enhanceProductWithColorData(product);
    
    res.status(201).json(
      ProductHelpers.formatSuccessResponse(enhancedProduct, 'Product created successfully')
    );
  });

// Update product
static updateProduct = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    const files = req.files || [];

    if (!ProductHelpers.isValidObjectId(id)) {
      throw new HttpError('Invalid product ID', 400);
    }

    const product = await Product.findById(id);
    if (!product) {
      throw new HttpError('Product not found', 404);
    }

    // **CRITICAL: Parse ALL JSON fields first**
    const jsonFields = [
        'sizeConfig', 'colors', 'variants', 'tags',
        'specifications', 'careInstructions', 'seo',
        'shipping', 'tax', 'dimensions', 'colorImages',
        'defaultSize', 'defaultColor' // ADD THESE
    ];
    
    jsonFields.forEach(field => {
        if (updateData[field] && typeof updateData[field] === 'string') {
            try {
                updateData[field] = JSON.parse(updateData[field]);
            } catch (e) {
                console.error(`Error parsing ${field}:`, e.message);
                // If parsing fails, set to appropriate default
                if (field === 'defaultSize' || field === 'defaultColor') {
                    updateData[field] = undefined;
                }
            }
        }
    });

    // **DEBUG: Log what we're receiving**
    console.log("=== DEBUG: Received updateData ===");
    console.log("Has variants?", !!updateData.variants);
    console.log("Variants count:", updateData.variants?.length);
    console.log("defaultSize:", updateData.defaultSize);
    console.log("defaultColor:", updateData.defaultColor);
    
    if (updateData.variants) {
      updateData.variants.forEach((variant, index) => {
        console.log(`Variant ${index + 1}:`, {
          size: variant.size?.value,
          color: variant.color?.value,
          quantity: variant.quantity,
          price: variant.price,
          comparePrice: variant.comparePrice
        });
      });
    }
    console.log("=== END DEBUG ===");

    // Validate update data
    if (updateData.name && updateData.name.trim().length === 0) {
      throw new HttpError('Product name cannot be empty', 400);
    }

    // Validate category if being updated
    if (updateData.category) {
      if (!ProductHelpers.isValidObjectId(updateData.category)) {
        throw new HttpError('Invalid category ID', 400);
      }

      const category = await Category.findById(updateData.category);
      if (!category) {
        throw new HttpError('Category not found', 404);
      }

      if (updateData.sex && category.sex !== 'unisex' && updateData.sex !== category.sex) {
        throw new HttpError(`Product sex (${updateData.sex}) is not compatible with category sex (${category.sex})`, 400);
      }
    }

    // **FIX: Handle defaultSize and defaultColor**
    if (updateData.defaultSize) {
        if (typeof updateData.defaultSize === 'object' && 
            updateData.defaultSize !== null &&
            !Array.isArray(updateData.defaultSize)) {
            // Ensure it has the correct structure
            product.defaultSize = {
                value: updateData.defaultSize.value || '',
                displayText: updateData.defaultSize.displayText || updateData.defaultSize.value || ''
            };
        } else {
            // If it's invalid, set to undefined
            product.defaultSize = undefined;
        }
    } else if (updateData.defaultSize === null || updateData.defaultSize === '') {
        product.defaultSize = undefined;
    }
    
    if (updateData.defaultColor) {
        if (typeof updateData.defaultColor === 'object' && 
            updateData.defaultColor !== null &&
            !Array.isArray(updateData.defaultColor)) {
            // Ensure it has the correct structure
            product.defaultColor = {
                name: updateData.defaultColor.name || '',
                value: updateData.defaultColor.value || '',
                hexCode: updateData.defaultColor.hexCode || ''
            };
        } else {
            // If it's invalid, set to undefined
            product.defaultColor = undefined;
        }
    } else if (updateData.defaultColor === null || updateData.defaultColor === '') {
        product.defaultColor = undefined;
    }

    // **FIX: Update variants with proper number conversion**
    if (updateData.variants && Array.isArray(updateData.variants)) {
      console.log("Setting variants from updateData...");
      
      // Clear existing variants
      product.variants = [];
      
      // Add each variant with proper data types
      updateData.variants.forEach((variant, index) => {
        console.log(`Processing variant ${index + 1}:`, variant);
        
        // **FIX: Proper number conversion for comparePrice**
        let comparePriceValue = null;
        if (variant.comparePrice !== undefined && variant.comparePrice !== null && variant.comparePrice !== '') {
          const parsed = parseFloat(variant.comparePrice);
          comparePriceValue = isNaN(parsed) ? null : parsed;
        }
        
        const newVariant = {
          size: {
            value: variant.size?.value || '',
            displayText: variant.size?.displayText || variant.size?.value || ''
          },
          color: {
            name: variant.color?.name || '',
            value: variant.color?.value || '',
            hexCode: variant.color?.hexCode || ''
          },
          // **CRITICAL: Ensure all numbers are properly converted**
          quantity: parseInt(variant.quantity) || 0,
          
          // Handle price - set to null if invalid
          price: variant.price !== undefined && variant.price !== '' && !isNaN(parseFloat(variant.price)) 
            ? parseFloat(variant.price) 
            : null,
            
          // **FIXED: Handle comparePrice properly**
          comparePrice: comparePriceValue,
          
          sku: variant.sku || '',
          barcode: variant.barcode || '',
          weight: variant.weight && !isNaN(parseFloat(variant.weight)) ? parseFloat(variant.weight) : null,
          dimensions: variant.dimensions || {
            length: null,
            width: null,
            height: null
          }
        };
        
        console.log(`Created variant ${index + 1}:`, {
          color: newVariant.color.value,
          size: newVariant.size.value,
          quantity: newVariant.quantity,
          price: newVariant.price,
          comparePrice: newVariant.comparePrice
        });
        
        product.variants.push(newVariant);
      });
      
      console.log(`Total variants set: ${product.variants.length}`);
    }

    // Handle image uploads if files are provided
    let uploadedImages = [];
    if (files && files.length > 0) {
      try {
        const uploadResult = await uploadMultipleImages(files, 'products');
        
        if (!uploadResult.success) {
          throw new Error(uploadResult.error || 'Image upload failed');
        }
        
        uploadedImages = uploadResult.data || [];
        
        let colorImagesData = updateData.colorImages || [];
        
        if (product.colors.hasColors && 
            product.colors.availableColors.length > 0 && 
            uploadedImages.length > 0) {
          
          const imagesByColor = {};
          product.colors.availableColors.forEach(color => {
            imagesByColor[color.value] = color.images || [];
          });
          
          if (colorImagesData.length === uploadedImages.length) {
            uploadedImages.forEach((img, index) => {
              const colorValue = colorImagesData[index];
              if (colorValue && imagesByColor[colorValue]) {
                const currentImagesCount = imagesByColor[colorValue].length;
                imagesByColor[colorValue].push({
                  url: img.url || img.secure_url,
                  public_id: img.public_id,
                  alt: `Product image for color ${colorValue}`,
                  isPrimary: currentImagesCount === 0,
                  displayOrder: currentImagesCount
                });
              } else if (product.colors.availableColors.length > 0) {
                const firstColor = product.colors.availableColors[0];
                const currentImagesCount = imagesByColor[firstColor.value].length;
                imagesByColor[firstColor.value].push({
                  url: img.url || img.secure_url,
                  public_id: img.public_id,
                  alt: `Product image for color ${firstColor.value}`,
                  isPrimary: currentImagesCount === 0,
                  displayOrder: currentImagesCount
                });
              }
            });
          } else {
            if (product.colors.availableColors.length > 0) {
              const firstColor = product.colors.availableColors[0];
              const currentImagesCount = imagesByColor[firstColor.value].length;
              
              uploadedImages.forEach((img, index) => {
                imagesByColor[firstColor.value].push({
                  url: img.url || img.secure_url,
                  public_id: img.public_id,
                  alt: `Product image for color ${firstColor.value}`,
                  isPrimary: currentImagesCount + index === 0,
                  displayOrder: currentImagesCount + index
                });
              });
            }
          }
          
          product.colors.availableColors.forEach(color => {
            color.images = imagesByColor[color.value] || [];
          });
        }
      } catch (uploadError) {
        console.error('Image upload error:', uploadError);
        throw new HttpError(`Image upload failed: ${uploadError.message}`, 500);
      }
    }

    // **FIX: Update other fields carefully**
    Object.keys(updateData).forEach(key => {
      if (key === 'colors' && updateData.colors) {
        if (updateData.colors.availableColors) {
          updateData.colors.availableColors.forEach((updatedColor, index) => {
            const existingColor = product.colors.availableColors.find(c => c.value === updatedColor.value);
            
            if (existingColor) {
              // Update basic fields
              existingColor.name = updatedColor.name || existingColor.name;
              existingColor.hexCode = updatedColor.hexCode || existingColor.hexCode;
              existingColor.displayOrder = updatedColor.displayOrder !== undefined ? updatedColor.displayOrder : existingColor.displayOrder;
              
              // Handle price and comparePrice conversions
              if (updatedColor.price !== undefined) {
                existingColor.price = !isNaN(parseFloat(updatedColor.price)) ? parseFloat(updatedColor.price) : existingColor.price;
              }
              
              if (updatedColor.comparePrice !== undefined) {
                const parsedComparePrice = parseFloat(updatedColor.comparePrice);
                existingColor.comparePrice = !isNaN(parsedComparePrice) ? parsedComparePrice : undefined;
              }
              
              // **IMPORTANT: Don't overwrite quantityConfig from updateData**
              // Keep existing quantityConfig, it will be updated from variants
            } else {
              product.colors.availableColors.push({
                ...updatedColor,
                quantityConfig: {
                  trackQuantity: true,
                  allowBackorder: false,
                  lowStockThreshold: 5,
                  quantities: [],
                  totalQuantity: 0,
                  availableQuantity: 0,
                  inStock: false,
                  isLowStock: false
                }
              });
            }
          });
          
          // Remove colors that are no longer in the update
          const updatedColorValues = updateData.colors.availableColors.map(c => c.value);
          product.colors.availableColors = product.colors.availableColors.filter(c => 
            updatedColorValues.includes(c.value)
          );
          
          product.colors.hasColors = product.colors.availableColors.length > 0;
        }
      } else if (key === 'sizeConfig') {
        product.sizeConfig = { ...product.sizeConfig, ...updateData.sizeConfig };
      } else if (key === 'specifications') {
        product.specifications = updateData.specifications;
      } else if (key === 'tags') {
        product.tags = updateData.tags;
      } else if (key === 'careInstructions') {
        product.careInstructions = updateData.careInstructions;
      } else if (key === 'seo') {
        product.seo = { ...product.seo, ...updateData.seo };
      } else if (key === 'shipping') {
        product.shipping = { ...product.shipping, ...updateData.shipping };
      } else if (key === 'tax') {
        product.tax = { ...product.tax, ...updateData.tax };
      } else if (key === 'dimensions') {
        product.dimensions = { ...product.dimensions, ...updateData.dimensions };
      } else if (key !== 'colorImages' && key !== 'variants' && key !== 'defaultSize' && key !== 'defaultColor') {
        // Handle numeric conversions for quantity fields
        if (key === 'quantity') {
          product[key] = parseInt(updateData[key]) || 0;
        } else if (key === 'lowStockThreshold') {
          product[key] = parseInt(updateData[key]) || 5;
        } else if (key === 'price' || key === 'comparePrice' || key === 'cost') {
          const parsedValue = parseFloat(updateData[key]);
          product[key] = !isNaN(parsedValue) ? parsedValue : null;
        } else if (key === 'weight') {
          const parsedValue = parseFloat(updateData[key]);
          product[key] = !isNaN(parsedValue) ? parsedValue : null;
        } else {
          product[key] = updateData[key];
        }
      }
    });

    // **FIX: Update color quantities from variants**
    console.log("=== Before updateColorQuantities ===");
    console.log("Variants count:", product.variants?.length);
    if (product.variants) {
      product.variants.forEach((v, i) => {
        console.log(`Variant ${i + 1}: ${v.color?.value}-${v.size?.value} = ${v.quantity}, comparePrice: ${v.comparePrice}`);
      });
    }
    
    if (product.colors.hasColors && product.colors.availableColors.length > 0) {
      console.log("Calling updateColorQuantities...");
      product.updateColorQuantities();
    }

    // Update meta
    product.meta.updatedBy = req.user._id;
    product.meta.updatedAt = new Date();

    // Save the product
    try {
      await product.save();
      
      // Verify save
      console.log("=== After save verification ===");
      const savedProduct = await Product.findById(id);
      console.log("Saved product quantity:", savedProduct.quantity);
      console.log("defaultSize:", savedProduct.defaultSize);
      console.log("defaultColor:", savedProduct.defaultColor);
      console.log("Saved variants:");
      savedProduct.variants?.forEach((v, i) => {
        console.log(`  ${v.color?.value}-${v.size?.value}: ${v.quantity}, comparePrice: ${v.comparePrice}`);
      });
      console.log("=== END verification ===");
      
    } catch (saveError) {
      console.error("Save error details:", saveError);
      
      // More detailed error logging
      if (saveError.errors) {
        Object.keys(saveError.errors).forEach(key => {
          console.error(`Field error for ${key}:`, saveError.errors[key]);
        });
      }
      
      throw new HttpError(`Failed to save product: ${saveError.message}`, 500);
    }

    const enhancedProduct = ProductHelpers.enhanceProductWithColorData(product);
    enhancedProduct.colorPriceSummary = ProductHelpers.getColorPriceSummary(product);
    
    res.json(ProductHelpers.formatSuccessResponse(enhancedProduct, 'Product updated successfully'));
  });
  // Delete product
  static deleteProduct = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!ProductHelpers.isValidObjectId(id)) {
      throw new HttpError('Invalid product ID', 400);
    }

    const product = await Product.findById(id);
    if (!product) {
      throw new HttpError('Product not found', 404);
    }

    // Delete all associated images from Cloudinary
    if (product.colors.hasColors) {
      const allImages = product.getAllImages();
      const publicIds = allImages.map(img => img.public_id).filter(id => id);
      
      if (publicIds.length > 0) {
        await deleteMultipleImages(publicIds);
      }
    }

    await Product.findByIdAndDelete(id);

    res.json(ProductHelpers.formatSuccessResponse(null, 'Product deleted successfully'));
  });


 




  // Get category hierarchy with product counts
  static getCategoryHierarchy = asyncHandler(async (req, res) => {
    const { sex } = req.query;

    let matchStage = { isActive: true };
    if (sex) {
      matchStage.sex = sex;
    }

    const categories = await Category.aggregate([
      { $match: matchStage },
      {
        $lookup: {
          from: 'products',
          let: { categoryId: '$_id' },
          pipeline: [
            { 
              $match: { 
                $expr: { $eq: ['$category', '$$categoryId'] },
                isActive: true 
              } 
            },
            { $count: 'count' }
          ],
          as: 'productCounts'
        }
      },
      {
        $lookup: {
          from: 'categories',
          localField: '_id',
          foreignField: 'parent',
          as: 'children'
        }
      },
      {
        $project: {
          _id: 1,
          name: 1,
          description: 1,
          sex: 1,
          parent: 1,
          image: 1,
          sortOrder: 1,
          'seo.slug': 1,
          accessories: 1,
          productCount: { $arrayElemAt: ['$productCounts.count', 0] } || 0,
          children: {
            $map: {
              input: '$children',
              as: 'child',
              in: {
                _id: '$$child._id',
                name: '$$child.name',
                sex: '$$child.sex',
                'seo.slug': '$$child.seo.slug',
                productCount: { $arrayElemAt: ['$$child.productCounts.count', 0] } || 0
              }
            }
          }
        }
      },
      { $sort: { sortOrder: 1, name: 1 } }
    ]);

    // Filter to only top-level categories (no parent)
    const topLevelCategories = categories.filter(cat => !cat.parent);

    res.json(ProductHelpers.formatSuccessResponse(topLevelCategories, 'Category hierarchy fetched successfully'));
  });

  // Get products by multiple categories
  static getProductsByMultipleCategories = asyncHandler(async (req, res) => {
    const { categoryIds } = req.body;
    const { page = 1, limit = 12, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    if (!categoryIds || !Array.isArray(categoryIds) || categoryIds.length === 0) {
      throw new HttpError('Category IDs array is required', 400);
    }

    // Validate all category IDs
    const validCategoryIds = categoryIds.filter(id => ProductHelpers.isValidObjectId(id));
    if (validCategoryIds.length === 0) {
      throw new HttpError('No valid category IDs provided', 400);
    }

    const filter = { 
      category: { $in: validCategoryIds },
      isActive: true 
    };
    const sortOptions = ProductHelpers.buildSortOptions(sortBy, sortOrder);
    const paginationOptions = ProductHelpers.buildPaginationOptions(page, limit);

    const products = await Product.find(filter)
      .populate('category', 'name slug description sex accessories')
      .populate('brand', 'name')
      .sort(sortOptions)
      .skip(paginationOptions.skip)
      .limit(paginationOptions.limit);

    const total = await Product.countDocuments(filter);

    const pagination = {
      page: paginationOptions.page,
      limit: paginationOptions.limit,
      total,
      pages: Math.ceil(total / paginationOptions.limit)
    };

    const enhancedProducts = products.map(product => 
      ProductHelpers.enhanceProductWithColorData(product)
    );

    // Add price analysis
    const priceAnalysis = ProductHelpers.analyzeProductPrices(enhancedProducts);

    res.json(ProductHelpers.formatPaginatedResponse(enhancedProducts, pagination, { priceAnalysis }));
  });

  // Get category stats
  static getCategoryStats = asyncHandler(async (req, res) => {
    const stats = await Category.aggregate([
      { $match: { isActive: true } },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: 'category',
          as: 'products'
        }
      },
      {
        $group: {
          _id: '$sex',
          totalCategories: { $sum: 1 },
          totalProducts: { $sum: { $size: '$products' } },
          categories: {
            $push: {
              _id: '$_id',
              name: '$name',
              productCount: { $size: '$products' },
              slug: '$seo.slug'
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          sex: '$_id',
          totalCategories: 1,
          totalProducts: 1,
          categories: 1
        }
      }
    ]);

    // Calculate overall totals
    const overallStats = {
      totalCategories: stats.reduce((sum, stat) => sum + stat.totalCategories, 0),
      totalProducts: stats.reduce((sum, stat) => sum + stat.totalProducts, 0),
      bySex: stats
    };

    res.json(ProductHelpers.formatSuccessResponse(overallStats, 'Category stats fetched successfully'));
  });

  // Toggle product status
  static toggleProductStatus = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!ProductHelpers.isValidObjectId(id)) {
      throw new HttpError('Invalid product ID', 400);
    }

    const product = await Product.findById(id);
    if (!product) {
      throw new HttpError('Product not found', 404);
    }

    product.isActive = !product.isActive;
    product.meta.updatedBy = req.user._id;
    product.meta.updatedAt = new Date();

    await product.save();

    res.json(ProductHelpers.formatSuccessResponse(
      { isActive: product.isActive },
      `Product ${product.isActive ? 'activated' : 'deactivated'} successfully`
    ));
  });

  // Update inventory
  static updateInventory = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { quantity, lowStockThreshold, trackQuantity, allowBackorder } = req.body;

    if (!ProductHelpers.isValidObjectId(id)) {
      throw new HttpError('Invalid product ID', 400);
    }

    const product = await Product.findById(id);
    if (!product) {
      throw new HttpError('Product not found', 404);
    }

    // Update inventory fields
    if (quantity !== undefined) {
      if (quantity < 0) {
        throw new HttpError('Quantity cannot be negative', 400);
      }
      product.quantity = quantity;
    }

    if (lowStockThreshold !== undefined) {
      product.lowStockThreshold = lowStockThreshold;
    }

    if (trackQuantity !== undefined) {
      product.trackQuantity = trackQuantity;
    }

    if (allowBackorder !== undefined) {
      product.allowBackorder = allowBackorder;
    }

    product.meta.updatedBy = req.user._id;
    product.meta.updatedAt = new Date();

    await product.save();

    const stockInfo = ProductHelpers.calculateProductStockStatus(product);
    
    res.json(ProductHelpers.formatSuccessResponse(
      { ...stockInfo, product: ProductHelpers.enhanceProductWithColorData(product) },
      'Inventory updated successfully'
    ));
  });

  // Get featured products
  static getFeaturedProducts = asyncHandler(async (req, res) => {
    const { limit = 10 } = req.query;

    const products = await Product.find({ 
      isFeatured: true, 
      isActive: true 
    })
    .populate('category', 'name slug sex')
    .populate('brand', 'name')
    .limit(parseInt(limit))
    .sort({ createdAt: -1 });

    const enhancedProducts = products.map(product => 
      ProductHelpers.enhanceProductWithColorData(product)
    );

    res.json(ProductHelpers.formatSuccessResponse(enhancedProducts, 'Featured products fetched successfully'));
  });

  // Get featured products by sex
  static getFeaturedProductsBySex = asyncHandler(async (req, res) => {
    const { sex } = req.params;
    const { limit = 10 } = req.query;

    const products = await Product.find({ 
      sex,
      isFeatured: true, 
      isActive: true 
    })
    .populate('category', 'name slug sex')
    .populate('brand', 'name')
    .limit(parseInt(limit))
    .sort({ createdAt: -1 });

    const enhancedProducts = products.map(product => 
      ProductHelpers.enhanceProductWithColorData(product)
    );

    res.json(ProductHelpers.formatSuccessResponse(enhancedProducts, 'Featured products fetched successfully'));
  });

  // Get products by sex
 

  // Search by color
  static searchByColor = asyncHandler(async (req, res) => {
    const { color, page = 1, limit = 12 } = req.query;

    if (!color) {
      throw new HttpError('Color parameter is required', 400);
    }

    const filter = {
      isActive: true,
      $or: [
        { 'colors.availableColors.name': { $regex: color, $options: 'i' } },
        { 'colors.availableColors.value': { $regex: color, $options: 'i' } }
      ]
    };

    const paginationOptions = ProductHelpers.buildPaginationOptions(page, limit);

    const products = await Product.find(filter)
      .populate('category', 'name slug')
      .populate('brand', 'name')
      .skip(paginationOptions.skip)
      .limit(paginationOptions.limit);

    const total = await Product.countDocuments(filter);

    const pagination = {
      page: paginationOptions.page,
      limit: paginationOptions.limit,
      total,
      pages: Math.ceil(total / paginationOptions.limit)
    };

    const enhancedProducts = products.map(product => 
      ProductHelpers.enhanceProductWithColorData(product)
    );

    // Add price analysis
    const priceAnalysis = ProductHelpers.analyzeProductPrices(enhancedProducts);

    res.json(ProductHelpers.formatPaginatedResponse(enhancedProducts, pagination, { priceAnalysis }));
  });

  // Get available colors
  static getAvailableColors = asyncHandler(async (req, res) => {
    const colors = await Product.aggregate([
      { $match: { isActive: true, 'colors.hasColors': true } },
      { $unwind: '$colors.availableColors' },
      {
        $group: {
          _id: {
            name: '$colors.availableColors.name',
            value: '$colors.availableColors.value',
            hexCode: '$colors.availableColors.hexCode'
          },
          count: { $sum: 1 },
          avgPrice: { $avg: '$colors.availableColors.price' },
          minPrice: { $min: '$colors.availableColors.price' },
          maxPrice: { $max: '$colors.availableColors.price' }
        }
      },
      {
        $project: {
          _id: 0,
          name: '$_id.name',
          value: '$_id.value',
          hexCode: '$_id.hexCode',
          count: 1,
          avgPrice: { $round: ['$avgPrice', 2] },
          minPrice: { $round: ['$minPrice', 2] },
          maxPrice: { $round: ['$maxPrice', 2] }
        }
      },
      { $sort: { count: -1, name: 1 } }
    ]);

    res.json(ProductHelpers.formatSuccessResponse(colors, 'Available colors fetched successfully'));
  });

  // Get products by multiple colors
  static getProductsByMultipleColors = asyncHandler(async (req, res) => {
    const { colors } = req.query;
    const { page = 1, limit = 12 } = req.query;

    if (!colors) {
      throw new HttpError('Colors parameter is required', 400);
    }

    const colorArray = Array.isArray(colors) ? colors : colors.split(',');

    const filter = {
      isActive: true,
      'colors.availableColors.value': { $in: colorArray }
    };

    const paginationOptions = ProductHelpers.buildPaginationOptions(page, limit);

    const products = await Product.find(filter)
      .populate('category', 'name slug')
      .populate('brand', 'name')
      .skip(paginationOptions.skip)
      .limit(paginationOptions.limit);

    const total = await Product.countDocuments(filter);

    const pagination = {
      page: paginationOptions.page,
      limit: paginationOptions.limit,
      total,
      pages: Math.ceil(total / paginationOptions.limit)
    };

    const enhancedProducts = products.map(product => 
      ProductHelpers.enhanceProductWithColorData(product)
    );

    // Add price analysis
    const priceAnalysis = ProductHelpers.analyzeProductPrices(enhancedProducts);

    res.json(ProductHelpers.formatPaginatedResponse(enhancedProducts, pagination, { priceAnalysis }));
  });

  // Get related products
  static getRelatedProducts = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { limit = 6 } = req.query;

    if (!ProductHelpers.isValidObjectId(id)) {
      throw new HttpError('Invalid product ID', 400);
    }

    const product = await Product.findById(id);
    if (!product) {
      throw new HttpError('Product not found', 404);
    }

    const relatedProducts = await Product.find({
      _id: { $ne: id },
      category: product.category,
      isActive: true
    })
    .populate('category', 'name slug')
    .populate('brand', 'name')
    .limit(parseInt(limit))
    .sort({ salesCount: -1, createdAt: -1 });

    const enhancedProducts = relatedProducts.map(prod => 
      ProductHelpers.enhanceProductWithColorData(prod)
    );

    res.json(ProductHelpers.formatSuccessResponse(enhancedProducts, 'Related products fetched successfully'));
  });

  // Validate product ID
  static validateProductId = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!ProductHelpers.isValidObjectId(id)) {
      throw new HttpError('Invalid product ID', 400);
    }

    const product = await Product.findById(id).select('_id name isActive');
    
    if (!product) {
      throw new HttpError('Product not found', 404);
    }

    res.json(ProductHelpers.formatSuccessResponse(
      { isValid: true, product: { _id: product._id, name: product.name, isActive: product.isActive } },
      'Product ID is valid'
    ));
  });

  // Upload product images
  static uploadProductImages = asyncHandler(async (req, res) => {
    const files = req.files;

    if (!files || files.length === 0) {
      throw new HttpError('No images provided', 400);
    }

    try {
      const uploadedImages = await uploadMultipleImages(files, 'products');
      
      res.json(ProductHelpers.formatSuccessResponse(
        uploadedImages,
        'Images uploaded successfully'
      ));
    } catch (error) {
      throw new HttpError(`Image upload failed: ${error.message}`, 500);
    }
  });

  // Add color images
  static addColorImages = asyncHandler(async (req, res) => {
    const { id, colorValue } = req.params;
    const files = req.files || [];

    if (!ProductHelpers.isValidObjectId(id)) {
      throw new HttpError('Invalid product ID', 400);
    }

    const product = await Product.findById(id);
    if (!product) {
      throw new HttpError('Product not found', 404);
    }

    if (!product.colors.hasColors) {
      throw new HttpError('Product does not support colors', 400);
    }

    const color = product.colors.availableColors.find(c => c.value === colorValue);
    if (!color) {
      throw new HttpError('Color not found', 404);
    }

    if (files.length === 0) {
      throw new HttpError('No images provided', 400);
    }

    // Upload images
    const uploadedImages = await uploadMultipleImages(files, `products/${product._id}/colors`);

    // Add images to color
    const currentImagesCount = color.images.length;
    
    uploadedImages.forEach((img, index) => {
      color.images.push({
        url: img.url,
        public_id: img.public_id,
        alt: ProductHelpers.generateImageAltText(product, color, 'color', currentImagesCount + index),
        isPrimary: color.images.length === 0 && index === 0, // Set first image as primary if no images exist
        displayOrder: currentImagesCount + index
      });
    });

    await product.save();

    res.json(ProductHelpers.formatSuccessResponse(
      { images: color.images },
      'Color images added successfully'
    ));
  });

  // Delete color images
  static deleteColorImages = asyncHandler(async (req, res) => {
    const { id, colorValue } = req.params;
    const { publicIds } = req.body;

    if (!ProductHelpers.isValidObjectId(id)) {
      throw new HttpError('Invalid product ID', 400);
    }

    if (!publicIds || !Array.isArray(publicIds) || publicIds.length === 0) {
      throw new HttpError('Public IDs array is required', 400);
    }

    const product = await Product.findById(id);
    if (!product) {
      throw new HttpError('Product not found', 404);
    }

    const color = product.colors.availableColors.find(c => c.value === colorValue);
    if (!color) {
      throw new HttpError('Color not found', 404);
    }

    // Delete images from Cloudinary
    await deleteMultipleImages(publicIds);

    // Remove images from color
    color.images = color.images.filter(img => !publicIds.includes(img.public_id));

    // If we removed the primary image and there are other images, set a new primary
    const hadPrimary = publicIds.some(pid => 
      color.images.find(img => img.public_id === pid && img.isPrimary)
    );
    
    if (hadPrimary && color.images.length > 0) {
      color.images[0].isPrimary = true;
    }

    await product.save();

    res.json(ProductHelpers.formatSuccessResponse(
      { images: color.images },
      'Color images deleted successfully'
    ));
  });

  // Set color primary image
  static setColorPrimaryImage = asyncHandler(async (req, res) => {
    const { id, colorValue } = req.params;
    const { publicId } = req.body;

    if (!ProductHelpers.isValidObjectId(id)) {
      throw new HttpError('Invalid product ID', 400);
    }

    if (!publicId) {
      throw new HttpError('Public ID is required', 400);
    }

    const product = await Product.findById(id);
    if (!product) {
      throw new HttpError('Product not found', 404);
    }

    const color = product.colors.availableColors.find(c => c.value === colorValue);
    if (!color) {
      throw new HttpError('Color not found', 404);
    }

    // Find the image and set it as primary
    let foundImage = false;
    color.images.forEach(img => {
      if (img.public_id === publicId) {
        img.isPrimary = true;
        foundImage = true;
      } else {
        img.isPrimary = false;
      }
    });

    if (!foundImage) {
      throw new HttpError('Image not found for this color', 404);
    }

    await product.save();

    res.json(ProductHelpers.formatSuccessResponse(
      { primaryImage: color.images.find(img => img.isPrimary) },
      'Primary image set successfully'
    ));
  });

  // Get color images
  static getColorImages = asyncHandler(async (req, res) => {
    const { id, colorValue } = req.params;

    if (!ProductHelpers.isValidObjectId(id)) {
      throw new HttpError('Invalid product ID', 400);
    }

    const product = await Product.findById(id);
    if (!product) {
      throw new HttpError('Product not found', 404);
    }

    const colorImages = product.getImagesByColor(colorValue);
    
    res.json(ProductHelpers.formatSuccessResponse(
      { images: colorImages, color: colorValue },
      'Color images fetched successfully'
    ));
  });

  // Update color display order
  static updateColorDisplayOrder = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { colorOrders } = req.body;

    if (!ProductHelpers.isValidObjectId(id)) {
      throw new HttpError('Invalid product ID', 400);
    }

    if (!colorOrders || typeof colorOrders !== 'object') {
      throw new HttpError('Color orders object is required', 400);
    }

    const product = await Product.findById(id);
    if (!product) {
      throw new HttpError('Product not found', 404);
    }

    // Update display orders
    Object.keys(colorOrders).forEach(colorValue => {
      const color = product.colors.availableColors.find(c => c.value === colorValue);
      if (color) {
        color.displayOrder = colorOrders[colorValue];
      }
    });

    // Sort colors by display order
    product.colors.availableColors.sort((a, b) => a.displayOrder - b.displayOrder);

    await product.save();

    res.json(ProductHelpers.formatSuccessResponse(
      { colors: product.colors.availableColors },
      'Color display order updated successfully'
    ));
  });

  // Update image display order
  static updateImageDisplayOrder = asyncHandler(async (req, res) => {
    const { id, colorValue } = req.params;
    const { imageOrders } = req.body;

    if (!ProductHelpers.isValidObjectId(id)) {
      throw new HttpError('Invalid product ID', 400);
    }

    if (!imageOrders || typeof imageOrders !== 'object') {
      throw new HttpError('Image orders object is required', 400);
    }

    const product = await Product.findById(id);
    if (!product) {
      throw new HttpError('Product not found', 404);
    }

    const color = product.colors.availableColors.find(c => c.value === colorValue);
    if (!color) {
      throw new HttpError('Color not found', 404);
    }

    // Update image display orders
    Object.keys(imageOrders).forEach(publicId => {
      const image = color.images.find(img => img.public_id === publicId);
      if (image) {
        image.displayOrder = imageOrders[publicId];
      }
    });

    // Sort images by display order
    color.images.sort((a, b) => a.displayOrder - b.displayOrder);

    await product.save();

    res.json(ProductHelpers.formatSuccessResponse(
      { images: color.images },
      'Image display order updated successfully'
    ));
  });

  // Get products by IDs
  static getProductsByIds = asyncHandler(async (req, res) => {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      throw new HttpError('Product IDs array is required', 400);
    }

    // Validate all IDs
    const validIds = ids.filter(id => ProductHelpers.isValidObjectId(id));
    if (validIds.length === 0) {
      throw new HttpError('No valid product IDs provided', 400);
    }

    const products = await Product.find({
      _id: { $in: validIds },
      isActive: true
    })
    .populate('category', 'name slug')
    .populate('brand', 'name');

    const enhancedProducts = products.map(product => 
      ProductHelpers.enhanceProductWithColorData(product)
    );

    // Add price analysis
    const priceAnalysis = ProductHelpers.analyzeProductPrices(enhancedProducts);

    res.json(ProductHelpers.formatSuccessResponse(
      { products: enhancedProducts, priceAnalysis },
      'Products fetched successfully'
    ));
  });

  // Bulk update products
  static bulkUpdateProducts = asyncHandler(async (req, res) => {
    const { ids, updates } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      throw new HttpError('Product IDs array is required', 400);
    }

    if (!updates || typeof updates !== 'object') {
      throw new HttpError('Updates object is required', 400);
    }

    // Validate color prices in updates if present
    if (updates.colors?.availableColors) {
      updates.colors.availableColors.forEach((color, index) => {
        if (color.price !== undefined && color.price !== null) {
          if (color.price < 0) {
            throw new HttpError(`Invalid price for color ${color.name}: Price cannot be negative`, 400);
          }
          
          if (color.comparePrice !== undefined && color.comparePrice !== null) {
            if (color.comparePrice < 0) {
              throw new HttpError(`Invalid compare price for color ${color.name}: Compare price cannot be negative`, 400);
            }
            if (color.comparePrice < color.price) {
              throw new HttpError(`Invalid compare price for color ${color.name}: Compare price must be greater than or equal to price`, 400);
            }
          }
        }
      });
    }

    // Validate all IDs
    const validIds = ids.filter(id => ProductHelpers.isValidObjectId(id));
    if (validIds.length === 0) {
      throw new HttpError('No valid product IDs provided', 400);
    }

    // Perform bulk update
    const result = await Product.updateMany(
      { _id: { $in: validIds } },
      { 
        ...updates,
        'meta.updatedBy': req.user._id,
        'meta.updatedAt': new Date()
      }
    );

    res.json(ProductHelpers.formatSuccessResponse(
      { 
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount 
      },
      'Products updated successfully'
    ));
  });

  // Get product stats by sex
  static getProductStatsBySex = asyncHandler(async (req, res) => {
    const { sex } = req.params;

    const stats = await Product.aggregate([
      { $match: { sex, isActive: true } },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          totalInStock: {
            $sum: {
              $cond: [
                { $or: [
                  { $gt: ['$quantity', 0] },
                  { $gt: [{ $size: { $ifNull: ['$variants', []] } }, 0] }
                ] },
                1,
                0
              ]
            }
          },
          totalLowStock: {
            $sum: {
              $cond: [
                { $or: [
                  { $and: [
                    { $gt: ['$quantity', 0] },
                    { $lte: ['$quantity', '$lowStockThreshold'] }
                  ]},
                  { $and: [
                    { $gt: [{ $size: { $ifNull: ['$variants', []] } }, 0] },
                    // This is a simplified low stock calculation for variants
                    { $lte: ['$quantity', '$lowStockThreshold'] }
                  ]}
                ]},
                1,
                0
              ]
            }
          },
          averageColorPrice: { 
            $avg: { 
              $arrayElemAt: ['$colors.availableColors.price', 0]
            }
          },
          totalInventoryValue: {
            $sum: {
              $add: [
                {
                  $reduce: {
                    input: '$variants',
                    initialValue: 0,
                    in: {
                      $add: [
                        '$$value',
                        { $multiply: ['$$this.price', '$$this.quantity'] }
                      ]
                    }
                  }
                }
              ]
            }
          }
        }
      }
    ]);

    const result = stats[0] || {
      totalProducts: 0,
      totalInStock: 0,
      totalLowStock: 0,
      averageColorPrice: 0,
      totalInventoryValue: 0
    };

    res.json(ProductHelpers.formatSuccessResponse(result, 'Product stats fetched successfully'));
  });

  // Get low stock products
  static getLowStockProducts = asyncHandler(async (req, res) => {
    const { page = 1, limit = 20 } = req.query;

    const paginationOptions = ProductHelpers.buildPaginationOptions(page, limit);

    // Find products that are low stock (either main product or variants)
    const products = await Product.find({
      isActive: true,
      $or: [
        // Main product low stock
        {
          $and: [
            { quantity: { $gt: 0 } },
            { quantity: { $lte: '$lowStockThreshold' } }
          ]
        },
        // Variants low stock (simplified check)
        {
          'variants': {
            $elemMatch: {
              quantity: { $gt: 0, $lte: 5 } // Using 5 as default low stock threshold for variants
            }
          }
        }
      ]
    })
    .populate('category', 'name')
    .populate('brand', 'name')
    .skip(paginationOptions.skip)
    .limit(paginationOptions.limit)
    .sort({ quantity: 1 });

    const total = await Product.countDocuments({
      isActive: true,
      $or: [
        {
          $and: [
            { quantity: { $gt: 0 } },
            { quantity: { $lte: '$lowStockThreshold' } }
          ]
        },
        {
          'variants': {
            $elemMatch: {
              quantity: { $gt: 0, $lte: 5 }
            }
          }
        }
      ]
    });

    const pagination = {
      page: paginationOptions.page,
      limit: paginationOptions.limit,
      total,
      pages: Math.ceil(total / paginationOptions.limit)
    };

    const enhancedProducts = products.map(product => {
      const enhanced = ProductHelpers.enhanceProductWithColorData(product);
      const stockInfo = ProductHelpers.calculateProductStockStatus(product);
      return { ...enhanced, stockInfo };
    });

    const analysis = ProductHelpers.analyzeLowStockProducts(products);

    res.json(ProductHelpers.formatPaginatedResponse(
      enhancedProducts,
      pagination,
      { lowStockAnalysis: analysis }
    ));
  });



  // Get category hierarchy for navigation
  static getCategoryHierarchy = asyncHandler(async (req, res) => {
    const { sex } = req.params;

    const categories = await Category.find({
      sex: { $in: [sex, 'unisex'] },
      isActive: true
    })
    .populate('children', 'name seo.slug isActive sortOrder')
    .sort({ sortOrder: 1, name: 1 });

    // Filter out inactive children and format response
    const formattedCategories = categories.map(cat => ({
      _id: cat._id,
      name: cat.name,
      slug: cat.seo?.slug,
      sex: cat.sex,
      description: cat.description,
      image: cat.image,
      children: cat.children
        ?.filter(child => child.isActive)
        .map(child => ({
          _id: child._id,
          name: child.name,
          slug: child.seo?.slug
        })) || []
    }));

    res.json(ProductHelpers.formatSuccessResponse(
      formattedCategories,
      'Category hierarchy fetched successfully'
    ));
  });

  // Get products count by category and sex (for quick stats)
  static getProductsCountByCategoryAndSex = asyncHandler(async (req, res) => {
    const { categoryId, sex } = req.params;

    if (!ProductHelpers.isValidObjectId(categoryId)) {
      throw new HttpError('Invalid category ID', 400);
    }

    const category = await Category.findById(categoryId);
    if (!category) {
      throw new HttpError('Category not found', 404);
    }

    // Build sex filter
    let sexFilter = {};
    if (sex === 'unisex') {
      sexFilter.sex = 'unisex';
    } else {
      sexFilter.$or = [
        { sex: sex },
        { sex: 'unisex' }
      ];
    }

    const counts = await Product.aggregate([
      {
        $match: {
          category: new mongoose.Types.ObjectId(categoryId),
          isActive: true,
          ...sexFilter
        }
      },
      {
        $facet: {
          total: [{ $count: 'count' }],
          inStock: [
            {
              $match: {
                $or: [
                  { quantity: { $gt: 0 } },
                  { 'variants.quantity': { $gt: 0 } }
                ]
              }
            },
            { $count: 'count' }
          ],
          featured: [
            { $match: { isFeatured: true } },
            { $count: 'count' }
          ],
          onSale: [
            { $match: { 
              'colors.availableColors.comparePrice': { $exists: true, $ne: null, $gt: '$colors.availableColors.price' }
            }},
            { $count: 'count' }
          ],
          newArrivals: [
            {
              $match: {
                createdAt: {
                  $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
                }
              }
            },
            { $count: 'count' }
          ]
        }
      }
    ]);

    const result = {
      category: {
        _id: category._id,
        name: category.name,
        sex: category.sex
      },
      counts: {
        total: counts[0]?.total[0]?.count || 0,
        inStock: counts[0]?.inStock[0]?.count || 0,
        featured: counts[0]?.featured[0]?.count || 0,
        onSale: counts[0]?.onSale[0]?.count || 0,
        newArrivals: counts[0]?.newArrivals[0]?.count || 0
      }
    };

    res.json(ProductHelpers.formatSuccessResponse(result, 'Products count fetched successfully'));
  });

  // Update color prices
  static updateColorPrices = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { colorPrices } = req.body; // Array of { colorValue, price, comparePrice }

    if (!ProductHelpers.isValidObjectId(id)) {
      throw new HttpError('Invalid product ID', 400);
    }

    if (!colorPrices || !Array.isArray(colorPrices)) {
      throw new HttpError('Color prices array is required', 400);
    }

    const product = await Product.findById(id);
    if (!product) {
      throw new HttpError('Product not found', 404);
    }

    if (!product.colors.hasColors) {
      throw new HttpError('Product does not support colors', 400);
    }

    // Validate and update color prices
    colorPrices.forEach(colorPrice => {
      const { colorValue, price, comparePrice } = colorPrice;
      
      const color = product.colors.availableColors.find(c => c.value === colorValue);
      if (!color) {
        throw new HttpError(`Color ${colorValue} not found`, 404);
      }

      if (price !== undefined) {
        if (price < 0) {
          throw new HttpError(`Invalid price for color ${colorValue}: Price cannot be negative`, 400);
        }
        color.price = price;
      }

      if (comparePrice !== undefined) {
        if (comparePrice !== null && comparePrice < 0) {
          throw new HttpError(`Invalid compare price for color ${colorValue}: Compare price cannot be negative`, 400);
        }
        if (comparePrice !== null && price !== undefined && comparePrice < price) {
          throw new HttpError(`Invalid compare price for color ${colorValue}: Compare price must be greater than or equal to price`, 400);
        }
        color.comparePrice = comparePrice;
      }
    });

    // Update meta
    product.meta.updatedBy = req.user.id;
    product.meta.updatedAt = new Date();

    await product.save();

    const enhancedProduct = ProductHelpers.enhanceProductWithColorData(product);
    
    res.json(ProductHelpers.formatSuccessResponse(
      { product: enhancedProduct, updatedColors: colorPrices.length },
      'Color prices updated successfully'
    ));
  });

  // Get products by color price range
  static getProductsByColorPriceRange = asyncHandler(async (req, res) => {
    const { minPrice, maxPrice, page = 1, limit = 12 } = req.query;

    if (!minPrice && !maxPrice) {
      throw new HttpError('At least one of minPrice or maxPrice is required', 400);
    }

    const filter = {
      isActive: true,
      'colors.availableColors.price': {
        ...(minPrice && { $gte: parseFloat(minPrice) }),
        ...(maxPrice && { $lte: parseFloat(maxPrice) })
      }
    };

    const paginationOptions = ProductHelpers.buildPaginationOptions(page, limit);

    const products = await Product.find(filter)
      .populate('category', 'name slug')
      .populate('brand', 'name')
      .skip(paginationOptions.skip)
      .limit(paginationOptions.limit)
      .sort({ 'colors.availableColors.price': 1 });

    const total = await Product.countDocuments(filter);

    const pagination = {
      page: paginationOptions.page,
      limit: paginationOptions.limit,
      total,
      pages: Math.ceil(total / paginationOptions.limit)
    };

    const enhancedProducts = products.map(product => 
      ProductHelpers.enhanceProductWithColorData(product)
    );

    // Add price analysis
    const priceAnalysis = ProductHelpers.analyzeProductPrices(enhancedProducts);

    res.json(ProductHelpers.formatPaginatedResponse(
      enhancedProducts,
      pagination,
      { 
        priceRange: { minPrice: minPrice ? parseFloat(minPrice) : null, maxPrice: maxPrice ? parseFloat(maxPrice) : null },
        priceAnalysis
      }
    ));
  });

  // Get color price summary for a product
  static getProductColorPriceSummary = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!ProductHelpers.isValidObjectId(id)) {
      throw new HttpError('Invalid product ID', 400);
    }

    const product = await Product.findById(id);
    if (!product) {
      throw new HttpError('Product not found', 404);
    }

    const colorPriceSummary = ProductHelpers.getColorPriceSummary(product);
    
    res.json(ProductHelpers.formatSuccessResponse(
      colorPriceSummary,
      'Color price summary fetched successfully'
    ));
  });

  // Bulk update color prices
  static bulkUpdateColorPrices = asyncHandler(async (req, res) => {
    const { productIds, colorPrices } = req.body; // colorPrices: { colorValue, price, comparePrice }

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      throw new HttpError('Product IDs array is required', 400);
    }

    if (!colorPrices || !Array.isArray(colorPrices)) {
      throw new HttpError('Color prices array is required', 400);
    }

    // Validate all IDs
    const validIds = productIds.filter(id => ProductHelpers.isValidObjectId(id));
    if (validIds.length === 0) {
      throw new HttpError('No valid product IDs provided', 400);
    }

    // Validate color prices
    colorPrices.forEach(colorPrice => {
      const { price, comparePrice } = colorPrice;
      
      if (price !== undefined && price < 0) {
        throw new HttpError(`Invalid price: Price cannot be negative`, 400);
      }

      if (comparePrice !== undefined && comparePrice !== null) {
        if (comparePrice < 0) {
          throw new HttpError(`Invalid compare price: Compare price cannot be negative`, 400);
        }
        if (price !== undefined && comparePrice < price) {
          throw new HttpError(`Invalid compare price: Compare price must be greater than or equal to price`, 400);
        }
      }
    });

    // Get all products
    const products = await Product.find({ _id: { $in: validIds } });
    
    let updatedCount = 0;
    let failedProducts = [];

    // Update each product
    for (const product of products) {
      if (!product.colors.hasColors) {
        failedProducts.push({ productId: product._id, reason: 'Product does not support colors' });
        continue;
      }

      try {
        // Update color prices for this product
        colorPrices.forEach(colorPrice => {
          const { colorValue, price, comparePrice } = colorPrice;
          
          const color = product.colors.availableColors.find(c => c.value === colorValue);
          if (color) {
            if (price !== undefined) {
              color.price = price;
            }
            if (comparePrice !== undefined) {
              color.comparePrice = comparePrice;
            }
          }
        });

        // Update meta
        product.meta.updatedBy = req.user.id;
        product.meta.updatedAt = new Date();

        await product.save();
        updatedCount++;
      } catch (error) {
        failedProducts.push({ productId: product._id, reason: error.message });
      }
    }

    res.json(ProductHelpers.formatSuccessResponse(
      { 
        totalProducts: products.length,
        updatedCount,
        failedCount: failedProducts.length,
        failedProducts
      },
      'Color prices updated successfully'
    ));
  });

  // Get products with color discounts
  static getProductsWithColorDiscounts = asyncHandler(async (req, res) => {
    const { minDiscount = 10, page = 1, limit = 12 } = req.query;

    const filter = {
      isActive: true,
      'colors.hasColors': true,
      'colors.availableColors.price': { $exists: true },
      'colors.availableColors.comparePrice': { $exists: true, $ne: null },
      $expr: {
        $gte: [
          {
            $multiply: [
              {
                $divide: [
                  { $subtract: ['$colors.availableColors.comparePrice', '$colors.availableColors.price'] },
                  '$colors.availableColors.comparePrice'
                ]
              },
              100
            ]
          },
          parseFloat(minDiscount)
        ]
      }
    };

    const paginationOptions = ProductHelpers.buildPaginationOptions(page, limit);

    const products = await Product.find(filter)
      .populate('category', 'name slug')
      .populate('brand', 'name')
      .skip(paginationOptions.skip)
      .limit(paginationOptions.limit)
      .sort({ 'ratings.average': -1 });

    const total = await Product.countDocuments(filter);

    const pagination = {
      page: paginationOptions.page,
      limit: paginationOptions.limit,
      total,
      pages: Math.ceil(total / paginationOptions.limit)
    };

    const enhancedProducts = products.map(product => 
      ProductHelpers.enhanceProductWithColorData(product)
    );

    // Add discount analysis
    const discountAnalysis = ProductHelpers.analyzeProductDiscounts(enhancedProducts);

    res.json(ProductHelpers.formatPaginatedResponse(
      enhancedProducts,
      pagination,
      { 
        minDiscount: parseFloat(minDiscount),
        discountAnalysis
      }
    ));
  });


  // Add this method to ProductController
static getBestSellingProducts = asyncHandler(async (req, res) => {
  const { limit = 10, page = 1, sex, categoryId } = req.query;
  
  const filter = { 
    isActive: true,
    ...(sex && { sex }),
    ...(categoryId && ProductHelpers.isValidObjectId(categoryId) && { category: categoryId })
  };
  
  const paginationOptions = ProductHelpers.buildPaginationOptions(page, limit);
  
  const products = await Product.find(filter)
    .populate('category', 'name slug description sex accessories')
    .populate('brand', 'name')
    .sort({ salesCount: -1, createdAt: -1 })
    .skip(paginationOptions.skip)
    .limit(paginationOptions.limit);
  
  const total = await Product.countDocuments(filter);
  
  const pagination = {
    page: paginationOptions.page,
    limit: paginationOptions.limit,
    total,
    pages: Math.ceil(total / paginationOptions.limit)
  };
  
  const enhancedProducts = products.map(product => 
    ProductHelpers.enhanceProductWithColorData(product)
  );
  
  res.json(ProductHelpers.formatPaginatedResponse(
    enhancedProducts,
    pagination,
    { sortBy: 'salesCount' }
  ));
});

}

module.exports = ProductController;