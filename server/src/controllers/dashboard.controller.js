import mongoose from 'mongoose';
import Order, { ORDER_STATUSES } from '../models/Order.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import PackingSession from '../models/PackingSession.js';
import StaffActivityLog from '../models/StaffActivityLog.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { accountingDay, shiftAccountingDate } from '../utils/accountingDay.js';

const percentChange = (current, previous) => {
  if (previous === 0) return current === 0 ? 0 : null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
};
const openStatuses = ORDER_STATUSES.filter((status) => !['delivered', 'cancelled', 'rejected'].includes(status));

const ownerDashboard = async (tenantId, timeZone) => {
  const tenantObjectId = new mongoose.Types.ObjectId(tenantId);
  const today = accountingDay(undefined, timeZone);
  const yesterday = accountingDay(shiftAccountingDate(today.businessDate, -1), timeZone);
  const salesMatch = (range) => ({
    tenantId: tenantObjectId,
    status: 'delivered',
    deliveredAt: { $gte: range.start, $lt: range.end },
  });
  const orderMatch = (range) => ({
    tenantId,
    status: { $nin: ['cancelled', 'rejected'] },
    createdAt: { $gte: range.start, $lt: range.end },
  });

  const [
    [todaySales],
    [yesterdaySales],
    todayOrders,
    yesterdayOrders,
    productCount,
    staffCount,
    recentOrders,
    [pending],
    [stock],
  ] = await Promise.all([
    Order.aggregate([
      { $match: salesMatch(today) },
      { $group: { _id: null, revenue: { $sum: '$pricing.grandTotal' } } },
    ]),
    Order.aggregate([
      { $match: salesMatch(yesterday) },
      { $group: { _id: null, revenue: { $sum: '$pricing.grandTotal' } } },
    ]),
    Order.countDocuments(orderMatch(today)),
    Order.countDocuments(orderMatch(yesterday)),
    Product.countDocuments({ tenantId, isActive: true }),
    User.countDocuments({
      tenantId, role: { $in: ['staff', 'packer', 'delivery'] }, isActive: true,
    }),
    Order.find({ tenantId })
      .select('orderNumber customerInfo.name pricing.grandTotal status createdAt')
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
    Order.aggregate([
      { $match: { tenantId: tenantObjectId, status: { $in: openStatuses } } },
      { $facet: {
        count: [{ $count: 'total' }],
        orders: [
          { $sort: { createdAt: -1, _id: -1 } },
          { $limit: 8 },
          { $project: { orderNumber: 1, 'customerInfo.name': 1, 'pricing.grandTotal': 1, status: 1, createdAt: 1 } },
        ],
      } },
    ]),
    Product.aggregate([
      { $match: { tenantId: tenantObjectId, isActive: true } },
      { $unwind: '$variants' },
      { $match: {
        'variants.isActive': true,
        $expr: { $lte: ['$variants.stock', '$variants.lowStockLimit'] },
      } },
      { $project: {
        name: 1,
        image: { $ifNull: [{ $arrayElemAt: ['$images.url', 0] }, null] },
        variantId: '$variants._id',
        variantName: '$variants.name',
        unit: '$variants.unit',
        stock: '$variants.stock',
        lowStockLimit: '$variants.lowStockLimit',
      } },
      { $facet: {
        count: [{ $count: 'total' }],
        variants: [{ $sort: { stock: 1, name: 1 } }, { $limit: 8 }],
      } },
    ]),
  ]);

  const revenueToday = Number((todaySales?.revenue || 0).toFixed(2));
  const revenueYesterday = Number((yesterdaySales?.revenue || 0).toFixed(2));
  return {
    kpis: {
      revenueToday,
      revenueYesterday,
      revenueChange: percentChange(revenueToday, revenueYesterday),
      ordersToday: todayOrders,
      ordersYesterday: yesterdayOrders,
      ordersChange: percentChange(todayOrders, yesterdayOrders),
      productCount,
      activeStaffCount: staffCount,
      pendingOrderCount: pending.count[0]?.total ?? 0,
      lowStockCount: stock.count[0]?.total ?? 0,
    },
    recentOrders,
    pendingOrders: pending.orders,
    lowStock: stock.variants,
  };
};

const staffDashboard = async (tenantId, user, timeZone) => {
  const today = accountingDay(undefined, timeZone);
  const base = {
    tenantId,
    assignedTo: user._id,
    createdAt: { $gte: today.start, $lt: today.end },
  };
  const [sales, ordersToday, pendingOrders, packingStats, activePacking] = await Promise.all([
    user.role === 'staff'
      ? Order.aggregate([
        { $match: {
          tenantId: new mongoose.Types.ObjectId(tenantId),
          assignedTo: user._id,
          orderType: 'counter',
          status: 'delivered',
          createdAt: base.createdAt,
        } },
        { $group: { _id: null, revenue: { $sum: '$pricing.grandTotal' } } },
      ])
      : Promise.resolve([]),
    user.role === 'staff'
      ? Order.countDocuments({ ...base, orderType: 'counter', status: { $nin: ['cancelled', 'rejected'] } })
      : Promise.resolve(0),
    Order.find({
      tenantId,
      assignedTo: user._id,
      status: { $in: ['pending', 'payment_pending', 'payment_submitted', 'accepted', 'payment_verified', 'packing', 'packed'] },
    })
      .select('orderNumber customerInfo.name pricing.grandTotal status items.quantity createdAt')
      .sort({ createdAt: 1 })
      .limit(10)
      .lean(),
    StaffActivityLog.aggregate([
      { $match: {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        staffId: user._id,
        createdAt: { $gte: today.start, $lt: today.end },
      } },
      { $group: {
        _id: null,
        itemsPacked: { $sum: { $cond: [{ $eq: ['$action', 'item_packed'] }, '$qty', 0] } },
        completedSessions: { $sum: { $cond: [{ $eq: ['$action', 'packing_completed'] }, 1, 0] } },
      } },
    ]),
    PackingSession.countDocuments({
      tenantId, staffId: user._id, status: { $in: ['in_progress', 'completed'] },
    }),
  ]);
  return {
    stats: {
      salesToday: Number((sales[0]?.revenue || 0).toFixed(2)),
      ordersToday,
      itemsPacked: packingStats[0]?.itemsPacked || 0,
      completedPackingSessions: packingStats[0]?.completedSessions || 0,
      activePacking,
      assignedOrders: pendingOrders.length,
    },
    pendingOrders: pendingOrders.map((order) => ({
      ...order,
      itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
      items: undefined,
    })),
  };
};

const deliveryDashboard = async (tenantId, user, timeZone) => {
  const today = accountingDay(undefined, timeZone);
  const [assigned, deliveredToday] = await Promise.all([
    Order.find({
      tenantId,
      deliveryAssignedTo: user._id,
      status: { $in: ['pending', 'payment_pending', 'payment_submitted', 'payment_verified', 'accepted', 'packing', 'packed', 'partially_fulfilled', 'out_for_delivery'] },
    })
      .select('orderNumber customerInfo.name pricing.grandTotal status createdAt')
      .sort({ createdAt: 1 })
      .limit(10)
      .lean(),
    Order.countDocuments({
      tenantId,
      deliveryAssignedTo: user._id,
      status: 'delivered',
      deliveredAt: { $gte: today.start, $lt: today.end },
    }),
  ]);
  return { stats: { assignedOrders: assigned.length, deliveredToday }, pendingOrders: assigned };
};

export const getDashboard = asyncHandler(async (req, res) => {
  let dashboard;
  if (req.user.role === 'store_owner') dashboard = await ownerDashboard(req.tenantId, req.storeTimeZone);
  else if (req.user.role === 'delivery') dashboard = await deliveryDashboard(req.tenantId, req.user, req.storeTimeZone);
  else dashboard = await staffDashboard(req.tenantId, req.user, req.storeTimeZone);
  sendSuccess(res, dashboard);
});
