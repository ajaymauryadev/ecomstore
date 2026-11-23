import mongoose from 'mongoose';
import { realpath } from 'node:fs/promises';
import { UPLOADS_ROOT } from '../middleware/upload.js';
import { AppError } from '../utils/AppError.js';
import { archiveModels, collections, encodeDocument, isTenantId, ObjectId, orderedBson } from './backupModels.js';
import { backupMediaOrigins, collectMedia, hash, mediaReferences } from './backupMedia.js';
import { reconcileBackup } from './backupReconciliation.js';

export const backupVersion = '2.0';
export const archiveLimitBytes = 512 * 1024 * 1024;
export const digest = (payload) => hash(JSON.stringify(payload));
export const entryMetadata = (payload, count = payload.length) => ({ count, sha256: digest(payload) });

const legacyUrls = (filename, origins) => [
  '/uploads/' + filename,
  ...origins.map((origin) => origin + '/uploads/' + filename),
];

async function validateLegacyAccess(db, session, relativePath, legacySource, tenantId, origins) {
  const legacyPrivate = Boolean(legacySource);
  if (relativePath.includes('/') && !legacyPrivate) return;
  const urls = legacyUrls(legacySource || relativePath, origins);
  const products = db.collection(collections.products.collection.name);
  const orders = db.collection(collections.orders.collection.name);
  const productFilter = { 'images.url': { $in: urls } };
  const proofFilter = { 'paymentProof.screenshotUrl': { $in: urls } };
  if (legacyPrivate) {
    if (await products.findOne(productFilter, { session, projection: { _id: 1 } }) ||
        await orders.findOne({ ...proofFilter, tenantId: { $ne: tenantId } }, { session, projection: { _id: 1 } })) {
      throw new Error('Legacy proof has an ambiguous owner or visibility.');
    }
  } else if (!await products.findOne({ ...productFilter, tenantId }, { session, projection: { _id: 1 } }) ||
      await products.findOne({ ...productFilter, tenantId: { $ne: tenantId } }, { session, projection: { _id: 1 } }) ||
      await orders.findOne(proofFilter, { session, projection: { _id: 1 } })) {
    throw new Error('Legacy public upload ownership could not be established.');
  }
}

export async function captureTenantBackup(tenantId, {
  connection = mongoose.connection, uploadsRoot = UPLOADS_ROOT, kind = 'recovery', inspect = false,
} = {}) {
  if (!isTenantId(tenantId)) throw new AppError('Invalid backup tenant.', 400);
  if (!['owner', 'recovery'].includes(kind)) throw new Error('Invalid backup archive kind.');
  const id = new ObjectId(tenantId);
  const session = connection.getClient().startSession({ snapshot: true });
  const data = {};
  const media = [];
  const mediaManifest = [];
  const counts = {};
  const collectionManifest = {};
  let remainingBytes = archiveLimitBytes - 1024 * 1024;
  const reserve = (size) => {
    remainingBytes -= size;
    if (remainingBytes < 0) throw new AppError('Tenant backup exceeds the supported archive size.', 413);
  };

  try {
    const rawStore = await connection.db.collection(archiveModels.store.collection.name)
      .findOne({ _id: id }, { session, ...orderedBson });
    if (!rawStore) throw new AppError('Store not found.', 404);
    const store = encodeDocument(rawStore, kind);
    reserve(Buffer.byteLength(JSON.stringify(store)));
    collectionManifest.store = entryMetadata(store, 1);
    for (const [key, model] of Object.entries(collections)) {
      const filter = key === 'plans' ? { _id: rawStore.subscription?.planId || null } : { tenantId: id };
      const cursor = connection.db.collection(model.collection.name).find(filter, { session, ...orderedBson, batchSize: 500 });
      const rows = [];
      for await (const rawRow of cursor) {
        const row = encodeDocument(rawRow, kind);
        reserve(Buffer.byteLength(JSON.stringify(row)) + 1);
        rows.push(row);
      }
      counts[key] = rows.length;
      collectionManifest[key] = entryMetadata(rows);
      data[key] = rows;
    }

    const mediaOrigins = backupMediaOrigins();
    const { paths, issues, legacySources } = mediaReferences(store, data, tenantId, mediaOrigins);
    const root = paths.length ? await realpath(uploadsRoot).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return uploadsRoot;
    }) : uploadsRoot;
    for (const relativePath of paths) {
      let bytes;
      try {
        const legacySource = legacySources.get(relativePath);
        await validateLegacyAccess(connection.db, session, relativePath, legacySource, id, mediaOrigins);
        bytes = await collectMedia(root, relativePath, legacySource, connection);
      } catch (error) {
        issues.push({ type: 'unavailable-upload', path: relativePath, reason: error.message });
        continue;
      }
      reserve(Math.ceil(bytes.length / 3) * 4 + Buffer.byteLength(relativePath) * 2 + 200);
      mediaManifest.push({ path: relativePath, bytes: bytes.length, sha256: hash(bytes) });
      if (!inspect) media.push({ path: relativePath, content: bytes.toString('base64') });
    }

    const exportedAt = new Date().toISOString();
    const snapshotTime = session.snapshotTime?.toString();
    if (inspect) {
      return { tenantId, exportedAt, snapshotTime, counts, media: mediaManifest, mediaIssues: issues, ...reconcileBackup(data) };
    }
    if (issues.length) throw new AppError('Required backup media is missing or unsafe. Check the reconciliation report.', 409);
    const archive = {
      version: backupVersion, kind, tenantId, exportedAt, snapshotTime, mediaOrigins,
      store, data, counts, media, manifest: { collections: collectionManifest, media: mediaManifest },
    };
    return archive;
  } finally {
    await session.endSession();
  }
}

export async function inspectTenantBackup(tenantId, options) {
  return captureTenantBackup(tenantId, { ...options, inspect: true });
}
