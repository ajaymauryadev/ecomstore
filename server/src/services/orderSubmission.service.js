import { createHash, createHmac, randomBytes } from 'node:crypto';
import Order from '../models/Order.js';
import { AppError } from '../utils/AppError.js';
import { generateGuestOrderToken } from '../utils/orderAccessToken.js';
import { runInTransaction } from '../utils/transaction.js';

const keyPath = 'orderSubmission.keyHash';

const fingerprint = (key, operation, req) => {
  const payload = JSON.stringify([operation, req.user?._id?.toString() ?? null, req.body], (_, value) =>
    value && Object.getPrototypeOf(value) === Object.prototype
      ? Object.fromEntries(Object.keys(value).sort().map((field) => [field, value[field]]))
      : value
  );
  return createHmac('sha256', key).update(payload).digest('hex');
};

// The original token can be regenerated only with the submitted key and the
// order's private seed. The tracking token itself is never stored in plaintext.
const replayToken = (key, seed) => seed
  ? createHmac('sha256', Buffer.from(seed, 'hex')).update(key).digest('base64url')
  : null;

export const submitOrder = async ({ req, tenantId, operation, guest = false }, createOrder) => {
  const key = req.get('Idempotency-Key');
  if (key === undefined) {
    const guestAccessToken = guest ? generateGuestOrderToken() : null;
    const order = await runInTransaction((session) => createOrder(session, { guestAccessToken }));
    return { order, guestAccessToken, replayed: false };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(key)) {
    throw new AppError('Invalid Idempotency-Key header.', 400);
  }

  const keyHash = createHash('sha256').update(key).digest('hex');
  const requestHash = fingerprint(key, operation, req);
  const query = () => Order.findOne({ tenantId, [keyPath]: keyHash }).select('+orderSubmission');
  const replay = (order) => {
    if (order.orderSubmission.requestHash !== requestHash) {
      throw new AppError('This submission key was already used with different order details.', 409);
    }
    return {
      order,
      guestAccessToken: replayToken(key, order.orderSubmission.guestSeed),
      replayed: true,
    };
  };

  const guestSeed = guest ? randomBytes(32).toString('hex') : undefined;
  const guestAccessToken = replayToken(key, guestSeed);
  const orderSubmission = { keyHash, requestHash, guestSeed };
  try {
    return await runInTransaction(async (session) => {
      const existing = await query().session(session);
      if (existing) return replay(existing);
      const order = await createOrder(session, { orderSubmission, guestAccessToken });
      return { order, guestAccessToken, replayed: false };
    });
  } catch (error) {
    if (error.code !== 11000 || !error.keyPattern?.[keyPath]) throw error;
    const existing = await query().readConcern('majority');
    if (existing) return replay(existing);
    throw new AppError('The original order is still being confirmed. Retry this submission.', 503);
  }
};
