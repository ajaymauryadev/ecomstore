const prefix = 'smart-kirana:cart:v1:';
const productIdPattern = /^[a-f0-9]{24}$/;
const couponCodePattern = /^[A-Z0-9_-]{2,40}$/;

export function cartDraftKey(storeId, userId) {
  if (!storeId) return null;
  const scope = userId ? 'account:' + encodeURIComponent(userId) : 'guest';
  return prefix + encodeURIComponent(storeId) + ':' + scope;
}

// Checkout accepts at most 100 lines and 1,000 units per variant.
export function cartDraftLines(items) {
  const lines = new Map();
  if (!Array.isArray(items)) return [];
  for (const item of items.slice(0, 100)) {
    const { productId, variantId, quantity } = item || {};
    if (typeof productId !== 'string' || !productIdPattern.test(productId) ||
        typeof variantId !== 'string' || !productIdPattern.test(variantId) ||
        !Number.isSafeInteger(quantity) || quantity < 1) continue;
    const key = productId + ':' + variantId;
    const units = Math.min((lines.get(key)?.quantity || 0) + quantity, 1000);
    lines.set(key, { productId, variantId, quantity: units });
  }
  return [...lines.values()];
}

function makeDraft(items, deliveryType, couponCode) {
  const code = typeof couponCode === 'string' ? couponCode.trim().toUpperCase() : '';
  return {
    items: cartDraftLines(items),
    deliveryType: deliveryType === 'self_pickup' ? 'self_pickup' : 'home_delivery',
    ...(couponCodePattern.test(code) && { couponCode: code }),
  };
}

export function readCartDraft(key) {
  try {
    const draft = JSON.parse(window.localStorage.getItem(key) || window.sessionStorage.getItem(key));
    if (draft) return makeDraft(draft.items, draft.deliveryType, draft.couponCode);
  } catch { /* Storage may be unavailable or contain an invalid draft. */ }
  return null;
}

export function removeCartDraft(key) {
  if (!key) return;
  try { window.sessionStorage.removeItem(key); } catch { /* Cart still works in memory. */ }
  try { window.localStorage.removeItem(key); window.localStorage.removeItem(key + ':snapshot'); } catch { /* Storage notice is handled by shared persistence. */ }
}

export function readCartSnapshot(key, draft) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key + ':snapshot'));
    if (!Array.isArray(saved)) return null;
    const items = draft.items.map((line) => {
      const item = saved.find((row) => row.productId === line.productId && row.variantId === line.variantId);
      return item && Number.isFinite(item.price) && item.price > 0 ? { ...item, quantity: line.quantity } : null;
    });
    return items.every(Boolean) ? items : null;
  } catch { return null; }
}

export function writeCartDraft(cart) {
  const draft = makeDraft(cart.items, cart.deliveryType, cart.coupon?.code || cart.pendingCouponCode);
  if (!draft.items.length) {
    removeCartDraft(cart.scopeKey);
    return;
  }
  try {
    window.sessionStorage.setItem(cart.scopeKey, JSON.stringify(draft));
    window.localStorage.setItem(cart.scopeKey, JSON.stringify(draft));
    window.localStorage.setItem(cart.scopeKey + ':snapshot', JSON.stringify(cart.items));
  } catch {
    window.dispatchEvent(new Event('saved-cart-storage-error'));
  }
}

export function clearGuestCartDrafts() {
  try {
    for (const storage of [window.sessionStorage, window.localStorage]) {
      for (let index = storage.length - 1; index >= 0; index--) {
        const key = storage.key(index);
        if (key?.startsWith(prefix) && /:guest(:snapshot)?$/.test(key)) storage.removeItem(key);
      }
    }
  } catch { /* Cart still works in memory. */ }
}

export function transferGuestCart(cart, storeId, userId) {
  const guestKey = cartDraftKey(storeId, null);
  if (!guestKey || !userId) return;
  const guest = cart.scopeKey === guestKey && cart.status === 'ready'
    ? makeDraft(cart.items, cart.deliveryType, cart.coupon?.code)
    : readCartDraft(guestKey);
  if (!guest?.items.length) return;

  const accountKey = cartDraftKey(storeId, userId);
  const account = readCartDraft(accountKey);
  const code = guest.couponCode || account?.couponCode;
  writeCartDraft({
    scopeKey: accountKey,
    items: [...guest.items, ...(account?.items ?? [])],
    deliveryType: guest.deliveryType,
    coupon: code ? { code } : null,
  });
  removeCartDraft(guestKey);
}
