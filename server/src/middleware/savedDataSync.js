import SyncRevision from '../models/SyncRevision.js';
import Store from '../models/Store.js';
import { getIO } from '../config/socket.js';
import { logger } from '../config/logger.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { changeTags } from '../utils/changeTags.js';
import { revisionScope, incrementSyncRevision } from '../services/syncRevision.service.js';

const pending = new Set();
export const settleRevisionWrites = () => Promise.all([...pending]);

export const getSyncRevision = asyncHandler(async (req, res) => {
  let tenantId = req.user?.tenantId;
  if (req.params.slug) {
    const store = await Store.findOne({ slug: req.params.slug, isActive: true }).select('_id').lean();
    if (!store) throw new AppError('Store unavailable.', 404);
    tenantId = store._id;
  }
  const [saved, personal] = await Promise.all([
    SyncRevision.findById(revisionScope(tenantId)).lean(),
    req.user ? SyncRevision.findById(`user:${req.user._id}`).lean() : null,
  ]);
  const versions = { ...(saved?.versions ?? {}) };
  for (const [tag, version] of Object.entries(personal?.versions ?? {})) versions[tag] = (versions[tag] ?? 0) + version;
  // Public clients only need the catalog counters, never internal activity.
  if (!req.user) for (const tag of Object.keys(versions)) {
    if (!['Store', 'Product', 'Category', 'Offer', 'All'].includes(tag)) delete versions[tag];
  }
  res.set('Cache-Control', 'no-store');
  res.json({ data: { revision: (saved?.revision ?? 0) + (personal?.revision ?? 0), versions } });
});

export function trackSavedDataChanges(req, res, next) {
  const pathname = req.originalUrl.split('?')[0];
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) ||
      /\/auth\/(login|refresh|logout)$/.test(pathname) ||
      /\/(cart\/products|coupon\/validate|import\/sample)$/.test(pathname)) return next();
  res.once('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300 || req.skipSavedDataChange) return;
    const work = (async () => {
      const tags = changeTags(pathname);
      if (!tags.length) return;
      let tenantId = req.tenantId ?? req.user?.tenantId;
      const adminStore = /^\/api\/v1\/super-admin\/stores\/([a-f\d]{24})(?:\/|$)/i.exec(pathname)?.[1];
      if (adminStore) tenantId = adminStore;
      const slug = /^\/api\/v1\/storefront\/([^/]+)/.exec(pathname)?.[1];
      if (slug && !tenantId) tenantId = (await Store.findOne({ slug }).select('_id').lean())?._id;
      const personal = /^\/api\/v1\/notifications(?:\/|$)/.test(pathname);
      const scopes = new Set(personal ? [`user:${req.user._id}`] : [revisionScope(tenantId), 'platform']);
      // Platform lists/counters can change after a tenant action, too.
      for (const scope of scopes) {
        if (req.tenantRevisionRecorded && scope === revisionScope(tenantId)) continue;
        await incrementSyncRevision(scope, tags);
      }
      try {
        const io = getIO();
        // Reading an inbox must not redownload every owner's saved report,
        // catalog and order page. Other tabs of this recipient still update.
        if (personal) {
          io.to(`user:${req.user._id}`).emit('data:changed', { tags });
        } else {
          if (tenantId) io.to(`tenant:${tenantId}`).emit('data:changed', { tags });
          io.to('super_admin').emit('data:changed', { tags });
        }
      } catch { /* Polling is available in builds without socket connections. */ }
    })().catch((error) => logger.error('Could not publish saved-data revision', { message: error.message }));
    pending.add(work);
    void work.finally(() => pending.delete(work));
  });
  next();
}
