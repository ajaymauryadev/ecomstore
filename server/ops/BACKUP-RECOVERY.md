# Tenant backup and disaster recovery

## Coverage

`GET /api/v1/backup/full` returns a tenant-scoped version 2 JSON download for the store owner. It includes the store configuration, 21 linked collections including the plan, public uploads and private payment proofs. The envelope records the MongoDB snapshot timestamp. The manifest records counts, SHA-256 digests for collections and files, and media sizes. Stock and Udhar history have no row limit. The archive has a 512 MiB serialized size ceiling. Over-limit exports fail as a whole.

Passwords, credential-shaped fields and token hashes are removed from owner downloads. Keep those files private because they contain business and customer data. Operator archives use gzip and authenticated AES-256-GCM and preserve BSON types and record IDs. They retain tenant password hashes and guest order tracking hashes for recovery. Refresh sessions are excluded. Payments are captured as order payment state, payment references, proofs and linked business records.

The backup worker reads the tenant and all its collections in one majority-committed MongoDB snapshot session. It requires MongoDB 5.0+ on a replica set. [MongoDB snapshot read concern](https://www.mongodb.com/docs/manual/reference/read-concern-snapshot/)

Local uploads have immutable filenames. The job copies only files referenced by that snapshot and fails if a required file is missing, unsafe or has ambiguous legacy ownership. A concurrent file removal can therefore fail one run. Supply the primary upload volume to the backup worker, and keep its contents immutable while referenced. Third-party image URLs remain references. Configure `BACKUP_MEDIA_ORIGINS` for first-party absolute upload URLs. Legacy proofs are preserved under the private legacy-proof tree for authorized operator retrieval. Current proof files stay in the application's authenticated payment-proof storage.

This runbook recovers a tenant into a dedicated instance. Keep separate infrastructure backups for cluster-wide recovery, platform administrators and other shared application configuration. A tenant snapshot includes its referenced plan. Platform administrators, environment secrets, alert configuration and external payment settlement require separate recovery procedures.

## Schedule and access

The initial recovery point objective (RPO) is **2 hours** and the recovery time objective (RTO) is **4 hours** for one supported tenant. The timer starts a backup hourly. The independent freshness timer checks every 15 minutes and alerts when the newest finalized backup for any current tenant is more than 90 minutes old. These are operational targets. Validate job duration, offsite availability and restore time on the production-sized volume before enabling the real-data trial.

Install the four [systemd unit files](systemd/) on one Linux backup worker. Their example paths assume Node at `/usr/bin/node`, application files under `/opt/smart-kirana/server`, and a dedicated service account named `smart-kirana-backup`. Adjust the unit paths to match the host. On another scheduler, run `node scripts/backup.js create` hourly and `node scripts/backup.js status` every 15 minutes as the backup account.

Configure `/etc/smart-kirana/backup.env` as a restricted environment file. Use a read-only MongoDB account scoped to the source database and read-only access to the same upload volume that the app uses. Use an access-controlled offsite vault, outside the uploads directory and web root. On POSIX the vault must be owned by the backup account with mode `0700`. On Windows apply equivalent NTFS ACLs. Archive files and the key file require restricted permissions (`0600` on POSIX). Keep a separately protected recovery copy of the key and retain older keys alongside the corresponding backup generations by operational key ID. The archive directory should use the provider's immutable retention or snapshots. Keep at least 7 days of hourly recovery points and 30 days of daily points, sized against actual tenant volumes.

| Setting | Purpose |
| --- | --- |
| `BACKUP_SOURCE_URI` | Read-only connection string for the source replica set |
| `BACKUP_SOURCE_DB` | Explicit source database name |
| `SMART_KIRANA_UPLOADS_ROOT` | Absolute upload volume used by the source app and mounted read-only on the worker |
| `BACKUP_MEDIA_ORIGINS` | Optional comma-separated first-party origins for historical absolute upload URLs |
| `BACKUP_VAULT` | Existing private output directory, for example `/var/lib/smart-kirana-backups` |
| `BACKUP_KEY_FILE` | Path to the restricted file containing 32 random bytes encoded as base64 |
| `BACKUP_ALERT_URL` | HTTPS incident webhook accepting a JSON `text` field |

Generate a key through your secret manager or restricted host workflow. Run one `create` and `status` manually, confirm the archive reaches offsite storage, and exercise the failure alert in staging before enabling the timers. The CLI logs per-tenant failures and sends a generic webhook notification. Monitor the worker and failed units externally as well so a dead host or undeliverable webhook is visible. Select retention and memory based on measurements. Archive generation uses an in-memory JSON envelope and the service runs one tenant at a time.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now smart-kirana-backup.timer smart-kirana-backup-status.timer
sudo systemctl list-timers 'smart-kirana-backup*'
```

## Read-only reconciliation and restore drill

1. From `server/`, run the read-only inspection against the selected source tenant or an isolated source clone. Protect the report as business data. It lists collection counts, upload issues, order totals, stock balances, Udhar balances, and record IDs for discrepancies. Pre-existing discrepancies remain in both before and after reports. This workflow makes no corrective entries or ledger changes.
2. Choose one encrypted archive and obtain the key through the authorized recovery account. Use the explicit expected tenant ID from the incident record. Verify the archive before provisioning application traffic.
3. Use a fresh replica-set database named `smart_kirana_restore_<incident>` and a new uploads directory on an isolated host or network. Set `BACKUP_RESTORE_URI` for a temporary identity with read/write/index privileges only on the new database. The target URI should have no production write privileges. The uploads directory must be separate from the live uploads directory and its parent must exist. The script refuses existing databases and upload roots.
4. Run restore. Recording counts, checksums and reconciliation before/after is part of the command. The process stages files privately, writes records in a transaction, reads data and media back, and publishes the receipt and verified database marker after all comparisons pass. A verification or write failure leaves the target quarantined. Archive digests cover original IDs and link fields as well as amounts.
5. For the request under incident recovery, review any source discrepancies, open the order, verify a product image and an authorized private proof, confirm link IDs, and test login on the staged instance. Reconcile writes or external settlement after the snapshot separately, with explicit approval and correction entries for financial history.
6. Only after sign-off and with writes frozen, switch application database **and** uploads root together to the verified pair. Only use the isolated test replica after drills. Keep the old configuration and data for rollback. Use fresh application signing/cookie secrets and have users sign in again. Before exposing traffic, rerun the targeted checks and measure elapsed recovery time against the RTO.

```sh
node scripts/backup.js inspect TENANT_ID
node scripts/backup.js check /private/backup.skbackup TENANT_ID
node scripts/backup.js restore /private/backup.skbackup TENANT_ID smart_kirana_restore_incident42 /srv/recovery/incident42-uploads
```

Promotion requires both a verified database marker and a matching `.restore-verified.json` in the configured uploads root. If the restore is interrupted, leave the staged target offline, retain error evidence according to incident policy and retry into a different empty database and directory. Failed targets can be removed under normal incident approvals after checking their IDs and paths. The command never drops an existing database or overwrites its records. If rollback is required after cutover, freeze writes, reconcile changes since cutover, and switch back to the previous database/uploads pair together. Keep both pairs until the incident owner signs off.

## Isolated regression fixture

| Check | Before | After |
| --- | --- | --- |
| Stock ledger rows | 5,001 | 5,001 |
| Order grand total | ₹99.00 | ₹99.00 |
| Inventory stock | 5,001 units | 5,001 units |
| Udhar outstanding | ₹75.00 | ₹75.00 |
| Reconciliation discrepancies | 0 | 0 |

The fixture also checks store settings, linked order/customer/product/variant IDs, returns, daily closing, and the exact bytes of public, current private and legacy private media. Negative cases cover corrupt ciphertext, wrong key, altered manifests and files, a wrong tenant or embedded foreign record, missing uploads and interruption after a transaction starts.
