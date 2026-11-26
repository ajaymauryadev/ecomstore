import { expect, test } from 'vitest';
import { notificationTarget } from './notificationTarget';

test('customer notification links stay in their storefront order tracking route', () => {
  const customer = { role: 'customer' };
  expect(notificationTarget(customer, { type: 'order_accepted', data: { orderId: 'order-123' } }, 'local-store'))
    .toBe('/s/local-store/orders/order-123');
  expect(notificationTarget(customer, { type: 'low_stock', data: {} }, 'local-store')).toBeNull();
  expect(notificationTarget(customer, { data: { orderId: 'order-123' } })).toBeNull();
});
