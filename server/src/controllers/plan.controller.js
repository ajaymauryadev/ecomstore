import Plan from '../models/Plan.js';
import Store from '../models/Store.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess } from '../utils/response.js';
import { ALL_MODULES } from '../models/Plan.js';

const PLAN_FIELDS = [
  'name', 'displayName', 'description', 'price', 'billingCycle', 'trialDays',
  'durationDays', 'limits', 'modules', 'isActive', 'isPublic', 'sortOrder',
  'color', 'badge',
];

const planPayload = (body) => Object.fromEntries(
  PLAN_FIELDS.filter((field) => body[field] !== undefined).map((field) => [field, body[field]])
);

export const getPlans = asyncHandler(async (req, res) => {
  const plans = await Plan.find().sort({ sortOrder: 1 }).lean();
  sendSuccess(res, { plans });
});

export const createPlan = asyncHandler(async (req, res) => {
  const plan = await Plan.create(planPayload(req.body));
  sendSuccess(res, { plan }, 201);
});

export const updatePlan = asyncHandler(async (req, res, next) => {
  const plan = await Plan.findByIdAndUpdate(req.params.id, planPayload(req.body), { new: true, runValidators: true });
  if (!plan) return next(new AppError('Plan not found.', 404));
  sendSuccess(res, { plan });
});

export const deletePlan = asyncHandler(async (req, res, next) => {
  const inUse = await Store.countDocuments({ 'subscription.planId': req.params.id });
  if (inUse > 0) return next(new AppError(`Plan is in use by ${inUse} store(s). Cannot delete.`, 400));
  await Plan.findByIdAndDelete(req.params.id);
  sendSuccess(res, { message: 'Plan deleted.' });
});

export const seedDefaultPlans = asyncHandler(async (req, res) => {
  const defaults = [
    {
      name: 'trial', displayName: 'Trial', description: '30-day free trial', price: 0,
      durationDays: 30, trialDays: 30, sortOrder: 0, color: '#94a3b8', badge: 'Free',
      limits: { maxProducts: 50, maxOrdersPerMonth: 100, maxStaff: 2, maxStorageGB: 0.5, maxCustomers: 200 },
      modules: ['pos', 'inventory', 'storefront'],
    },
    {
      name: 'basic', displayName: 'Basic', description: 'Perfect for small kirana stores', price: 499,
      billingCycle: 'monthly', durationDays: 30, sortOrder: 1, color: '#3b82f6', badge: 'Popular',
      limits: { maxProducts: 500, maxOrdersPerMonth: 1000, maxStaff: 5, maxStorageGB: 2, maxCustomers: 1000 },
      modules: ['pos', 'inventory', 'purchases', 'suppliers', 'storefront', 'returns', 'daily_closing'],
    },
    {
      name: 'premium', displayName: 'Premium', description: 'Full-featured for growing stores', price: 999,
      billingCycle: 'monthly', durationDays: 30, sortOrder: 2, color: '#f59e0b', badge: 'Best Value',
      limits: { maxProducts: 5000, maxOrdersPerMonth: 10000, maxStaff: 20, maxStorageGB: 10, maxCustomers: 10000 },
      modules: ALL_MODULES,
    },
    {
      name: 'enterprise', displayName: 'Enterprise', description: 'Unlimited everything for large operations', price: 2999,
      billingCycle: 'monthly', durationDays: 30, sortOrder: 3, color: '#a855f7', badge: 'Unlimited',
      limits: { maxProducts: 999999, maxOrdersPerMonth: 999999, maxStaff: 999, maxStorageGB: 100, maxCustomers: 999999 },
      modules: ALL_MODULES,
    },
  ];

  const results = [];
  for (const p of defaults) {
    const existing = await Plan.findOne({ name: p.name });
    if (!existing) {
      results.push(await Plan.create(p));
    } else {
      results.push(existing);
    }
  }
  sendSuccess(res, { plans: results, message: 'Default plans seeded.' });
});
