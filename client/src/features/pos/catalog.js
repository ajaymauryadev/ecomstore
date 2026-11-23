// Keep the first counter screen small; RTK Query reuses this exact request on warmup.
export const POS_CATALOG_PARAMS = Object.freeze({ isActive: true, limit: 24, sortBy: 'name' });
export const EMPTY_PRODUCTS = Object.freeze([]);

export function matchesProduct(product, search) {
  const term = search.trim().toLocaleLowerCase();
  if (!term) return true;
  return [product.name, product.brand, ...(product.tags || []),
    ...(product.variants || []).flatMap((v) => [v.name, v.sku, v.barcode])]
    .some((value) => String(value || '').toLocaleLowerCase().includes(term));
}

export function mergeCatalog(local, remote, search) {
  // Fresh server values replace cached values, including stock and prices.
  return [...new Map([...local, ...remote].map((p) => [p._id, p])).values()]
    .filter((p) => matchesProduct(p, search));
}
