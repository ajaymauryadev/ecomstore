import crypto from 'crypto';

export const generateGuestOrderToken = () => crypto.randomBytes(32).toString('base64url');

export const hashGuestOrderToken = (token) =>
  crypto.createHash('sha256').update(String(token)).digest('hex');
