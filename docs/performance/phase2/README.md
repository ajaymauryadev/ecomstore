# Phase 2 startup evidence

28 November 2026. Phase 2 changes are local only. No production data or deployment was changed.

## Checkpoint and comparison conditions

The tracked pre-edit worktree is preserved by tag `codex/checkpoint-phase2-tracked-20261128` at `edba0fbd4a080366705607aa8eb791608fe0a75b`; branch `codex/checkpoint-phase2-20261128` preserves HEAD `0b9a498`. The tag includes the uncommitted tracked Phase 1 code. Pre-existing untracked plans, audits, diagnostics, and test artifacts remain in the worktree. The baseline production client was built from that tag in an ignored temporary directory, with the pre-existing untracked diagnostics module copied into it. The final client was built from the Phase 2 worktree. Both used `VITE_API_URL=/api/v1` and `VITE_PERF_DIAGNOSTICS=true`, with browser diagnostics off.

The Playwright fixture used Chromium 140.0.7339.16 at 1365 × 768, a disposable MongoDB replica set, one synthetic store and product, the same API/server source and production Vite preview on loopback. Each condition has five sequential fresh-context samples; `publicWarm` first visits the catalog in the same context. `PHASE2_IDB_DELAY_MS=600` delays the IndexedDB open success callback by 600 ms in both builds. The normal-storage and delayed-storage pairs ran separately; they must not be compared to one another as a before/after pair. No production or staging server was benchmarked.

## Raw samples and results

All numbers below are navigation to useful content in ms. p95 is the largest of five samples. The linked JSON files also retain network waterfall, bytes, response status, web vitals, browser task time, storage state, and request counts.

| Condition | Before raw; p50/p95 | After raw; p50/p95 | API calls before → after |
|---|---|---|---|
| 600 ms IDB, public cold | 987, 980, 970, 986, 963; 980/987 | 555, 540, 502, 527, 508; 527/555 | 4 → 4 |
| 600 ms IDB, public warm | 931, 951, 930, 938, 951; 938/951 | 222, 201, 225, 215, 186; 215/225 | 4–5 → 3 |
| 600 ms IDB, owner cold | 980, 971, 998, 981, 988; 981/998 | 1006, 1012, 986, 978, 986; 986/1012 | 12–13 → 7 |
| Normal IDB, first pair, public cold | 513, 493, 493, 479, 496; 493/513 | 550, 521, 536, 521, 283; 521/550 | 4 → 4 |
| Normal IDB, first pair, owner cold | 488, 471, 481, 482, 501; 482/501 | 529, 498, 501, 518, 471; 501/529 | 7 → 7 |
| Normal IDB, final pair, public cold | 1365, 829, 1215, 1307, 770; 1215/1365 | 536, 540, 530, 504, 499; 530/540 | 4 → 4 |
| Normal IDB, final pair, public warm | 625, 222, 201, 187, 220; 220/625 | 246, 111, 196, 220, 191; 196/246 | 4–6 → 4 |
| Normal IDB, final pair, owner cold | 517, 469, 494, 486, 530; 494/530 | 488, 507, 517, 479, 497; 497/517 | 11–12 → 7 |

Raw files: [delayed before](browser-delayed-before.json), [final-build delayed after](browser-delayed-final-after.json), [normal first before](browser-before.json), [normal first after](browser-after.json), [normal final before](browser-normal-before-final-pair.json), [final-build normal after](browser-normal-final-after.json). Intermediate after runs are retained in [delayed](browser-delayed-after.json) and [normal](browser-normal-after-final-pair.json). Every after sample in these files had one startup `/auth/refresh` and one `/auth/me` on the owner route, with no duplicate exact-route API request or incidental 401/429. The fault cases deliberately inject 401/429/timeout and are assessed as correctness cases, not production error-rate samples.

The delayed-IDB public p95 improved by 432 ms cold and 726 ms warm. The owner route remains gated on identity verification and its delayed-IDB p95 rose by 14 ms. Normal-storage runs vary sharply: the first pair became slower, while the final pair's public baseline had large outliers and became faster. These five-sample pairs do not establish a consistent normal-storage p95 improvement. No confidence interval or hosted improvement is claimed.

## Correctness and validation

The router mounts before IDB reads. Public catalog becomes useful even when IndexedDB never resolves; the protected dashboard remains hidden. If the identity-marker read fails, automatic cookie recovery stays gated because an older install could have an IDB-only pending-logout marker. An explicit new sign-in restores access. Online saved identity is held until refresh confirms its scope; offline identity remains time-limited to 12 hours and never authorizes writes. Pending logout is checked before refresh and mirrored in local storage so a blocked IDB open cannot silently clear that intent on updated installs. Hydration checks session epoch and account scope, and skips keys already filled by a network read. A pending sign-in suppresses an older cookie refresh. The original protected product-before-refresh expectation was updated to assert no sensitive flash.

Unit tests cover delayed/rejected identity reads, pending logout and its mirror, online versus offline identity, stale tenant A snapshot after tenant B switch, StrictMode refresh deduplication, 401/429/timeout recovery, and late refresh after sign-in. Production-browser tests cover blocked/rejected IDB and explicit sign-in recovery, slow refresh, injected 401/429/timeout, two-tab tenant switch, offline sign-out, startup shell, saved data, route/role navigation, public catalog and missing offline views.

| Matrix case / role and route | Browser condition and assertion | Result |
|---|---|---|
| A01–A04, guest and owner `/login`, `/register`, `/`, `/store/dashboard` | 360/390/768/1440 px auth UI, slow refresh, 401/429/timeout, blocked/rejected IDB, access gate and redirect | PASS in auth/startup suites |
| C01/C03, guest/mobile customer `/s/:slug`, `/s/:slug/categories` | Cold/warm public catalog, blocked IDB, saved/offline view, category filter and narrow layout | PASS in startup/storefront/saved-data suites |
| O01/O03/O29/O34, owner `/store/dashboard`, `/store/products`, `/store/reports`, `/store/notifications` | Scope-confirmed startup, saved data, offline reload, route navigation, no protected flash | PASS in startup/role/saved-data suites |
| S01/P01/D01/SA01, staff/packer/delivery/super-admin dashboard and work routes | Role navigation and matching API read without runtime errors; offline saved work where applicable | PASS in role/saved-data suites |
| Cross-route, two owner tenants `/login` and `/store/dashboard` | Two tabs, tenant switch, old refresh race and first-tab invalidation | PASS, including three repeated switches |

These are selected matrix cases, not the complete route matrix. C02/C04, every permission variant, and tenant-scale hosted behavior remain outside the browser run.

- Frontend: `client/npm test -- --reporter=dot` — 36 files, 184 tests passed in [log](frontend-tests-final.log).
- Backend: `server/npm test -- --reporter=dot` — 4 files, 166 tests passed in [log](backend-tests.log).
- Production frontend build: `client/npm run build` with the variables above — passed in [log](build.log).
- Chromium production preview: startup/saved data/role navigation/loading/storefront design suite — 29 passed in [log](browser-regressions-final.log); auth UI — 15 passed in [log](browser-auth-final.log). The second-tab switch also passed three consecutive repeats in [log](account-switch-repeat.log).
- Lint: zero errors and three pre-existing React Refresh warnings in [log](lint.log).

Exact commands and exit codes: `client/npm test -- --reporter=dot` (0); `server/npm test -- --reporter=dot` (0); `client/npm run build` with the two environment variables above (0); `client/npx playwright test e2e-isolated/phase2-startup.spec.js e2e-isolated/stable-startup.spec.js e2e-isolated/role-navigation.spec.js e2e-isolated/performance-loading.spec.js e2e-isolated/saved-data.spec.js e2e-isolated/customer-storefront-design.spec.js --config playwright.storefront.config.js --project chromium --reporter=dot` with `STOREFRONT_PRODUCTION=true` (0); `client/npx playwright test e2e/auth.spec.js --project chromium --reporter=dot` (0). Benchmark commands used the Phase 1 benchmark spec and `PHASE2_IDB_DELAY_MS=600` for the delayed pair; baseline preview used `PHASE2_PREVIEW_DIST` pointing to the ignored tag build.

## Remaining gate

**BLOCKED:** The proposed overall p95 useful-content improvement is not established for normal storage or the owner route, and no staging URL, disposable staging accounts, or hosted resource traces exist to validate the 401/429 rate and request-count gate under representative conditions. The local synthetic fixture confirms isolation and delayed-IDB public improvement, but cannot establish hosted tenant-scale behavior. A permanently stalled identity-marker read keeps protected startup and sign-in gated until storage responds; a rejected read offers explicit sign-in. Retain the checkpoint for a reviewable rollback if scope isolation fails on staging. Do not mark Phase 2 complete or start Phase 3 until the gate and required evidence are satisfied.
