# Smart Kirana performance and production review

Work started 25 November 2026; report completed 26 November 2026 (India time).

## Deployment scope and release status

The latest user instruction and screenshot establish **Northflank Free, London,
one 0.2 vCPU / 512 MB instance** as the backend target. Cloudflare Pages is the
frontend option and MongoDB Atlas Free is the database target. This supersedes
the earlier generic request to move the backend to Workers. The supplied
Northflank image also continues to serve the frontend on its existing origin.

At audit completion the changes were local. The follow-up release was authorized
on 26 November 2026. The final Northflank Docker image now builds successfully;
its Caddy/Bash checks and container HTTP checks for SPA routes, gzip, immutable
assets, local fonts and the font license passed. Deployment progress belongs to
the release commit's GitHub/Northflank checks rather than the historical benchmark
results in this report. No paid resource, production load test, database migration
or production data edit was performed. Existing customer UI and notification
changes are included in the authorized release.

The local checks below passed. This is not a certification that every feature
meets every target on the hosted account. Live Northflank/Atlas latency, real
traffic capacity, field Core Web Vitals and recovery on the actual hosting
account remain unverified.

## Baseline and priorities

The baseline is the complete working source at the start of this task, including
the user's uncommitted work, rather than just Git HEAD `2c9b871`.

A source checkpoint was created at:

`C:/Users/ajaym/AppData/Local/Temp/smart-kirana-source-20261125-231332`

Ignored credentials, customer uploads, databases and dependencies were excluded.
Dependency junctions and benchmark harness files were subsequently added inside
that checkpoint solely to execute the old source. They are not original source.

| Priority | Finding and root cause | Resolution |
| --- | --- | --- |
| High | Inventory loaded all tenant products into Node before slicing a page | Filter and paginate in MongoDB; project inventory fields; populate categories only for returned products |
| High | Low Stock downloaded all matching variants before client pagination | Server aggregation returns bounded pages and exact totals; category joins follow pagination |
| High | Socket, spreadsheet and native image code loaded even when unused | Defer transport until authentication and server libraries until the operation requires them |
| High | Private cache scope omitted permission changes delivered through `/auth/me` | Include normalized permissions in the session epoch and clear the query cache on changes |
| Medium | Auth restoration delayed loading route and layout code | Prepare only the requested route and shell concurrently with session restoration; no early API reads |
| Medium | Owner/staff notification polling duplicated connected socket updates | Stop polling while connected; keep fallback polling and reconnect invalidation |
| Medium | Dashboard repeated queries separately for two adjacent business days | Group each two-day summary in one query, retaining date/status rules |
| Medium | Expensive reports, exports and workbooks could run without a concurrency cap | Reject excess work with 503 and Retry-After; no unbounded waiting queue |
| Medium | Third-party stylesheet/font loading added external dependencies | Self-host the same Inter family as licensed WOFF2 subsets with swap behavior |
| Medium | Database pool checkout had no wait bound | Keep a 10-connection pool, add a 5-second checkout bound and idle connection cleanup |
| Medium | Production latency/resource visibility was sparse | Constant-memory aggregate request metrics and safe structured server error logs |

## Measured API and database results

Harness: `server/scripts/performance-workflows.js`. It creates and deletes its
own local MongoDB, never loads `.env`, and never uses the configured production
database. It exercises the real HTTP API including authentication and tenant
middleware. The data contains 10,000 synthetic products across two shops, 5,000
per shop, plus synthetic order history. Page size is five.

Before and after were run sequentially against the saved source and changed
source. There are ten sequential samples and forty samples in batches of four
per endpoint. All measured responses were HTTP 200. Names and totals were
compared across the old and new inventory responses and matched. Small sample
sizes make p99 exploratory; these are local warm measurements, not hosted SLOs.

| Endpoint / concurrency | Before p50 / p95 / p99, ms | After p50 / p95 / p99, ms |
| --- | --- | --- |
| Inventory / 1 | 98.92 / 126.35 / 126.35 | 8.36 / 13.50 / 13.50 |
| Inventory / 4 | 313.90 / 328.68 / 340.80 | 18.44 / 23.57 / 23.84 |
| Inventory, low-stock filter / 1 | 84.27 / 108.65 / 108.65 | 16.93 / 17.76 / 17.76 |
| Inventory, low-stock filter / 4 | 294.93 / 336.33 / 336.41 | 24.56 / 32.63 / 36.55 |
| Owner dashboard / 1 | 26.44 / 28.37 / 28.37 | 26.47 / 27.98 / 27.98 |
| Owner dashboard / 4 | 38.43 / 44.38 / 47.63 | 37.32 / 43.96 / 45.44 |

The dashboard shows a command saving, not a material measured latency gain.

| Per inventory request | Before | After |
| --- | ---: | ---: |
| Products transferred from MongoDB to Node | 5,000 | 5 |
| Observed DB commands including auth and getMore | 8 | 4 |
| Uncompressed HTTP JSON bytes, default page | 6,212 | 1,502 |
| Page find documents examined, executionStats | 5,000 | 5 |
| Page find keys examined, executionStats | 5,000 | 5 |
| Page find documents examined, low-stock filter | 5,000 | 6 |
| Blocking sort in page find | No | No |

Default inventory JSON fell 75.8%; product transfer fell 99.9%. The existing
`catalog_counter_page` index supplies deterministic `name, _id` ordering; no new
indexes or destructive index changes were needed. **These executionStats cover
the page find, not the count query.** Exact totals still scan tenant index keys;
the stock comparison count still examines tenant products inside MongoDB.

Owner dashboard commands including authentication fell from 11 to 9. Revenue
still recognizes delivered orders by deliveredAt, and order counts retain the
original createdAt/status rules. Tests cover exact business-day boundaries and
other-tenant exclusion. No accounting formula was changed.

Local API workload-process RSS after the harness was 636.68 MiB before and
245.31 MiB after. These Windows process readings include fixture setup and GC
history, exclude the MongoDB child process and Caddy, and are not a production
memory sizing guarantee.

Raw local results, intentionally ignored by Git, are in
`server/audit/workflows-before.json` and `server/audit/workflows-after.json`.

## Bundle, startup and browser measurements

Both bundle comparison builds used `/api/v1`, same-origin sockets and enabled
live updates. `client/scripts/bundle-report.mjs` sums the entry and its recursive
static JavaScript imports; dynamic route modules are excluded from initial JS.

| Production JavaScript | Before | After |
| --- | ---: | ---: |
| Initial raw bytes | 405,457 | 355,762 |
| Initial gzip bytes | 135,948 | 121,077 |
| All JS raw bytes | 1,556,362 | 1,559,542 |
| All JS gzip bytes | 517,306 | 518,964 |

Initial gzip JS is 10.9% smaller. Total JS slightly increases from lifecycle
guards and splitting; code is deferred, not eliminated. Charts remain outside
ordinary initial/POS loading. API modules formerly pulled into the initial graph
by cart restoration now load when a stored cart needs validation.

Seven Inter font subsets total 218,512 bytes on disk. Browsers fetch only the
Unicode subsets used by a page; Latin is 48,256 bytes and Latin Extended, which
contains the rupee sign, is 85,068 bytes. These bytes are **additional to the JS
table**, replacing external Google Fonts traffic rather than proving an overall
page-byte reduction. Vite fingerprints them; the OFL license ships with the UI.

Five fresh Windows Node imports, without a DB connection or listening socket:

| Startup import | Before median | After median |
| --- | ---: | ---: |
| Import time | 3,174.88 ms | 2,044.84 ms |
| RSS | 152.82 MiB | 120.63 MiB |

Timings are noisy and were collected alongside build activity. Treat the memory
reduction as local evidence and the startup timing as indicative, not a hosted
cold-start promise. Deferred libraries consume memory when first used.

A Linux image successfully built. Its Caddy configuration and Bash startup
script validated. A Node import/asset check inside that image with **0.2 CPU and
512 MiB limits** completed with 106 MiB RSS and about 9.2 seconds elapsed. This
excluded a database connection, concurrent traffic and a running Caddy process.
The final release rebuild was completed successfully on 26 November after Docker
became available again. Its Caddy/Bash validation and isolated HTTP asset checks
also passed; the temporary verification container was removed afterward.

Production Chromium preview, mobile 390x844, 4x CPU slowdown, 150 ms network
latency and 1.6 Mbps download, one synthetic cold/warm page pair:

| Metric | Cold | Warm |
| --- | ---: | ---: |
| FCP | 1,368 ms | 512 ms |
| LCP | 3,604 ms | 2,244 ms |
| CLS | 0.000586 | 0.000519 |
| Maximum observed interaction event duration | 128 ms | 56 ms |
| Resource transfer bytes | 335,193 | 22,686 |

There were no third-party requests in this scenario. The preview is not the
Cloudflare CDN/Caddy production delivery path. **Cold LCP misses the 2.5-second
target.** These samples are not field p75, a Lighthouse score or measured INP.
Lighthouse, React Profiler traces and hosted p75 Web Vitals were not collected.
Cached navigation under 100 ms is not established by this work.

## Cache, prefetch and request policy

- Reuse existing RTK Query; no parallel server-state library was added. Query
  arguments form cache keys; user/shop/role/permission changes advance the
  session epoch, clear private query state and reject obsolete responses.
- Existing retention is 300 seconds without subscribers and mount freshness is
  30 seconds. Focus does not globally refetch everything; reconnect revalidates.
  Auth and notification queries retain their specific focus/reconnect policies.
- Existing mutation/socket tags target affected lists and summaries. Failed
  financial mutations do not optimistically mark success. Prices, stock, ledgers
  and final close values are still verified authoritatively on the server.
- Requested route code and shell prepare during session restoration. This loads
  code only; regression coverage verifies no storefront API call starts before
  restoration finishes. Meaningful hover/focus prefetch still has a dwell time.
- Existing background scheduling respects hidden tabs, offline state, Save-Data
  and 2G, yields to active queries/input, and serializes work per scheduler.
  Catalog prefetch warms one adjacent page rather than the full database.
- Existing network-backed searches use debounce. The inventory browser test
  types Rice and observes one settled search request. Scanner behavior remains
  covered separately and is not given a new delay.
- Financial writes retain durable idempotency and pending-state guards. No
  blanket automatic mutation retry was added. Authentication refresh handling
  and rate-limit cooldowns remain in the existing base query.
- Server-side financial caching was not introduced. Authenticated and private
  token API responses remain private/no-store. No business data service worker,
  shared browser persistence or public CDN API cache was added.
- Cloudflare Pages `_headers` gives hashed assets immutable caching and the
  index/root revalidation. Pages handles other SPA HTML through its normal
  serving behavior. Existing Caddy preserves revalidated HTML, immutable hashed
  assets and compression. Express/Caddy avoid recompressing encoded responses.

## API request reduction and free-resource estimates

The connected owner/staff bell previously polled two endpoints every 30 seconds
even with sockets working. It now polls neither while connected. Disconnected
owner/staff fallback remains 30 seconds; customer fallback remains 60 seconds.
Socket events and reconnection invalidate the relevant queries.

**Configuration-derived estimate**, not a timed live count: a quiet connected
owner tab avoids up to four polling HTTP requests per minute. Across eight hours
that is 1,920 requests and approximately 6,720 auth/inbox database commands per
tab. Active notifications, reconnects, focus refreshes and `/auth/me` polling
still create necessary traffic. Socket heartbeats still consume resources.

Inventory remains one HTTP read per requested page, with a smaller payload and
fewer DB commands; no HTTP reduction is claimed there. The adjacent-page browser
test confirms one request per cached page across Next/Previous navigation. That
cache behavior already existed and was preserved, rather than being a new gain.

The Node pool permits ten application connections, zero minimum, two concurrent
connection attempts, 60-second idle cleanup and a five-second checkout wait.
Driver monitoring connections are additional. This does not represent the
total Atlas connection count or eliminate cross-region network latency.

Request admission permits two reports, one export and one workbook operation
per Node process. These are resource safeguards, not financial locks or
distributed coordination. Billing/payment routes do not use those new gates.

Production request summaries use constant memory and log counts, errors, slow
responses (>=1 second), mean/max latency and process RSS at most once per active
minute. Default warn logging emits summaries with slow/error responses; setting
`LOG_LEVEL=info` also emits healthy summaries. Error logs omit raw URLs, query
strings, request bodies and production exception messages/stacks. No external
monitoring service or paid dependency is introduced.

## Module coverage and integrity checks

| Module | Work performed or existing protection retained |
| --- | --- |
| POS/billing | Initial transport/API bytes deferred; existing bounded product views, immediate cart work, authoritative prices/stock, transactions and durable idempotency retained |
| Dashboard | Two adjacent-day query pairs combined; bounded pending/stock previews and existing query cache retained |
| Products/inventory | Inventory projection and DB pagination; existing catalog indexes reused; archived variants retained in inventory results |
| Low Stock | Bounded variant pages, stable stock/name/ID order, targeted notification lookup outside page one, zero-limit stock-bar guard and explicit error handling |
| Orders/packing/delivery | Existing pagination, tenant/user inbox scopes and coalesced socket invalidation retained; live assignment/reconnect browser checks passed |
| Udhar/suppliers/payments | Existing authoritative validation, ledger transactions, allocation and payment idempotency retained; financial regression suite passed |
| Day Close | Existing version conflicts, frozen snapshots and transaction checks retained; boundary/reconciliation regressions passed |
| Reports/exports | Existing lazy chart routes and paginated report lists retained; heavy work admitted with bounded concurrency |
| Images/Excel | Libraries deferred; signature/dimension/expanded workbook limits, private proof access and import rollback retained |
| Auth/cache | Permission changes now clear cached private results as well as account/store/role changes |
| Offline | Existing draft recovery retained; no unconfirmed sale is finalized offline |

No password hashing, authorization check, financial validation, stock predicate,
transaction isolation/write concern, audit trail or unique invoice/idempotency
constraint was removed. No new process-local financial locking was added.

Verification completed locally:

- Baseline: 155 server tests and 94 client tests passed.
- Changed source: **160 server tests and 96 client tests passed**.
- **13 production browser checks passed**, covering loading, metrics, mobile
  and desktop POS, product creation, cash/UPI, Udhar and lost-response retry.
- Five additional real-time/customer notification browser scenarios passed,
  including reconnect recovery. Earlier dev loading checks also passed after a
  new test's stale heading selector was corrected; product UI was not changed
  for that assertion.
- Regression coverage includes concurrent overselling, concurrent stock/product
  edits, duplicate submissions across process restart, duplicate payments,
  rollback on ledger failure, Day Close finalization, private media and tenant
  separation. The workload-gate test verifies shared capacity and error release.
- Production build passed. ESLint has zero errors and three existing layout
  Fast Refresh warnings. Production dependency audits found zero known
  vulnerabilities in both packages; one registry connection failure succeeded
  on retry. This is a point-in-time audit, not a security guarantee.
- Windows disposable MongoDB teardown occasionally prints ECONNRESET after
  tests; completed test commands still exited successfully.

## Cloudflare Workers compatibility

The existing backend remains on Northflank. Current Cloudflare documentation
supports MongoDB TCP/TLS with Node compatibility and documents Mongoose **9+**;
this application uses Mongoose 8.24.x. It also has a long-running HTTP/Socket.IO
server, in-process rooms/rate counters, native Sharp, filesystem upload/backup
work and a cleanup timer. There is no Workers entrypoint or deployment config.

MongoDB support in Workers does not make this complete backend a drop-in Worker.
Cloudflare documents connection lifetime limitations for plain Workers; migrating
pooling/socket coordination would need a separate design and verification.
Workers Free currently lists 100,000 requests/day, 10 ms CPU/request and 128 MB
memory. Secure password hashing and media/Excel/backup work cannot be assumed to
fit that CPU budget. No hashing reduction, major migration, KV, Durable Object
or extra service was introduced.

Sources checked during this work:
[Cloudflare MongoDB support](https://developers.cloudflare.com/workers/databases/third-party-integrations/mongodb/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Pages headers](https://developers.cloudflare.com/pages/configuration/headers/).

## Remaining software and hosting limits

Software work remains as data grows: exact list counts and field-to-field stock
filters still do collection work within a tenant; substring searches cannot use
ordinary B-tree indexes efficiently; stock summaries and reports still aggregate
history; offset pagination gets more expensive on deep pages. Existing cursor
paths remain preferable for growing ledger/order histories.

Full backup capture builds an in-memory archive with a 512 MiB archive allowance;
other JSON exports also materialize data. Admission control prevents concurrent
exports but does **not** make a large archive safe in a 512 MiB host. Use the
existing off-host backup tooling for large stores. A streaming, versioned backup
format and restore rehearsal would be separate work; no data was silently
truncated or feature removed to manufacture a memory improvement.

Native image work, Excel parsing, full backups and JSON serialization can still
consume substantial CPU/memory when requested. Lazy import reduces idle cost,
not their processing cost. No claim is made that all software bottlenecks have
been eliminated. Per-component React profiling and larger representative
workloads are still needed before adding more memoization/virtualization; most
ordinary lists currently render five records, so no virtualization library was
added indiscriminately.

Atlas Free currently has 512 MB storage including indexes, 500 connections and
100 operations/second, plus rolling transfer limits. It does not permit
aggregation spill to disk. Backups must not be assumed available for an account:
the current documentation describes Free backups as private preview. See
[Atlas Free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/).

Northflank's observed 0.2 vCPU / 512 MB plan has little CPU headroom. The public
Sandbox offering describes limited always-on free resources, not a guaranteed
commercial concurrency SLO. London-to-shop and API-to-Atlas latency remain;
the actual Atlas region and hosted resource consumption were not inspected.
See [Northflank pricing](https://northflank.com/pricing) and
[resource plans](https://northflank.com/docs/v1/application/billing/resource-plans-and-quotas).

Keep one API instance. Existing in-process Socket.IO rooms and rate counters
still require a shared adapter/store design before horizontal replication.
MongoDB transactions and unique constraints, rather than those in-process maps,
remain responsible for financial correctness. Do not enable paid autoscaling
or add a custom load balancer to compensate for these limits.

## Reproduce the checks

From `server`, with development dependencies installed:

```sh
npm test
npm run perf:workflows -- audit/workflows-new.json
npm run perf:startup -- audit/startup-new.json
npm run perf:smoke
```

The performance scripts use disposable local data. They are not production load
generators. To reproduce the before side, run the same harness against the saved
source checkpoint, using local dependencies, rather than altering production.

From `client`:

```sh
npm test
npm run lint
```

Build with `VITE_API_URL=/api/v1`, `VITE_WS_URL` empty and
`VITE_DISABLE_WEBSOCKETS=false`, then run:

```sh
npm run build
npm run perf:bundle -- ../server/audit/bundle-new.json
```

Set `STOREFRONT_PRODUCTION=true` and run the isolated browser suite for
`performance-loading.spec.js`, `performance-metrics.spec.js` and
`pos-walkin.spec.js`. The fixture then serves the production build and its own
disposable API/database. Real-time scenarios use their normal fixture mode.

## Release instructions

1. Preserve a copy of this checkout's pre-existing work and the source checkpoint.
   Review the task diff independently from the earlier customer/notification edits.
2. Rebuild and validate the Northflank image with the existing Dockerfile:
   `docker build -f deploy/northflank/Dockerfile -t smart-kirana:performance-local .`.
   No new runtime dependency or DB index migration is required by this change.
3. Deploy through the existing Northflank repository pipeline on the **same free
   plan and one instance**, using public port 8080, existing exact CORS origins,
   independent secrets, Atlas replica set and configured ImageKit storage. Keep
   `/health`, `/ready` and the current loopback proxy trust configuration.
4. For a separately hosted Pages frontend, build `client/dist` with the current
   API origin plus `/api/v1` and the current backend socket origin. Include the
   Pages frontend origin in the existing backend CORS allowlist. `_headers`,
   fonts and license are included in the build. Do not proxy private APIs through
   a public Cache Everything rule or change proxy trust casually.
5. Verify browser login, reload/session refresh, billing in a disposable shop,
   two-browser stock/inbox updates, image/proof privacy and Low Stock deep links.
   Cross-site cookie restrictions can affect unrelated pages.dev/code.run domains
   despite correct SameSite=None cookies; the existing same-origin Northflank
   frontend remains an available deployment path.
6. Check the live CPU/memory/Atlas connection charts and slow-response summaries
   during normal low-risk traffic. Use a separate staging database for any load
   tests. Only field/staging measurements can establish actual shop capacity.

Future scaling should first address expensive query counts/search/report plans
and large backup streaming, keep API and DB regions close where free allocations
permit, and collect real device measurements. Shared socket/rate-limit state is
needed before replicas. None of those services or a paid plan was provisioned.

## Modified files and rollback

| Files | Purpose |
| --- | --- |
| `server/src/controllers/inventory.controller.js`, `server/src/utils/inventoryQuery.js` | DB-side inventory filtering/pagination and bounded Low Stock results/target lookup |
| `server/src/controllers/dashboard.controller.js` | Combine two-day summaries without changing business rules |
| `server/src/services/productSpreadsheet.service.js`, `server/src/middleware/upload.js` | Lazy library loading |
| `server/src/middleware/workloadGate.js`, report/backup routes, product import controller | Bound expensive operation concurrency |
| `server/src/config/db.js` | Bounded connection checkout and idle lifetime |
| `server/src/middleware/requestMetrics.js`, app, logger, error handler | Lightweight private-safe observability |
| `client/src/App.jsx`, `client/src/app/routePrefetch.js` | Requested route and shell loading during auth restoration |
| `client/src/components/shared/SocketProvider.jsx` | Deferred transport with unmount/token-change guards |
| `client/src/features/cart/restoreCartDraft.js` | Defer cart-validation APIs until restoration is needed |
| `client/src/features/auth/authSlice.js` | Permission-aware private cache clearing |
| `client/src/components/layout/NotificationBell.jsx` | Socket-aware fallback polling |
| Inventory API and `LowStockPage.jsx` | Server pages, totals, deep links and error handling |
| `client/index.html`, `client/src/index.css`, font assets, public license, `_headers` | Local font delivery, valid favicon path and Pages cache policies |
| Server/client regression files and isolated fixture | Inventory/summary/cache/socket/admission/metrics regressions and production browser execution |
| `server/scripts/performance-workflows.js`, `server/scripts/performance-startup.js`, `client/scripts/bundle-report.mjs`, package scripts | Repeatable local benchmarks |
| Northflank env example/README and this report | Logging option, release evidence and rollback |

Before deployment, archive this source checkpoint somewhere durable; the current
copy is in Windows Temp. To roll back a release, redeploy the previous known-good
backend image and matching frontend build. No database/data reversal is needed.

For local rollback, restore only task-modified files from the checkpoint and
remove only newly added task files listed above. The benchmark harness files
later copied into the checkpoint are new task files, not original files. Preserve
all other original uncommitted changes. Do not use a blanket reset/clean, restore
the entire repository from HEAD, or overwrite later user edits. Re-run the
existing regression suites after any rollback.
