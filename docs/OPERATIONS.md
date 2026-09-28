# Operations Runbook

Deployment, background workers, migrations, and day-to-day operational procedures. See
`docs/ARCHITECTURE.md` for how the system behaves; this document is about running it.

## 1. Environment variables

Copy `backend/.env.example` to `backend/.env` and set at minimum:

- `MONGODB_URI` — defaults to `mongodb://127.0.0.1:27017/erp_financial_system` if unset.
- `JWT_SECRET` — set a strong value before any shared/production use.
- `CLIENT_URLS` — every allowed frontend origin (CORS).
- `NODE_ENV=production` for any real deployment — this disables the dev seed and dev-reset scripts.

SUNAT integration (`backend/src/services/sunatService.js`):
- `SUNAT_PROVIDER_MODE` — `MOCK` (dev default), `PADRON` (production default — taxpayer-registry
  only), `PRODUCTION` (requires the vars below), or `MANUAL` (not auto-selected; used only through
  the dedicated manual-override endpoint).
- `SUNAT_API_BASE_URL`, `SUNAT_API_TOKEN`, and the per-endpoint env vars in
  `ProductionSunatProvider.js` — only needed if a real contracted SUNAT CPE API is available. Absent
  these, `PRODUCTION` mode safely degrades to a 503 "not configured" response for every
  taxpayer/voucher check, and the server now logs a clear warning about this at boot.
- `SUNAT_PADRON_DATA_DIR` — where the downloaded national RUC padrón is stored/indexed.

SIRE / RCE export (`backend/src/services/sireService.js`, screen Accounting → SIRE):
- `SIRE_TAXPAYER_RUC` — UMA's own RUC (field 1 and the file name). Required; the export is blocked
  and the preview shows a configuration error until it is set to a valid RUC.
- `SIRE_TAXPAYER_NAME` — UMA's legal name exactly as registered with SUNAT (field 2). Required.
- `SIRE_RCE_IGV_DESTINATION` — which Anexo 11 column pair receives the base/IGV of taxed purchases:
  `DG` (15/16, default), `DGNG` (17/18) or `DNG` (19/20). **Must be confirmed by UMA's accountant**
  (it depends on whether UMA's own operations are taxed with IGV).
- `SIRE_RCE_BOOK_CURRENCY` — `PEN` (default) or `USD`; sets the file name's currency indicator.

The export is SUNAT's RCE "reemplazo de la propuesta" TXT, structure **Anexo 11 of RS
000112-2021/SUNAT as replaced by Anexo F of RS 000040-2022/SUNAT** (tag `RCE_ANEXO11_RS040_2022`;
RS 000138-2023/SUNAT did not modify Anexo 11). 37 pipe-separated fields per voucher, dates
DD/MM/AAAA, amounts with 2 decimals and no thousands separator (credit notes negative), exchange
rate `#.###`, CRLF line endings, UTF-8, no header. File name per Tabla 13.1:
`LE<RUC><AAAA><MM>00080400021<I><M>2.TXT`, e.g. `LE2010000000920260800080400021112.TXT` for RUC 20100000009, August 2026, with data, in soles.
Cancelled CXPs and duplicate voucher links are excluded and listed; any other failing
voucher blocks the file and is listed with its errors. Upload to SUNAT is manual (SUNAT Operaciones
en Línea → SIRE → RCE → Propuesta → Reemplazar); SUNAT's API upload additionally requires zipping.
Sources:
- https://www.sunat.gob.pe/legislacion/superin/2022/anexo-040-2022.pdf (Anexo 1 tablas 11-13, Anexo 11)
- https://www.sunat.gob.pe/legislacion/superin/2022/040-2022.pdf
- https://www.sunat.gob.pe/legislacion/superin/2023/000138-2023.pdf
- https://cpe.sunat.gob.pe/sites/default/files/inline-files/Manual%20de%20servicios%20Web%20Api%20-%20SIRE_Compras%20v24.pdf

Rules not stated verbatim in those sources are marked `// VERIFY:` in `sireService.js` and should be
confirmed with UMA's accountant before the first filing (ideally by running the file through
SUNAT's PVSIRE validator).

Background workers (see §4 — in production they run inside the web service process):
- `BATCH_INVOICE_WORKER_ENABLED`, `SLA_WORKER_ENABLED`, `SUNAT_PADRON_WORKER_ENABLED` — start the
  A2 batch-invoice worker, the approval-SLA worker and the SUNAT Padrón refresh inside `npm start`.
  Each defaults to `true` when `NODE_ENV=production` and `false` otherwise; set one to `false` to
  host that worker separately. The Padrón refresh also requires `SUNAT_PROVIDER_MODE=PADRON`.
- `BATCH_INVOICE_INLINE_PROCESSING` — dev convenience only; must stay unset/false in production so
  the durable worker (not the request thread) processes uploads. While it is on, the in-process
  batch worker never starts.
- `BATCH_INVOICE_POLL_MS`, `BATCH_INVOICE_STALE_MINUTES`, `BATCH_INVOICE_WORKER_CONCURRENCY` —
  batch worker tuning; `SLA_POLL_MS`, `SLA_DUE_SOON_HOURS`, `SLA_ESCALATION_HOURS` — SLA worker
  tuning. All have safe defaults.

Authentication:
- `LOGIN_MAX_FAILED_ATTEMPTS` (default 5) and `LOGIN_LOCKOUT_MINUTES` (default 15) — per-account
  lockout after repeated failed sign-ins. Failed, locked-out and successful sign-ins and sign-outs
  are written to the audit log (module `AUTH`).

## 2. Local development

```powershell
npm install
Copy-Item backend\.env.example backend\.env
npm run seed
npm run dev
```

- Frontend: `http://localhost:5174`
- Backend: `http://localhost:5000`

`npm run seed` populates a fictional but internally-consistent UMA demo dataset (nine role
profiles, faculties/cost centers, suppliers, approval rules, budget rules, one Track B eligibility
rule, requests across every lifecycle stage). The demo password is **not** a fixed value in source —
it comes from `SEED_DEMO_PASSWORD` if set, otherwise a random password is generated per run and
printed in the seed's final JSON summary (`password`/`passwordSource` fields). Capture it from that
output; it is not written anywhere else.

To wipe and recreate (refuses to run outside a database whose name contains `erp_financial`,
`development`, or `dev`, and refuses to run at all when `NODE_ENV=production`):

```powershell
npm run seed:reset
npm run seed
```

## 3. Tests and build

```powershell
npm test          # backend (Node's built-in test runner, needs a local MongoDB) + frontend
npm run build      # frontend production build
npm run verify      # test + build
```

The backend suite (`backend/test/run.js`) is a full integration suite against a real, per-test-file,
uniquely-named MongoDB database (dropped on completion) — it needs a reachable MongoDB instance, not
a mock.

## 4. Production on Render and background workers

Production runs on **Render** from `render.yaml`: a single web service (`uma-finance`) with one
persistent disk mounted at `/var/data` (`UMA_STORAGE_ROOT=/var/data`,
`SUNAT_PADRON_DATA_DIR=/var/data/sunat-padron`). Render disks belong to exactly one service and
cannot be shared, so every background job that touches files runs **inside the web service
process**, started by `backend/server.js` (`backend/src/workers/inProcessWorkers.js`):

| Worker | Flag (default in production) | Purpose | Uses |
| --- | --- | --- | --- |
| A2 batch invoice | `BATCH_INVOICE_WORKER_ENABLED` (`true`) | Processes queued mass-invoice uploads | MongoDB + uploaded files on the disk |
| Approval SLA | `SLA_WORKER_ENABLED` (`true`) | Due-soon / overdue notifications and escalation | MongoDB |
| SUNAT Padrón refresh | `SUNAT_PADRON_WORKER_ENABLED` (`true`, PADRON mode only) | Keeps the local RUC registry fresh (daily 03:00 Lima) | `SUNAT_PADRON_DATA_DIR` on the disk |

The boot log prints one line with the state of all three
(`[WORKERS] In-process: batch-invoice=on, sla=on, sunat-padron=on`). On `SIGTERM` (every Render
deploy) the server stops accepting requests and lets in-flight worker work finish (up to ~25s).

Running more than one copy is safe: the batch worker claims each `QUEUED` batch with an atomic
`QUEUED → PROCESSING` update; SLA notifications and audit rows are idempotent (unique `eventKey`);
the Padrón refresh holds a heartbeat lease file (`worker.lock`) in its data directory and a new
instance waits for a previous instance's lease to go stale (~1 minute) before taking over. Keep
the Render service at **one instance** anyway — its disk can only attach to one.

There are no separate Render worker services any more. If one was created from an older
`render.yaml`, delete it in the Render dashboard (and its separate `uma-finance-padron-data` disk).
If the batch worker is off and nothing else runs it, uploaded invoice batches sit `QUEUED`
indefinitely.

Standalone entry points still exist for local development or hosting a worker elsewhere (turn the
matching `*_WORKER_ENABLED` flag off on the web service first):
`npm run worker:batch`, `npm run worker:sla` (`npm run sla:check --workspace backend` for one
scan), `npm run sunat:padron:worker --workspace backend`. A standalone batch worker must see the
same `UMA_STORAGE_ROOT` files as the web service.

`backend/scripts/startPadronWorker.ps1` registers the padrón sync as a Windows Scheduled Task — for
**local Windows development and the demo launcher only**. `backend/Dockerfile.padron` /
`compose.padron.yml` remain an alternative self-contained Docker path for hosting the padrón worker
outside Render.

The four SUNAT padrón CLI scripts under `backend/scripts/` (`syncSunatPadron.js`, `padronWorker.js`,
`indexSunatPadron.js`, `padronStatus.js`) serve different one-off purposes (sync once, run as a
daemon, rebuild the search index only, or print status) — each has a short comment at its top saying
which of the other three to reach for instead.

### Demo-only public links (not production)

`START_UMA_PUBLIC_FIXED.bat` (ngrok) and `npm run share` (`scripts/share-cloudflare.ps1`,
Cloudflare Quick Tunnel) expose **this PC's** copy with demo data through a temporary public URL,
for presentations only. They are never the production deployment and must not hold real university
data.

- The launcher runs MongoDB in Docker bound to `127.0.0.1:27018` only, with authentication. The
  admin password is generated on first run and kept in `.uma-local-mongo-password` (git-ignored,
  next to `.uma-local-jwt-secret`). An older unauthenticated `uma-finance-triple-mongo` container
  is migrated automatically (user added, container recreated on the same volume). If the password
  file is lost, the secured container cannot be opened; the launcher explains how to start over.
- Both start the demo server with `BATCH_INVOICE_WORKER_ENABLED=true` and `SLA_WORKER_ENABLED=true`,
  so A2 batches and SLA escalation work during a demo; the Padrón refresh stays with the scheduled
  task registered by `startPadronWorker.ps1`.
- The former `share:publish` / `link:publish` flow (rewriting a Render gateway to the tunnel) was
  removed: production now lives on Render itself, so there is nothing to publish.

## 5. Migrations & data operations

```powershell
npm run backup                          # dumps collections + uploads/generated files
npm run migrate:workflow                # dry run
npm run migrate:workflow:apply          # apply, after reviewing the dry-run report
npm run verify:data
```

Migration reports are written under `backend/migration-reports`. Every migration script no-ops if
its own key already exists in the `migrationruns` collection, so re-running an already-applied
migration is always safe. Back up first; ambiguous historical records are reported for manual review
rather than silently reinterpreted, and no collection is ever dropped.

Other one-off/maintenance scripts under `backend/scripts/` (cost-center import, deployment password
rotation, demo-data cleanup) are documented individually at the top of each script. Presentation-only
demo scripts that duplicate the main seed for a "live demo" dataset are isolated under
`backend/scripts/tools/demo/` and are not part of the production path.

## 6. Storage & backup

- Request evidence: `backend/uploads/requests/{requestId}`
- Supplier evidence: `backend/uploads/suppliers/{supplierId}`
- Bank files: `backend/generated/bank-files`
- Reports / accounting exports: `backend/generated/reports`, `backend/generated/accounting`

`npm run backup` exports MongoDB collections as Extended JSON alongside both upload directories into
a timestamped `backend/backups` folder — a usable recovery point needs all of it, not just the
database dump.

## 7. Known external dependencies not yet in place

These require a real institutional decision or credential this codebase cannot supply on its own:

- **BBVA production certification** — `BankFormatConfiguration.certified` stays `false` until
  Treasury/BBVA formally accept the generated PEN/USD test files through the certification action
  (Admin or Treasury, `/configuration/bank-formats`, linked from Treasury's menu as "Bank Formats").
- **A contracted SUNAT CPE API** — if/when one exists, set `SUNAT_PROVIDER_MODE=PRODUCTION` and the
  associated env vars; until then, production should run on `PADRON` mode (taxpayer-status only).
- **The organizational roster's manager-chain (`jefe`) data** — approval routing prefers this over
  configured rules; keeping it current is what keeps most requests off the "no configured rule for
  this dimension" error path (see `ARCHITECTURE.md` §3.3).
