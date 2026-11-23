import assert from 'node:assert/strict';

const site = new URL(process.argv[2] ?? '');
assert.equal(site.protocol, 'https:', 'Use the HTTPS staging origin.');
assert.equal(site.pathname, '/', 'Pass an origin rather than a route.');

const checks = [];
const get = (path, options = {}) => fetch(new URL(path, site.origin), {
  signal: AbortSignal.timeout(10_000),
  redirect: 'error',
  ...options,
});
const status = async (path, expected, options) => {
  const response = await get(path, options);
  assert.equal(response.status, expected, path);
  return response;
};

const ready = await status('/ready', 200);
assert.equal((await ready.json()).status, 'ready');
assert.match(ready.headers.get('cache-control') ?? '', /no-store/);
await status('/health', 200);
checks.push('API liveness and replica-set readiness');

const page = await status('/store/pos', 200);
assert.match(page.headers.get('content-type') ?? '', /text\/html/);
assert.match(page.headers.get('cache-control') ?? '', /no-cache/);
const html = await page.text();
const asset = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
assert.ok(asset, 'The production HTML should reference a hashed script.');
const script = await status(asset, 200);
assert.match(script.headers.get('cache-control') ?? '', /max-age=31536000.*immutable/);
const missing = await status('/assets/absent-9ZYXabcd.js', 404);
assert.doesNotMatch(missing.headers.get('cache-control') ?? '', /immutable/);
const apiMissing = await status('/api/v1/staging-smoke-missing', 404);
assert.match(apiMissing.headers.get('content-type') ?? '', /application\/json/);
checks.push('SPA navigation, asset caching and distinct API 404s');

const preflight = (origin) => ({
  method: 'OPTIONS',
  headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Authorization' },
});
const allowed = await status('/api/v1/auth/me', 204, preflight(site.origin));
assert.equal(allowed.headers.get('access-control-allow-origin'), site.origin);
assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
const denied = await status('/api/v1/auth/me', 403, preflight('https://origin.invalid'));
assert.equal(denied.headers.get('access-control-allow-origin'), null);
const privateRead = await status('/api/v1/auth/me', 401);
assert.match(privateRead.headers.get('cache-control') ?? '', /private.*no-store/);
checks.push('CORS allowlist and no-store private responses');

const { STAGING_SMOKE_EMAIL: email, STAGING_SMOKE_PASSWORD: password } = process.env;
if (email || password) {
  assert.ok(email && password, 'Supply both synthetic account settings.');
  const login = await status('/api/v1/auth/login', 200, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: site.origin },
    body: JSON.stringify({ email, password }),
  });
  const cookie = login.headers.getSetCookie().find((header) => header.startsWith('refreshToken='));
  assert.ok(cookie, 'Login should set a refresh cookie.');
  for (const flag of [/;\s*Secure(?:;|$)/i, /;\s*HttpOnly(?:;|$)/i, /;\s*SameSite=None(?:;|$)/i, /;\s*Path=\/api\/v1\/auth(?:;|$)/i]) {
    assert.match(cookie, flag);
  }
  const rotated = await status('/api/v1/auth/refresh', 200, {
    method: 'POST', headers: { Origin: site.origin, Cookie: cookie.split(';', 1)[0] },
  });
  const result = await rotated.json();
  assert.ok(result.data?.accessToken);
  const nextCookie = rotated.headers.getSetCookie().find((header) => header.startsWith('refreshToken='));
  assert.ok(nextCookie, 'Refresh should set a replacement cookie.');
  assert.notEqual(nextCookie.split(';', 1)[0], cookie.split(';', 1)[0]);
  const account = await status('/api/v1/auth/me', 200, {
    headers: { Authorization: 'Bearer ' + result.data.accessToken },
  });
  assert.match(account.headers.get('cache-control') ?? '', /private.*no-store/);
  await status('/api/v1/auth/logout', 200, {
    method: 'POST',
    headers: {
      Origin: site.origin,
      Cookie: nextCookie.split(';', 1)[0],
    },
  });
  checks.push('HTTPS-only refresh cookie, rotation and logout');
} else {
  checks.push('Cookie rotation skipped without a synthetic account');
}

console.log(JSON.stringify({ origin: site.origin, checks }, null, 2));
