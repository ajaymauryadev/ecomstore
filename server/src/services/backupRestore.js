import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { archiveModels, collections, decodeDocument, encodeDocument, isTenantId, ObjectId, orderedBson } from './backupModels.js';
import { hash, mediaReferences, readBackupMedia } from './backupMedia.js';
import { backupVersion, entryMetadata } from './tenantBackup.service.js';
import { reconcileBackup } from './backupReconciliation.js';

export const restoreDatabasePattern = /^smart_kirana_restore_[a-z0-9_]{1,35}$/;
const restoreMarker = '_backupRestore';
const isRecord = (value) => value && Object.getPrototypeOf(value) === Object.prototype;
const sameKeys = (record, keys) => isRecord(record) && Object.keys(record).length === keys.length
  && keys.every((key) => Object.hasOwn(record, key));

function verifyCollection(name, documents, manifest, predicate) {
  const rows = name === 'store' ? [documents] : documents;
  if (!Array.isArray(rows) || !rows.every(isRecord)) throw new Error('Invalid archive collection: ' + name);
  const metadata = entryMetadata(documents, rows.length);
  if (manifest?.sha256 !== metadata.sha256 || manifest?.count !== metadata.count) {
    throw new Error('Archive collection checksum or count mismatch: ' + name);
  }
  const seen = new Set();
  for (const row of rows) {
    const doc = decodeDocument(row);
    if (!(doc._id instanceof ObjectId) || seen.has(String(doc._id)) || !predicate(doc)) {
      throw new Error('Invalid record ID or tenant scope: ' + name);
    }
    seen.add(String(doc._id));
  }
}

export function validateRecoveryArchive(archive, expectedTenantId) {
  if (!isTenantId(expectedTenantId) || archive?.tenantId !== expectedTenantId) {
    throw new Error('Archive belongs to a different tenant.');
  }
  if (archive.version !== backupVersion || archive.kind !== 'recovery' ||
      !Number.isFinite(Date.parse(archive.exportedAt)) || !/^\d+$/.test(archive.snapshotTime) ||
      !Array.isArray(archive.mediaOrigins) || !archive.mediaOrigins.every((origin) =>
        typeof origin === 'string' && /^https?:\/\//.test(origin) && URL.canParse(origin) && new URL(origin).origin === origin) ||
      !sameKeys(archive.data, Object.keys(collections)) ||
      !sameKeys(archive.counts, Object.keys(collections)) ||
      !sameKeys(archive.manifest?.collections, Object.keys(archiveModels))) {
    throw new Error('Unsupported or incomplete recovery archive.');
  }
  verifyCollection('store', archive.store, archive.manifest.collections.store, (store) => String(store._id) === expectedTenantId);
  const store = decodeDocument(archive.store);
  for (const [name, rows] of Object.entries(archive.data)) {
    const metadata = archive.manifest.collections[name];
    verifyCollection(name, rows, metadata, (doc) => name === 'plans'
      ? String(doc._id) === String(store.subscription?.planId)
      : doc.tenantId instanceof ObjectId && String(doc.tenantId) === expectedTenantId);
    if (archive.counts[name] !== metadata.count) throw new Error('Archive collection count mismatch: ' + name);
  }

  const { paths, issues } = mediaReferences(archive.store, archive.data, expectedTenantId, archive.mediaOrigins);
  if (issues.length || !Array.isArray(archive.media) || !Array.isArray(archive.manifest.media) ||
      archive.media.length !== paths.length || archive.manifest.media.length !== paths.length) {
    throw new Error('Archive media manifest does not match the referenced uploads.');
  }
  archive.media.forEach((item, index) => {
    const metadata = archive.manifest.media[index];
    if (item?.path !== paths[index] || metadata?.path !== paths[index] || typeof item.content !== 'string') {
      throw new Error('Invalid or mismatched archive media path.');
    }
    const bytes = Buffer.from(item.content, 'base64');
    if (item.content !== bytes.toString('base64') || bytes.length !== metadata.bytes || hash(bytes) !== metadata.sha256) {
      throw new Error('Archive media checksum or size mismatch.');
    }
  });
  return reconcileBackup(archive.data);
}

export async function assertRestoreReady(db, uploadsRoot) {
  if (!restoreDatabasePattern.test(db.databaseName)) return;
  const marker = await db.collection(restoreMarker).findOne({ _id: 'restore', state: 'verified' });
  if (!marker) throw new Error('Restore database has not passed verification.');
  const receipt = JSON.parse(await readFile(path.join(uploadsRoot, '.restore-verified.json'), 'utf8'));
  if (receipt.tenantId !== marker.tenantId || receipt.databaseName !== db.databaseName ||
      receipt.uploadsDirectory !== path.resolve(uploadsRoot)) {
    throw new Error('Restored database and uploads do not belong to the same verified recovery.');
  }
}

async function restoreMedia(target, archive) {
  for (const { path: relative, content } of archive.media) {
    const destination = path.join(target, ...relative.split('/'));
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, Buffer.from(content, 'base64'), { flag: 'wx', mode: 0o600, flush: true });
  }
}

async function compareRestore(db, uploads, archive) {
  const restoredData = {};
  for (const [name, model] of Object.entries(archiveModels)) {
    const rows = await db.collection(model.collection.name).find({}, orderedBson).toArray();
    const documents = rows.map((row) => encodeDocument(row, 'recovery'));
    const payload = name === 'store' ? documents[0] : documents;
    const metadata = entryMetadata(payload, rows.length);
    assert.deepStrictEqual(metadata, archive.manifest.collections[name], 'Restored collection mismatch: ' + name);
    if (name !== 'store') restoredData[name] = documents;
  }
  for (const media of archive.manifest.media) {
    const bytes = await readBackupMedia(uploads, media.path);
    if (bytes.length !== media.bytes || hash(bytes) !== media.sha256) {
      throw new Error('Restored media checksum or size mismatch.');
    }
  }
  return reconcileBackup(restoredData);
}

export async function restoreTenantBackup(client, {
  databaseName, uploadsDirectory, archive, expectedTenantId, sourceDatabaseName, signal,
}) {
  const before = validateRecoveryArchive(archive, expectedTenantId);
  if (!restoreDatabasePattern.test(databaseName) || databaseName === sourceDatabaseName) {
    throw new Error('Restore requires a separate smart_kirana_restore_* database.');
  }
  const db = client.db(databaseName);
  if (await db.listCollections({}, { nameOnly: true }).hasNext()) {
    throw new Error('Restore database must be empty and dedicated to this run.');
  }
  signal?.throwIfAborted();
  const uploads = path.resolve(uploadsDirectory);
  if (await realpath(path.dirname(uploads)) !== path.dirname(uploads)) {
    throw new Error('Restore uploads parent must be a real directory.');
  }
  await mkdir(uploads, { mode: 0o700 });
  const marker = db.collection(restoreMarker);
  await marker.insertOne(
    { _id: 'restore', state: 'staging', tenantId: expectedTenantId, startedAt: new Date() },
    { writeConcern: { w: 'majority' } },
  );
  await restoreMedia(uploads, archive);
  signal?.throwIfAborted();

  for (const model of Object.values(archiveModels)) {
    const collection = await db.createCollection(model.collection.name);
    for (const [keys, options] of model.schema.indexes()) {
      await collection.createIndex(keys, options);
    }
  }
  await client.withSession((session) => session.withTransaction(async () => {
    for (const [name, model] of Object.entries(archiveModels)) {
      const rows = name === 'store' ? [archive.store] : archive.data[name];
      const collection = db.collection(model.collection.name);
      for (let start = 0; start < rows.length; start += 500) {
        signal?.throwIfAborted();
        await collection.insertMany(rows.slice(start, start + 500).map(decodeDocument), { session });
      }
    }
    signal?.throwIfAborted();
  }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } }));

  const after = await compareRestore(db, uploads, archive);
  assert.deepStrictEqual(after, before, 'Restored financial reconciliation differs from the backup.');
  signal?.throwIfAborted();
  const result = {
    tenantId: expectedTenantId, databaseName, uploadsDirectory: uploads,
    snapshotTime: archive.snapshotTime, restoredAt: new Date().toISOString(),
    counts: archive.counts, mediaCount: archive.media.length, reconciliation: { before, after },
  };
  await writeFile(path.join(uploads, '.restore-verified.json'), JSON.stringify(result, null, 2), {
    flag: 'wx', mode: 0o600, flush: true,
  });
  await marker.updateOne({ _id: 'restore', state: 'staging' }, {
    $set: { state: 'verified', restoredAt: new Date() },
  }, { writeConcern: { w: 'majority' } });
  return result;
}
