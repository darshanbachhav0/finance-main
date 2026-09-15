# SUNAT Padrón: startup and maintenance

The web server starts with its existing local dataset. It does not download or index during startup or a RUC lookup. Missing or expired data returns a validation-pending/unavailable result; it never automatically approves a taxpayer.

## Windows BAT deployment

START_UMA_PUBLIC_FIXED.bat now launches backend/scripts/startPadronWorker.ps1 without waiting for an import. The script registers the named UMA SUNAT Padron Updater task at user login and starts it immediately. If task registration is unavailable, it launches a hidden worker for that Windows session and prints a warning. Run the BAT once to activate this setup; the coding session does not install a task or move your live dataset.

The default persistent path is %LOCALAPPDATA%\UMA Finance\sunat-padron. An explicit SUNAT_PADRON_DATA_DIR is respected. Existing backend/data/sunat-padron/current data is copied once by the worker with timestamps preserved; the server reads the old location until the copy completes. Do not remove that location during migration. Windows logon tasks require a logged-in user. For an unattended production host use the container worker below or configure a service account with Task Scheduler's “Run whether user is logged on or not”.

The worker checks immediately on launch, then at 03:00 America/Lima. Fresh caches skip the network. Failed attempts retry after 1, 5, 15 and then 60 minutes. Only one worker may own a data directory. Stop the task and terminate its worker before changing its data directory; do not run independent updaters on different hosts against shared storage.

## Container deployment

Build/run the dedicated updater with:

```sh
docker compose -f compose.padron.yml up -d --build
```

Mount the named volume uma_sunat_padron at /var/lib/uma/sunat-padron in the existing API container too, and set SUNAT_PADRON_DATA_DIR to that path. Use one updater replica. The API currently needs write access for legacy index repair. The volume must survive image replacement. This Compose file provides the updater, not a replacement for the existing API/Mongo deployment. Do not run the Windows updater against that separate container volume.

For several API hosts, use a managed shared filesystem with atomic rename and a single designated updater, or distribute completed immutable snapshots per host. A local lock is not a distributed consensus service. The supplied configuration targets a single host.

## Prepare before going live

With the same data directory configured for the API:

```sh
npm run sunat:padron:bootstrap --workspace backend
npm run sunat:padron:status --workspace backend
```

Bootstrap is a one-shot maintenance operation and exits nonzero on failure. Complete it before opening production access if taxpayer validation must be immediately available. The first full import still takes time; subsequent application restarts do not wait for it.

## Update integrity and recovery

Existing publication-date/ETag/Last-Modified checks avoid unchanged downloads. SHA-256 avoids rebuilding an identical downloaded ZIP. A verified pending download is reusable for 24 hours following an indexing failure; interrupted downloads are fetched again. The builder validates RUC keys without constructing unused address objects and batches chunk writes, then builds exact byte-offset search indexes. It deliberately retains the second indexing pass; combining it would add complexity and requires representative benchmarking.

Imports build a separate next-TIMESTAMP-PID generation. A minimum record count, relative row-count guard and completed index files are checked before atomically replacing active.json. Readers retain the generation they opened. Failed updates leave the active pointer untouched. The worker retains the two newest inactive generations and a seven-day grace period for all other generations, then prunes older inactive directories after a successful check. Monitor disk capacity and archive snapshots separately if longer retention is needed. Never remove the directory named by active.json or the legacy current folder still in use.

Defaults: at least 100,000 records and at least 80% of the prior row count. Investigate upstream changes before overriding SUNAT_PADRON_MIN_ROWS or SUNAT_PADRON_MIN_ROW_RATIO. --force bypasses freshness and checksum skipping, not the validation guards.

Configuration pages show an Admin-only status panel: dataset date, last successful check, worker heartbeat, next check, phase, indexed records and last failure. The API is GET /api/sunat-padron/status (Admin authentication required). Status updates do not create financial actions or notifications.

Inspect status and worker logs when updates fail. Restart a stopped worker; do not repeatedly force reindex. A live sync refreshes its lock heartbeat so long imports are not mistaken for abandoned work. Automatic worker-lock recovery is limited to a confirmed dead process on the same host; investigate other-host locks manually.

## Validation

Fixture-based tests cover bootstrap, identical ZIP skipping, cached startup, failed update preservation, immutable generations, exact lookups and stale-data refusal. No full live SUNAT download is required for these tests. Runtime improvement must be measured on the deployment host; no production indexing-time claim is made.
