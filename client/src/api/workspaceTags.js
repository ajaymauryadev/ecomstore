export const stockViewTags = (productIds = []) => [
  { type: 'Product', id: 'LIST' }, { type: 'Product', id: 'PUBLIC' },
  { type: 'Inventory' }, { type: 'Dashboard', id: 'CURRENT' }, { type: 'Reports', id: 'stock' },
  ...(productIds.length ? [...new Set(productIds)].flatMap((id) => [
    { type: 'Product', id }, { type: 'StockLedger', id },
  ]) : [{ type: 'Product' }, { type: 'StockLedger' }]),
];

export const orderViewTags = (orderId) => [
  { type: 'Order', id: 'LIST' }, { type: 'Order', id: 'ADMIN_LIST' },
  { type: 'Order', id: 'PAYMENT_QUEUE' }, { type: 'Dashboard', id: 'CURRENT' },
  { type: 'Reports' }, { type: 'Packing', id: 'MY_ORDERS' },
  { type: 'Packing', id: 'ADMIN_QUEUE' }, { type: 'Delivery', id: 'LIST' },
  ...(orderId ? [{ type: 'Order', id: orderId }, { type: 'Order', id: `admin-${orderId}` }] : []),
];

export const soldProductIds = (items) => (items ?? []).map((item) => item.productId).filter(Boolean);
