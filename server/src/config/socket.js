import { Server } from 'socket.io';
import { verifyAccessToken } from '../utils/jwt.js';
import { logger } from './logger.js';
import { env } from './env.js';
import User from '../models/User.js';

let io;

export const initSocket = (server) => {
  const allowedOrigins = env.CORS_ORIGINS.split(',').map(o => o.trim());
  if (env.isDevelopment) {
    allowedOrigins.push('http://localhost:5173', 'http://127.0.0.1:5173');
  }

  io = new Server(server, {
    cors: {
      origin: [...new Set(allowedOrigins)],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const decoded = verifyAccessToken(token);
      const user = await User.findById(decoded.userId).select('+tokenVersion');
      if (!user?.isActive || user.role !== decoded.role ||
          String(user.tenantId || '') !== String(decoded.tenantId || '') ||
          Number(user.tokenVersion || 0) !== Number(decoded.tokenVersion || 0) ||
          user.changedPasswordAfter(decoded.iat)) return next(new Error('Invalid or expired token'));
      socket.user = decoded;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id} (user: ${socket.user?.userId})`);

    if (socket.user?.tenantId) {
      socket.join(`tenant:${socket.user.tenantId}`);
      socket.join(`tenant:${socket.user.tenantId}:role:${socket.user.role}`);
    }

    if (socket.user?.userId) {
      socket.join(`user:${socket.user.userId}`);
    }

    if (socket.user?.role === 'super_admin') {
      socket.join('super_admin');
    }

    socket.on('join:tenant', (tenantId) => {
      if (String(socket.user?.tenantId) === String(tenantId) || socket.user?.role === 'super_admin') {
        socket.join(`tenant:${tenantId}`);
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info(`Socket disconnected: ${socket.id} (${reason})`);
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
};

export const emitToTenant = (tenantId, event, data) => {
  getIO().to(`tenant:${tenantId}`).emit(event, data);
};

export const emitToUser = (userId, event, data) => {
  getIO().to(`user:${userId}`).emit(event, data);
};

export const emitToAll = (event, data) => {
  getIO().emit(event, data);
};

export const emitToTenantRoles = (tenantId, roles, event, data) => {
  getIO().to(roles.map((role) => `tenant:${tenantId}:role:${role}`)).emit(event, data);
};

export const emitToWorkers = (tenantId, event, data) =>
  emitToTenantRoles(tenantId, ['store_owner', 'staff', 'packer', 'delivery'], event, data);
