import Product from '../models/Product.js';
import StockLedger from '../models/StockLedger.js';
import Return, { ACTIVE_RETURN_STATUSES } from '../models/Return.js';
import { AppError } from '../utils/AppError.js';
import { assertPositiveInteger } from '../utils/money.js';

const getVariantStock = async ({ tenantId, productId, variantId, session }) => {
  const product = await Product.findOne({ _id: productId, tenantId, 'variants._id': variantId })
    .select('variants')
    .session(session);
  const variant = product?.variants.id(variantId);
  if (!variant || !Number.isFinite(variant.stock)) throw new AppError('Stock record is unavailable.', 409);
  return variant.stock;
};

export const reserveOrderStock = async ({ tenantId, order, actorId, session, movementType = 'ORDER_RESERVED' }) => {
  const ledgerRows = [];
  for (const item of order.items) {
    const quantity = assertPositiveInteger(item.quantity, 'order item quantity', 1000);
    const result = await Product.updateOne(
      {
        _id: item.productId,
        tenantId,
        variants: {
          $elemMatch: { _id: item.variantId, isActive: true, stock: { $gte: quantity } },
        },
      },
      { $inc: { 'variants.$[variant].stock': -quantity } },
      { arrayFilters: [{ 'variant._id': item.variantId }], session }
    );
    if (result.modifiedCount !== 1) {
      throw new AppError(`Insufficient stock for ${item.name} (${item.variantName}).`, 409);
    }

    const balanceBefore = Number(item.stockBefore ?? await getVariantStock({
      tenantId, productId: item.productId, variantId: item.variantId, session,
    }) + quantity);
    ledgerRows.push({
      tenantId,
      productId: item.productId,
      variantId: item.variantId,
      movementType,
      quantityChange: -quantity,
      balanceBefore,
      balanceAfter: balanceBefore - quantity,
      referenceId: order._id,
      referenceType: 'Order',
      note: `${movementType === 'ORDER_SOLD' ? 'Sale' : 'Stock reserved'} for ${order.orderNumber}`,
      createdBy: actorId,
    });
  }
  if (ledgerRows.length) await StockLedger.create(ledgerRows, { session, ordered: true });
};

export const restoreOrderStock = async ({ order, tenantId, actorId, session, note }) => {
  if (order.stockReservationState === 'restored' || order.stockReservationState === 'none') return false;
  if (order.stockReservationState === 'consumed') {
    throw new AppError('Consumed stock cannot be restored by order cancellation.', 409);
  }
  if (await Return.exists({
    tenantId, orderId: order._id, status: { $in: ACTIVE_RETURN_STATUSES },
  }).session(session)) {
    throw new AppError('An order with active returns cannot be cancelled.', 409);
  }

  const ledgerRows = [];
  for (const item of order.items) {
    const alreadyRestored = Number(item.restoredQty || 0);
    const quantity = Number(item.quantity) - alreadyRestored;
    if (!Number.isSafeInteger(quantity) || quantity < 0) throw new AppError('Order stock state is invalid.', 409);
    if (quantity === 0) continue;
    const balanceBefore = await getVariantStock({
      tenantId, productId: item.productId, variantId: item.variantId, session,
    });
    const result = await Product.updateOne(
      { _id: item.productId, tenantId, 'variants._id': item.variantId },
      { $inc: { 'variants.$[variant].stock': quantity } },
      { arrayFilters: [{ 'variant._id': item.variantId }], session }
    );
    if (result.modifiedCount !== 1) throw new AppError('Unable to restore reserved stock.', 409);
    item.restoredQty = alreadyRestored + quantity;
    ledgerRows.push({
      tenantId,
      productId: item.productId,
      variantId: item.variantId,
      movementType: 'ORDER_CANCEL_RESTORE',
      quantityChange: quantity,
      balanceBefore,
      balanceAfter: balanceBefore + quantity,
      referenceId: order._id,
      referenceType: 'Order',
      note: note || `Stock restored for ${order.orderNumber}`,
      createdBy: actorId,
    });
  }

  order.stockReservationState = 'restored';
  order.stockRestoredAt = new Date();
  await order.save({ session });
  if (ledgerRows.length) await StockLedger.create(ledgerRows, { session, ordered: true });
  return true;
};

export const restoreUnfulfilledStock = async ({ order, fulfilledQuantities, tenantId, actorId, session, note }) => {
  if (!['reserved'].includes(order.stockReservationState)) {
    throw new AppError('Order stock is not in a restorable state.', 409);
  }

  const ledgerRows = [];
  for (const item of order.items) {
    const requested = fulfilledQuantities.get(String(item.variantId));
    const fulfilledQty = requested == null ? item.quantity : Number(requested);
    if (!Number.isSafeInteger(fulfilledQty) || fulfilledQty < 0 || fulfilledQty > item.quantity) {
      throw new AppError('Fulfilled quantities must be whole numbers within the ordered quantity.', 400);
    }

    const desiredRestored = item.quantity - fulfilledQty;
    const alreadyRestored = Number(item.restoredQty || 0);
    if (desiredRestored < alreadyRestored) {
      throw new AppError('A previously restored quantity cannot be fulfilled again.', 409);
    }
    const restoreNow = desiredRestored - alreadyRestored;
    item.fulfilledQty = fulfilledQty;
    if (restoreNow === 0) continue;

    const balanceBefore = await getVariantStock({
      tenantId, productId: item.productId, variantId: item.variantId, session,
    });
    const result = await Product.updateOne(
      { _id: item.productId, tenantId, 'variants._id': item.variantId },
      { $inc: { 'variants.$[variant].stock': restoreNow } },
      { arrayFilters: [{ 'variant._id': item.variantId }], session }
    );
    if (result.modifiedCount !== 1) throw new AppError('Unable to restore unfulfilled stock.', 409);
    item.restoredQty = desiredRestored;
    ledgerRows.push({
      tenantId,
      productId: item.productId,
      variantId: item.variantId,
      movementType: 'ORDER_CANCEL_RESTORE',
      quantityChange: restoreNow,
      balanceBefore,
      balanceAfter: balanceBefore + restoreNow,
      referenceId: order._id,
      referenceType: 'Order',
      note: note || `Unfulfilled stock restored for ${order.orderNumber}`,
      createdBy: actorId,
    });
  }

  await order.save({ session });
  if (ledgerRows.length) await StockLedger.create(ledgerRows, { session, ordered: true });
};

export const consumeOrderReservation = async ({ order, session }) => {
  if (order.stockReservationState === 'consumed') return false;
  if (order.stockReservationState !== 'reserved') {
    throw new AppError('Order stock reservation is not available to consume.', 409);
  }
  order.stockReservationState = 'consumed';
  await order.save({ session });
  return true;
};
