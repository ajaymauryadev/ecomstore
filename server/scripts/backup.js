import { randomUUID } from 'node:crypto';
import { realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { UPLOADS_ROOT } from '../src/middleware/upload.js';
import { assertPrivatePath, loadBackupKey, readEncryptedBackup, writeEncryptedBackup } from '../src/services/backupEncryption.js';
import { archiveModels } from '../src/services/backupModels.js';
import { restoreDatabasePattern, restoreTenantBackup, validateRecoveryArchive } from '../src/services/backupRestore.js';
import { captureTenantBackup, inspectTenantBackup } from '../src/services/tenantBackup.service.js';

const hourMs = 60 * 60 * 1000;
const required = (name) => {
  if (!process.env[name]) throw new Error('Missing configuration: ' + name);
  return process.env[name];
};
const print = (result) => console.log(JSON.stringify(result, null, 2));
const within = (directory, target) => {
  const relative = path.relative(directory, target);
  return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};

async function vaultPath() {
  const vault = await assertPrivatePath(required('BACKUP_VAULT'), true);
  const uploads = await realpath(UPLOADS_ROOT).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return UPLOADS_ROOT;
  });
  if (within(uploads, vault)) throw new Error('The backup vault must be outside the application uploads directory.');
  return vault;
}

const sourceConnection = () => mongoose.createConnection(required('BACKUP_SOURCE_URI'), {
  dbName: required('BACKUP_SOURCE_DB'),
  autoCreate: false,
  autoIndex: false,
  serverSelectionTimeoutMS: 10_000,
}).asPromise();

async function alertFailure(command) {
  const webhook = new URL(required('BACKUP_ALERT_URL'));
  if (webhook.protocol !== 'https:') throw new Error('BACKUP_ALERT_URL must use HTTPS.');
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Smart Kirana tenant backup ' + command + ' failed. Check the backup worker logs.' }),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error('Backup alert endpoint returned HTTP ' + response.status + '.');
}

async function runAll(command) {
  const alert = new URL(required('BACKUP_ALERT_URL'));
  if (alert.protocol !== 'https:') throw new Error('BACKUP_ALERT_URL must use HTTPS.');
  const vault = await vaultPath();
  const key = command === 'create' ? await loadBackupKey(required('BACKUP_KEY_FILE')) : null;
  const connection = await sourceConnection();
  try {
    const archived = new Map();
    if (command === 'status') {
      for (const entry of await readdir(vault, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const match = /^([a-f0-9]{24})-(\d{13})-[a-f0-9-]{36}\.skbackup$/.exec(entry.name);
        if (match) archived.set(match[1], Math.max(archived.get(match[1]) || 0, Number(match[2])));
      }
    }
    const stores = connection.db.collection(archiveModels.store.collection.name);
    let attempted = 0;
    let failures = 0;
    for await (const { _id } of stores.find({}, { projection: { _id: 1 } }).sort({ _id: 1 })) {
      const tenantId = String(_id);
      attempted += 1;
      try {
        if (command === 'status') {
          const age = Date.now() - (archived.get(tenantId) || 0);
          if (age > 1.5 * hourMs || age < 0) throw new Error('No recent finalized backup.');
        } else {
          const startedAt = Date.now();
          const archive = await captureTenantBackup(tenantId, { connection });
          await writeEncryptedBackup(vault, tenantId + '-' + startedAt + '-' + randomUUID() + '.skbackup', archive, key);
        }
      } catch (error) {
        failures += 1;
        console.error('Tenant ' + tenantId + ': ' + (error.name === 'AppError' ? error.message : error.code || error.name));
      }
    }
    print({ command, attempted, failures });
    if (failures) throw new Error(failures + ' tenant backup checks or exports failed.');
  } finally {
    await connection.close();
  }
}

async function main() {
  const [command, first, second, third, fourth, ...extra] = process.argv.slice(2);
  if (['create', 'status'].includes(command) && !first) {
    await runAll(command);
    return;
  }
  if (command === 'inspect' && first && !second) {
    const connection = await sourceConnection();
    try {
      print(await inspectTenantBackup(first, { connection }));
    } finally {
      await connection.close();
    }
    return;
  }
  if (command === 'check' && first && second && !third) {
    const archive = await readEncryptedBackup(first, await loadBackupKey(required('BACKUP_KEY_FILE')));
    print({ tenantId: second, counts: archive.counts, mediaCount: archive.media.length, reconciliation: validateRecoveryArchive(archive, second) });
    return;
  }
  if (command === 'restore' && first && second && third && fourth && !extra.length) {
    if (!restoreDatabasePattern.test(third) || third === process.env.BACKUP_SOURCE_DB) {
      throw new Error('A dedicated restore database is required.');
    }
    const destination = path.resolve(fourth);
    const liveUploads = path.resolve(UPLOADS_ROOT);
    if (within(liveUploads, destination) || within(destination, liveUploads)) {
      throw new Error('Choose a restore uploads directory separate from the application uploads directory.');
    }
    const archive = await readEncryptedBackup(first, await loadBackupKey(required('BACKUP_KEY_FILE')));
    const client = new mongoose.mongo.MongoClient(required('BACKUP_RESTORE_URI'), { serverSelectionTimeoutMS: 10_000 });
    const abort = new AbortController();
    const stop = () => abort.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      await client.connect();
      print(await restoreTenantBackup(client, {
        databaseName: third, uploadsDirectory: destination, archive, expectedTenantId: second,
        sourceDatabaseName: process.env.BACKUP_SOURCE_DB, signal: abort.signal,
      }));
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      await client.close();
    }
    return;
  }
  throw new Error('Usage: backup.js create | status | inspect TENANT | check ARCHIVE TENANT | restore ARCHIVE TENANT DATABASE NEW_UPLOADS_DIRECTORY');
}

try {
  await main();
} catch (error) {
  const command = process.argv[2];
  console.error(error.message);
  if (['create', 'status'].includes(command)) {
    try {
      await alertFailure(command);
    } catch {
      console.error('Backup failure could not be delivered to the alert endpoint.');
    }
  }
  process.exitCode = 1;
}
