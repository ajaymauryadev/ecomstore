# Hosting and performance

## Northflank setup — 25 November 2026

For the connected Northflank Free team, use the
[Northflank deployment guide](northflank/README.md). It includes a dedicated
Dockerfile serving the frontend and API on one HTTPS origin, production
configuration validation, readiness/liveness endpoints, safe public-ingress
client-IP forwarding, and external MongoDB/ImageKit storage. Select only the
account's free compute allocation. Deployment and live checks must be verified
separately; adding these files does not publish the app. The earlier Oracle
review below remains an alternative with greater VM administration needs.

## Free-host deployment review — 23 November 2026

For this store's Node/Express API, Socket.IO, MongoDB transactions and media,
the preferred zero-cost starting point is the existing
[Oracle Always Free setup](free/README.md), with Atlas Free and ImageKit.
This is an architectural recommendation, not a hosted performance measurement.
Choose the nearest available API and database regions, ideally Mumbai for these
users. Keep one API instance with the current in-process socket rooms and limits.

| Option | Fit for this application | Current limitation |
| --- | --- | --- |
| Oracle Always Free + Atlas Free + ImageKit | Preferred free setup for a small store; supplied Compose and Caddy configuration serves everything on one HTTPS origin | Account verification and free capacity are required; idle instances may be reclaimed. VM maintenance and backups are your responsibility. |
| Render Free API + Atlas Free + ImageKit | Suitable for a demo or an initial low-traffic trial; run the existing server with `npm ci --omit=dev` and `npm start` from `server` | Sleeps after 15 idle minutes, roughly one minute to wake; ephemeral disk. Free API compute is not a measured capacity guarantee for daily billing. Frontend hosting, exact origins and ingress proxy trust must be configured separately. |
| Render Static Site | Free CDN hosting for `client/dist`; build from `client` with `npm ci && npm run build` and rewrite SPA routes to `/index.html` | Only the frontend. It does not replace the Node API, Atlas or image storage. |
| Vercel Hobby | Personal/non-commercial previews only for this project | Current Hobby terms restrict commercial use. Vercel's June 2026 WebSocket beta exists, but this persistent Node process, socket rooms and cleanup scheduler have not been adapted or verified on Vercel Functions. |

Sources checked on the review date:
[Oracle allowances and reclamation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm),
[Render free limitations](https://render.com/docs/free),
[Render static hosting](https://render.com/docs/static-sites),
[Vercel terms](https://vercel.com/legal/terms),
[Vercel WebSocket beta](https://vercel.com/changelog/websocket-support-is-now-in-public-beta),
[Atlas limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/),
[ImageKit free plan](https://imagekit.io/plans/).
Oracle currently includes 2 A1 OCPUs / 12 GB RAM equivalent within its monthly
allowance. Atlas Free has 512 MB for data and indexes; ImageKit's Forever Free
plan includes 3 GB storage and 20 GB monthly bandwidth. Stay within the account's
displayed limits and keep a database/media backup outside the application host.

Production configuration references:
[API environment](../server/.env.production.example) and
[frontend build environment](../client/.env.production.example).
Do not deploy the ignored local `.env` files: the current development settings
use development mode, localhost API/socket URLs and localhost CORS origins.
The existing Docker build already overrides frontend URLs for same-origin use;
the Compose deployment injects the production mode, exact HTTPS origin, trusted
Caddy proxy address and durable upload mount. `configure.sh` generates separate
random production secrets outside the checkout.

The new `npm run deploy:check` command checks the actual runtime environment
without printing credentials. It verifies production startup validation, HTTPS
origins, a named remote database, proxy configuration and image storage. It runs
automatically inside the API container in `deploy/free/deploy.sh`. For a separate
environment file, run `npm run deploy:check -- --env-file PATH`; add `--ephemeral`
when checking a Render-like host without a persistent disk. A passing result is
configuration validation only; live TLS, cookies, socket connectivity, image
durability and latency still need verification on the chosen host. Existing
`deploy/staging/smoke.mjs` checks the deployed HTTPS origin.

This review verified the Atlas connection is a writable replica set with
sessions, and ImageKit accepts private uploads, allows signed original downloads
and rejects unsigned access. The temporary ImageKit verification asset was
deleted. Both production dependency audits returned zero known vulnerabilities;
135 existing server tests, 72 client tests, and the production client build
passed. All four additional deployment-preflight tests passed in
`server/test/deployment-config.test.js`. Shell syntax and the free Compose
configuration parsed successfully. The deployment-mode client build used
`VITE_API_URL=/api/v1`, an empty `VITE_WS_URL` and enabled live updates; generated
JavaScript was checked for localhost API references and none were present.
ESLint returned zero errors and three existing layout Fast Refresh warnings.
The preflight correctly rejects the current local development environment for
development mode, localhost origins and missing ingress proxy trust.

No cloud service was created or published. A fresh Linux image build and live
hosting checks remain unverified in this review because the local Docker engine
is stopped. Earlier Linux rehearsal evidence below is historical, not a new
verification. Complete the account/hostname setup in the free guide, keep a
separate production database and ImageKit folder, migrate the intended store
and media with the existing backup/migration tools, and run the live smoke
before directing shop users to the new URL. The application's existing store
subscription/trial expiry is separate from the hosting plan.

For free hosting with exact commands and limits, see the
[Oracle Always Free deployment guide](free/README.md). The paid sizing and
earlier performance measurements below are separate.

## Paid setup for higher availability

Assuming most operators and customers are in India, host the always-on Node API
and Caddy on an AWS EC2 Linux instance in Mumbai (`ap-south-1`), with MongoDB
Atlas on AWS in the same region. Start with about 2 vCPU and 4–8 GB RAM for the
application host, and a dedicated Atlas M10 or higher cluster. These are sizing
estimates for an initial deployment, not a measured concurrency guarantee.
Choose sustained CPU capacity if billing traffic is steady; watch CPU credits
if selecting a burstable instance. EC2 requires OS patching and monitoring.

[EC2 regions](https://docs.aws.amazon.com/general/latest/gr/ec2-service.html)
and [Atlas AWS regions](https://www.mongodb.com/docs/atlas/reference/amazon-aws/)
both include Mumbai. [Atlas dedicated tiers](https://www.mongodb.com/docs/atlas/manage-clusters/)
provide separate database instances rather than shared free capacity.

| Component | Deployment choice |
| --- | --- |
| Frontend | Build with `npm ci` and `npm run build`; serve `client/dist` through Caddy |
| API | Production Node container running continuously behind Caddy |
| Database | Managed MongoDB replica set in the API's region; private connectivity where available |
| Uploads | Durable disk mounted at `/srv/smart-kirana/uploads`, writable by UID 1000 |
| HTTPS and real-time updates | Same public origin for UI, `/api`, `/uploads` and `/socket.io`; preserve WebSocket upgrades |
| Backups | Encrypted database and uploads backups in a separate off-host vault, with restore verification |

The existing [staging stack](staging/README.md) already implements the Caddy,
Node and persistent-volume layout. Rehearse there using a separate database,
volume, secrets and hostname before preparing an independent production stack.
Keep the Node port and database out of public ingress. Build images before
release, or in CI, so compilation does not compete with active billing.

The supplied Docker build sets `VITE_API_URL=/api/v1` and an empty `VITE_WS_URL`
for same-origin traffic. When building outside Docker, set those values at
build time as well; the development `client/.env` points to localhost and must
not supply the production URLs. Run the API with `NODE_ENV=production`.

For shop operations requiring dependable availability, prefer an always-on paid
backend over a sleeping free backend. For example,
[Render's free service](https://render.com/docs/free) sleeps after 15 minutes of
inactivity, takes about a minute to wake, and loses local files on restart.
That behavior is unsuitable for this app's counter and upload requirements.

Start with one API instance. The current rate-limit counters and Socket.IO
rooms are in process, and uploads are on local storage. Before adding API
replicas, implement a shared rate-limit store, Socket.IO adapter, appropriate
session affinity for polling, and shared durable media storage. Adding replicas
without those changes can break real-time delivery and media access.

## Changes verified on 23 November 2026

- Added product indexes for the recent admin list, active counter catalog, and
  default featured storefront ordering. These preserve filters and responses.
- Coalesced related socket invalidations into a fixed 75 ms window. Removed
  duplicate page-level socket refetches from the dashboard and order screens.
  Reconnection refresh, manual refresh and packing fallback polling remain.
- Debounced the operational staff order search by 200 ms, using the existing
  search hook, so typing does not issue one API request per keystroke.
- Added an isolated, repeatable query-plan benchmark and live-update regression
  tests covering query refreshes, reconnect, session change and unmount.

Verification on the changed code:

- Server regression suite: 131 tests passed against a disposable replica set.
- Client regression suite: 65 tests passed, including four new live-update tests.
- Selected browser coverage: all 14 scenarios passed across the completed runs
  (eight POS, four real-time, and two owner/employee fulfillment scenarios).
  The fulfillment tests were rerun successfully after correcting stale packing
  button selectors; no product UI wording was changed to satisfy a test.
- Production build passed. ESLint returned zero errors and three existing
  Fast Refresh warnings in layout files. Build notices about Browserslist data
  and mixed static/dynamic API imports remain; they did not prevent the build.
- `npm audit --omit=dev` returned zero known vulnerabilities for both packages.

The [benchmark report](../server/audit/performance-results.json) uses 10,000
synthetic products across two tenants, 24-row pages, and 30 warm sequential
queries per measurement. It compares the old indexes against the new indexes
in a disposable local MongoDB process. Returned IDs are checked for equality.

| Query | Documents examined before → after | Local query p95 before → after |
| --- | ---: | ---: |
| Default admin products | 5,000 → 24 | 8.72 → 1.12 ms |
| Active counter catalog | 27 → 24 | 1.57 → 1.85 ms |
| Default storefront catalog | 3,857 → 24 | 9.18 → 1.69 ms |

The admin and storefront queries no longer use blocking sorts. The counter
timing did not improve in this run; its index avoids examining inactive rows.
Timings include local driver overhead and vary between runs. This is a query
plan comparison, not an end-to-end API or hosted-load benchmark. Counts,
substring searches, price sorts, deep pagination, reports and write throughput
are not covered by these measurements. Indexes also consume storage and add
write work, so verify the tradeoff with the expected workload.

To repeat safely after installing server development dependencies:

```sh
cd server
npm run perf:smoke
```

The script does not load `.env` or connect to the configured application
database. It shuts down its disposable database afterward. The optional output
path writes a JSON report: `npm run perf:smoke -- audit/performance-results.json`.

The new schema indexes are additive. Mongoose currently creates schema indexes
automatically; verify `catalog_recent`, `catalog_counter` and
`catalog_storefront` exist on staging before measuring. If automatic index
creation is disabled in your deployment, create these exact schema indexes in
the release procedure. Schedule initial index builds away from busy billing
periods on an existing large catalog. Do not drop existing indexes as part of
this change.

## Establish the actual hosting capacity

Measure on the intended hosting plan with realistic synthetic catalog, order
history and simultaneous operators. Exercise product search, POS submission,
order assignment, packing and reports together. Record read and write p50/p95,
error/timeout rate, database query plans, connection wait, CPU, memory and disk
latency. Include the actual shop phone/counter device and normal network.

Suggested initial acceptance targets: visible click feedback within 100 ms,
common read API p95 below 300 ms and POS submission p95 below 800 ms on the
normal shop connection. These are targets to validate, not promised results.
Run a sustained test at expected peak concurrency and a short test at twice
that level. Keep expensive report and backup jobs in the workload if they run
during shop hours. Preserve transaction and idempotency checks under load.

The local build retains route-level code splitting and separates chart code
from ordinary billing routes. Existing Caddy compression, immutable hashed
assets, revalidated HTML and cached catalog images should stay enabled. Avoid
caching authenticated API responses or private payment proofs at a CDN.

The remaining production decision depends on the live staging measurements
and recovery/device checks already listed in the staging guide. No remote
deployment or live database modification was performed during this review.

