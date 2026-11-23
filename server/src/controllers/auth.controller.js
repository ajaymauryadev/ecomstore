import User from '../models/User.js';
import Store from '../models/Store.js';
import RefreshToken from '../models/RefreshToken.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess } from '../utils/response.js';
import {
  generateTokens,
  verifyRefreshToken,
  hashToken,
  setRefreshCookie,
  clearRefreshCookie,
  getTokenExpiry,
} from '../utils/jwt.js';
import { logAudit } from '../services/audit.service.js';
import { runInTransaction } from '../utils/transaction.js';

const saveRefreshToken = async (userId, rawToken, req, session, sessionId) => {
  const hashed = hashToken(rawToken);
  const values = {
    userId,
    token: hashed,
    expiresAt: getTokenExpiry(rawToken),
    userAgent: req.headers['user-agent'],
    ip: req.ip,
    ...(sessionId && { sessionId }),
  };
  if (session) return RefreshToken.create([values], { session });
  return RefreshToken.create(values);
};

const sanitizeUser = (user) => {
  const obj = user.toObject ? user.toObject() : { ...user };
  delete obj.password;
  delete obj.tokenVersion;
  delete obj.__v;
  return obj;
};

export const register = asyncHandler(async (req, res, next) => {
  const { name, email, password, phone, storeName, storeSlug, rememberMe = false } = req.body;

  const existing = await User.findOne({ email });
  if (existing) return next(new AppError('Email is already registered.', 409));

  if (!storeName || !storeSlug) {
    return next(new AppError('Store name and slug are required.', 400));
  }

  const slugTaken = await Store.findOne({ slug: storeSlug.toLowerCase() });
  if (slugTaken) return next(new AppError('Store URL is already taken.', 409));

  const result = await runInTransaction(async (session) => {
    const [store] = await Store.create([{
      name: storeName,
      slug: storeSlug.toLowerCase(),
    }], { session });

    const [user] = await User.create([{
      name, email, password, phone, role: 'store_owner', tenantId: store._id,
    }], { session });
    store.ownerId = user._id;
    await store.save({ session });

    const tokens = generateTokens(user, { rememberMe });
    await saveRefreshToken(user._id, tokens.refreshToken, req, session);
    return { store, user, ...tokens };
  });

  setRefreshCookie(res, result.refreshToken, { rememberMe });
  sendSuccess(res, {
    user: sanitizeUser(result.user),
    accessToken: result.accessToken,
    store: result.store,
  }, 201);
});

export const login = asyncHandler(async (req, res, next) => {
  const { email, password, rememberMe = false } = req.body;

  const user = await User.findOne({ email }).select('+password +tokenVersion');
  if (!user || !(await user.comparePassword(password))) {
    return next(new AppError('Invalid email or password.', 401));
  }

  if (!user.isActive) return next(new AppError('Account is deactivated. Contact support.', 401));

  user.lastLogin = new Date();
  await user.save({ validateModifiedOnly: true });

  let store = null;
  if (user.tenantId) {
    store = await Store.findOne({
      _id: user.tenantId,
      isActive: true,
      'subscription.isActive': true,
      'subscription.expiresAt': { $gt: new Date() },
    }).select('name slug branding settings subscription');
    if (!store) return next(new AppError('Store is unavailable or its subscription has expired.', 403));
  }

  const { accessToken, refreshToken } = generateTokens(user, { rememberMe });
  await saveRefreshToken(user._id, refreshToken, req);
  setRefreshCookie(res, refreshToken, { rememberMe });

  if (user.role !== 'customer') {
    await logAudit({ tenantId: user.tenantId, action: 'admin_login', user: { _id: user._id, name: user.name, role: user.role }, description: `${user.role} login`, req });
  }

  sendSuccess(res, { user: sanitizeUser(user), accessToken, store });
});

export const refreshToken = asyncHandler(async (req, res, next) => {
  const raw = req.cookies?.refreshToken;
  if (!raw) return next(new AppError('Refresh token not found.', 401));

  let decoded;
  try {
    decoded = verifyRefreshToken(raw);
  } catch {
    clearRefreshCookie(res);
    return next(new AppError('Invalid or expired refresh token.', 401));
  }

  const hashed = hashToken(raw);
  const result = await runInTransaction(async (session) => {
    const now = new Date();
    const stored = await RefreshToken.findOne({ token: hashed, userId: decoded.userId }).session(session);
    if (!stored) {
      return { failure: 'Refresh token is no longer valid.', statusCode: 401 };
    }
    if (stored.isRevoked || stored.expiresAt <= now) {
      const parallelRotation = stored.rotatedAt && now.getTime() - stored.rotatedAt.getTime() <= 10_000;
      if (!parallelRotation) {
        // Reuse invalidates this login only; other devices keep their sessions.
        const scope = stored.sessionId ? { sessionId: stored.sessionId } : { token: hashed };
        await RefreshToken.updateMany({ userId: decoded.userId, ...scope }, { isRevoked: true }, { session });
      }
      return {
        failure: parallelRotation
          ? 'This session was just refreshed by another request.'
          : 'Refresh token reuse was detected. Please log in again.',
        statusCode: parallelRotation ? 409 : 401,
        preserveCookie: parallelRotation,
      };
    }

    const user = await User.findById(decoded.userId).select('+tokenVersion').session(session);
    if (!user || !user.isActive || user.changedPasswordAfter(decoded.iat)) {
      await RefreshToken.updateMany({ userId: decoded.userId }, { isRevoked: true }, { session });
      return { failure: 'Session is no longer valid. Please log in again.', statusCode: 401 };
    }

    let store = null;
    if (user.tenantId) {
      store = await Store.findOne({
        _id: user.tenantId,
        isActive: true,
        'subscription.isActive': true,
        'subscription.expiresAt': { $gt: now },
      }).select('name slug branding settings subscription').session(session);
      if (!store) {
        await RefreshToken.updateMany({ userId: user._id }, { isRevoked: true }, { session });
        return { failure: 'Store is unavailable or its subscription has expired.', statusCode: 403 };
      }
    }

    const rememberMe = Boolean(decoded.rememberMe);
    const tokens = generateTokens(user, { rememberMe });
    stored.sessionId ||= stored._id.toString();
    stored.isRevoked = true;
    stored.rotatedAt = now;
    stored.replacedByTokenHash = hashToken(tokens.refreshToken);
    await stored.save({ session });
    await saveRefreshToken(user._id, tokens.refreshToken, req, session, stored.sessionId);
    return { user, store, rememberMe, ...tokens };
  });

  if (result.failure) {
    if (!result.preserveCookie) clearRefreshCookie(res);
    return next(new AppError(result.failure, result.statusCode));
  }

  setRefreshCookie(res, result.refreshToken, { rememberMe: result.rememberMe });
  sendSuccess(res, { user: sanitizeUser(result.user), accessToken: result.accessToken, store: result.store });
});

export const logout = asyncHandler(async (req, res) => {
  const raw = req.cookies?.refreshToken;

  if (raw) {
    const hashed = hashToken(raw);
    await RefreshToken.findOneAndUpdate({ token: hashed }, { isRevoked: true });
  }

  clearRefreshCookie(res);
  sendSuccess(res, null, 200);
});

export const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  let store = null;
  if (user.tenantId) {
    store = await Store.findById(user.tenantId).select('name slug branding settings subscription');
  }
  sendSuccess(res, { user, store });
});

export const updatePassword = asyncHandler(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select('+password +tokenVersion');
  if (!(await user.comparePassword(currentPassword))) {
    return next(new AppError('Current password is incorrect.', 400));
  }

  const { accessToken, refreshToken } = await runInTransaction(async (session) => {
    user.password = newPassword;
    await user.save({ session });
    const tokens = generateTokens(user);
    await RefreshToken.updateMany({ userId: user._id }, { isRevoked: true }, { session });
    await saveRefreshToken(user._id, tokens.refreshToken, req, session);
    return tokens;
  });
  setRefreshCookie(res, refreshToken);

  sendSuccess(res, { user: sanitizeUser(user), accessToken });
});
