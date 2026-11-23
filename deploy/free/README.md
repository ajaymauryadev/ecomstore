# Free hosting for Smart Kirana

Use Oracle Cloud Always Free for the API, static frontend and uploaded files;
MongoDB Atlas Free for the database; and DuckDNS for a free HTTPS hostname.
The same hostname serves the UI, API, images and Socket.IO, so the browser
never needs localhost URLs or third-party authentication cookies.

**ImageKit option:** see [cloud image setup and migration](../../server/ops/IMAGEKIT.md).
The setup script asks for an optional ImageKit private key after the Atlas URI.
With a key, new images go to ImageKit and public image paths redirect to its CDN.
Migrate existing images separately, and retain the volume for legacy files and
verified restores. ImageKit's own plan storage and delivery limits also apply.

This is a small deployment, not a measured capacity guarantee. An A1 VM avoids
Render Free's normal idle wake-up delay and retains files across app restarts.
Oracle requires a supported card for verification, free capacity can be
unavailable, and idle free instances can be reclaimed. Free services have no
uptime guarantee. Keep backups outside the VM. If Oracle is unavailable, the
same Compose files work on a paid Ubuntu VM; that alternative is not free.

## 1. Create the free resources in their dashboards

1. [Oracle Cloud](https://www.oracle.com/cloud/free/): choose your home region
   near your users, ideally Mumbai for India. Create an Ubuntu 24.04 instance
   with shape `VM.Standard.A1.Flex`, **2 OCPUs / 12 GB RAM**, and a 50 GB boot
   disk, within your tenancy's displayed Always Free allowances. As of
   23 November 2026, the official allowance is 1,500 A1 OCPU hours and 9,000
   GB hours per month, not the older 4 OCPU / 24 GB allowance. Other existing
   instances count toward the same limits. Choose a public subnet with an
   internet gateway and a public IPv4 address. Download the SSH private key.
2. In the VM subnet's security list or attached network security group, allow
   inbound TCP **80 and 443** from `0.0.0.0/0`. Allow SSH TCP 22 from your own
   public IP `/32`. Keep the default outbound access so Docker, Atlas and
   certificate issuance work. Do not open 5000 or 27017.
3. [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register): create a
   **Free/M0** cluster, preferably Mumbai or the nearest supported free region
   to the VM. Do not select a paid Flex or dedicated cluster. Create a database
   user with `readWrite` access to `smart-kirana`, and add the VM's public IP
   `/32` under Network Access. Copy the Node.js driver connection URI. Insert
   `/smart-kirana` before `?`, for example:
   `mongodb+srv://appuser:ENCODED_PASSWORD@YOUR_CLUSTER.mongodb.net/smart-kirana?retryWrites=true&w=majority`.
   Percent-encode special characters in the password. The free cluster has
   512 MB for data plus indexes; uploads use the VM disk instead.
4. [DuckDNS](https://www.duckdns.org/): sign in, claim a unique name, such as
   `my-kirana`, set its IPv4 address to the Oracle VM public IPv4, and click
   Update. Your eventual link is `https://my-kirana.duckdns.org`.
   Use your own chosen name in the commands. If you have your own domain,
   an A record pointing to the VM works too. Remove any incorrect AAAA record.

These account, VM and database steps require your own login. No resources
have been created by editing this repository. A new Atlas database is empty;
the deploy does not copy the local database or uploaded files.

## 2. Package the code on Windows

Run in PowerShell from the project. Git is installed locally. This creates a
local Git repository and source archive; a GitHub account is not required.
Review `git status --short` before committing: environment files, uploads,
node_modules, builds, audit JSON, backups and local screenshots are ignored.
Keep package-lock files and `.env.example` files committed.

```powershell
Set-Location 'D:\Backup\DESKTOP\Personal Project\ecomstore_2'
git init -b main
git add .
git status --short
git commit -m "Prepare free Oracle hosting"
git archive --format=tar.gz --output=smart-kirana-source.tar.gz HEAD

$VmIp = 'YOUR_ORACLE_PUBLIC_IP'
$SshKey = 'C:\Users\ajaym\Downloads\YOUR_ORACLE_PRIVATE_KEY.key'
scp -i "$SshKey" .\smart-kirana-source.tar.gz "ubuntu@${VmIp}:~/smart-kirana-source.tar.gz"
ssh -i "$SshKey" "ubuntu@$VmIp"
```

If Git asks for an identity, set your own values with `git config user.name
"Your Name"` and `git config user.email "you@example.com"`, then rerun the
commit and archive commands. Do not paste literal example identity values.

## 3. Deploy on the VM

After SSH, use these **Bash/Ubuntu** commands, not PowerShell:

```bash
mkdir -p ~/smart-kirana
cd ~/smart-kirana
tar -xzf ~/smart-kirana-source.tar.gz

# Open only web ports in the existing Ubuntu firewall. Save these before
# installing Docker so Docker's dynamic chains are not saved as static rules.
sudo apt-get update
sudo apt-get install -y iptables-persistent
sudo iptables -C INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 1 -p tcp -m multiport --dports 80,443 -j ACCEPT
sudo netfilter-persistent save

bash deploy/free/install-docker.sh
bash deploy/free/configure.sh
bash deploy/free/deploy.sh
```

If `iptables-persistent` asks to save existing rules, accept. Existing SSH and
Oracle storage rules are retained; do not flush the firewall or enable UFW.
The cloud security list and Ubuntu firewall are separate layers.

The configure script asks for the hostname, Atlas URI and an optional ImageKit
private key (credentials are hidden while typed). It generates three independent random secrets and stores them
with private permissions in `~/.config/smart-kirana/.env.api`. It writes
deployment settings into `~/.config/smart-kirana/.env`. These live outside
the source checkout and are reused across updates. Do not run configure with
sudo: deployment later reads the files using Docker's sudo access.

The deploy script builds both images, waits for API readiness, validates Caddy,
waits for HTTPS certificate issuance, and runs the existing route/cache/CORS
smoke checks. It prints the live link after they pass. It requires public
DNS and ports 80/443 to be ready. The first build can take several minutes.
The Dockerfile uses Node 24 and has ARM64 support via upstream base images.

Visit `https://YOUR_NAME.duckdns.org/register` to create a store owner account,
then use `/login`. This uses the existing application subscription rules:
new stores currently get a 30-day app trial, which is separate from hosting
cost. The storefront URL is `/s/YOUR_STORE_SLUG`. Configure products, stock
and payment settings from the owner account. Demo reset commands delete demo
data and are not required for hosting.

## 4. Updates

On Windows, commit the changes and package the committed version:

```powershell
Set-Location 'D:\Backup\DESKTOP\Personal Project\ecomstore_2'
git add .
git status --short
git commit -m "Update application"
git archive --format=tar.gz --output=smart-kirana-source.tar.gz HEAD
scp -i "$SshKey" .\smart-kirana-source.tar.gz "ubuntu@${VmIp}:~/smart-kirana-source.tar.gz"
ssh -i "$SshKey" "ubuntu@$VmIp"
```

On the VM, extract into a fresh release directory so removed source files
cannot linger in the next image. Config, certificate volumes and uploads are
reused because the Compose project and volume names stay fixed:

```bash
release_dir="$HOME/smart-kirana-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$release_dir"
tar -xzf ~/smart-kirana-source.tar.gz -C "$release_dir"
cd "$release_dir"
bash deploy/free/deploy.sh
```

Run subsequent log or deploy commands from the currently deployed release
directory. There can be a brief interruption during container replacement.

## Useful commands and recovery

From the deployed source directory:

```bash
sudo docker compose --env-file "$HOME/.config/smart-kirana/.env" -f deploy/free/compose.yaml ps
sudo docker compose --env-file "$HOME/.config/smart-kirana/.env" -f deploy/free/compose.yaml logs --tail 100 api edge
sudo docker compose --env-file "$HOME/.config/smart-kirana/.env" -f deploy/free/compose.yaml restart api
curl -fsS https://YOUR_NAME.duckdns.org/ready
```

If HTTPS fails, check DuckDNS points at the VM, Oracle ingress rules allow
80/443, and Caddy logs show certificate issuance. If API readiness fails,
check Atlas user credentials, the database name, the VM's `/32` allowlist
entry and outbound connectivity. If the VM's public IP changes, update both
DuckDNS and Atlas Network Access. Keep only this VM in the Atlas allowlist.

The API has no published port. Caddy is the only public container and its
fixed IP is the only trusted proxy. Do not change `TRUSTED_PROXY_CIDRS` to
`true`, `*`, or the whole internet. If subnet `172.30.22.0/24` already exists
on your host, change the bridge subnet, allocation range, fixed Caddy IP and
trusted proxy address together before deploying.

Uploads live in external Docker volume `smart-kirana-free-uploads`, including
private payment screenshots. They survive rebuilds and app/container restarts;
they do not survive deletion of the VM disk. Existing local images and records
are not migrated by the source archive. To preserve existing data, use the
[verified database-and-media recovery procedure](../../server/ops/BACKUP-RECOVERY.md)
before switching users over. Atlas Free does not include automated backups;
use the existing encrypted backup tools and keep copies off-host. Do not run
volume prune or delete the upload volume. Keep the config files backed up
privately too. Ubuntu security updates and VM maintenance remain your job.

## Why not just Vercel, Netlify, or Render Free?

Static hosts can serve the React build, but the current backend expects a
continuously running Node process, Socket.IO rooms, scheduled upload cleanup,
and durable local files. Splitting the frontend adds proxy and cookie setup
without solving backend storage. Render Free can run the backend, but sleeps
after 15 idle minutes, takes about a minute to wake and loses local files on
restart/redeploy. ImageKit now provides a durable cloud-media option covering
uploads, private proofs, cleanup and backups, but the idle delay still applies.
Retain legacy files and restore receipts on durable storage until migration and
recovery are verified. The VM route preserves the current realtime behavior.

## Local verification on 23 November 2026

- Production client build and both Linux Docker image builds passed.
- Shell syntax, generated independent secrets, safe configuration reuse, invalid
  input rejection, Compose interpolation and production env validation passed.
- Ignore checks confirmed that env files, private uploads, generated files and
  SSH keys are excluded, while lockfiles and env examples remain trackable.
- Caddy validated its free-host configuration; the built frontend contained no
  `localhost:5000` API target. Only Caddy publishes ports 80 and 443.
- The API image ran as UID 1000, encoded a WebP with sharp, wrote the uploads
  volume, and read the same bytes after container replacement.
- Native builds ran on x86-64 Docker. Both upstream base images list ARM64;
  a full ARM64 build and deployment on Oracle were not run locally.

No cloud account, live database, public certificate or deployed performance was
verified here. The deploy script runs the existing public smoke checks on your
actual hostname; authenticated cookie checks require a separate test account.

Sources checked 23 November 2026:
[Oracle limits and reclamation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm),
[Oracle card verification](https://www.oracle.com/cloud/free/faq/),
[Oracle Ubuntu firewall notes](https://docs.oracle.com/en-us/iaas/Content/Compute/known-issues.htm#ufw),
[Atlas Free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/),
[Docker on Ubuntu](https://docs.docker.com/engine/install/ubuntu/),
[Caddy HTTPS](https://caddyserver.com/docs/automatic-https),
[DuckDNS](https://www.duckdns.org/spec.jsp),
[Render Free limits](https://render.com/docs/free).
