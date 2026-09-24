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

Batch invoice worker (`backend/src/workers/batchInvoiceWorker.js` /
`backend/src/queues/batchInvoiceQueue.js`):
- `BATCH_INVOICE_INLINE_PROCESSING` — dev convenience only; must stay unset/false in production so
  the real worker (not the request thread) processes uploads.
- `BATCH_INVOICE_POLL_MS`, `BATCH_INVOICE_STALE_MINUTES`, `BATCH_INVOICE_WORKER_CONCURRENCY` —
  worker tuning, all have safe defaults.

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
a mock. As of this writing it is 310 tests, all passing.

## 4. Background workers (must run in production)

Three long-running background processes exist beyond the web server. All three are provisioned in
`render.yaml` as separate Render services if deploying there:

| Worker | Command | Purpose | Depends on |
| --- | --- | --- | --- |
| SLA | `npm run worker:sla` | Escalates overdue approval steps | `MONGODB_URI` |
| Batch invoice | `npm run worker:batch` | Processes queued Track A2 mass-invoice uploads | `MONGODB_URI` |
| SUNAT padrón sync | `npm run sunat:padron:worker` | Keeps the local RUC registry copy fresh | `SUNAT_PADRON_DATA_DIR` (filesystem-only, no DB) |

If the batch-invoice worker isn't running, uploaded invoice batches will sit `QUEUED` indefinitely —
there is no other path that processes them in production (`BATCH_INVOICE_INLINE_PROCESSING` must
stay off there).

`backend/scripts/startPadronWorker.ps1` registers the padrón sync as a Windows Scheduled Task — that
script is for **local Windows development only**; production uses the Render worker service.
`backend/Dockerfile.padron` / `backend/compose.padron.yml` are an alternative self-contained
Docker path for hosting the padrón worker outside Render, kept for that use case.

The four SUNAT padrón CLI scripts under `backend/scripts/` (`syncSunatPadron.js`, `padronWorker.js`,
`indexSunatPadron.js`, `padronStatus.js`) serve different one-off purposes (sync once, run as a
daemon, rebuild the search index only, or print status) — each has a short comment at its top saying
which of the other three to reach for instead.

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
  (Admin or Treasury, `/configuration/bank-formats`).
- **A contracted SUNAT CPE API** — if/when one exists, set `SUNAT_PROVIDER_MODE=PRODUCTION` and the
  associated env vars; until then, production should run on `PADRON` mode (taxpayer-status only).
- **The organizational roster's manager-chain (`jefe`) data** — approval routing prefers this over
  configured rules; keeping it current is what keeps most requests off the "no configured rule for
  this dimension" error path (see `ARCHITECTURE.md` §3.3).
