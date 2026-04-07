const asyncHandler = require("express-async-handler");
const HttpError = require('../middleware/HttpError');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const mongoose = require('mongoose');

class SalesReportController {
  
  /**
   * @desc    Get sales report data by period
   * @route   GET /api/sales/report
   * @access  Private/Admin
   */
  static getSalesReport = asyncHandler(async (req, res) => {
    const { 
      period = 'monthly', 
      startDate, 
      endDate, 
      category,
      status,
      limit = 12
    } = req.query;

    try {
      // Build match query
      const matchStage = {};
      
      // Date range filter
      if (startDate || endDate) {
        matchStage.createdAt = {};
        if (startDate) {
          matchStage.createdAt.$gte = new Date(startDate);
        }
        if (endDate) {
          const endDateObj = new Date(endDate);
          endDateObj.setHours(23, 59, 59, 999);
          matchStage.createdAt.$lte = endDateObj;
        }
      } else {
        // Default to last 12 months for monthly, 30 days for daily
        const defaultDate = new Date();
        if (period === 'daily') {
          defaultDate.setDate(defaultDate.getDate() - 30);
        } else if (period === 'weekly') {
          defaultDate.setDate(defaultDate.getDate() - 90);
        } else if (period === 'yearly') {
          defaultDate.setFullYear(defaultDate.getFullYear() - 5);
        } else {
          defaultDate.setMonth(defaultDate.getMonth() - 12);
        }
        matchStage.createdAt = { $gte: defaultDate };
      }

      // Status filter
      if (status && status !== 'all') {
        matchStage.status = status;
      } else {
        // Default to completed orders for revenue calculations
        matchStage.status = { 
          $in: ['confirmed', 'processing', 'shipped', 'delivered', 'completed'] 
        };
      }

      // Build group stage based on period
      let groupStage = {};
      let sortStage = {};
      let projectStage = {};

      switch (period) {
        case 'daily':
          groupStage = {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' }
            },
            date: { $first: '$createdAt' }
          };
          projectStage = {
            _id: 0,
            day: '$_id.day',
            month: '$_id.month',
            year: '$_id.year',
            date: 1,
            revenue: 1,
            orders: 1,
            items: 1
          };
          sortStage = { '_id.year': 1, '_id.month': 1, '_id.day': 1 };
          break;

        case 'weekly':
          groupStage = {
            _id: { 
              year: { $year: '$createdAt' },
              week: { $week: '$createdAt' }
            },
            date: { $first: '$createdAt' }
          };
          projectStage = {
            _id: 0,
            week: '$_id.week',
            year: '$_id.year',
            date: 1,
            revenue: 1,
            orders: 1,
            items: 1
          };
          sortStage = { '_id.year': 1, '_id.week': 1 };
          break;

        case 'yearly':
          groupStage = {
            _id: { year: { $year: '$createdAt' } },
            date: { $first: '$createdAt' }
          };
          projectStage = {
            _id: 0,
            year: '$_id.year',
            date: 1,
            revenue: 1,
            orders: 1,
            items: 1
          };
          sortStage = { '_id.year': 1 };
          break;

        default: // monthly
          groupStage = {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' }
            },
            date: { $first: '$createdAt' }
          };
          projectStage = {
            _id: 0,
            month: '$_id.month',
            year: '$_id.year',
            date: 1,
            revenue: 1,
            orders: 1,
            items: 1
          };
          sortStage = { '_id.year': 1, '_id.month': 1 };
      }

      // Add aggregation calculations
      groupStage.revenue = { $sum: '$total' };
      groupStage.orders = { $sum: 1 };
      groupStage.items = { $sum: '$itemCount' };
      groupStage.avgOrderValue = { $avg: '$total' };
      groupStage.customers = { $addToSet: '$customer' };

      projectStage.revenue = 1;
      projectStage.orders = 1;
      projectStage.items = 1;
      projectStage.avgOrderValue = 1;
      projectStage.customerCount = { $size: '$customers' };

      // If category filter is applied
      if (category && category !== 'all') {
        // First, populate items to filter by category
        const orders = await Order.find(matchStage)
          .populate({
            path: 'items.product',
            match: { category: category }
          })
          .lean();

        // Filter orders that have products in the specified category
        const filteredOrders = orders.filter(order => 
          order.items.some(item => item.product && item.product.category === category)
        );

        // Manually aggregate filtered orders
        const aggregatedData = this.aggregateManual(filteredOrders, period, limit);
        
        // Calculate growth
        const dataWithGrowth = this.calculateGrowth(aggregatedData);
        
        return res.json({
          success: true,
          period,
          category,
          data: dataWithGrowth,
          total: aggregatedData.length
        });
      }

      // Standard aggregation pipeline
      const pipeline = [
        { $match: matchStage },
        { $group: groupStage },
        { $project: projectStage },
        { $sort: sortStage },
        { $limit: parseInt(limit) }
      ];

      const salesData = await Order.aggregate(pipeline);

      // Format the data
      const formattedData = salesData.map(item => {
        const date = new Date(item.date);
        let label = '';
        
        switch (period) {
          case 'daily':
            label = `${date.getMonth() + 1}/${date.getDate()}`;
            break;
          case 'weekly':
            label = `Week ${item.week}`;
            break;
          case 'yearly':
            label = item.year.toString();
            break;
          default:
            label = date.toLocaleDateString('en-US', { month: 'short' });
        }

        return {
          ...item,
          label,
          monthName: period === 'monthly' ? date.toLocaleDateString('en-US', { month: 'short' }) : undefined
        };
      });

      // Calculate growth percentage
      const dataWithGrowth = this.calculateGrowth(formattedData);

      res.json({
        success: true,
        period,
        data: dataWithGrowth,
        total: salesData.length
      });

    } catch (error) {
      console.error('Sales report error:', error);
      throw new HttpError('Failed to generate sales report', 500);
    }
  });

  /**
   * @desc    Get sales statistics
   * @route   GET /api/sales/stats
   * @access  Private/Admin
   */
  static getSalesStats = asyncHandler(async (req, res) => {
    const { period = 'monthly', startDate, endDate } = req.query;

    try {
      // Current period match stage
      const currentMatch = {};
      
      // Set date range for current period
      if (startDate && endDate) {
        currentMatch.createdAt = {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        };
      } else {
        // Default based on period
        const now = new Date();
        const start = new Date();
        
        switch (period) {
          case 'daily':
            start.setDate(now.getDate() - 30);
            break;
          case 'weekly':
            start.setDate(now.getDate() - 90);
            break;
          case 'yearly':
            start.setFullYear(now.getFullYear() - 5);
            break;
          default: // monthly
            start.setMonth(now.getMonth() - 12);
        }
        
        currentMatch.createdAt = { $gte: start };
      }

      // Only include revenue-generating statuses
      currentMatch.status = { 
        $in: ['confirmed', 'processing', 'shipped', 'delivered', 'completed'] 
      };

      // Get current period stats
      const currentStats = await Order.aggregate([
        { $match: currentMatch },
        {
          $group: {
            _id: null,
            revenue: { $sum: '$total' },
            orders: { $sum: 1 },
            items: { $sum: '$itemCount' },
            avgOrderValue: { $avg: '$total' },
            customers: { $addToSet: '$customer' }
          }
        },
        {
          $project: {
            _id: 0,
            revenue: 1,
            orders: 1,
            items: 1,
            avgOrderValue: 1,
            customerCount: { $size: '$customers' }
          }
        }
      ]);

      // Get previous period for comparison
      const prevMatch = JSON.parse(JSON.stringify(currentMatch));
      let periodOffset = 0;
      
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffTime = Math.abs(end - start);
        periodOffset = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        prevMatch.createdAt.$gte = new Date(start.setDate(start.getDate() - periodOffset));
        prevMatch.createdAt.$lte = new Date(end.setDate(end.getDate() - periodOffset));
      } else {
        // Default offset based on period
        switch (period) {
          case 'daily':
            periodOffset = 30;
            break;
          case 'weekly':
            periodOffset = 90;
            break;
          case 'yearly':
            periodOffset = 365 * 5;
            break;
          default:
            periodOffset = 365; // 1 year for monthly
        }
        
        if (prevMatch.createdAt.$gte) {
          prevMatch.createdAt.$gte = new Date(
            prevMatch.createdAt.$gte.getTime() - (periodOffset * 24 * 60 * 60 * 1000)
          );
        }
      }

      const prevStats = await Order.aggregate([
        { $match: prevMatch },
        {
          $group: {
            _id: null,
            revenue: { $sum: '$total' },
            orders: { $sum: 1 }
          }
        }
      ]);

      // Get all-time stats
      const allTimeStats = await Order.aggregate([
        { 
          $match: { 
            status: { 
              $in: ['confirmed', 'processing', 'shipped', 'delivered', 'completed'] 
            } 
          } 
        },
        {
          $group: {
            _id: null,
            revenue: { $sum: '$total' },
            orders: { $sum: 1 }
          }
        }
      ]);

      // Get refund stats
      const refundStats = await Order.aggregate([
        { $match: { $or: [{ status: 'refunded' }, { status: 'partially_refunded' }] } },
        {
          $group: {
            _id: null,
            refundAmount: { $sum: '$refundAmount' },
            refundCount: { $sum: 1 }
          }
        }
      ]);

      // Calculate metrics
      const current = currentStats[0] || { revenue: 0, orders: 0, items: 0, avgOrderValue: 0, customerCount: 0 };
      const previous = prevStats[0] || { revenue: 0, orders: 0 };
      const allTime = allTimeStats[0] || { revenue: 0, orders: 0 };
      const refund = refundStats[0] || { refundAmount: 0, refundCount: 0 };

      const growthRate = previous.revenue > 0 
        ? ((current.revenue - previous.revenue) / previous.revenue) * 100 
        : (current.revenue > 0 ? 100 : 0);

      const avgDailyRevenue = period === 'daily' 
        ? current.revenue / 30 
        : current.revenue / (period === 'weekly' ? 12 : period === 'monthly' ? 30 : 365);

      const refundRate = allTime.revenue > 0 
        ? (refund.refundAmount / allTime.revenue) * 100 
        : 0;

      // Get status counts
      const statusCounts = await Order.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      // Convert to object
      const statusStats = {};
      statusCounts.forEach(item => {
        statusStats[item._id] = item.count;
      });

      res.json({
        success: true,
        stats: {
          // Current period
          monthlyRevenue: current.revenue,
          monthlyOrders: current.orders,
          monthlyItems: current.items,
          avgOrderValue: current.avgOrderValue,
          uniqueCustomers: current.customerCount,
          
          // Growth
          growthRate: parseFloat(growthRate.toFixed(2)),
          orderGrowth: previous.orders > 0 
            ? ((current.orders - previous.orders) / previous.orders) * 100 
            : (current.orders > 0 ? 100 : 0),
          
          // All time
          totalRevenue: allTime.revenue,
          totalOrders: allTime.orders,
          
          // Rates
          avgDailyRevenue: parseFloat(avgDailyRevenue.toFixed(2)),
          refundRate: parseFloat(refundRate.toFixed(2)),
          conversionRate: current.customerCount > 0 
            ? (current.orders / current.customerCount) * 100 
            : 0,
          
          // Status breakdown
          status: statusStats,
          
          // Refunds
          totalRefunded: refund.refundAmount,
          refundCount: refund.refundCount
        }
      });

    } catch (error) {
      console.error('Sales stats error:', error);
      throw new HttpError('Failed to get sales statistics', 500);
    }
  });

  /**
   * @desc    Get top selling products
   * @route   GET /api/sales/top-products
   * @access  Private/Admin
   */
  static getTopProducts = asyncHandler(async (req, res) => {
    const { 
      limit = 10, 
      startDate, 
      endDate, 
      category,
      sortBy = 'revenue' 
    } = req.query;

    try {
      const matchStage = {
        status: { 
          $in: ['confirmed', 'processing', 'shipped', 'delivered', 'completed'] 
        }
      };

      // Date filter
      if (startDate || endDate) {
        matchStage.createdAt = {};
        if (startDate) matchStage.createdAt.$gte = new Date(startDate);
        if (endDate) {
          const endDateObj = new Date(endDate);
          endDateObj.setHours(23, 59, 59, 999);
          matchStage.createdAt.$lte = endDateObj;
        }
      }

      // Lookup stage to get product details
      const lookupStage = {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'productDetails'
        }
      };

      // Unwind items and product details
      const unwindItemsStage = { $unwind: '$items' };
      const unwindProductStage = { $unwind: '$productDetails' };

      // Match product stage (for category filter)
      const productMatchStage = {};
      if (category && category !== 'all') {
        productMatchStage['productDetails.category'] = category;
      }

      // Group by product
      const groupStage = {
        $group: {
          _id: '$items.product',
          name: { $first: '$productDetails.name' },
          sku: { $first: '$productDetails.sku' },
          category: { $first: '$productDetails.category' },
          images: { $first: '$productDetails.images' },
          price: { $first: '$productDetails.price' },
          salesCount: { $sum: '$items.quantity' },
          revenue: { 
            $sum: { 
              $multiply: ['$items.quantity', '$items.price'] 
            } 
          },
          orderCount: { $addToSet: '$_id' }
        }
      };

      // Project stage
      const projectStage = {
        $project: {
          _id: 0,
          id: '$_id',
          name: 1,
          sku: 1,
          category: 1,
          images: 1,
          price: 1,
          salesCount: 1,
          revenue: 1,
          orderCount: { $size: '$orderCount' },
          avgPrice: { $divide: ['$revenue', '$salesCount'] }
        }
      };

      // Sort stage
      const sortStage = { $sort: {} };
      sortStage.$sort[sortBy] = -1;

      // Limit stage
      const limitStage = { $limit: parseInt(limit) };

      // Build pipeline
      const pipeline = [
        { $match: matchStage },
        lookupStage,
        unwindItemsStage,
        unwindProductStage
      ];

      if (category && category !== 'all') {
        pipeline.push({ $match: productMatchStage });
      }

      pipeline.push(
        groupStage,
        projectStage,
        sortStage,
        limitStage
      );

      const topProducts = await Order.aggregate(pipeline);

      // Format product data
      const formattedProducts = topProducts.map(product => ({
        ...product,
        formattedRevenue: new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD'
        }).format(product.revenue),
        formattedPrice: new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD'
        }).format(product.price || 0),
        formattedAvgPrice: new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD'
        }).format(product.avgPrice || 0),
        imageUrl: product.images?.[0]?.url || null
      }));

      res.json({
        success: true,
        products: formattedProducts,
        count: formattedProducts.length
      });

    } catch (error) {
      console.error('Top products error:', error);
      throw new HttpError('Failed to get top products', 500);
    }
  });

  /**
   * @desc    Get sales by category
   * @route   GET /api/sales/by-category
   * @access  Private/Admin
   */
  static getSalesByCategory = asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    try {
      const matchStage = {
        status: { 
          $in: ['confirmed', 'processing', 'shipped', 'delivered', 'completed'] 
        }
      };

      // Date filter
      if (startDate || endDate) {
        matchStage.createdAt = {};
        if (startDate) matchStage.createdAt.$gte = new Date(startDate);
        if (endDate) {
          const endDateObj = new Date(endDate);
          endDateObj.setHours(23, 59, 59, 999);
          matchStage.createdAt.$lte = endDateObj;
        }
      }

      const categorySales = await Order.aggregate([
        { $match: matchStage },
        { $unwind: '$items' },
        {
          $lookup: {
            from: 'products',
            localField: 'items.product',
            foreignField: '_id',
            as: 'productDetails'
          }
        },
        { $unwind: '$productDetails' },
        {
          $group: {
            _id: '$productDetails.category',
            revenue: { 
              $sum: { 
                $multiply: ['$items.quantity', '$items.price'] 
              } 
            },
            itemsSold: { $sum: '$items.quantity' },
            productCount: { $addToSet: '$items.product' },
            orderCount: { $addToSet: '$_id' }
          }
        },
        {
          $project: {
            _id: 0,
            name: '$_id',
            revenue: 1,
            itemsSold: 1,
            productCount: { $size: '$productCount' },
            orderCount: { $size: '$orderCount' }
          }
        },
        { $sort: { revenue: -1 } }
      ]);

      // Calculate total revenue for percentages
      const totalRevenue = categorySales.reduce((sum, cat) => sum + cat.revenue, 0);

      // Format category data
      const formattedCategories = categorySales.map((category, index) => ({
        ...category,
        percentage: totalRevenue > 0 ? (category.revenue / totalRevenue) * 100 : 0,
        formattedRevenue: new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD'
        }).format(category.revenue),
        rank: index + 1
      }));

      res.json({
        success: true,
        categories: formattedCategories,
        totalRevenue,
        categoryCount: formattedCategories.length
      });

    } catch (error) {
      console.error('Category sales error:', error);
      throw new HttpError('Failed to get sales by category', 500);
    }
  });

  /**
   * @desc    Get customer statistics
   * @route   GET /api/sales/customer-stats
   * @access  Private/Admin
   */
  static getCustomerStats = asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    try {
      const matchStage = {
        status: { 
          $in: ['confirmed', 'processing', 'shipped', 'delivered', 'completed'] 
        }
      };

      // Date filter
      if (startDate || endDate) {
        matchStage.createdAt = {};
        if (startDate) matchStage.createdAt.$gte = new Date(startDate);
        if (endDate) {
          const endDateObj = new Date(endDate);
          endDateObj.setHours(23, 59, 59, 999);
          matchStage.createdAt.$lte = endDateObj;
        }
      }

      const customerStats = await Order.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$customer',
            orderCount: { $sum: 1 },
            totalSpent: { $sum: '$total' },
            avgOrderValue: { $avg: '$total' },
            firstOrder: { $min: '$createdAt' },
            lastOrder: { $max: '$createdAt' }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'customerDetails'
          }
        },
        { $unwind: { path: '$customerDetails', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            customerId: '$_id',
            firstName: '$customerDetails.firstName',
            lastName: '$customerDetails.lastName',
            email: '$customerDetails.email',
            orderCount: 1,
            totalSpent: 1,
            avgOrderValue: 1,
            firstOrder: 1,
            lastOrder: 1
          }
        },
        { $sort: { totalSpent: -1 } },
        { $limit: 20 }
      ]);

      // Format customer data
      const formattedCustomers = customerStats.map(customer => ({
        ...customer,
        fullName: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unknown Customer',
        formattedTotalSpent: new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD'
        }).format(customer.totalSpent),
        formattedAvgOrderValue: new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD'
        }).format(customer.avgOrderValue),
        customerSince: customer.firstOrder ? new Date(customer.firstOrder).toLocaleDateString() : 'N/A',
        lastPurchase: customer.lastOrder ? new Date(customer.lastOrder).toLocaleDateString() : 'N/A'
      }));

      // Get overall customer metrics
      const overallStats = await Order.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalCustomers: { $addToSet: '$customer' },
            totalOrders: { $sum: 1 },
            totalRevenue: { $sum: '$total' }
          }
        },
        {
          $project: {
            _id: 0,
            uniqueCustomers: { $size: '$totalCustomers' },
            totalOrders: 1,
            totalRevenue: 1,
            avgOrdersPerCustomer: { $divide: ['$totalOrders', { $size: '$totalCustomers' }] },
            avgRevenuePerCustomer: { $divide: ['$totalRevenue', { $size: '$totalCustomers' }] }
          }
        }
      ]);

      res.json({
        success: true,
        topCustomers: formattedCustomers,
        overallStats: overallStats[0] || {
          uniqueCustomers: 0,
          totalOrders: 0,
          totalRevenue: 0,
          avgOrdersPerCustomer: 0,
          avgRevenuePerCustomer: 0
        },
        customerCount: formattedCustomers.length
      });

    } catch (error) {
      console.error('Customer stats error:', error);
      throw new HttpError('Failed to get customer statistics', 500);
    }
  });

  /**
   * @desc    Export sales report
   * @route   GET /api/sales/export
   * @access  Private/Admin
   */
  static exportSalesReport = asyncHandler(async (req, res) => {
    const { 
      format = 'csv', 
      startDate, 
      endDate,
      reportType = 'orders'
    } = req.query;

    try {
      const matchStage = {};
      
      // Date filter
      if (startDate || endDate) {
        matchStage.createdAt = {};
        if (startDate) matchStage.createdAt.$gte = new Date(startDate);
        if (endDate) {
          const endDateObj = new Date(endDate);
          endDateObj.setHours(23, 59, 59, 999);
          matchStage.createdAt.$lte = endDateObj;
        }
      }

      matchStage.status = { 
        $in: ['confirmed', 'processing', 'shipped', 'delivered', 'completed'] 
      };

      const orders = await Order.find(matchStage)
        .populate('customer', 'firstName lastName email')
        .populate('items.product', 'name category sku')
        .sort({ createdAt: -1 })
        .lean();

      if (format === 'csv') {
        let csvContent = '';
        let headers = [];
        let rows = [];

        switch (reportType) {
          case 'orders':
            headers = [
              'Order Number',
              'Date',
              'Customer',
              'Email',
              'Items',
              'Subtotal',
              'Tax',
              'Shipping',
              'Discount',
              'Total',
              'Status',
              'Payment Method',
              'Payment Status'
            ];

            rows = orders.map(order => [
              order.orderNumber,
              order.createdAt.toISOString().split('T')[0],
              `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim(),
              order.customer?.email || '',
              order.items.length,
              `$${order.subtotal.toFixed(2)}`,
              `$${order.tax.toFixed(2)}`,
              `$${order.shipping.toFixed(2)}`,
              `$${order.discount.toFixed(2)}`,
              `$${order.total.toFixed(2)}`,
              order.status,
              order.payment?.method || 'N/A',
              order.payment?.status || 'N/A'
            ]);
            break;

          case 'products':
            headers = [
              'Product Name',
              'SKU',
              'Category',
              'Quantity Sold',
              'Total Revenue',
              'Average Price',
              'Number of Orders'
            ];

            // Aggregate product data
            const productMap = new Map();
            orders.forEach(order => {
              order.items.forEach(item => {
                const productId = item.product?._id?.toString();
                if (!productMap.has(productId)) {
                  productMap.set(productId, {
                    name: item.product?.name || 'Unknown Product',
                    sku: item.product?.sku || 'N/A',
                    category: item.product?.category || 'Uncategorized',
                    quantity: 0,
                    revenue: 0,
                    orderCount: new Set()
                  });
                }
                const productData = productMap.get(productId);
                productData.quantity += item.quantity;
                productData.revenue += item.quantity * item.price;
                productData.orderCount.add(order._id.toString());
              });
            });

            rows = Array.from(productMap.values()).map(product => [
              product.name,
              product.sku,
              product.category,
              product.quantity,
              `$${product.revenue.toFixed(2)}`,
              `$${(product.revenue / product.quantity).toFixed(2)}`,
              product.orderCount.size
            ]);
            break;

          case 'customers':
            headers = [
              'Customer Name',
              'Email',
              'Total Orders',
              'Total Spent',
              'Average Order Value',
              'First Order Date',
              'Last Order Date'
            ];

            const customerMap = new Map();
            orders.forEach(order => {
              const customerId = order.customer?._id?.toString();
              if (customerId) {
                if (!customerMap.has(customerId)) {
                  customerMap.set(customerId, {
                    name: `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim(),
                    email: order.customer?.email || '',
                    orderCount: 0,
                    totalSpent: 0,
                    firstOrder: order.createdAt,
                    lastOrder: order.createdAt
                  });
                }
                const customerData = customerMap.get(customerId);
                customerData.orderCount++;
                customerData.totalSpent += order.total;
                if (order.createdAt < customerData.firstOrder) {
                  customerData.firstOrder = order.createdAt;
                }
                if (order.createdAt > customerData.lastOrder) {
                  customerData.lastOrder = order.createdAt;
                }
              }
            });

            rows = Array.from(customerMap.values()).map(customer => [
              customer.name,
              customer.email,
              customer.orderCount,
              `$${customer.totalSpent.toFixed(2)}`,
              `$${(customer.totalSpent / customer.orderCount).toFixed(2)}`,
              customer.firstOrder.toISOString().split('T')[0],
              customer.lastOrder.toISOString().split('T')[0]
            ]);
            break;
        }

        // Create CSV
        csvContent = [
          headers.join(','),
          ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        // Set response headers
        const filename = `sales-report-${reportType}-${Date.now()}.csv`;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        return res.send(csvContent);

      } else if (format === 'json') {
        // JSON export
        const filename = `sales-report-${reportType}-${Date.now()}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        return res.json({
          success: true,
          reportType,
          dateRange: { startDate, endDate },
          generatedAt: new Date().toISOString(),
          data: orders
        });
      } else {
        throw new HttpError('Unsupported export format', 400);
      }

    } catch (error) {
      console.error('Export error:', error);
      throw new HttpError('Failed to export sales report', 500);
    }
  });

  /**
   * @desc    Get real-time sales dashboard
   * @route   GET /api/sales/dashboard
   * @access  Private/Admin
   */
  static getDashboardData = asyncHandler(async (req, res) => {
    try {
      const today = new Date();
      const startOfToday = new Date(today.setHours(0, 0, 0, 0));
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const startOfYear = new Date(today.getFullYear(), 0, 1);

      // Get counts for different time periods
      const [
        todayOrders,
        weekOrders,
        monthOrders,
        yearOrders,
        pendingOrders,
        processingOrders,
        deliveredOrders,
        revenueStats
      ] = await Promise.all([
        Order.countDocuments({ 
          createdAt: { $gte: startOfToday },
          status: { $in: ['confirmed', 'processing', 'shipped', 'delivered', 'completed'] }
        }),
        Order.countDocuments({ 
          createdAt: { $gte: startOfWeek },
          status: { $in: ['confirmed', 'processing', 'shipped', 'delivered', 'completed'] }
        }),
        Order.countDocuments({ 
          createdAt: { $gte: startOfMonth },
          status: { $in: ['confirmed', 'processing', 'shipped', 'delivered', 'completed'] }
        }),
        Order.countDocuments({ 
          createdAt: { $gte: startOfYear },
          status: { $in: ['confirmed', 'processing', 'shipped', 'delivered', 'completed'] }
        }),
        Order.countDocuments({ status: 'pending' }),
        Order.countDocuments({ status: 'processing' }),
        Order.countDocuments({ status: 'delivered' }),
        Order.aggregate([
          {
            $match: {
              status: { $in: ['confirmed', 'processing', 'shipped', 'delivered', 'completed'] }
            }
          },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: '$total' },
              todayRevenue: {
                $sum: {
                  $cond: [
                    { $gte: ['$createdAt', startOfToday] },
                    '$total',
                    0
                  ]
                }
              },
              weekRevenue: {
                $sum: {
                  $cond: [
                    { $gte: ['$createdAt', startOfWeek] },
                    '$total',
                    0
                  ]
                }
              },
              monthRevenue: {
                $sum: {
                  $cond: [
                    { $gte: ['$createdAt', startOfMonth] },
                    '$total',
                    0
                  ]
                }
              },
              avgOrderValue: { $avg: '$total' }
            }
          }
        ])
      ]);

      // Get recent orders
      const recentOrders = await Order.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('customer', 'firstName lastName email')
        .lean();

      // Get top products
      const topProducts = await Order.aggregate([
        {
          $match: {
            status: { $in: ['confirmed', 'processing', 'shipped', 'delivered', 'completed'] }
          }
        },
        { $unwind: '$items' },
        {
          $lookup: {
            from: 'products',
            localField: 'items.product',
            foreignField: '_id',
            as: 'productDetails'
          }
        },
        { $unwind: '$productDetails' },
        {
          $group: {
            _id: '$items.product',
            name: { $first: '$productDetails.name' },
            salesCount: { $sum: '$items.quantity' },
            revenue: { 
              $sum: { 
                $multiply: ['$items.quantity', '$items.price'] 
              } 
            }
          }
        },
        { $sort: { revenue: -1 } },
        { $limit: 5 }
      ]);

      const revenueData = revenueStats[0] || {
        totalRevenue: 0,
        todayRevenue: 0,
        weekRevenue: 0,
        monthRevenue: 0,
        avgOrderValue: 0
      };

      res.json({
        success: true,
        dashboard: {
          overview: {
            todayOrders,
            weekOrders,
            monthOrders,
            yearOrders,
            pendingOrders,
            processingOrders,
            deliveredOrders
          },
          revenue: {
            total: revenueData.totalRevenue,
            today: revenueData.todayRevenue,
            week: revenueData.weekRevenue,
            month: revenueData.monthRevenue,
            average: revenueData.avgOrderValue
          },
          recentOrders: recentOrders.map(order => ({
            id: order._id,
            orderNumber: order.orderNumber,
            customer: order.customer,
            total: order.total,
            status: order.status,
            date: order.createdAt
          })),
          topProducts: topProducts.map(product => ({
            id: product._id,
            name: product.name,
            salesCount: product.salesCount,
            revenue: product.revenue
          }))
        }
      });

    } catch (error) {
      console.error('Dashboard error:', error);
      throw new HttpError('Failed to get dashboard data', 500);
    }
  });

  // Helper method for manual aggregation when category filter is applied
  static aggregateManual(orders, period, limit) {
    const aggregated = {};
    
    orders.forEach(order => {
      const date = new Date(order.createdAt);
      let key = '';
      
      switch (period) {
        case 'daily':
          key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
          break;
        case 'weekly':
          const week = Math.ceil(date.getDate() / 7);
          key = `${date.getFullYear()}-W${week}`;
          break;
        case 'yearly':
          key = date.getFullYear().toString();
          break;
        default:
          key = `${date.getFullYear()}-${date.getMonth() + 1}`;
      }
      
      if (!aggregated[key]) {
        aggregated[key] = {
          revenue: 0,
          orders: 0,
          items: 0,
          date: date
        };
      }
      
      aggregated[key].revenue += order.total;
      aggregated[key].orders += 1;
      aggregated[key].items += order.itemCount || 0;
    });
    
    // Convert to array and sort
    return Object.entries(aggregated)
      .map(([key, data]) => ({
        ...data,
        key
      }))
      .sort((a, b) => a.date - b.date)
      .slice(0, limit);
  }

  // Helper method to calculate growth percentages
  static calculateGrowth(data) {
    return data.map((item, index, array) => {
      if (index === 0) {
        return { ...item, growth: 0 };
      }
      const previous = array[index - 1];
      const growth = previous.revenue > 0 
        ? ((item.revenue - previous.revenue) / previous.revenue) * 100 
        : (item.revenue > 0 ? 100 : 0);
      return { ...item, growth: parseFloat(growth.toFixed(2)) };
    });
  }
}

module.exports = SalesReportController;