import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { downloadRemoteAsset, remoteAsset } from './imageStorage.service.js';

const filenamePattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,145}\.(?:webp|png|jpe?g)$/i;
const maxMediaFileBytes = 10 * 1024 * 1024;

export const hash = (value) => createHash('sha256').update(value).digest('hex');

export function backupMediaOrigins() {
  const configured = (process.env.BACKUP_MEDIA_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
  return [...new Set(configured.map((value) => {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) {
      throw new Error('BACKUP_MEDIA_ORIGINS must contain HTTP(S) origins.');
    }
    return url.origin;
  }))];
}

function uploadPath(value, origins) {
  if (typeof value !== 'string') return null;
  if (value.startsWith('/uploads/')) return value.slice('/uploads/'.length);
  if (!/^https?:\/\//i.test(value) || !URL.canParse(value)) return null;
  const url = new URL(value);
  return origins.includes(url.origin) && url.pathname.startsWith('/uploads/')
    ? url.pathname.slice('/uploads/'.length)
    : null;
}

export function mediaReferences(store, data, tenantId, origins) {
  const references = new Set();
  const legacySources = new Map();
  const issues = [];
  const addPublic = (value) => {
    const file = uploadPath(value, origins);
    if (file === null) return;
    const [directory, filename, ...extra] = file.split('/');
    if (!filename && filenamePattern.test(directory)) references.add(directory);
    else if (directory === tenantId && filenamePattern.test(filename || '') && !extra.length) {
      references.add('public/' + file);
    } else {
      issues.push({ type: 'invalid-public-media-reference', reference: file });
    }
  };
  [store.branding?.logo, store.branding?.banner, store.paymentSettings?.upiQrUrl].forEach(addPublic);
  for (const product of data.products) for (const image of product.images || []) addPublic(image.url);
  for (const category of data.categories) addPublic(category.image);
  for (const offer of data.offers) addPublic(offer.image);
  for (const user of data.users) addPublic(user.avatar);
  for (const expense of data.expenses) addPublic(expense.receiptUrl);
  for (const session of data.packingSessions) for (const item of session.items || []) addPublic(item.image);
  for (const order of data.orders) {
    for (const item of order.items || []) addPublic(item.image);
    const proof = order.paymentProof;
    if (proof?.screenshotFile) {
      const [directory, filename, ...extra] = String(proof.screenshotFile).split('/');
      if (directory === tenantId && filenamePattern.test(filename || '') && !extra.length) {
        references.add('private/payment-proofs/' + proof.screenshotFile);
      } else {
        issues.push({ type: 'invalid-private-media-reference', orderId: String(order._id) });
      }
    }
    const legacy = uploadPath(proof?.screenshotUrl, origins);
    if (legacy !== null) {
      const filename = legacy.startsWith(tenantId + '/') ? legacy.slice(tenantId.length + 1) : legacy;
      if (filenamePattern.test(filename)) {
        const destination = 'private/legacy-payment-proofs/' + tenantId + '/' + filename;
        if (legacySources.has(destination) && legacySources.get(destination) !== legacy) {
          issues.push({ type: 'ambiguous-legacy-payment-reference', orderId: String(order._id) });
        }
        legacySources.set(destination, legacy);
        references.add(destination);
      } else {
        issues.push({ type: 'invalid-legacy-payment-reference', orderId: String(order._id) });
      }
    }
  }

  for (const entry of references) {
    if (!entry.startsWith('private/legacy-payment-proofs/')) continue;
    const filename = entry.split('/').at(-1);
    if (references.has(filename) || references.has('public/' + tenantId + '/' + filename)) {
      issues.push({ type: 'mixed-public-private-media-reference', reference: filename });
    }
  }
  return { paths: [...references].sort(), issues, legacySources };
}

export async function readBackupMedia(root, relativePath) {
  const absolute = path.resolve(root, ...relativePath.split('/'));
  const physical = await realpath(absolute);
  if (physical !== absolute) throw new Error('Symlinked backup media is not supported.');
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.size > maxMediaFileBytes) throw new Error('Unsupported backup media file.');
  return readFile(absolute);
}

export async function collectMedia(root, relativePath, legacySource, connection) {
  const candidates = [relativePath];
  if (legacySource) candidates.push(legacySource.includes('/') ? 'public/' + legacySource : legacySource);
  for (const candidate of candidates) {
    const asset = await remoteAsset(candidate, connection);
    if (asset) return downloadRemoteAsset(asset);
    try {
      return await readBackupMedia(root, candidate);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error('Required upload is missing.');
}
