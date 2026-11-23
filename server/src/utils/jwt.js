import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env.js';

export const generateAccessToken = (payload) =>
  jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES_IN });

export const generateRefreshToken = (payload) =>
  jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES_IN });

export const verifyAccessToken = (token) =>
  jwt.verify(token, env.JWT_ACCESS_SECRET);

export const verifyRefreshToken = (token) =>
  jwt.verify(token, env.JWT_REFRESH_SECRET);

export const generateTokens = (user, { rememberMe = false } = {}) => {
  const payload = {
    userId: user._id.toString(),
    role: user.role,
    tenantId: user.tenantId?.toString() || null,
    tokenVersion: Number(user.tokenVersion || 0),
    tokenId: crypto.randomUUID(),
  };
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken({
      userId: payload.userId,
      tokenId: crypto.randomUUID(),
      rememberMe: Boolean(rememberMe),
    }),
  };
};

export const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

const refreshCookieOptions = (rememberMe = false) => ({
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.isProduction ? 'none' : 'lax',
    path: '/api/v1/auth',
    ...(rememberMe ? { maxAge: 7 * 24 * 60 * 60 * 1000 } : {}),
  });

export const setRefreshCookie = (res, refreshToken, { rememberMe = false } = {}) => {
  res.cookie('refreshToken', refreshToken, refreshCookieOptions(rememberMe));
};

export const clearRefreshCookie = (res) => {
  res.clearCookie('refreshToken', refreshCookieOptions(false));
};

export const getTokenExpiry = (token) => {
  const decoded = jwt.decode(token);
  if (!decoded?.exp) throw new Error('Token expiry is missing.');
  return new Date(decoded.exp * 1000);
};
