# ECOMSTORE route, role, regression and performance matrix

**Source of truth:** `client/src/App.jsx` at `0b9a498`; API endpoints from `client/src/features/*/*Api.js` and `server/src/routes/`. All API paths below have `/api/v1` prefix. `{slug}` and IDs are disposable fixture values. **O** owner; **S** staff; **P** packer; **D** delivery; **C** customer; **SA** super-admin; **G** guest. A `/store` or `/staff` shell can be mounted for several roles, but the named `Access` permission and corresponding API middleware still decide the page. Test allowed and denied accounts, including reduced permissions and a second tenant. A test case row covers the route and all listed interactions; it does not mean every role is granted every interaction.

## Common run protocol for every route

For each row, capture cold navigation, warm revisit, exact-key saved data with background revalidation, uncached slow response, changed query args, server error/429, offline saved/unsaved, reconnect, back/forward/scroll, narrow mobile and desktop, keyboard/accessibility, and a second-tenant denial where relevant. Assert no full document reload or blank transition; shell/heading remains visible; valid same-key data remains visible while fetching; unavailable data is not `0` or represented as current; stale data is clearly marked; only affected panels update. Record request count/bytes and p50/p95 route useful/fresh time, LCP/INP/CLS, long tasks, IDB operations, and API p95. Use no production writes. For every mutation, assert pending/failed/confirmed states, double-click and timeout reconciliation, ledger/stock/notification side effects, and permission/tenant checks.

| ID | Role and route | Page / primary read(s) | Workflow and high-risk assertions |
|---|---|---|---|
| A01 | G/O/S/P/D/SA `/login` | `pages/auth/Login.jsx`; POST `/auth/login` | Correct role redirect; 401/429/retry; no protected flash; no prior account snapshot after sign-in. |
| A02 | G `/register` | `pages/auth/Register.jsx`; POST `/auth/register` | Validation and duplicate account; new store/owner scope; no unintended automatic write retry. |
| A03 | any `/`, `/unauthorized`, unknown `*` | `RoleRedirect`, `UnauthorizedPage`, `NotFound` | Role destination, denied permission, history behavior, stable shell, no sensitive cached content. |
| A04 | O/S/P/D/SA `/store`, `/staff`, `/super-admin` | Nested index redirects in `App.jsx` | Correct index destination, permission denial, back/forward and no redirect loop. |
| C01 | G/C `/s/{slug}` | `StoreFront`, `CustomerLayout`; GET `/storefront/{slug}`, `/categories`, `/products` | Store availability, infinite scroll, categories, featured, online stock, cached/offline catalog and scroll. |
| C02 | G/C `/s/{slug}/search` | `StoreFront`; GET `/storefront/{slug}/products` | Debounced search; exact-key results; stale old search never shown as new match; rapid typing/abort. |
| C03 | G/C `/s/{slug}/categories` | `StoreFront`; GET `/categories`, `/products` | Parent/child categories, filter and sort, count/load-more, changed category cache. |
| C04 | G/C `/s/{slug}/p/{productId}` | `ProductDetail`; GET `/products/{productId}`, related products | Variant, price, stock, favorite state, missing/deactivated item, image/layout stability. |
| C05 | G/C `/s/{slug}/cart` | `CartPage`; GET store; POST `/storefront/{slug}/cart/products`, `/coupon/validate` | Cart draft restore, changed stock/price, coupon expiry, pickup/delivery choices, offline provisional totals. |
| C06 | C `/s/{slug}/checkout` | `Checkout`; GET `/customer/profile`, store; POST `/orders` | Server price/stock, address/payment, idempotency, double submit, timeout unknown outcome, no offline purchase claim. |
| C07 | C `/s/{slug}/orders` | `OrderHistory`; GET `/orders` | Page/count, own-store isolation, cached history during refresh, new order appears after reconnect. |
| C08 | C/authorized guest `/s/{slug}/orders/{orderId}` | `OrderTracking`; GET order, POST cancel/proof | Guest order token, status/settlement/proof, permissions, duplicate proof/cancel, live update, offline read label. |
| C09 | C `/s/{slug}/account` | `AccountPage`; GET profile/favorites; PUT profile, addresses, favorites | Identity, address/favorite edits, cached data, pending write, logout and account switch. |
| C10 | G `/s/{slug}/auth` | `CustomerAuth`; POST store customer login/register | Store-bound identity, expired session, 429, back to original route/cart state. |
| O01 | O `/store/dashboard` | `Dashboard`; GET `/dashboard`; layout payment/packing queues and bell | Seven DB operations, cards/graphs, exact figures, notification/queue updates, no fake zero on failure. |
| O02 | O or permitted S `/store/pos` | `POSPage`; GET product catalog, Udhar accounts; POST `/pos/order` | Scanner/search, split cash/UPI/credit, server price and stock, idempotency, 429, offline draft, receipt. |
| O03 | O or permitted S `/store/products` | `ProductList`; GET `/products`, `/categories` | Search/filter/sort/page, adjacent-page prefetch, import/download, inactive products, cache key and count. |
| O04 | O or permitted S `/store/products/new` | `ProductForm`; GET categories; POST `/products`/import | Variant IDs, image upload, defaults, validation, draft preservation and stock ledger creation. |
| O05 | O or permitted S `/store/products/{id}/edit` | `ProductForm`; GET `/products/{id}`; PUT/PATCH product | Stale edit/version handling, variants and stock, tenant ownership, preserved draft. |
| O06 | O or permitted S `/store/categories` | `CategoriesPage`; GET/POST/PUT/DELETE `/categories`, reorder | Hierarchy/orphans, valid parent, order, product association, cached catalog invalidation. |
| O07 | O or permitted S `/store/suppliers` | `SuppliersPage`; GET `/suppliers`, supplier detail | Search/page, create/edit/delete, pending balance, tenant scope. |
| O08 | O or permitted S `/store/purchases` | `PurchaseList`; GET `/purchases`, `/purchases/stats` | Date/status/page, totals, deep page, stock/dues update after purchase. |
| O09 | O or permitted S `/store/purchases/new` | `PurchaseForm`; product/supplier lookup; POST `/purchases` | Variant selection, tax/discount, stock ledger, duplicate submit, draft and server confirmation. |
| O10 | O or permitted S `/store/purchases/{id}` | `PurchaseForm`; GET `/purchases/{id}`, POST payment | Existing purchase, payment allocation, idempotency, supplier dues, read-only/permission differences. |
| O11 | O or permitted S `/store/inventory` | `InventoryDashboard`; GET `/inventory/dashboard`, `/list` | Value and low stock, filter/page, stock adjust only with permission, exact figures on error. |
| O12 | O or permitted S `/store/inventory/low-stock` | `LowStockPage`; GET `/inventory/low-stock` | Threshold/variant accuracy, no stale current claim, live stock change. |
| O13 | O or permitted S `/store/inventory/ledger/{productId}` | `StockLedgerPage`; GET `/inventory/ledger/{productId}` | Chronology/page/quantity reconciliation, tenant isolation, export if offered. |
| O14 | O or permitted S `/store/orders` | `OrdersManagement`; GET `/storefront/{slug}/admin/orders` and detail | Cursor/page/filter, responsibility, status/cancel/reject/partial/assignment, notifications, duplicate event behavior. |
| O15 | O or permitted S `/store/orders/payment-queue` | `PaymentVerificationPage`; GET payment queue/order payments | Verify/reject proof, role restriction, idempotent settlement, Udhar and cash reporting, live queue. |
| O16 | O or permitted S `/store/packing` | `PackingVerificationPage`; GET `/packing/admin/queue`, sessions/detail | Accept/verify/reject, missing/high-value items, exact stock/order effects, live and offline worker replay. |
| O17 | O or permitted S `/store/packing/work` | `StaffOrdersPage`; GET `/packing/my-orders` | Assigned work, accept/start, search/status persistence, permission and tenant isolation. |
| O18 | O or permitted S `/store/packing/work/{orderId}` | `StaffPackingPage`; GET `/packing/session/{id}` | Checklist/replacement/complete, offline outbox, conflict 409, operation receipt, no duplicate activity. |
| O19 | O or permitted S/D `/store/deliveries` | `DeliveryOrdersPage`; GET `/delivery/orders` | Assignment/status, COD handover, order/payment/closing refresh, worker scope. |
| O20 | O or permitted S `/store/staff-activity` | `StaffActivityPage`; GET `/packing/admin/activity`, reports | Search/page, missing/high-value reports, actor history and tenant scope. |
| O21 | O or permitted S `/store/staff` | `StaffManagementPage`; GET/POST/PATCH/DELETE `/users/staff` | Permissions/role changes, socket `user:updated`, session/cache reset, no privilege leak. |
| O22 | O or permitted S `/store/daily-closing` | `DailyClosingPage`; GET summary/transactions/closings/detail | Cash movement reconciliation, frozen finalize, version/review key, corrections, local business date, stale draft. |
| O23 | O or permitted S `/store/returns` | `ReturnsPage`; GET returns/stats; POST create/process | Customer/supplier return, stock/payment/credit, idempotency, role restriction and exact totals. |
| O24 | O or permitted S `/store/udhar` | `UdharPage`; GET customers/stats/dues/ledger/bills | Debit/credit/reversal, payment preview, order settlement, history/page, duplicate submit, tenant isolation. |
| O25 | O or permitted S `/store/expenses` | `ExpensesPage`; GET `/expenses`, `/stats` | Date/category/filter/page, create/edit/delete, closing and P&L totals, exact-key data. |
| O26 | O or permitted S `/store/salary` | `SalaryPage`; GET salary records/stats/staff/history | Month/employee/page, salary/payment posting, closing cash and P&L, permission. |
| O27 | O or permitted S `/store/supplier-payments` | `SupplierPaymentsPage`; GET suppliers/detail/reconciliation | Invoice allocation, idempotency, balance/ledger rollback on failure, pending confirmation. |
| O28 | O or permitted S `/store/profit-loss` | `ProfitLossPage`; GET `/reports/profit-loss` | Date range/time zone, revenue/COGS/expense/salary/returns, no fabricated zero or old-filter totals. |
| O29 | O or permitted S `/store/reports` | `ReportsPage`; GET daily/monthly/yearly/product/category/stock/dues/expenses/salary/purchases | Each tab/date/page; aggregate reconciliation and chart chunk/load, no eager all-tab requests. |
| O30 | O or permitted S `/store/sales` | `SalesOverviewPage`; GET `/reports/sales-overview` | Cursor/page/date, POS/delivery/Udhar sources, receipt links, totals across page boundaries. |
| O31 | O or permitted S `/store/coupons` | `CouponsPage`; GET/POST/PUT/DELETE `/coupons` | Scope/expiry/usage limits, customer checkout validation and invalidation. |
| O32 | O or permitted S `/store/offers` | `OffersPage`; GET/POST/PUT/DELETE `/offers` | Online catalog price/eligibility, start/end, no stale promotional total. |
| O33 | O or permitted S `/store/settings` | `SettingsPage`; GET/PATCH `/stores/mine`, QR upload | Saved draft/tab, store config/time zone, image privacy, version/permission. |
| O34 | O or permitted S `/store/notifications` | `NotificationsPage`; GET inbox/unread count | Read/all-read, persisted notification, multi-tab and socket/revision deduplication. |
| O35 | O or permitted S `/store/backup` | `BackupPage`; GET `/backup/*` | Full/category export, large stream, private asset inclusion and tenant isolation; isolated restore drill. |
| O36 | O or permitted S `/store/audit-logs` | `AuditLogsPage`; GET `/audit-logs`, `/stats` | Action/date/page, actor and tenant scope, immutable history. |
| S01 | permitted S/P/D `/staff/dashboard` | `staff/Dashboard`; GET `/dashboard` | Role-specific cards and queues, permission-limited data, live changes, no fake zero. |
| S02 | permitted S/P/D `/staff/orders` | `StaffOrderAccess` chooses `OrdersManagement` or `OperationalOrdersPage` | Permission-dependent UI; operational order search/status; no unauthorized admin action. |
| S03 | permitted S `/staff/pos` | shared `POSPage`; GET products/Udhar, POST `/pos/order` | Same POS financial/stock assertions as O02 with staff permission. |
| P01 | permitted P/S `/staff/packing` | shared `StaffOrdersPage`; GET `/packing/my-orders` | Assigned-only queue, accept/start, reconnect and offline saved work. |
| P02 | permitted P/S `/staff/packing/{orderId}` | shared `StaffPackingPage`; GET session | Offline checklist replay, 409, changed assignment, duplicate operation and completion. |
| D01 | permitted D/S `/staff/deliveries` | shared `DeliveryOrdersPage`; GET `/delivery/orders` | Assigned-only status, COD handover, reconnect and tenant isolation. |
| SA01 | SA `/super-admin/dashboard` | `super-admin/Dashboard`; GET `/super-admin/stats` | Platform totals, recent stores, no tenant data bleed, aggregate query p95. |
| SA02 | SA `/super-admin/stores` | `StoresPage`; GET `/super-admin/stores` | Search/page/count, create store, owner collision/plan/limits, no duplicate provisioning. |
| SA03 | SA `/super-admin/stores/{id}` | `TenantDetailPage`; GET detail, plans, support logs | Subscription/modules/limits/toggle, support-access audit, stale form/version and tenant isolation. |
| SA04 | SA `/super-admin/plans` | `PlansPage`; GET/POST/PUT/DELETE `/plans` | Active/inactive plans, store entitlements, no unauthorized edit; seed only in controlled fixture. |
| SA05 | SA `/super-admin/audit-logs` | `AuditLogsPage`; GET `/super-admin/audit-logs` | Cross-store filters/page, actor scope, no private payload leakage. |

## Cross-route scenarios and evidence to retain

| Scenario | Roles/routes | Automated proof and performance record |
|---|---|---|
| Startup and account switch | A01–A04, C01, O01, S01, SA01 | Delayed/rejected IDB, slow/failed refresh, 12 h offline identity, pending logout, two tabs, no prior-scope flash; shell/useful/fresh times. |
| Live business changes | C07–C08, O01/O14–O20/O34, P01–P02, D01 | Order/packing/delivery/notification event once, duplicate/out-of-order socket, reconnect, revision recovery, process death; active query refetch and visible lag. |
| Catalog and cache | C01–C05, O03–O05/O11–O13 | 5k+ products/tenant fixture, search/category/price/deep page; result equivalence, explain stats, bytes, saved/offline exact-key correctness. |
| Financial and stock ledger | C06/C08, O02/O08–O10/O15/O19/O22–O30, S03/D01 | Concurrent writes, 409/429/timeout, stock ledger, payment legs, supplier/Udhar balances, returns, frozen closing, date/time zone; DB invariant equality. |
| Offline and PWA upgrade | all designated routes; especially C01–C09, O02, P02 | First install vs visited route, SW update with active draft, quota, storage blocked, public image cache, pending outbox conflict; install bytes/duration and offline hit. |
| Authorization and isolation | every protected row | Allowed/denied role, reduced permission, tenant B ID, stale tab, signed-out cookie; response status and absence of cross-scope cached data. |
| Responsive and accessible UI | all route rows | 360/390 px mobile and desktop, reduced motion, keyboard, focus return, labels, contrast, layout shifts; axe plus visual trace. |
| Load and handover | C01/C02/C06, O01/O02/O14/O22/O29, P02, SA01 | Staging only at 1/5/10/25/50 users with realistic read/write mix; p50/p95/p99, throughput, 429/5xx, CPU/RAM/DB pool, restore and rollback drills. |

**Execution status:** planned, not run as a full matrix. Existing automated tests cover selected cells (for example `savedData.test.jsx`, `StableRoutes.test.jsx`, `StaffPackingPage.test.jsx`, `POSPage.test.jsx`, `DailyClosingPage.test.jsx`, and server `api.security.test.js`), but no per-route performance pass or hosted load result is claimed.
