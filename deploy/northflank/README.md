# Free Northflank deployment

This setup builds the React frontend and runs Caddy plus the existing Node API in
one combined service. The browser uses `/api/v1` and same-origin Socket.IO, so
there is one HTTPS address for cookies, API calls, images and live updates.
MongoDB and uploaded media stay outside the ephemeral application container.

## Connected account status — 25 November 2026

The connected Free team permits **Europe West (London)** and **US Central**.
India and Singapore are disabled behind a paid upgrade. London was selected.
The creation form permits `nf-compute-20` (0.2 shared vCPU, 512 MB), one instance.
Despite the public pricing page's "No card needed" statement, this account's
service form requires card verification and says this service will not be
charged. Complete verification yourself while keeping the team on Free.

A service **draft**, not a created deployment, was prepared for `smart-kirana`
using branch `codex/northflank-deploy`. Northflank loaded and verified this
Dockerfile, detected public HTTP port 8080, and generated a provisional hostname.
The draft contains production mode, that origin's CORS setting, ImageKit storage
mode/folder, HTTP `/ready` and `/health` probes on 8080 (120-second initial delay),
and a 30-second termination grace period. Database/media credentials and three
independent signing secrets still need configuring. The generated address is
**not a live website**. The form is not a saved service and may be lost on refresh;
the repository settings below allow it to be recreated.

## Northflank dashboard settings

1. Keep the team on **Free / Sandbox**. Choose Northflank Cloud. Check **All**
   regions for a free India or Singapore option. If the account only permits
   US Central or Europe West, choose among those; do not upgrade to unlock a
   nearer region. Put MongoDB as close to the service as the free plans permit.
2. Select **Deploy repository**, then a **Combined** build and deployment
   service, repository `ajaymauryadev/ecomstore`, and the branch containing these
   files. Use Dockerfile build, context `/`, Dockerfile
   `deploy/northflank/Dockerfile`, and the final/default target `runtime`.
3. Select the **free compute plan**, **one instance**, with no paid volume or
   autoscaling. Leave the command/entrypoint override empty.
4. Configure **one public HTTP port: 8080**, using Northflank's generated HTTPS
   domain. Do not expose port 5000, add a TCP endpoint, or route around public
   HTTP ingress. Do not place a CDN in front until client IP handling is reviewed.
5. Add the runtime variables from [`.env.example`](.env.example). Set
   `CORS_ORIGINS` to the generated HTTPS origin without a trailing slash. Generate
   three separate random secrets, each at least 32 characters, for JWTs/cookies.
   Keep secrets in runtime variables/secret groups, never Git or build arguments.
6. Use a **MongoDB replica set** with an explicit production database name. Atlas
   Free is an option; a Northflank free MongoDB addon is suitable only after its
   replica-set/transaction support is verified. A standalone MongoDB instance
   cannot support this app's billing transactions. Do not copy development store
   data or run demo seed/reset scripts against production.
7. Set ImageKit's private key and a dedicated production folder. The container
   exits if production configuration fails validation or local uploads are used
   on its ephemeral disk. Existing local images must be migrated separately
   using `server/ops/IMAGEKIT.md` before relying on them in production.
8. Set HTTP readiness to **GET `/ready` on 8080** and liveness to **GET `/health`
   on 8080**. Allow at least 120 seconds for initial database connection/indexes.
   Use an HTTP startup probe if the dashboard supports one. Deploy and inspect
   build/runtime logs. Green `/health` alone does not prove MongoDB transactions
   work; `/ready` checks the application's actual database prerequisites.

The startup script fixes the internal API port and trusts only its loopback
Caddy proxy. Caddy replaces forwarded client addresses with Northflank's
`X-Envoy-External-Address`, which Northflank documents as overwritten at public
HTTP ingress. **Internal callers must be trusted**: Northflank does not guarantee
that header for internal/VPC requests. Do not add untrusted workloads to this
project or publish the internal Node port. Health probes do not need that header.

## Verify the deployment

Run from the repository root, replacing the URL with the actual deployed origin:

```sh
node deploy/staging/smoke.mjs https://YOUR_NORTHFLANK_HOST
```

Then verify a real login, a billing transaction in a disposable test store,
Socket.IO updates between two browsers, image upload, private payment-proof
access, and image retrieval after a service restart. Do not call a release
verified until these checks pass. Keep encrypted backups outside the host.

For a local Linux Docker build (no credentials needed):

```sh
docker build -f deploy/northflank/Dockerfile -t smart-kirana-northflank .
```

Free hosting is a limited starting point; this is not a hosted speed benchmark
or an availability guarantee. Northflank's current pricing lists two services,
two jobs and one database with limited always-on resources. Use the account's
displayed free allocation; do not enable Pay as you go. Vercel Hobby is restricted
to personal/non-commercial use and is not recommended for a trading store.

Sources checked 25 November 2026:
[Northflank pricing](https://northflank.com/pricing),
[Northflank ingress headers](https://northflank.com/docs/v1/application/network/networking-on-northflank),
[Vercel terms](https://vercel.com/legal/terms).

## Local verification on 25 November 2026

The Linux runtime image built successfully. All four existing production
configuration tests passed. The bundled Caddy configuration and Bash startup
script validated. A disposable container with a synthetic upstream verified
SPA navigation, hashed-asset caching, distinct API 404s, health/readiness and
Socket.IO polling route forwarding, replacement of spoofed forwarded-IP
headers, production API URLs, and absence of a bundled `.env`. This is local
configuration/proxy evidence; it does not verify a live Northflank deployment,
real WebSocket upgrades, database transactions, account login or media durability.
