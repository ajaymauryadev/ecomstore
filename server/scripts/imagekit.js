import 'dotenv/config';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { readdir, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { toFile } from '@imagekit/nodejs';
import { imageKitClient, remoteAsset, uploadRemoteAsset, downloadRemoteAsset, MEDIA_COLLECTION } from '../src/services/imageStorage.service.js';
import { UPLOADS_ROOT } from '../src/middleware/upload.js';

const command = process.argv[2] || 'verify';
async function verify() {
  const client = imageKitClient();
  const buffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#5588aa' } }).webp().toBuffer();
  let uploaded;
  try {
    uploaded = await client.files.upload({
      file: await toFile(buffer, 'connection-check.webp'),
      fileName: `connection-check-${randomUUID()}.webp`,
      folder: (process.env.IMAGEKIT_FOLDER || '/smart-kirana') + '/checks',
      isPrivateFile: true, responseFields: ['isPrivateFile'],
    });
    if (uploaded.isPrivateFile !== true) throw new Error('ImageKit did not mark the verification file private.');
    const urlEndpoint = uploaded.url.slice(0, -uploaded.filePath.length);
    const { createHash } = await import('node:crypto');
    const restored = await downloadRemoteAsset({
      url: uploaded.url, urlEndpoint, size: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    });
    if (!restored.equals(buffer)) throw new Error('Private image verification failed.');
    const unsigned = await fetch(uploaded.url, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
    await unsigned.body?.cancel();
    if (unsigned.ok) throw new Error('Private image unexpectedly allows unsigned access.');
    console.log(JSON.stringify({ status: 'ok', urlEndpoint, privateUpload: true, signedDownload: true, unsignedAccessBlocked: true }));
  } finally {
    if (uploaded?.fileId) await client.files.delete(uploaded.fileId);
  }
}

async function* files(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* files(absolute);
    else if (entry.isFile()) yield absolute;
  }
}

async function migrate() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  try {
    const result = { migrated: 0, alreadyMigrated: 0, repaired: 0, skipped: 0, localCopiesRetained: true };
    for await (const absolute of files(UPLOADS_ROOT)) {
      const key = path.relative(UPLOADS_ROOT, absolute).split(path.sep).join('/');
      if (!/\.(webp|png|jpe?g)$/i.test(key)) { result.skipped++; continue; }
      let isPrivate = key.startsWith('private/');
      let tenantId = key.includes('/') ? key.split('/').at(-2) : null;
      if (!key.includes('/')) {
        const url = '/uploads/' + key;
        const products = await mongoose.connection.db.collection('products').find({ 'images.url': url }, { projection: { tenantId: 1 } }).toArray();
        const proof = await mongoose.connection.db.collection('orders').findOne({ 'paymentProof.screenshotUrl': url }, { projection: { tenantId: 1 } });
        // Never publish a legacy file when its public/private ownership is ambiguous.
        if ((!products.length && !proof) || (products.length && proof)) { result.skipped++; continue; }
        isPrivate = Boolean(proof);
        tenantId = proof?.tenantId || products[0]?.tenantId;
      }
      const existing = await remoteAsset(key);
      if ((await lstat(absolute)).size > 10 * 1024 * 1024) throw new Error('Local image is too large: ' + key);
      const buffer = await readFile(absolute);
      const asset = await uploadRemoteAsset({ key, buffer, isPrivate, tenantId, repairMissing: true });
      await downloadRemoteAsset(asset); // Verify the bytes before considering a migration successful.
      // A migration must not make existing local images eligible for orphan deletion.
      await mongoose.connection.db.collection(MEDIA_COLLECTION).updateOne({ storageKey: key, fileId: asset.fileId }, { $set: { migrated: true } });
      result[existing ? (existing.fileId === asset.fileId ? 'alreadyMigrated' : 'repaired') : 'migrated']++;
    }
    console.log(JSON.stringify(result));
  } finally { await mongoose.disconnect(); }
}

try {
  if (command === 'verify') await verify();
  else if (command === 'migrate') await migrate();
  else if (command === 'status') {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
    console.log(JSON.stringify({ provider: process.env.IMAGE_STORAGE || 'local', migratedImages: await mongoose.connection.db.collection(MEDIA_COLLECTION).countDocuments() }));
    await mongoose.disconnect();
  } else throw new Error('Use imagekit.js verify, migrate or status.');
} catch (error) {
  // Do not serialize SDK errors, request headers or environment secrets.
  console.error(`ImageKit ${command} failed: ${error.message}`);
  await mongoose.disconnect();
  process.exitCode = 1;
}
