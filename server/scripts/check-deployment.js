import { parseArgs } from 'node:util';
import dotenv from 'dotenv';

const { values } = parseArgs({ options: {
  'env-file': { type: 'string' },
  ephemeral: { type: 'boolean', default: false },
} });
const loaded = dotenv.config({ path: values['env-file'] || '.env' });
if (values['env-file'] && loaded.error) {
  console.error('Could not read the specified environment file.');
  process.exit(1);
}

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

try {
  // Reuse the API's actual startup validation for secrets, storage and proxy CIDRs.
  const { env } = await import('../src/config/env.js');
  check('production mode', env.isProduction, 'NODE_ENV must be production.');
  check('startup validation', true, 'API environment validation passed.');
  const origins = env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
  check('HTTPS origins', origins.length && origins.every((origin) => {
    try {
      const url = new URL(origin);
      return url.protocol === 'https:' && url.origin === origin && !url.username && !url.password
        && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        && !/YOUR_|REPLACE_|example\./i.test(origin);
    } catch { return false; }
  }), 'CORS_ORIGINS must contain the actual HTTPS site origin(s), without paths or placeholders.');
  check('named remote database', /^mongodb(?:\+srv)?:\/\/[^/]+\/[a-zA-Z0-9_-]+(?:\?.*)?$/.test(env.MONGODB_URI)
    && !/localhost|127\.0\.0\.1|YOUR_CLUSTER|ENCODED_PASSWORD/i.test(env.MONGODB_URI),
  'Use a remote MongoDB URI with an explicit database name. Verify replica-set readiness at /ready.');
  check('proxy configured', Boolean(env.TRUSTED_PROXY_CIDRS), 'Set only the real ingress proxy IP/CIDRs. The supplied Compose configuration provides these.');
  check('port', Number.isInteger(env.PORT) && env.PORT > 0 && env.PORT <= 65535, 'Use the hosting platform port, or 5000 behind the supplied Caddy proxy.');
  const cloud = process.env.IMAGE_STORAGE === 'imagekit';
  check('durable uploads', cloud || !values.ephemeral, cloud
    ? 'Cloud storage selected; verify the ImageKit account separately.'
    : 'Local uploads require a persistent mounted volume; use --ephemeral for a host without one.');
  if (cloud) {
    check('ImageKit key', /^private_[a-zA-Z0-9+/=_-]+$/.test(process.env.IMAGEKIT_PRIVATE_KEY || ''), 'A server-only ImageKit private key is required.');
    check('ImageKit folder', /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test((process.env.IMAGEKIT_FOLDER || '').replace(/^\/+|\/+$/g, '')),
      'Use a dedicated folder for this production database.');
  }
} catch (error) {
  check('startup validation', false, error.message);
}

console.log(JSON.stringify({ ready: checks.every((entry) => entry.ok), scope: 'configuration only; no network or load checks', checks }, null, 2));
process.exitCode = checks.every((entry) => entry.ok) ? 0 : 1;
