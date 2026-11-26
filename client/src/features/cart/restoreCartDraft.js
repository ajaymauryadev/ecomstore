import { createAsyncThunk } from '@reduxjs/toolkit';
import { orderApi } from '../orders/orderApi';
import { productApi } from '../products/productApi';
import { cartDraftLines, readCartDraft } from './cartDraftStorage';

const apiOrigin = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || '';

function currentCartItem(line, product) {
  const variant = product?.variants.find((option) => option._id === line.variantId);
  if (!variant || !Number.isSafeInteger(variant.stock) || variant.stock <= 0) return null;
  const price = variant.offerPrice ?? variant.retailPrice;
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(variant.retailPrice) || price > variant.retailPrice) return null;
  return {
    ...line,
    _id: line.productId + '_' + line.variantId,
    quantity: Math.min(line.quantity, variant.stock),
    name: product.name,
    variantName: variant.name,
    unit: variant.unit,
    image: product.mainImage?.startsWith('/') ? apiOrigin + product.mainImage : product.mainImage,
    price,
    mrp: variant.retailPrice,
    stock: variant.stock,
  };
}

async function restoreCoupon(dispatch, slug, code, items, deliveryType) {
  const request = dispatch(orderApi.endpoints.validateCoupon.initiate({
    slug,
    code,
    items: cartDraftLines(items),
    orderType: deliveryType,
    paymentMethod: deliveryType === 'self_pickup' ? 'cash_on_pickup' : 'cod',
  }, { track: false }));
  try {
    const { data } = await request.unwrap();
    if (!data?.coupon?.code || !Number.isFinite(data.discount) || data.discount < 0) {
      throw new Error('Unexpected coupon response.');
    }
    return { coupon: data.coupon, couponDiscount: data.discount };
  } catch (error) {
    if ([400, 403, 404, 409, 410, 422].includes(error.status)) return {};
    throw error;
  }
}

export const restoreCartDraft = createAsyncThunk(
  'cart/restoreDraft',
  async ({ scopeKey, slug, userId, sessionUserId = userId }, { dispatch, getState, signal }) => {
    const draft = readCartDraft(scopeKey);
    if (!draft?.items.length) return {};

    const assertCurrentAccount = () => {
      signal.throwIfAborted();
      if ((getState().auth.user?._id ?? null) !== sessionUserId) throw new Error('Cart account changed.');
    };
    const productIds = [...new Set(draft.items.map(({ productId }) => productId))];
    const { data } = await dispatch(productApi.endpoints.getCartProducts.initiate(
      { slug, productIds }, { track: false }
    )).unwrap();
    if (!Array.isArray(data?.products)) throw new Error('Unexpected product response.');
    const byId = new Map(data.products.map((product) => [product._id, product]));
    const items = draft.items.map((line) => currentCartItem(line, byId.get(line.productId))).filter(Boolean);
    assertCurrentAccount();
    const coupon = draft.couponCode && items.length
      ? await restoreCoupon(dispatch, slug, draft.couponCode, items, draft.deliveryType)
      : {};
    assertCurrentAccount();
    const savedQuantity = draft.items.reduce((sum, item) => sum + item.quantity, 0);
    const currentQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    return {
      items,
      deliveryType: draft.deliveryType,
      ...coupon,
      restoredWithChanges: savedQuantity !== currentQuantity || Boolean(draft.couponCode && !coupon.coupon),
    };
  }
);
