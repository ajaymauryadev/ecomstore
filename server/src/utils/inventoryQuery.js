// Preserve the product-level stock filters without transferring the catalog to Node.
// A product may match both low and out of stock when different variants qualify.
export function inventoryStockExpression(status) {
  if (!['low_stock', 'out_of_stock', 'in_stock'].includes(status)) return null;
  const low = { $and: [{ $gt: ['$$variant.stock', 0] }, { $lte: ['$$variant.stock', '$$variant.lowStockLimit'] }] };
  const out = { $lte: ['$$variant.stock', 0] };
  const condition = status === 'low_stock' ? low : status === 'out_of_stock' ? out : { $or: [low, out] };
  const any = { $anyElementTrue: [{ $map: {
    input: '$variants', as: 'variant',
    in: { $and: [{ $eq: ['$$variant.isActive', true] }, condition] },
  } }] };
  return status === 'in_stock' ? { $not: [any] } : any;
}
