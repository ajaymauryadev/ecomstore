# Smart Kirana staging and one-week trial

## Stage a release

Use a dedicated Linux host with Docker Compose, a staging DNS hostname pointing
at the host, and an authenticated staging MongoDB replica set in the same
region or private network. Use a staging-only database and MongoDB identity.
Keep the API container and database off public ingress. Caddy owns ports 80 and
443 and obtains and renews the certificate for the hostname. Docker restart
policies restart both services when the Docker daemon starts. Verify that the
host and Docker daemon start after reboot. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https) · [Docker restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/) · [MongoDB replication](https://www.mongodb.com/docs/manual/replication/)

Set the following deployment variables in the protected host environment.

| Variable | Value |
| --- | --- |
| `STAGING_HOST` | Staging DNS hostname without a scheme or path |
| `STAGING_RELEASE` | Immutable release identifier used for both image tags |
| `STAGING_API_ENV` | Absolute path to a host-only environment file containing `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `COOKIE_SECRET` |
| `STAGING_UPLOAD_VOLUME` | Dedicated persistent volume for public catalog images and private payment proofs |

Use three independent signing and cookie secrets. Supply the database URI and
secrets from the host's secret store. Store the external uploads volume on
durable storage and allow the API's container user, UID 1000, to write to it.
The backup worker needs read access to the same uploads tree, a separate
read-only source database connection, and an off-host vault.

From the repository root, create the staging volume once and start the stack.

```sh
docker volume create "$STAGING_UPLOAD_VOLUME"
docker compose -f deploy/staging/compose.yaml config --quiet
docker compose -f deploy/staging/compose.yaml up --build -d --wait --wait-timeout 120
node deploy/staging/smoke.mjs "https://$STAGING_HOST"
```

For the cookie smoke, supply `STAGING_SMOKE_EMAIL` and
`STAGING_SMOKE_PASSWORD` through the local process environment for a synthetic
staging account. The smoke verifies refresh cookie flags and rotation, then
logs out that session. Record certificate validity, HTTP to HTTPS redirection
and working WebSocket connections on the deployed URL. The sample private
bridge uses `172.30.21.0/24`; if the host already routes that subnet, change
the subnet, dynamic allocation range, Caddy address and trusted proxy CIDR
together. Keep Caddy's fixed address outside the dynamic allocation range so
Docker can recreate the API or edge in either order.

HTML revalidates on navigation. Fingerprinted files are immutable for one year.
The edge serves a real 404 for a missing asset and keeps REST, Socket.IO and
uploads out of the SPA rewrite. Express controls upload permissions. The
readiness probe checks the writable transaction-capable MongoDB topology and
access to the upload directory. [Caddy SPA patterns](https://caddyserver.com/docs/caddyfile/patterns) · [Caddy proxy behavior](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

## Rehearse deploy, restart and rollback

1. Record both image IDs, the staging database name and uploads volume. Capture
   the same tenant's order and stock reconciliation before the change.
2. On synthetic data, record a POS bill, its idempotency key, its stock ledger
   movement and an authorized private proof hash. Restart the API and verify
   readiness, the same bill ID and stock count, and matching proof bytes.
   Replay the same POS request and verify a single bill and stock movement.
3. Deploy the candidate tag. Repeat the checks with pre-upgrade data, then
   create a new synthetic bill and proof. Freeze writes and redeploy the
   previous image pair with `up --no-build -d --wait` against the same staging
   data only after verifying write compatibility. Rerun the bill, proof,
   stock and totals checks. Deploy the candidate again with the same checks.
4. If the old image requires a different schema, restore a verified snapshot
   to an isolated database and uploads pair and reconcile writes since that
   snapshot before any promotion. Follow [backup recovery](../../server/ops/BACKUP-RECOVERY.md).

Keep a copy of the previous images and the matching uploads/database recovery
point. On release replacement, stale open tabs can still request an older
hashed chunk. Include a warmed tab in the rollout smoke and record whether a
reload is required.

## Device and failure checks

- On the owner's phone and counter laptop, log in, find a product, post a POS
  bill, print the receipt on the intended printer, verify stock, post a refund
  and finalize closing. Record the bill number, inventory change, refund and
  closing reconciliation for synthetic data.
- Complete guest checkout and tracking, then pack and deliver a synthetic order
  with the authorized staff roles. Check customer and staff permissions.
- Repeat navigation and billing over a constrained connection. Interrupt one
  response after a bill commits and retry. Check that the draft is recoverable,
  exactly one bill and movement exist, and the receipt reflects server success.
- Verify an encrypted restore to a fresh database and separate upload directory.
  Compare financial totals, stock and proof hashes. Exercise the backup worker's
  failed or stale-backup alert and confirm receipt in the designated destination.
- Measure click feedback, cached navigation, sign-in and read API p95 on staging
  and the owner device. See the [local measurement method](../../demo-smoke-test.md#route-and-cache-measurements).
  Record the release, device, sample count, connection profile and measured
  values for each run. Track timeout/retry outcomes separately so failed requests
  are visible alongside latency percentiles.

## Local rehearsal on 21 November 2026

- Compose configuration parsed and Caddy configuration validated. The production
  web build ran behind native Caddy with a local certificate, a production-mode
  API and a disposable MongoDB replica set. HTTP redirected to HTTPS. Deep links,
  immutable assets, HTML revalidation, API 404s, readiness, CORS, private cache
  headers, refresh cookie rotation and an authenticated WebSocket passed.
- Both Linux images built from clean installs. The Linux API's production
  install returned zero npm findings. The client build stage includes
  development tools, and its full install audit reported 16 findings. The
  final edge image copies the built web assets from that stage.
- The Linux Compose stack passed the HTTPS smoke against a disposable,
  authenticated MongoDB replica set. The API container was recreated with
  a new container ID while retaining the external uploads volume. The
  original POS bill replayed with one movement, the authorized proof bytes
  matched and anonymous proof access returned 404. The local test stack
  and its synthetic volumes were removed afterward.
- During an API process restart, the edge returned 502 for readiness. After
  restart, the POS retry returned the original bill and one stock movement,
  with stock moving from 20 to 19. The SHA-256 of an authorized payment proof
  matched before and after restart, and an anonymous fetch returned 404.
- The encrypted restore fixture recovered the original private proof, 5,001
  stock ledger rows, ₹99 in order totals, 5,001 stock units and ₹75 in Udhar
  with no reconciliation differences. An empty backup vault triggered the
  backup CLI's failure path and a local HTTPS receiver got the alert.
- The guest delivery API check covered checkout, tracking, owner assignment,
  packing, verification, delivery and COD settlement. The full runs passed
  95 API tests and 20 client unit tests. The 11 browser tests
  covered guest checkout/tracking and lost POS and checkout responses using
  synthetic data. Production dependency audits returned zero findings for both
  packages on the local lockfiles.

## Go/no-go

**No-go for real data pending live staging evidence.** The one-week trial starts
after each P0 has staging evidence and the designated owner signs off. Record the
release, start date, reviewer, P0 evidence and any rollback trigger. Any failed
P0, unresolved reconciliation difference, missing restore or backup alert
verification, or missing measured staging performance holds the decision.

| P0 | Local evidence | Staging and owner-device result |
| --- | --- | --- |
| 02 Backup and verified restore | Encrypted restore, proof hash, reconciled totals and local alert receipt passed | Pending isolated staging restore and designated alert destination |
| 03 Add to Cart | Guest cart, recovery and checkout browser fixtures | Pending |
| 06 Stocked variants | Variant and stock transaction regression | Pending |
| 07 Walk-in POS | Cash and UPI browser billing with one movement per bill | Pending |
| 08 Retry idempotency | Lost-response POS and storefront tests plus API-process replay | Pending |
| 09 Udhar posting | Browser ₹100 credit bill and API ledger checks | Pending |
| 10 Supplier reconciliation | Supplier payment integration, retries and invoice checks | Pending |
| 11 Discounted refund | Original paid bill, restock and refund cap regressions | Pending |
| 12 Cash closing | Cash movement reconciliation API tests | Pending |
| 13 Finalized closing | Finalization and correction API tests | Pending |
| 14 Business dates | Store timezone boundary and closing API tests | Pending |
| 15 Historical COGS | ₹100 sale, ₹60 COGS, ₹40 gross profit and 40% margin API regression | Pending |
| 18 Production dependencies | Server and client production audits, clean Linux image builds | Pending verification on the deployed release |
| 21 Trial deployment | Linux Compose with authenticated replica set, local HTTPS, API recreation and staff journey passed | Pending live host, DNS, staging replica set and storage, roll-forward/rollback, staging measurements and physical devices |
