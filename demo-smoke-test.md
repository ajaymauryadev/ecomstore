# Smart Kirana verification and demo workflow

The normal verification path is isolated and does not connect to the configured application database.

## Safe automated verification

From `server/`:

```powershell
npm test
npm audit --omit=dev
```

The server suite starts a temporary in-memory MongoDB replica set and covers authentication, refresh rotation, password-session invalidation, role and tenant boundaries, customer and guest order privacy, checkout manipulation, coupon concurrency, stock overselling, transaction rollback, idempotent cancellation, POS manipulation, upload signatures, and missing-store responses. It is destroyed after the suite.

From `client/`:

```powershell
npm run lint
npm test
npm run test:e2e
npm run build
npm audit --omit=dev
```

The browser smoke suite uses mocked API responses. It covers owner, packer,
delivery, customer and super-admin layouts, including 390 px mobile and desktop
views. It checks role-scoped navigation, keyboard controls and the owner shell
during a delayed route load. Run `npm run test:e2e:storefront -- pos-walkin.spec.js`
from `client` for the POS workflow with the isolated API and MongoDB.

## Route and cache measurements

Local measurements on 2026-11-21 compare the built pre-change and updated
clients in Chromium at 1440 × 900. Each build had six fresh contexts, with 150 ms
added before JavaScript requests and 100 ms before mock API responses. Browser
times are median milliseconds from the Playwright click to the named visible
result. The first Products click ran 750 ms after the dashboard became visible
to allow the idle prefetch to finish.

| Measurement | Baseline | After |
| --- | ---: | ---: |
| Inventory click to loading feedback | 264 ms | 60 ms |
| Cached Products click to first visible row | 67 ms | 69 ms |
| Sign-in click to dashboard heading | 895 ms | 888 ms |
| First Products click to first visible row after idle | 875 ms | 73 ms |
| Local read API p95 | 14.5 ms | 14.5 ms |

Read API p95 is a separate loopback control with 30 requests per column. Both
sets used the same Express server and disposable MongoDB replica set. Requests
cycled through the dashboard, Products and Orders endpoints with 20 synthetic
products. The staging deployment, staging dataset and physical owner device
were unavailable for this run, so the staging baseline and after measurements
remain pending.

## Destructive demo reset (approval required)

`npm run demo:reset` and `npm run demo:seed` intentionally delete and recreate data belonging to the `demo-kirana` tenant in the database selected by `MONGODB_URI`. They are disabled by default and must never be pointed at a production database.

Only after the target database has been explicitly approved as disposable, supply a temporary password through the process environment and opt in:

```powershell
$env:ALLOW_DEMO_RESET='I_UNDERSTAND_THIS_DELETES_DEMO_TENANT_DATA'
$env:DEMO_PASSWORD='<temporary value of at least 10 characters>'
npm run demo:reset
```

The password is not stored in the repository or printed by the script. Clear both process variables afterward.

## Live API demo verification (approval required)

`npm run demo:verify` exercises the database selected by `MONGODB_URI` and can start an embedded API server. Run it only against an explicitly approved test/demo database after the demo data has been prepared:

```powershell
$env:ALLOW_DEMO_VERIFY='true'
$env:DEMO_PASSWORD='<the temporary demo password>'
npm run demo:verify
```

No demo reset or live-database smoke test is part of the default test command. The customer storefront is `/s/demo-kirana`; role dashboards are `/store/dashboard`, `/staff/dashboard`, and `/super-admin/dashboard` when matching demo accounts exist.
