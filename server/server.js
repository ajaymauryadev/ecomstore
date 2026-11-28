import 'dotenv/config';
import http from 'http';
import mongoose from 'mongoose';
import { app } from './src/app.js';
import Order from './src/models/Order.js';
import Notification from './src/models/Notification.js';
import SyncRevision from './src/models/SyncRevision.js';
import Expense from './src/models/Expense.js';
import { connectDB } from './src/config/db.js';
import { initSocket } from './src/config/socket.js';
import { logger } from './src/config/logger.js';
import { env } from './src/config/env.js';
import { startUploadCleanupScheduler } from './src/services/uploadCleanup.service.js';
import { UPLOADS_ROOT } from './src/middleware/upload.js';
import { assertRestoreReady } from './src/services/backupRestore.js';
import { settleRevisionWrites } from './src/middleware/savedDataSync.js';

const server = http.createServer(app);
const io = initSocket(server);

const start = async () => {
  await connectDB();
  await assertRestoreReady(mongoose.connection.db, UPLOADS_ROOT);
  await Promise.all([Order.init(), Notification.init(), SyncRevision.init(), Expense.init()]);
  startUploadCleanupScheduler();
  server.listen(env.PORT, () => {
    logger.info(`Server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
  });
};

start().catch((err) => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});

process.once('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  const deadline = setTimeout(() => process.exit(1), 20_000);
  deadline.unref();
  try {
    await new Promise((resolve) => io.close(resolve));
    await settleRevisionWrites();
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Graceful shutdown failed:', error);
    process.exit(1);
  }
});

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Rejection:', err);
  server.close(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});
