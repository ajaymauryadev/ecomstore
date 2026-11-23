import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import mongoose from 'mongoose';
import { PRIVATE_PAYMENT_ROOT, PUBLIC_UPLOADS_ROOT } from '../middleware/upload.js';

let runningProbe;

export async function isApiReady() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return false;
  runningProbe ??= (async () => {
    await Promise.all([PUBLIC_UPLOADS_ROOT, PRIVATE_PAYMENT_ROOT].map((directory) =>
      access(directory, constants.R_OK | constants.W_OK | constants.X_OK)));
    const topology = await mongoose.connection.db.admin().command({ hello: 1, maxTimeMS: 1000 });
    return topology.isWritablePrimary === true && Boolean(topology.setName || topology.msg === 'isdbgrid');
  })().catch(() => false).finally(() => { runningProbe = undefined; });

  let timer;
  try {
    return await Promise.race([
      runningProbe,
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), 1500); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
