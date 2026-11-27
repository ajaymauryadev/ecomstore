import SyncRevision from '../models/SyncRevision.js';
import Store from '../models/Store.js';
import { getIO } from '../config/socket.js';
import { logger } from '../config/logger.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';

const scopeFor = (tenantId) => tenantId ? `tenant:${tenantId}` : 'platform';
const pending = new Set();
export const settleRevisionWrites = () => Promise.all([...pending]);

export const getSyncRevision = asyncHandler(async (req, res) => {
  let tenantId = req.user?.tenantId;
  if (req.params.slug) {
    const store = await Store.findOne({ slug: req.params.slug, isActive: true }).select('_id').lean();
    if (!store) throw new AppError('Store unavailable.', 404);
    tenantId = store._id;
  }
  const saved = await SyncRevision.findById(scopeFor(tenantId)).lean();
  res.set('Cache-Control', 'no-store');
  res.json({ data: { revision: saved?.revision ?? 0 } });
});

export function trackSavedDataChanges(req, res, next) {
  const pathname = req.originalUrl.split('?')[0];
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) ||
      /\/auth\/(login|refresh|logout)$/.test(pathname) ||
      /\/(cart\/products|coupon\/validate|import\/sample)$/.test(pathname)) return next();
  res.once('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const work = (async () => {
      let tenantId = req.tenantId ?? req.user?.tenantId;
      const adminStore = /^\/api\/v1\/super-admin\/stores\/([a-f\d]{24})(?:\/|$)/i.exec(pathname)?.[1];
      if (adminStore) tenantId = adminStore;
      const slug = /^\/api\/v1\/storefront\/([^/]+)/.exec(pathname)?.[1];
      if (slug && !tenantId) tenantId = (await Store.findOne({ slug }).select('_id').lean())?._id;
      const scopes = new Set([scopeFor(tenantId)]);
      // Platform lists/counters can change after a tenant action, too.
      scopes.add('platform');
      for (const scope of scopes) {
        await SyncRevision.updateOne({ _id: scope }, { $inc: { revision: 1 } }, { upsert: true });
      }
      try {
        const io = getIO();
        if (tenantId) io.to(`tenant:${tenantId}`).emit('data:changed', {});
        io.to('super_admin').emit('data:changed', {});
      } catch { /* Polling is available in builds without socket connections. */ }
    })().catch((error) => logger.error('Could not publish saved-data revision', { message: error.message }));
    pending.add(work);
    void work.finally(() => pending.delete(work));
  });
  next();
}
