import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdir, readdir, stat, writeFile } from 'fs/promises';
import { deleteStoredImage, remoteTenantBytes, uploadRemoteAsset, usesImageKit } from '../services/imageStorage.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_ROOT = process.env.SMART_KIRANA_UPLOADS_ROOT
  ? path.resolve(process.env.SMART_KIRANA_UPLOADS_ROOT)
  : path.resolve(__dirname, '../../../uploads');
export const PUBLIC_UPLOADS_ROOT = path.join(UPLOADS_ROOT, 'public');
export const PRIVATE_PAYMENT_ROOT = path.join(UPLOADS_ROOT, 'private', 'payment-proofs');

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;
const MAX_DIMENSION = 8192;
const PUBLIC_QUOTA_BYTES = 250 * 1024 * 1024;
const PAYMENT_QUOTA_BYTES = 50 * 1024 * 1024;

const memoryStorage = multer.memoryStorage();
const imageFilter = (req, file, callback) => {
  if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.mimetype)) {
    return callback(new Error('Only JPEG, PNG, and WebP images are accepted.'));
  }
  callback(null, true);
};

const singleParser = (field) => multer({
  storage: memoryStorage,
  fileFilter: imageFilter,
  limits: { fileSize: MAX_INPUT_BYTES, files: 1, fields: 10, parts: 12 },
}).single(field);

const multipleParser = multer({
  storage: memoryStorage,
  fileFilter: imageFilter,
  limits: { fileSize: MAX_INPUT_BYTES, files: 5, fields: 5, parts: 10 },
}).array('images', 5);

const hasSupportedSignature = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return jpeg || png || webp;
};

const directorySize = async (directory) => {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  let total = 0;
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySize(entryPath);
    else if (entry.isFile()) total += (await stat(entryPath)).size;
  }
  return total;
};

const encodeSafeWebp = async (file) => {
  if (!hasSupportedSignature(file.buffer)) throw new Error('Image signature does not match an allowed format.');
  const { default: sharp } = await import('sharp');
  const pipeline = sharp(file.buffer, {
    failOn: 'error',
    limitInputPixels: MAX_PIXELS,
    pages: 1,
  });
  const metadata = await pipeline.metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height ||
      metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION ||
      metadata.pages > 1 || metadata.width * metadata.height > MAX_PIXELS) {
    throw new Error('Image dimensions, pages, or decoded format are not allowed.');
  }
  return pipeline
    .rotate()
    .resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
};

const attachCleanup = (req, res, storageKeys) => {
  req.retainUploadedFiles = () => { req.uploadsRetained = true; };
  res.once('finish', () => {
    if (req.uploadsRetained) return;
    storageKeys.forEach((key) => { void deleteStoredImage(key, UPLOADS_ROOT).catch(() => {}); });
  });
};

const processFiles = async ({ req, res, files, visibility }) => {
  const tenantId = req.tenantId?.toString();
  if (!tenantId) throw new Error('Tenant context is required for uploads.');
  const isPrivate = visibility === 'payment';
  const tenantRoot = path.join(isPrivate ? PRIVATE_PAYMENT_ROOT : PUBLIC_UPLOADS_ROOT, tenantId);
  const quota = isPrivate ? PAYMENT_QUOTA_BYTES : PUBLIC_QUOTA_BYTES;
  if (!usesImageKit()) await mkdir(tenantRoot, { recursive: true });
  const existingSize = usesImageKit() ? await remoteTenantBytes(tenantId, isPrivate) : await directorySize(tenantRoot);
  const encoded = [];
  let incomingSize = 0;
  for (const file of files) {
    const buffer = await encodeSafeWebp(file);
    incomingSize += buffer.length;
    encoded.push({ buffer, filename: `${crypto.randomUUID()}.webp` });
  }
  if (existingSize + incomingSize > quota) throw new Error('Upload storage quota exceeded.');

  const storageKeys = [];
  const stored = [];
  try {
    for (const image of encoded) {
      const absolutePath = path.join(tenantRoot, image.filename);
      const key = `${isPrivate ? 'private/payment-proofs' : 'public'}/${tenantId}/${image.filename}`;
      if (usesImageKit()) await uploadRemoteAsset({ key, buffer: image.buffer, isPrivate, tenantId });
      else await writeFile(absolutePath, image.buffer, { flag: 'wx', mode: 0o640 });
      storageKeys.push(key);
      stored.push({
        filename: image.filename,
        mimetype: 'image/webp',
        size: image.buffer.length,
        storagePath: `${tenantId}/${image.filename}`,
        url: isPrivate ? undefined : `/uploads/${tenantId}/${image.filename}`,
      });
    }
  } catch (error) {
    await Promise.all(storageKeys.map((key) => deleteStoredImage(key, UPLOADS_ROOT).catch(() => {})));
    throw error;
  }
  attachCleanup(req, res, storageKeys);
  return stored;
};

const wrapSingle = (field, visibility) => {
  const parser = singleParser(field);
  return (req, res, callback) => {
    parser(req, res, async (parseError) => {
      if (parseError) return callback(parseError);
      if (!req.file) return callback();
      try {
        [req.file] = await processFiles({ req, res, files: [req.file], visibility });
        callback();
      } catch (error) {
        callback(error);
      }
    });
  };
};

export const uploadSingle = wrapSingle('image', 'public');
export const uploadPaymentProof = wrapSingle('screenshot', 'payment');

export const uploadMultiple = (req, res, callback) => {
  multipleParser(req, res, async (parseError) => {
    if (parseError) return callback(parseError);
    if (!req.files?.length) return callback();
    try {
      req.files = await processFiles({ req, res, files: req.files, visibility: 'public' });
      callback();
    } catch (error) {
      callback(error);
    }
  });
};

export const resolvePaymentProofPath = (storagePath) => {
  const resolved = path.resolve(PRIVATE_PAYMENT_ROOT, String(storagePath || ''));
  const root = `${path.resolve(PRIVATE_PAYMENT_ROOT)}${path.sep}`;
  if (!resolved.startsWith(root)) throw new Error('Invalid stored payment proof path.');
  return resolved;
};
