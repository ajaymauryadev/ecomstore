# Security verification notes

Last reviewed on 2026-11-21.

## Production dependency audit

Clean `npm ci` installs from both lockfiles were verified on Windows with Node
24.14.1 and npm 11.11.0. The initial `npm audit --omit=dev` reported 2 critical,
6 high and 2 moderate entries on the server and 1 high entry on the client. Both
production audits now report **0 vulnerabilities**. There are no outstanding
high or critical findings in these production dependency trees.

| Package | Previous → verified installed | Applicability and remediation |
| --- | --- | --- |
| Mongoose | 8.24.2 → 8.24.10 | The old version was in the affected 8.x ranges. The two filter findings concern the `sanitizeFilter` option, which the application leaves unset. Mongoose still hydrates and updates application documents, so the 8.x patch addresses the affected runtime without a major migration. [Critical countDocuments advisory](https://github.com/advisories/GHSA-pcrw-h46h-c93h) · [Connection filter advisory](https://github.com/advisories/GHSA-gg4r-jv3p-qx3c) · [Hydration and update advisory](https://github.com/advisories/GHSA-8332-j7wj-wjw4) |
| proxy-addr | 2.0.7 → 2.0.8 | Express uses this package for client IP resolution when trusted proxy CIDRs are configured. Direct deployments disable forwarding trust by default. The patched dependency applies to every deployment. [Proxy advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) |
| body-parser and compression | 1.20.6 → 1.20.9 and 1.8.1 → 1.8.2 | Express parses request bodies and compresses eligible responses in production. The parser stays on the Express 4-compatible 1.x line. [Body parser advisory](https://github.com/advisories/GHSA-27r3-jxmh-p828) · [Compression advisory](https://github.com/advisories/GHSA-vc2v-76pw-4v95) |
| engine.io and socket.io-parser | 6.6.8 → 6.6.12 and 4.2.6 → 4.2.7 | Engine.IO handles the server transport. Both Socket.IO endpoints use the parser and now resolve 4.2.7. [Engine.IO advisory](https://github.com/advisories/GHSA-2gc4-cqfq-p2gv) · [Socket.IO parser advisory](https://github.com/advisories/GHSA-2m8v-j782-fhvr) |
| Multer | 2.2.0 → 2.5.0 | Catalog images and payment proofs use multipart parsing, in-memory storage and a synchronous image filter. The 2.5.0 release covers the older parser findings and the subsequent asynchronous-filter fix. [Multipart field advisory](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm) · [File descriptor advisory](https://github.com/advisories/GHSA-qfvm-cv95-jqjf) · [Field index advisory](https://github.com/advisories/GHSA-535w-7cp7-47q4) · [Async filter advisory](https://github.com/advisories/GHSA-q7qp-rjg7-q26m) |
| sharp | 0.35.3 → 0.35.5 | The upload path accepts JPEG, PNG and WebP and checks file signatures before decoding. The libheif and librsvg findings concern native decoder paths and platform conditions. The verified bundled build reports libheif 1.23.5 and librsvg 2.63.2. Deployments that supply system libraries should verify the native runtime versions separately. [libheif advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) · [librsvg advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) |
| Morgan and qs | 1.11.0 → 1.12.1 and 6.15.2 → 6.16.2 | The server also clears the moderate logging and query library findings. It uses Morgan in development and resolves qs through Express 4.22.3 and body-parser. [Morgan advisory](https://github.com/advisories/GHSA-9f6g-j8ch-79g4) · [qs advisory](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) |

React Router 7.18.2 stays installed. The current upstream advisory identifies
7.18.2 as the patched 7.x release and limits the affected feature to unstable RSC
APIs. This client runs as a declarative BrowserRouter SPA.
[React Router advisory](https://github.com/advisories/GHSA-qwww-vcr4-c8h2)

After the clean installs, 92 server tests and 15 client tests passed. The
server tests covered authentication, tenant scoping, catalog and private payment
proof uploads, POS events over Socket.IO polling and WebSocket, and transaction
rollback. The client production build also passed.

## Delegated shop duties

Store owners have every store permission and can pack, verify, and deliver any
order in their own store without a separate employee login. Existing employee
roles retain their standard duties. Owners may grant additional shop permissions
to staff, packers, and delivery workers; staff-access management remains owner-only.
The `packing.manage` and `delivery.manage` permissions allow work across the
store's assignments, while ordinary packing and delivery permissions remain
restricted to the worker's own assigned work. APIs read current permissions on
every request. Permission updates refresh the employee workspace without revoking
its session. Delegated audit views and exports remain scoped to that store.

## Deployment preconditions

- Production must provide independent, randomly generated JWT access, JWT refresh,
  and cookie secrets that satisfy startup validation.
- CORS origins must be explicit HTTPS origins in production.
- MongoDB must be a replica set or sharded deployment because financial writes use
  transactions.
- Before applying the new unique tenant/date daily-closing index to existing data,
  check for duplicate historical closing records and resolve them deliberately.
- Legacy orders whose stock-reservation state predates the reservation marker must
  be reviewed before attempting historical cancellation/restock operations.

## API request budgets and proxy configuration

- The public and customer budget is 200 requests per IP per 15 minutes. Business
  roles carrying a signed, unexpired access token use a separate budget of 450
  per account per 15 minutes. Route authorization still checks the current
  user and tenant.
- In 15 minutes, 30-second polling generates up to 120 owner requests when the
  payment queue is open, and 30 notification requests on a cashier tab. A busy
  cashier estimate of 60 bills with three product searches and one submission
  per bill plus notifications gives 270 requests. Both fit their account budgets
  even on the same IP. POS submissions also have a cap of 120 per account per minute.
- Login and registration share 10 attempts per IP per 15 minutes. Password
  changes allow 10 attempts per account over the same window. Refresh has
  its own 60-attempt IP budget over the same window. Catalog uploads allow 30 per
  account and 60 per IP per 15 minutes. Payment proofs retain 10 per IP per 15 minutes.
  The in-memory counters are per API process.
- Direct deployments ignore forwarded IP headers by default. For a deployment
  behind proxies, set `TRUSTED_PROXY_CIDRS` to the actual proxy addresses or the
  narrow network ranges they exclusively use. At the public ingress, discard
  client-supplied forwarding headers and set the observed client IP. Additional
  trusted hops must append the observed peer and the API origin should be
  reachable only by the configured ingress chain. Verify the direct path, every
  ingress path and the effective client IP before enabling the setting.
