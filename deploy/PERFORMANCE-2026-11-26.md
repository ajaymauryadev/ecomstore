# Loading regression fixes and free-hosting verification — 26 November 2026

## Deployment scope

The active URL is `https://p01--smart-kirana--9phrmsmpt8r6.code.run`.
Its existing Northflank configuration is London, one 0.2 shared-vCPU / 512 MB
instance, Caddy and Node, with Atlas and external image storage. This release
keeps that architecture and its dependency versions. No paid service, new cache
service, production test records, schema migration or accounting formula change
is introduced. The pre-change Git checkpoint is `429fc56`; the earlier broad
release remains recoverable at `493b479` and is not reapplied wholesale.

## Findings and changes

| Root cause | Change and files | Verification |
| --- | --- | --- |
| Saved-cart product/coupon verification blocked the entire customer layout, including unrelated orders and product browsing | `client/src/components/layout/CustomerLayout.jsx` renders those routes independently, with cart status/retry; cart and checkout still wait for validation | Holding the cart request prevented the old Orders heading from appearing within 5 seconds. Three new browser cases now pass with the request still pending |
| Rendering while cart restoration is pending could allow edits to a draft that restoration would replace | `MobileNavigation.jsx`, `StoreFront.jsx`, `ProductDetail.jsx` disable cart changes until the correct account/shop cart is ready | Product remains readable while Add is disabled; restored quantity becomes editable after validation. Existing cross-shop/account draft isolation and checkout tests pass |
| The external Google Fonts stylesheet blocked module execution and session/data startup | `client/index.html` loads the same font CSS without blocking rendering, with a noscript fallback | With font CSS held indefinitely, the old build did not start auth refresh within 5 seconds. The new build starts the session and renders an enabled product before the stylesheet completes |
| Inventory loaded every tenant product into Node and sliced/filtered in JavaScript | `server/src/controllers/inventory.controller.js` and `utils/inventoryQuery.js` filter/page in Mongo, project row fields, retain active/archived variant semantics, and bound category population to tenant | Regression covers page totals, duplicate names, search/category combinations, all stock filters and tenant isolation; local query plans below |
| Dashboard performed separate today/yesterday reads for each summary | `dashboard.controller.js` groups the two adjacent days in two reads instead of four | Boundary, cancelled/rejected, revenue and cross-tenant regression; existing cash/accounting tests unchanged |
| Customer order history repeated the store lookup already validated by middleware | `storefront.controller.js` reuses `req.store`, retaining fallback and authorization | Existing storefront API/tenant tests and browser order-history check |

The font test models a network dependency, not a claim that fonts caused every
reported production delay. Likewise, cart isolation fixes an observed software
waterfall; it cannot remove API/Atlas/network latency.

## Measured backend comparison

Real local HTTP/auth, disposable MongoDB, 10,000 synthetic products across two
tenants, 200 orders. Warm measurements use 10 requests at concurrency 1 and 40
at concurrency 4. No requests from this workload target production. Baseline
controllers in the saved source checkpoint were verified identical to `429fc56`.
Both implementations were measured on this machine on 26 November. The small
sample makes p99 exploratory, not a service-level guarantee.

| Endpoint / concurrency | p50 before → after (ms) | p95 before → after (ms) | p99 before → after (ms) |
| --- | --- | --- | --- |
| Inventory, 1 | 144.94 → 7.36 | 217.52 → 10.90 | 217.52 → 10.90 |
| Inventory, 4 | 494.48 → 14.02 | 551.55 → 18.31 | 553.07 → 18.35 |
| Low-stock inventory filter, 1 | 135.26 → 16.82 | 173.65 → 24.31 | 173.65 → 24.31 |
| Low-stock inventory filter, 4 | 487.57 → 28.25 | 569.79 → 36.38 | 570.30 → 39.93 |
| Dashboard, 1 | 45.25 → 41.98 | 53.21 → 47.77 | 53.21 → 47.77 |
| Dashboard, 4 | 56.59 → 46.89 | 72.04 → 63.88 | 77.36 → 64.27 |

Inventory Mongo documents **transferred to Node** per page: 5,000 → 5.
The page `find` explain examined 5 documents/keys (6 with the low-stock filter),
returned 5 and used no blocking sort. This excludes the separate exact count:
filtered totals still require examining matching catalog data. Existing indexes
are reused; no production indexes are created/dropped by this release.

Inventory response: 6,212 → 1,502 JSON bytes (75.8% smaller); low-stock
6,211 → 1,501. Measured Mongo command counts, including auth and cursor reads,
were 8 → 4 for inventory and 11 → 9 for dashboard. Counts depend on dataset,
cursor batching and populated categories. Dashboard response size was unchanged
at 4,721 bytes. Dashboard latency improvement is modest; the robust gain is two
fewer reads. No general reduction in browser API request count is claimed.

Reproduce after installing existing development dependencies:

```powershell
cd server
node scripts/performance-workflows.js audit/workflows-current.json
```

This script creates its own local database, ignores application `.env` files,
uses bounded concurrency and removes the disposable database. The ignored local
evidence is `server/audit/workflows-baseline-recheck.json` and
`server/audit/workflows-customer-fix.json`.

## Browser and correctness coverage

- **154 server tests pass**: tenant/role authorization, server price/stock
  checks, concurrent stock operations, idempotent POS/order/payment retries,
  ledger allocation/rollback, supplier payments, day close finalization,
  backup/restore and imports, including the two new read regressions.
- **93 client tests pass**; ESLint has zero errors and three pre-existing layout
  Fast Refresh warnings. Production Vite build succeeds.
- **54 isolated Chromium browser tests pass** against the production build in
  2.1 minutes, with real local API and disposable replica-set databases.
  Includes customer shopping/cart/order tracking, cash/UPI/Udhar billing,
  payment reject/resubmit/approve, split receipts, lost responses, product
  import/search/pagination, suppliers, packing/verification/delivery, live
  assignments and reconnect recovery. POS is exercised at 320/390/768/1440px.
- The navigation matrix visits **30 distinct owner pages**, all four admin
  sections, staff dashboard/orders/POS/packing, packer dashboard/packing/catalog
  and delivery dashboard/deliveries. It asserts expected API reads, no API/runtime
  errors and completion of visible skeletons. It does not exercise every form,
  every permission combination or every possible business state.
- Exploratory local owner samples: cold dashboard 553 ms, products 214 ms,
  POS 148 ms, inventory 198 ms, orders 198 ms, cached return dashboard 81 ms.
  These are single navigation samples from the expanded matrix run, with font
  CSS stubbed and local data, not field Core Web Vitals or Northflank latency.
- The test fixture now supports production preview, closes its upgraded socket
  connections, and separates unrelated scenarios' loopback rate-limit budgets.
  Production rate limits remain unchanged and enabled within each scenario.
  The payment browser test now navigates through the Sales/Payments menu and
  captures the actual queue response rather than a prior document's badge read.

```powershell
cd client
$env:VITE_API_URL='/api/v1'
$env:VITE_WS_URL=''
$env:VITE_DISABLE_WEBSOCKETS='false'
npm run build
$env:STOREFRONT_PRODUCTION='true'
$env:STOREFRONT_OFFLINE_FONTS='true'
npx playwright test --config playwright.storefront.config.js --workers=2
```

The font-stall test overrides the stub and deliberately holds the stylesheet.
Fonts are stubbed only in functional tests; these runs do not measure font layout
shift. Local test logs can include Mongo connection resets during disposable
database shutdown; browser API/runtime assertions passed. Live authenticated
roles have **not** been exercised because production credentials are unavailable.
No production customer/order/stock/payment data was changed for verification.

## Bundle, caching and resource use

No optimization library or second server-state system was added. Existing
RTK Query deduplication, account/session cache reset, targeted invalidation,
route lazy loading, background scheduling, adjacent-page prefetching and settled
network search remain in place. Cart drafts remain scoped by shop/account;
financial execution still revalidates on the server. No private API data is
put in shared CDN caches or a new persistent browser cache.

The final entry is `index-D7Rgv-Y5.js`: 187.29 kB raw / 62.21 kB gzip. Entry plus
recursive static imports is 405,373 bytes / 135,935 gzip; all route JS totals
1,549,897 bytes / 515,250 gzip. The earlier saved audit baseline was 405,457 /
135,948 initial and 1,556,362 / 517,306 total. That earlier snapshot also contained
uncommitted customer work: this is a size reference, **not a controlled bundle
speed comparison**. No meaningful initial-bundle reduction is claimed here.
Heavy reports/charts stay in existing route chunks.

Caddy retains compression, no-cache HTML and one-year immutable hashed assets.
A local Linux overlay image using the existing runtime/dependencies plus the
current source/dist passed SPA routing, JS syntax and asset/cache checks. A full
fresh Docker dependency build could not finish locally because registry/npm
requests failed; the overlay is not a clean-image build. Northflank's normal
Dockerfile remains the release build path.

Resource estimates are workload formulas, not observed hosting consumption:
1,000 inventory pages of this benchmark shape save about 4.71 MB uncompressed
HTTP and 4,995,000 product-document transfers from Mongo to Node. Each dashboard
load saves two database reads. The existing pool is bounded at 10 per Mongo
server (monitor connections are additional). Two existing 30-second owner badge
polls alone can issue 240 requests per visible owner-hour; this release adds no
polling. Actual CPU, Atlas quota, concurrent-shop capacity and active-user totals
need authenticated host metrics; local throughput must not be used to size the
0.2-vCPU service.

## Hosting limits and remaining work

Official docs checked on 26 November:

- [Northflank compute plans](https://northflank.com/docs/v1/application/billing/resource-plans-and-quotas): `nf-compute-20` is 0.2 vCPU/512 MB. Account region/free eligibility can differ from public pricing. Keep the existing Free configuration.
- [Atlas Free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/): shared resources, operational throttling and limited storage constrain capacity. Broad counts, stock expressions and large reports still cost reads. Arbitrary substring search cannot obtain the same efficiency as indexed equality/prefix lookup.
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/): Free has 10 ms CPU per HTTP request, 128 MB memory and 100,000 daily requests. This Node API is **not deployed or verified on Workers**.
- [MongoDB on Workers](https://developers.cloudflare.com/workers/databases/third-party-integrations/mongodb/): Mongoose 9+ is documented; this app uses Mongoose 8, native Sharp, Socket.IO, filesystem export/backup code and a persistent server lifecycle. Direct Mongo connections also have documented setup overhead. Migrating the full backend is a separate compatibility project; it is not a safe configuration-only performance fix.

Cloudflare Pages remains an option for the static build. Moving an already
working same-origin deployment there requires deliberate API/socket origin,
cookie/CORS and asset handling verification; no silent migration was made.
London-to-user/Atlas network distance, shared CPU contention and Atlas throttling
can remain visible. No hosted LCP/INP/CLS, authenticated p95/p99, real-user memory
profile or maximum shop count is claimed. Broad low-stock lists, expensive
accounting reports/exports, and existing background polling remain candidates
for a separate measured pass; no whole-software bottleneck-free guarantee is
possible from these tests. Production request/Atlas metrics are the next evidence
to collect if delays remain, before changing rate limits, pool sizes or adding
caches. No paid infrastructure is needed for the changes in this release.

## Release and recovery

Use the existing `deploy/northflank/Dockerfile`, production environment and
auto-deploy branch. Do not upload local `.env`, test data or ignored audit JSON.
After rollout, verify the **public HTML asset hash and nonblocking font link**,
`/health`, `/ready`, SPA routing, protected API 401, private-cache headers, asset
caching and CORS using the existing read-only smoke:

```powershell
node deploy/staging/smoke.mjs https://p01--smart-kirana--9phrmsmpt8r6.code.run
```

Without staging login credentials this deliberately skips authenticated checks.
A successful GitHub deployment status by itself does not verify the public
rollout. Check actual served content. No hosting secrets/settings need changing.

Source changes are reversible and require no data rollback. For an urgent proven
regression, redeploy `429fc56` or revert only the corrective release commit with
ordinary Git history, then verify the served assets again. Preserve subsequent
user changes; do not reset the repository or restore/delete business data.
