const keyFor = (slug, orderId) => `smart-kirana:guest-order:${slug}:${orderId}`;

export const saveGuestOrderToken = (slug, orderId, token) => {
  if (!slug || !orderId || !token) return;
  try { window.sessionStorage.setItem(keyFor(slug, orderId), token); } catch { /* Storage can be disabled by browser privacy controls. */ }
};

export const getGuestOrderToken = (slug, orderId) => {
  try { return window.sessionStorage.getItem(keyFor(slug, orderId)); } catch { return null; }
};

export const clearGuestOrderToken = (slug, orderId) => {
  try { window.sessionStorage.removeItem(keyFor(slug, orderId)); } catch { /* Storage can be disabled by browser privacy controls. */ }
};
