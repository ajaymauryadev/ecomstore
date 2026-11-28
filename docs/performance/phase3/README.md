# Phase 3 evidence

Local disposable fixture, Chromium, Windows, Vite development server. Baseline command:

`cd client && npx playwright test --config playwright.storefront.config.js role-navigation.spec.js performance-loading.spec.js --reporter=line`

Result: 7/7 passed. The route smoke captured one visibility sample per row, so those values are diagnostic only and cannot establish p50/p95 or an improvement. Owner dashboard 738 ms; staff dashboard 428 ms; packer dashboard 442 ms; delivery dashboard 455 ms; super-admin dashboard 602 ms. No document reload, filter correctness, CLS, or INP claim follows from this smoke alone.

The full route and role matrix, hosted staging, slow network, error, offline, mobile, and accessibility checks remain to be recorded separately.
