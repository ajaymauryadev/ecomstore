import UdharCustomer from '../models/UdharCustomer.js';
import UdharEntry from '../models/UdharEntry.js';
import Order from '../models/Order.js';
import { ensureCustomerAllocations, allocationPreview, applyAllocations, postDebitLot } from './udharAllocation.service.js';
import { AppError } from '../utils/AppError.js';
import { fromMinorUnits, toMinorUnits } from '../utils/money.js';

const posCustomerError = (message, status, field = 'customerPhone') =>
  new AppError(message, status, [{ field, message }]);

export const resolvePOSUdharCustomer = async ({ tenantId, customerId, phone, session = null }) => {
  const filter = { tenantId, isActive: true };
  if (customerId) filter._id = customerId;
  else filter.phone = phone;

  const matches = await UdharCustomer.find(filter).limit(2).session(session);
  if (matches.length === 0) {
    throw posCustomerError('No active Udhar account found at this store. Choose an existing account.', 404);
  }
  if (matches.length > 1) {
    throw posCustomerError('Multiple active Udhar accounts use this number. Choose an explicit account or ask an admin to update the records.', 409);
  }

  const [customer] = matches;
  if (!/^[6-9]\d{9}$/.test(customer.phone ?? '')) {
    throw posCustomerError('The selected Udhar account needs a valid mobile number.', 409);
  }
  if (phone && customer.phone !== phone) {
    throw posCustomerError('The selected Udhar account no longer matches this mobile number.', 409);
  }
  return customer;
};

export const recordUdharEntry = async ({
  customer, type, amountMinor, method, description, referenceType = 'manual', referenceId = null,
  actor, date, session,
  targetOrderId, paymentSubmission,
}) => {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new AppError('Udhar entry amount must be at least one paisa and within the supported range.', 400);
  }
  await ensureCustomerAllocations(customer, session);
  const adjustment = type === 'credit' && ['order', 'pos_order'].includes(referenceType);
  const allocations = type === 'credit' ? await allocationPreview(customer, amountMinor,
    adjustment ? referenceId : targetOrderId, session, { allowClosed: adjustment }) : undefined;
  const balanceMinor = toMinorUnits(customer.balance, 'customer balance');
  const nextMinor = type === 'debit' ? balanceMinor + amountMinor : balanceMinor - amountMinor;
  if (!Number.isSafeInteger(nextMinor)) throw new AppError('Customer balance exceeds the supported amount range.', 400);
  if (nextMinor < 0) {
    const message = referenceType === 'pos_order'
      ? 'The Udhar balance is lower than the bill adjustment. Reconcile the customer payment before changing this order.'
      : 'Payment cannot exceed the outstanding balance.';
    throw new AppError(message, 409);
  }

  const [entry] = await UdharEntry.create([{
    tenantId: customer.tenantId,
    customerId: customer._id,
    type,
    amount: fromMinorUnits(amountMinor),
    method,
    description,
    referenceType,
    referenceId,
    balanceAfter: fromMinorUnits(nextMinor),
    recordedBy: actor._id,
    recordedByName: actor.name,
    recordedByRole: actor.role,
    date,
    ...(type === 'debit' ? { remainingAmount: fromMinorUnits(amountMinor) } : {
      allocations, allocationMode: adjustment ? 'adjustment' : targetOrderId ? 'bill' : 'oldest_first',
    }),
    targetOrderId,
    paymentSubmission,
  }], { session });
  if (type === 'debit') await postDebitLot(customer, entry, session);
  else await applyAllocations(customer, allocations, { adjustment, date: entry.date, actor }, session);
  customer.balance = fromMinorUnits(nextMinor);
  await customer.save({ session });
  return entry;
};

export const adjustPOSUdharBalance = async ({ order, amountChangeMinor, actor, description, session }) => {
  if (!order.udharCustomerId || amountChangeMinor === 0) return;
  if (order.udharAmount === 0) return;
  const upfrontMinor = (order.checkoutPayments || []).reduce((sum, payment) => sum + toMinorUnits(payment.amount), 0);
  if (['cancelled', 'rejected'].includes(order.status)) {
    amountChangeMinor = -Math.max(0, toMinorUnits(order.pricing.grandTotal) - upfrontMinor);
  }
  if (!amountChangeMinor) return;
  if (amountChangeMinor < 0) {
    const currentCustomer = await UdharCustomer.findOne({ _id: order.udharCustomerId, tenantId: order.tenantId }).session(session);
    if (!currentCustomer) throw new AppError('Customer not found.', 409);
    await ensureCustomerAllocations(currentCustomer, session);
    const current = await Order.findOne({ _id: order._id, tenantId: order.tenantId }).session(session);
    const pendingMinor = toMinorUnits(current?.settlement?.pending || 0);
    if (-amountChangeMinor > pendingMinor) {
      throw new AppError('This bill already has payments. Reconcile its payments before reducing the bill beyond its pending Udhar.', 409);
    }
  }
  const customer = await UdharCustomer.findOne({
    _id: order.udharCustomerId, tenantId: order.tenantId,
  }).session(session);
  if (!customer) throw new AppError('The Udhar account linked to this bill could not be found.', 409);

  await recordUdharEntry({
    customer,
    type: amountChangeMinor > 0 ? 'debit' : 'credit',
    amountMinor: Math.abs(amountChangeMinor),
    description,
    referenceType: 'pos_order',
    referenceId: order._id,
    actor,
    session,
  });
};
