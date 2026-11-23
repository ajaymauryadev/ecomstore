import { parseTrustedProxies } from './trustedProxies.js';

const required = (key) => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
};

const optional = (key, fallback) => process.env[key] || fallback;

const PLACEHOLDER_PATTERN = /(change[-_ ]?me|placeholder|example|your[-_]|dev[-_]|default|secret|password)/i;

const requireStrongSecret = (key, value, isProduction) => {
  if (!value) throw new Error(`Missing required env var: ${key}`);
  if (isProduction && (value.length < 32 || PLACEHOLDER_PATTERN.test(value))) {
    throw new Error(`${key} must be a non-placeholder secret of at least 32 characters in production.`);
  }
  return value;
};

const nodeEnv = optional('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';
const imageStorage = optional('IMAGE_STORAGE', 'local');
if (!['local', 'imagekit'].includes(imageStorage)) throw new Error('IMAGE_STORAGE must be local or imagekit.');
if (imageStorage === 'imagekit' && !process.env.IMAGEKIT_PRIVATE_KEY) throw new Error('IMAGEKIT_PRIVATE_KEY is required for ImageKit storage.');
const accessSecret = required('JWT_ACCESS_SECRET');
const refreshSecret = required('JWT_REFRESH_SECRET');
const cookieSecret = optional('COOKIE_SECRET', isProduction ? '' : 'dev-cookie-secret');

requireStrongSecret('JWT_ACCESS_SECRET', accessSecret, isProduction);
requireStrongSecret('JWT_REFRESH_SECRET', refreshSecret, isProduction);
requireStrongSecret('COOKIE_SECRET', cookieSecret, isProduction);

if (isProduction && new Set([accessSecret, refreshSecret, cookieSecret]).size !== 3) {
  throw new Error('JWT and cookie secrets must be independent in production.');
}

const corsOrigins = optional('CORS_ORIGINS', 'http://localhost:5173');
if (isProduction && corsOrigins.split(',').some((origin) => origin.trim() === '*')) {
  throw new Error('Wildcard CORS origins are not allowed in production.');
}

export const env = {
  NODE_ENV: nodeEnv,
  PORT: parseInt(optional('PORT', '5000'), 10),

  MONGODB_URI: required('MONGODB_URI'),

  JWT_ACCESS_SECRET: accessSecret,
  JWT_REFRESH_SECRET: refreshSecret,
  JWT_ACCESS_EXPIRES_IN: optional('JWT_ACCESS_EXPIRES_IN', '15m'),
  JWT_REFRESH_EXPIRES_IN: optional('JWT_REFRESH_EXPIRES_IN', '7d'),

  CORS_ORIGINS: corsOrigins,
  TRUSTED_PROXY_CIDRS: parseTrustedProxies(process.env.TRUSTED_PROXY_CIDRS),
  COOKIE_SECRET: cookieSecret,

  get isProduction() {
    return this.NODE_ENV === 'production';
  },
  get isDevelopment() {
    return this.NODE_ENV === 'development';
  },
};
