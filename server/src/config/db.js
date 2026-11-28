import mongoose from 'mongoose';
import { logger } from './logger.js';
import { env } from './env.js';
import { installMongoCommandTiming } from '../middleware/performanceDiagnostics.js';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

export const connectDB = async (retries = 0) => {
  try {
    const conn = await mongoose.connect(env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      monitorCommands: process.env.PERF_DIAGNOSTICS === '1',
    });

    installMongoCommandTiming(conn.connection.getClient());

    logger.info(`MongoDB connected: ${conn.connection.host}`);

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. Attempting to reconnect...');
    });
  } catch (err) {
    logger.error(`MongoDB connection failed (attempt ${retries + 1}):`, err.message);

    if (retries < MAX_RETRIES) {
      logger.info(`Retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      return connectDB(retries + 1);
    }

    logger.error('Max retries reached. Exiting.');
    process.exit(1);
  }
};
