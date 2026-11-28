# ECOMSTORE (Smart Kirana) audit — owner summary

**28 November 2026.** This was a read-only code and local build audit of `D:\Backup\DESKTOP\Personal Project\ecomstore_2` at Git HEAD `0b9a49853b45ae2f843be9d10105492d20eb3eb7`. Its packages are `smart-kirana-client` and `smart-kirana-server`, and its UI is branded Smart Kirana. The live Northflank service and MongoDB were not accessed, so the source of the reported slow response has not yet been measured in production. See [the full technical audit](ECOMSTORE_COMPLETE_TECHNICAL_AUDIT.md) for evidence, paths and verification steps.

## What we found

1. **Opening the app waits for device storage.** Before the main app appears, it reads offline data from IndexedDB. Slow device storage can delay the first useful screen (`client/src/main.jsx:13-23`).
2. **The offline installer downloads the whole built app.** A local build contains 1.62 MB of JavaScript across 161 files before compression. The service worker lists every chunk for installation, including reports a customer may never open (`client/offlineShellPlugin.js:5-27`).
3. **Product searches may slow as the catalog grows.** Several searches use substring matching across multiple fields; price sorting computes values across products. These patterns need real database query plans before choosing a fix (`server/src/controllers/product.controller.js:42-95`, `storefront.controller.js:125-190`).
4. **Several systems check the same data for changes.** Socket messages, query invalidation and a one-minute revision check can all refresh active data. The code tries to limit duplicate reads, but the actual request count has not been measured (`client/src/components/shared/LiveUpdates.jsx:24-82`, `offline/savedData.js:242-317`).
5. **“Oldest visible snapshot” is easy to misread.** It shows the oldest timestamp among active queries, not the age of every number on screen (`client/src/offline/SavedDataStatus.jsx:81-109`).

## What is working and should be protected

The code includes tenant and permission checks, transactional paths for billing and stock, persisted notifications, role-specific live updates, paginated lists and route splitting. The frontend and backend test suites passed **173/173** and **164/164** tests locally. This is useful regression coverage, but it does not measure real user speed.

## Recommended order

1. Record cold/warm page loads, requests, API latency and CPU/RAM on the existing free deployment. Confirm its current plan and region. Use a disposable store for write tests.
2. Shorten the device-storage startup gate and reduce first-install downloads while preserving the offline screens people actually need.
3. Use database `explain` results to target the slowest catalog, dashboard or report query.
4. Consolidate overlapping refresh paths only after measuring duplicate traffic and checking reconnect behavior.
5. Test several simultaneous users in local or staging, never by stress-testing the live shop.

No fixes, deployments or production-data changes were made. No claim of a specific speed improvement is possible without live measurements.
