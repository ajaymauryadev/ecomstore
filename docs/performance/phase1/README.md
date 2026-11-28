# Phase 1 performance baseline and diagnostic protocol

28 November 2026. Local tracked baseline: `0b9a49853b45ae2f843be9d10105492d20eb3eb7`. This note records Phase 1 only. No production data, deployment, or infrastructure setting was changed.

## Reproduce safely

- Browser fixture: `client/e2e-isolated/storefront-fixture.js` creates a disposable MongoDB replica set, API server, one synthetic store and product, and a Chromium production preview. Build from `client` with `VITE_API_URL=/api/v1` and `VITE_PERF_DIAGNOSTICS=true`, then run `STOREFRONT_PRODUCTION=true npx playwright test e2e-isolated/phase1-benchmark.spec.js --config playwright.storefront.config.js --project chromium`. The benchmark uses five sequential Chromium 140.0.7339.16 samples per condition at 1365 × 768 on loopback. `PHASE1_OUTPUT` writes raw JSON. Set `PHASE1_CLIENT_DIAGNOSTICS=1`, `PERF_DIAGNOSTICS=1`, and `PERF_DIAGNOSTICS_SAMPLE_RATE=1` for the diagnostic-on run. Production React profiling is disabled; a Vite development run with `VITE_PERF_DIAGNOSTICS=true` collects React root commits.
- API workload: from `server`, run `node scripts/performance-workflows.js <output.json>`. It creates disposable MongoDB, two tenants and 10,000 synthetic products, then measures warm authenticated HTTP reads with 10 sequential or 40 four-way request samples. It records CPU milliseconds/request, RSS, response bytes and read-only `explain('executionStats')`. Enable the server diagnostics variables above only for its diagnostic-on run. The script never loads `.env`.
- Mongo index smoke: from `server`, run `npm run perf:smoke -- <output.json>`. Its `before` intentionally omits five existing indexes; its `after` is the current index set. It is a narrow, disposable query-plan comparison, not a deployed-before/deployed-after result.
- Server diagnostics are off by default. When `PERF_DIAGNOSTICS=1`, one of every `PERF_DIAGNOSTICS_SAMPLE_RATE` requests is sampled (default 100). Logs contain a generated request ID, fixed route template, method, status, elapsed time, compressed response-body byte count, Mongo command count, summed command duration and failures. The `X-Request-ID` header is exposed to browsers. No URL query, body, credential, customer name, tenant slug or raw Mongo command is logged. Mongo timing requires `monitorCommands` on that connection. Summed Mongo duration can exceed request wall time when commands run concurrently. Browser marks and bounded in-memory durations require a build with `VITE_PERF_DIAGNOSTICS=true` and `sessionStorage.__ecom_perf = '1'` before navigation; they record fixed stage names and endpoint names only.

## Raw evidence

| Artifact | Contents |
|---|---|
| [browser-prechange.json](browser-prechange.json) | First pre-code production-browser run. Public data is valid; owner useful-time was based on the startup shell and is **invalid for owner comparison**. |
| [browser-diagnostics-off.json](browser-diagnostics-off.json), [browser-diagnostics-on.json](browser-diagnostics-on.json) | First matched production-build comparison after the useful-data selector was fixed. Five raw samples/condition, waterfall, transfer, LCP, CLS, long tasks, CPU task duration, heap, storage and service worker state. |
| [browser-repeat-off.json](browser-repeat-off.json), [browser-repeat-on.json](browser-repeat-on.json) | Second matched comparison on the final client build, with the production React Profiler wrapper removed. |
| [browser-final-validation-on.json](browser-final-validation-on.json) | Final diagnostic-on browser regression run after request cleanup was finalized. It is an on-only validation run, not another matched overhead comparison. |
| [react-profiler-dev.json](react-profiler-dev.json) | Development-only raw App Profiler commits. Development compilation timings must not be compared with production browser timings. |
| [navigation-roles.json](navigation-roles.json) | 44 raw visible-time samples from disposable client navigation across owner, staff, packer, delivery and super-admin roles. First route is a cold document load; later routes use client history and are a different condition. |
| [api-workflows-before.json](api-workflows-before.json), [api-workflows-diagnostics-off.json](api-workflows-diagnostics-off.json), [api-workflows-diagnostics-on.json](api-workflows-diagnostics-on.json) | Local HTTP/Mongo summaries; the latter two include raw per-request latency samples. Runs were sequential but local host contention varied. |
| [server-request-samples.json](server-request-samples.json) | 156 sanitized sampled server request records, including dashboard DB timing and compressed response bytes. |
| [mongo-smoke-before.json](mongo-smoke-before.json), [mongo-smoke-after.json](mongo-smoke-after.json) | Two repeats of the existing-index smoke test. |
| [notifications-mongo.json](notifications-mongo.json) | Disposable 3,000-notification owner/worker query plans. |

Raw browser URL paths use route templates; query values and synthetic store slug are removed. Browser `apiBytes` are CDP encoded transfer bytes including headers; server `responseBytes` count compressed response body only.

## Local measurements and interpretation

| Condition | Diagnostics off useful p50 / p95 | Diagnostics on useful p50 / p95 | API calls per cold page | Interpretation |
|---|---:|---:|---:|---|
| Public catalog cold, first matched pair | 497 / 542 ms | 486 / 551 ms | 4 | p95 +1.6%; five samples are too few to establish the proposed <2% staging overhead gate. |
| Owner dashboard cold, first matched pair | 476 / 511 ms | 489 / 533 ms | 7 | p95 +4.4%; no staging conclusion. |
| Public catalog cold, repeat pair | 480 / 513 ms | 532 / 1,205 ms | 4 | Two diagnostic-on runs had 613 ms browser task duration and delayed service worker readiness; cause is unproven. This pair fails a simple <2% local comparison. |
| Owner dashboard cold, repeat pair | 489 / 510 ms | 487 / 511 ms | 7 | p95 nearly equal; does not cancel the public outliers. |

The final diagnostic-on validation run passed and recorded public/owner cold p95 of 511/505 ms. It lacks a concurrent off run and is not used to claim the overhead gate.

The seven owner startup API calls in this fixture include refresh, `/auth/me`, dashboard, notifications list/count, payment queue and packing queue. The sampled dashboard request ran nine Mongo commands. These are confirmed work counts, not proof that any one call is the hosted bottleneck. No duplicate exact-route API request appeared in the cold samples. Warm public revisits showed 4–7 calls depending on revision and navigation state; inspect raw waterfalls before attributing duplicates.

The role-navigation regression recorded 44 visible-time samples across five roles and the routes listed in its raw artifact. For example, the owner's initial dashboard load was 342 ms and its subsequent client-side products navigation was 99 ms in that run. Cold and client-side navigation times must be compared separately; these are single samples, not route p95 values.

The final local production build emitted 173 files totaling 1,784,797 uncompressed bytes, including 160 JavaScript files totaling 1,611,119 bytes. The master plan's earlier build was made under different concurrent load and build conditions, so these sizes and build durations are descriptive, not an established speedup. No hosted bottleneck has been confirmed from the available evidence.

In the first matched browser pair, public cold LCP was 168–228 ms and CLS was 0 in these synthetic runs. Chromium CDP task duration was roughly 246–305 ms and JS heap roughly 6.6–8.7 MB across the public/owner samples. Local IDB readonly operations were usually submillisecond after an initial 10–30 ms open wait. Service worker readiness varied from about 260 ms to over 1 s across runs; registration is asynchronous after hydration and is not itself a measured startup blocker. Vite development runs recorded 13–16 root `App` commits per warm/public/owner sample; production React does not expose Profiler callbacks. The passive benchmark did not generate a defensible INP value.

For the 10,000-product synthetic index smoke, all three current-index default catalog queries examined 24 documents, had no blocking sort and returned p95 of 0.80–1.06 ms in the second run. The existing workload's `/dashboard` had nine Mongo commands; `/inventory/list?limit=5` had four and a 5-document indexed page. API warm p95 values varied widely between local runs (for example `/dashboard` at concurrency 4: 47.35 ms pre-code, 137.33 ms diagnostics-off on a later contended run, 39.46 ms diagnostics-on in the final run). No local speedup or overhead percentage is claimed from those unmatched workload runs. Search, count, price-sort and deep-page query plans remain unmeasured.

The disposable notification plan returned a page of 20 with no blocking sort, examining 40 owner documents or 20 worker documents. This is a synthetic plan check, not hosted latency.

## Read-only hosting observation and blocked gates

The [Northflank deployment page](https://app.northflank.com/t/ajaymauryadevs-team/project/default/services/smart-kirana/deployments?range=1h) was inspected in the signed-in browser on 28 November 2026. It showed the current `smart-kirana` deployment running commit `0b9a498`, one of one instances, 0.2 vCPU, 512 MB, Europe West (London), zero pod restarts and 2/2 passing checks. The page did not identify a separate staging deployment. This verifies the allocation previously listed as unverified in the master plan. No hosted load or write was performed, and the new diagnostics are not deployed there.

**BLOCKED:** no separate staging URL/disposable account, staging resource traces, MongoDB region/profiler/explain access, or representative tenant cardinalities were supplied. Therefore hosted p50/p95/p99 API and browser waterfalls, 429/5xx rates, pool wait, throttling, sustained CPU/RAM, freshness lag, field LCP/INP/CLS and the proposed <2% p95 staging overhead gate cannot be marked PASS. Local passive runs also cannot establish INP or production React render counts. The public catalog cold outliers warrant a controlled staging comparison before enabling diagnostics there. Keep the server sampling default at 1/100 and disable the flags if overhead or log cardinality is excessive.

## Validation and rollback

Frontend Vitest: 36 files/173 tests passed. Backend Vitest: 4 files/166 tests passed, including two new diagnostic privacy/contract tests. Production Vite build passed. Affected Chromium regressions: 21 isolated tests passed (startup, public catalog, role navigation including products/reports/notifications, offline/saved data) and 15 auth UI tests passed; the benchmark passed in each recorded run. The new code has not been deployed.

Frontend ESLint completed with zero errors and three pre-existing React Refresh warnings in layout files outside this phase.

Rollback the tracked code to the Phase 1 checkpoint branch `codex/checkpoint-phase1-20261128` at `0b9a49853b45ae2f843be9d10105492d20eb3eb7` with a reviewable revert, preserving unrelated untracked user files. For immediate diagnostic shutdown without code rollback, leave `PERF_DIAGNOSTICS` unset and build without `VITE_PERF_DIAGNOSTICS=true`.
