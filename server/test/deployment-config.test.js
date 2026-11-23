import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const run = (overrides = {}, args = []) => {
  const result = spawnSync(process.execPath, ['scripts/check-deployment.js', ...args], {
    cwd, encoding: 'utf8', env: {
      ...process.env, NODE_ENV: 'production', PORT: '5000',
      MONGODB_URI: 'mongodb+srv://app:encoded@cluster.mongodb.net/smart-kirana?retryWrites=true&w=majority',
      JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
      JWT_REFRESH_SECRET: randomBytes(48).toString('hex'),
      COOKIE_SECRET: randomBytes(48).toString('hex'),
      CORS_ORIGINS: 'https://kirana.test', TRUSTED_PROXY_CIDRS: '172.30.22.2/32',
      IMAGE_STORAGE: 'imagekit', IMAGEKIT_PRIVATE_KEY: 'private_configcheck', IMAGEKIT_FOLDER: '/smart-kirana/production',
      ...overrides,
    },
  });
  return { code: result.status, report: JSON.parse(result.stdout), output: result.stdout };
};

test('accepts the supplied production topology without disclosing credentials', () => {
  const result = run({}, ['--ephemeral']);
  expect(result.code).toBe(0);
  expect(result.report.ready).toBe(true);
  expect(result.output).not.toContain('private_configcheck');
  expect(result.output).not.toContain('app:encoded');
});

test('rejects localhost frontend origins and development mode', () => {
  const result = run({ NODE_ENV: 'development', CORS_ORIGINS: 'http://localhost:5173' });
  expect(result.code).toBe(1);
  expect(result.report.checks).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'production mode', ok: false }),
    expect.objectContaining({ name: 'HTTPS origins', ok: false }),
  ]));
});

test('rejects local upload storage on an ephemeral host', () => {
  const result = run({ IMAGE_STORAGE: 'local' }, ['--ephemeral']);
  expect(result.code).toBe(1);
  expect(result.report.checks).toContainEqual(expect.objectContaining({ name: 'durable uploads', ok: false }));
});

test('uses the real startup validator to reject weak production secrets', () => {
  const result = run({ JWT_ACCESS_SECRET: 'change-me' });
  expect(result.code).toBe(1);
  expect(result.report.checks).toContainEqual(expect.objectContaining({ name: 'startup validation', ok: false }));
  expect(result.output).not.toContain('change-me');
});
