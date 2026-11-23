import path from 'path';
import { readdir, stat } from 'fs/promises';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Offer from '../models/Offer.js';
import Store from '../models/Store.js';
import Order from '../models/Order.js';
import Category from '../models/Category.js';
import User from '../models/User.js';
import Expense from '../models/Expense.js';
import PackingSession from '../models/PackingSession.js';
import { PRIVATE_PAYMENT_ROOT, PUBLIC_UPLOADS_ROOT, UPLOADS_ROOT } from '../middleware/upload.js';
import { deleteStoredImage, MEDIA_COLLECTION, remoteAsset } from './imageStorage.service.js';
import { logger } from '../config/logger.js';

const MAX_ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SAFE_ID = /^[a-f\d]{24}$/i;
const SAFE_IMAGE = /^[a-f\d-]{36}\.webp$/i;

const listTenantImages = async (root) => {
  let tenantEntries = [];
  try {
    tenantEntries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const tenantEntry of tenantEntries) {
    if (!tenantEntry.isDirectory() || !SAFE_ID.test(tenantEntry.name)) continue;
    const tenantRoot = path.join(root, tenantEntry.name);
    const entries = await readdir(tenantRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !SAFE_IMAGE.test(entry.name)) continue;
      const filePath = path.join(tenantRoot, entry.name);
      const metadata = await stat(filePath);
      if (Date.now() - metadata.mtimeMs >= MAX_ORPHAN_AGE_MS) {
        files.push({ tenantId: tenantEntry.name, filename: entry.name, filePath });
      }
    }
  }
  return files;
};

const publicImageIsReferenced = async ({ tenantId, filename }) => {
  const url = `/uploads/${tenantId}/${filename}`;
  const references = await Promise.all([
    Product.exists({ tenantId, 'images.url': url }),
    Offer.exists({ tenantId, image: url }),
    Store.exists({
      _id: tenantId,
      $or: [
        { 'branding.logo': url },
        { 'branding.banner': url },
        { 'paymentSettings.upiQrUrl': url },
      ],
    }),
    Category.exists({ tenantId, image: url }),
    User.exists({ tenantId, avatar: url }),
    Expense.exists({ tenantId, receiptUrl: url }),
    PackingSession.exists({ tenantId, 'items.image': url }),
    Order.exists({ tenantId, 'items.image': url }),
  ]);
  return references.some(Boolean);
};

const privateImageIsReferenced = async ({ tenantId, filename }) => {
  const storagePath = `${tenantId}/${filename}`;
  return Boolean(await Order.exists({
    tenantId,
    'paymentProof.screenshotFile': storagePath,
  }).select('+paymentProof.screenshotFile'));
};

export const cleanupAbandonedUploads = async () => {
  const [publicFiles, privateFiles] = await Promise.all([
    listTenantImages(PUBLIC_UPLOADS_ROOT),
    listTenantImages(PRIVATE_PAYMENT_ROOT),
  ]);
  let removed = 0;
  for (const file of publicFiles) {
    if (await remoteAsset(`public/${file.tenantId}/${file.filename}`)) continue;
    if (!await publicImageIsReferenced(file)) {
      await deleteStoredImage(`public/${file.tenantId}/${file.filename}`, UPLOADS_ROOT);
      removed += 1;
    }
  }
  for (const file of privateFiles) {
    if (await remoteAsset(`private/payment-proofs/${file.tenantId}/${file.filename}`)) continue;
    if (!await privateImageIsReferenced(file)) {
      await deleteStoredImage(`private/payment-proofs/${file.tenantId}/${file.filename}`, UPLOADS_ROOT);
      removed += 1;
    }
  }
  const remoteFiles = mongoose.connection.db.collection(MEDIA_COLLECTION).find({
    migrated: { $ne: true },
    createdAt: { $lt: new Date(Date.now() - MAX_ORPHAN_AGE_MS) },
    storageKey: { $regex: '^(public|private/payment-proofs)/' },
  });
  for await (const asset of remoteFiles) {
    const parts = asset.storageKey.split('/');
    const filename = parts.at(-1);
    const tenantId = parts.at(-2);
    if (!SAFE_ID.test(tenantId) || !SAFE_IMAGE.test(filename)) continue;
    const referenced = asset.isPrivate
      ? await privateImageIsReferenced({ tenantId, filename })
      : await publicImageIsReferenced({ tenantId, filename });
    if (!referenced) {
      await deleteStoredImage(asset.storageKey, UPLOADS_ROOT);
      removed += 1;
    }
  }
  if (removed > 0) logger.info(`Removed ${removed} abandoned upload(s).`);
  return removed;
};

export const startUploadCleanupScheduler = () => {
  const run = () => cleanupAbandonedUploads()
    .catch((error) => logger.error(`Upload cleanup failed: ${error.message}`));
  const initialTimer = setTimeout(run, 60_000);
  initialTimer.unref?.();
  const interval = setInterval(run, CLEANUP_INTERVAL_MS);
  interval.unref?.();
};
