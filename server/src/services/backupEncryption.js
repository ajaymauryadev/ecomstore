import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { link, lstat, open, readFile, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { archiveLimitBytes } from './tenantBackup.service.js';

const magic = Buffer.from('SKBACKUP2\n');
const nonceLength = 12;
const tagLength = 16;
const zip = promisify(gzip);
const unzip = promisify(gunzip);

export async function assertPrivatePath(filePath, directory = false) {
  const resolved = path.resolve(filePath);
  const metadata = await lstat(resolved);
  if ((directory ? !metadata.isDirectory() : !metadata.isFile()) || await realpath(resolved) !== resolved) {
    throw new Error('Backup storage must use a real file or directory without symlinks.');
  }
  if (process.platform !== 'win32' && (metadata.mode & 0o077)) {
    throw new Error('Backup storage must be accessible only to its service account.');
  }
  return resolved;
}

export async function loadBackupKey(filePath) {
  const keyPath = await assertPrivatePath(filePath);
  if ((await lstat(keyPath)).size > 100) throw new Error('Invalid backup key file.');
  const encoded = (await readFile(keyPath, 'utf8')).trim();
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new Error('Backup key must contain 32 random bytes encoded as base64.');
  }
  return key;
}

export async function encryptBackup(archive, key) {
  if (archive.kind !== 'recovery') throw new Error('Only recovery archives may be encrypted for restore.');
  const document = Buffer.from(JSON.stringify(archive));
  if (document.length > archiveLimitBytes) throw new Error('Recovery archive exceeds the supported size.');
  const nonce = randomBytes(nonceLength);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(magic);
  const compressed = await zip(document);
  const ciphertext = cipher.update(compressed);
  cipher.final();
  return Buffer.concat([magic, nonce, ciphertext, cipher.getAuthTag()]);
}

export async function decryptBackup(archive, key) {
  const offset = magic.length + nonceLength;
  if (archive.length <= offset + tagLength || !archive.subarray(0, magic.length).equals(magic)) {
    throw new Error('Unsupported or incomplete encrypted backup.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, archive.subarray(magic.length, offset));
  decipher.setAAD(magic);
  decipher.setAuthTag(archive.subarray(-tagLength));
  let compressed;
  try {
    compressed = decipher.update(archive.subarray(offset, -tagLength));
    decipher.final();
  } catch {
    throw new Error('Encrypted backup authentication failed.');
  }
  const document = await unzip(compressed, { maxOutputLength: archiveLimitBytes });
  return JSON.parse(document.toString('utf8'));
}

export async function writeEncryptedBackup(directory, filename, archive, key) {
  const encrypted = await encryptBackup(archive, key);
  const destination = path.join(directory, filename);
  const temporary = path.join(directory, '.' + randomBytes(16).toString('hex') + '.partial');
  const file = await open(temporary, 'wx', 0o600);
  try {
    try {
      await file.writeFile(encrypted);
      await file.sync();
    } finally {
      await file.close();
    }
    await link(temporary, destination);
    if (process.platform !== 'win32') {
      const vault = await open(directory, 'r');
      try {
        await vault.sync();
      } finally {
        await vault.close();
      }
    }
  } finally {
    await unlink(temporary);
  }
  return destination;
}

export async function readEncryptedBackup(filePath, key) {
  const archive = await assertPrivatePath(filePath);
  if ((await lstat(archive)).size > archiveLimitBytes + 1024 * 1024) {
    throw new Error('Encrypted backup exceeds the supported size.');
  }
  return decryptBackup(await readFile(archive), key);
}
