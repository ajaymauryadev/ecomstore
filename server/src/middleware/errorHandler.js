import { logger } from '../config/logger.js';
import { AppError } from '../utils/AppError.js';

const handleCastError = (error) =>
  new AppError(`Invalid value for ${error.path}.`, 400);

const handleDuplicateKey = (error) => {
  const field = Object.keys(error.keyValue || {})[0] || 'value';
  return new AppError(`${field} already exists`, 409);
};

const handleValidationError = (error) => {
  const errors = Object.values(error.errors || {}).map((entry) => ({
    field: entry.path,
    message: entry.message,
  }));
  return new AppError('Validation failed', 400, errors);
};

const handleJWTError = () => new AppError('Invalid token. Please log in again.', 401);
const handleJWTExpiredError = () => new AppError('Your token has expired. Please log in again.', 401);

export const errorHandler = (err, req, res, next) => {
  let error = { ...err, message: err.message, stack: err.stack };
  if (err.name === 'CastError') error = handleCastError(err);
  if (err.code === 11000) error = handleDuplicateKey(err);
  if (err.name === 'ValidationError') error = handleValidationError(err);
  if (err.name === 'JsonWebTokenError') error = handleJWTError();
  if (err.name === 'TokenExpiredError') error = handleJWTExpiredError();

  const statusCode = error.statusCode || 500;
  const status = error.status || 'error';
  if (statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} - ${err.message}`, {
      stack: err.stack,
      requestId: req.id,
    });
  }

  res.status(statusCode).json({
    status,
    message: statusCode >= 500 && process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : (error.message || 'Internal server error'),
    ...(statusCode < 500 && error.errors && { errors: error.errors }),
    ...(process.env.NODE_ENV === 'development' && statusCode >= 500 && { stack: error.stack }),
  });
};
