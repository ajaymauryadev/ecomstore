// These names match RTK Query's cache tags. Keep dependencies explicit so a
// small write never turns into a download of every saved workspace screen.
const orders = ['Order', 'Packing', 'Delivery', 'Dashboard', 'Reports', 'Notification', 'AuditLog'];
const stock = ['Product', 'Inventory', 'StockLedger', 'Dashboard', 'Reports', 'Notification', 'AuditLog'];
const accounting = ['Reports', 'Dashboard', 'DailyClosing', 'AuditLog'];

export function changeTags(pathname) {
  const path = pathname.replace(/^\/api\/v1\//, '');
  if (path.startsWith('notifications')) return ['Notification'];
  if (/^storefront\/[^/]+\/(?:admin\/)?orders(?:\/|$)/.test(path)) {
    return [...new Set([...orders, ...stock, ...accounting, 'Transaction', 'POS', 'Udhar', 'CustomerProfile', 'Coupon'])];
  }
  if (/^storefront\/[^/]+\/customer(?:\/|$)/.test(path)) return ['CustomerProfile', 'Favorites'];
  if (/^storefront\/[^/]+\/auth\/(?:register|login)(?:\/|$)/.test(path)) return ['CustomerProfile', 'CurrentUser'];
  if (/^packing\/session\/[^/]+\/item\//.test(path)) return ['Packing', 'Notification'];
  if (/^packing\/admin\/session\/[^/]+\/verify$/.test(path)) return [...new Set([...orders, ...stock, ...accounting, 'Udhar'])];
  const resource = path.split('/')[0];
  const tags = {
    products: [...stock, 'Category'],
    inventory: stock,
    categories: ['Category', 'Product', 'Inventory', 'AuditLog'],
    packing: orders,
    delivery: [...orders, ...accounting, 'Transaction'],
    pos: [...orders, ...stock, ...accounting, 'POS', 'Udhar', 'Transaction'],
    purchases: [...stock, ...accounting, 'Purchase', 'Supplier'],
    suppliers: ['Supplier', 'Purchase', ...accounting],
    returns: [...orders, ...stock, ...accounting, 'Return', 'Udhar', 'Supplier', 'Purchase', 'Transaction'],
    udhar: ['Udhar', 'Order', 'POS', 'Transaction', ...accounting],
    expenses: ['Expense', ...accounting],
    salary: ['Salary', ...accounting],
    'daily-closing': ['DailyClosing', 'Reports', 'AuditLog'],
    users: ['Staff', 'CurrentUser', 'Packing', 'Delivery', 'AuditLog'],
    stores: ['Store', 'CurrentUser', 'Product', 'Order', 'Dashboard', 'SuperAdmin', 'AuditLog'],
    coupons: ['Coupon', 'AuditLog'],
    offers: ['Offer', 'Product', 'AuditLog'],
    plans: ['Plan', 'Store', 'SuperAdmin', 'AuditLog'],
    'super-admin': ['SuperAdmin', 'Store', 'Plan', 'CurrentUser', 'AuditLog'],
    auth: ['CurrentUser', 'AuditLog'],
    upload: [], // Upload bytes are not catalog changes until the record is saved.
  }[resource];
  // Restores and new/unclassified write routes must never leave stale data.
  return [...new Set(tags ?? ['All'])];
}
