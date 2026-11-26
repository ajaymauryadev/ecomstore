// Fresh-process import cost; no database connection and no .env loading.
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv.includes('--sample')) {
  const root = await mkdtemp(path.join(tmpdir(), 'kirana-import-'));
  Object.assign(process.env, {
    NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:1/unused', IMAGE_STORAGE: 'local',
    JWT_ACCESS_SECRET: 'local-benchmark-access', JWT_REFRESH_SECRET: 'local-benchmark-refresh',
    COOKIE_SECRET: 'local-benchmark-cookie', SMART_KIRANA_UPLOADS_ROOT: root,
  });
  const start = performance.now();
  await import('../src/app.js');
  console.log(JSON.stringify({ importMs: performance.now() - start,
    rssMiB: process.memoryUsage().rss / 1024 / 1024 }));
  await rm(root, { recursive: true, force: true });
} else {
  const samples = Array.from({ length: 5 }, () => JSON.parse(execFileSync(process.execPath,
    [fileURLToPath(import.meta.url), '--sample'], { encoding: 'utf8' })));
  const median = (key) => Number(samples.map((s) => s[key]).sort((a, b) => a - b)[2].toFixed(2));
  const report = { scope: 'Five fresh Node processes importing app; no DB, listening socket or hosted cold start.',
    medianImportMs: median('importMs'), medianRssMiB: median('rssMiB'), samples };
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
