import ImageKit, { toFile } from '@imagekit/nodejs';
import mongoose from 'mongoose';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { unlink } from 'node:fs/promises';

export const MEDIA_COLLECTION = 'mediaassets';
export const usesImageKit = () => process.env.IMAGE_STORAGE === 'imagekit';
const maxBytes = 10 * 1024 * 1024;
let client;
let clientKey;
const indexes = new WeakMap();

export function imageKitClient() {
  const key = process.env.IMAGEKIT_PRIVATE_KEY;
  if (!key) throw new Error('IMAGEKIT_PRIVATE_KEY is required for ImageKit storage.');
  if (!client || clientKey !== key) {
    client = new ImageKit({ privateKey: key, timeout: 20_000, maxRetries: 0, logLevel: 'off' });
    clientKey = key;
  }
  return client;
}

export function validateStorageKey(key) {
  if (typeof key !== 'string' || !/^(?:(?:public|private\/payment-proofs|private\/legacy-payment-proofs)\/[a-f\d]{24}\/)?[a-zA-Z0-9][a-zA-Z0-9_.-]{0,159}$/.test(key)) {
    throw new Error('Invalid image storage path.');
  }
  return key;
}

export async function remoteAsset(key, connection = mongoose.connection) {
  validateStorageKey(key);
  if (connection.readyState !== 1 || !connection.db) return null;
  return connection.db.collection(MEDIA_COLLECTION).findOne({ storageKey: key });
}

export async function uploadRemoteAsset({ key, buffer, isPrivate, tenantId, connection = mongoose.connection, repairMissing = false }) {
  validateStorageKey(key);
  if (!buffer.length || buffer.length > maxBytes) throw new Error('Unsupported image file size.');
  const existing = await remoteAsset(key, connection);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  if (existing) {
    if (existing.sha256 !== sha256 || existing.isPrivate !== isPrivate) throw new Error('Stored image path already contains different content or visibility.');
    if (!repairMissing) return existing;
    try { await imageKitClient().files.get(existing.fileId); return existing; }
    catch (error) { if (error.status !== 404) throw error; }
  }
  const db = connection.db;
  if (!db) throw new Error('Database connection is required for image storage.');
  if (!indexes.has(db)) indexes.set(db, db.collection(MEDIA_COLLECTION).createIndex({ storageKey: 1 }, { unique: true }));
  await indexes.get(db);
  const prefix = (process.env.IMAGEKIT_FOLDER || '/smart-kirana').replace(/^\/+|\/+$/g, '');
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(prefix)) throw new Error('Invalid IMAGEKIT_FOLDER.');
  const fileName = path.posix.basename(key);
  const folder = '/' + prefix + (key.includes('/') ? '/' + path.posix.dirname(key) : '/legacy');
  const uploaded = await imageKitClient().files.upload({
    file: await toFile(buffer, fileName), fileName, folder,
    useUniqueFileName: true, isPrivateFile: isPrivate, responseFields: ['isPrivateFile'],
  });
  try {
    if (!uploaded.fileId || !uploaded.url || !uploaded.filePath || !uploaded.url.endsWith(uploaded.filePath) ||
        new URL(uploaded.url).protocol !== 'https:' || uploaded.isPrivateFile !== isPrivate) {
      throw new Error('ImageKit returned incomplete image metadata.');
    }
    const asset = {
      storageKey: key, tenantId: tenantId ? String(tenantId) : null,
      fileId: uploaded.fileId, url: uploaded.url,
      urlEndpoint: uploaded.url.slice(0, -uploaded.filePath.length),
      isPrivate, size: buffer.length, sha256, createdAt: new Date(),
    };
    if (existing) {
      const replaced = await db.collection(MEDIA_COLLECTION).updateOne({ _id: existing._id, fileId: existing.fileId }, { $set: asset });
      if (!replaced.matchedCount) throw new Error('Image metadata changed during repair; rerun migration.');
    } else await db.collection(MEDIA_COLLECTION).insertOne(asset);
    return asset;
  } catch (error) {
    if (uploaded.fileId) await imageKitClient().files.delete(uploaded.fileId).catch(() => {});
    throw error;
  }
}

export async function downloadRemoteAsset(asset) {
  const url = imageKitClient().helper.buildSrc({
    urlEndpoint: asset.urlEndpoint, src: asset.url,
    transformation: [{ raw: 'orig-true' }], signed: true, expiresIn: 60,
  });
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('ImageKit image download failed.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Image exceeds the supported download size.');
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (size !== asset.size || createHash('sha256').update(buffer).digest('hex') !== asset.sha256) {
    throw new Error('ImageKit image checksum mismatch.');
  }
  return buffer;
}

export async function deleteStoredImage(key, localRoot, connection = mongoose.connection) {
  const asset = await remoteAsset(key, connection);
  if (asset) {
    try { await imageKitClient().files.delete(asset.fileId); }
    catch (error) { if (error.status !== 404) throw error; }
    await connection.db.collection(MEDIA_COLLECTION).deleteOne({ _id: asset._id, fileId: asset.fileId });
  }
  // Also remove a retained pre-migration copy when this image is explicitly deleted.
  await unlink(path.join(localRoot, ...validateStorageKey(key).split('/'))).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

export async function remoteTenantBytes(tenantId, isPrivate) {
  const [total] = await mongoose.connection.db.collection(MEDIA_COLLECTION).aggregate([
    { $match: { tenantId: String(tenantId), isPrivate } },
    { $group: { _id: null, bytes: { $sum: '$size' } } },
  ]).toArray();
  return total?.bytes || 0;
}
