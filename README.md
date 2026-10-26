# UMA Integrated CAPEX / OPEX / Accounts Payable Management System

Production-oriented, modular ERP for controlling the institutional expenditure lifecycle from
request intake through approval, budget commitment, procurement, Accounts Payable, Treasury,
payment confirmation, reconciliation, close, and audit — for Universidad María Auxiliadora (UMA).

## Architecture

- Frontend: React 18, Vite, React Router, Axios, Lucide icons, Floating UI.
- Backend: Node.js, Express, Mongoose, JWT, bcrypt, Helmet, CORS, rate limiting.
- Database: MongoDB.
- Storage: `backend/uploads` and `backend/generated`, with metadata stored in MongoDB.
- Languages: Spanish (default) and English, toggle-able per session.

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the full business-workflow and technical
description (roles, the A1/A2/B/C/D track workflow, approval routing, budget, accounting,
treasury, suppliers, SUNAT/SIRE integration, and what's intentionally out of scope).

## Functional areas

1. CAPEX/OPEX and special-flow requests (advances, reimbursements, direct payment).
2. Supplier master, homologation (with a configurable renewal window), and bank-account history.
3. Document rules and XML fiscal consistency validation.
4. Configurable hierarchical approvals (organizational manager chain + policy rules), authenticated
   sign-off, and SLA escalation.
5. Dimensional budget allocation, commitment, exception routing, release, execution, and payment
   control.
6. Fiscal processing, balanced journals, explicit Accounts Payable records (including partial
   payments), and controlled cancellation of unpaid obligations.
7. Purchase/Service Order issuance (Procurement), Treasury scheduling, BBVA bank-file batches,
   actual payment confirmation, and reconciliation.
8. SUNAT taxpayer/voucher validation, SIRE/RCE preparation, month-end consolidation, reports,
   dashboards, and immutable audit history.

## Roles

Thirteen stored operational roles — see **[docs/ROLE_PERMISSIONS_GUIDE.md](docs/ROLE_PERMISSIONS_GUIDE.md)**
for the full capability matrix and per-role guide:

`Admin`, `Solicitor`, `AreaDirector`, `ViceRector` (same permissions; the role sets the approval
level), `Accounting`, `Treasury` (also manages the budget — the former `Budget` role was folded into
it), `Procurement`, `Management` (Gerencia General), `GAF` (Gerencia de Administración Financiera),
`Legal`, `HumanResources` (Gestión de Personas), `Auditor` (read-only), `ManagementViewer` (strictly
read-only), plus `SuperAdmin`, which manages administrator accounts and takes part in no process.
Approvals follow the amount in UIT: the cost center's responsible and their superior always, the
GAF above 5 UIT, the Gerencia General above 20 UIT. Track D moves money between UMA's own accounts.

Backend role/permission/ownership/workflow checks are authoritative; frontend navigation is a
separate, narrower presentational layer on top of them.

## Requirements and installation

- Node.js 18 or newer.
- MongoDB available locally or through the configured connection string.

```powershell
npm install
Copy-Item backend\.env.example backend\.env
npm run seed
npm run dev
```

- Frontend: `http://localhost:5174`
- Backend: `http://localhost:5000`

Set a strong `JWT_SECRET` before any shared or production-style use, and update `CLIENT_URLS` with
every allowed frontend origin. See **[docs/OPERATIONS.md](docs/OPERATIONS.md)** for the full
environment-variable reference, background workers, migrations, and backup procedures.

## Development demo data

`npm run seed` creates a fictional UMA demo dataset (cost centers, budgets, suppliers, rules) with
four staff accounts: Admin (DNI 10000001), Accounting (10000005), Treasury (10000006) and
Treasury - Budget (10000007). It creates no requests; the demo accounts and requests of earlier
seeds are removed with `npm run demo:remove-accounts` (see docs/OPERATIONS.md).
The demo password is generated fresh per run (or read from `SEED_DEMO_PASSWORD` if set) — it is **not** a fixed value anywhere in source. Capture it from the seed command's final JSON
summary output (`password` field). To wipe and recreate:

```powershell
npm run seed:reset
npm run seed
```

`seed:reset` refuses to run outside a database whose name identifies it as development, and refuses
to run at all when `NODE_ENV=production`.

## Tests and build

```powershell
npm test
npm run build
npm run verify
```

The backend suite is a full integration suite against a real local MongoDB instance —
it needs MongoDB reachable, not a mock. The frontend suite covers canonical UI contracts, role
navigation, and accessibility behavior.

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how the platform works: roles, workflow,
  budget, accounting, treasury, suppliers, SUNAT/SIRE, and explicit scope boundaries.
- **[docs/OPERATIONS.md](docs/OPERATIONS.md)** — environment variables, background workers,
  migrations, backups, and deployment.
- **[docs/ROLE_PERMISSIONS_GUIDE.md](docs/ROLE_PERMISSIONS_GUIDE.md)** — detailed per-role
  capability matrix and walkthrough, also rendered to a printable PDF by
  `scripts/build-role-permissions-guide.py`.

## Production deployment

Production runs on **Render** (`render.yaml`): one web service with a persistent disk; the A2
batch-invoice worker, the approval-SLA worker and the SUNAT Padrón refresh run inside it. See
[docs/OPERATIONS.md §4](docs/OPERATIONS.md) for the layout and the `*_WORKER_ENABLED` flags.

## Demo-only public links

`START_UMA_PUBLIC_FIXED.bat` (ngrok) and the Cloudflare commands below are **for demos only** —
they publish this PC's local copy with demo data through a temporary URL. They are not the
production deployment; never load real data into them.

```powershell
npm run share
npm run share:status
npm run share:stop
```

The generated `trycloudflare.com` URL is temporary. The local PC, ERP server, MongoDB, and tunnel
must all remain running for the shared link to work.

## Operational automation and readiness checks

These run inside the existing pages; records retain their server-side visibility and action
permissions.

| Improvement | Where it works |
| --- | --- |
| Durable evidence copies | Uploads, invoice/XML reads, A2 ZIP extraction, BBVA files, SIRE and report downloads retain their protected URLs and access checks. |
| Submission readiness | Request form preview collects document, quotation, supplier, period and budget issues. Final submission still runs the authoritative controls. |
| Next action and owner | Request detail explains the current task and responsible role ("Your turn"). |
| Track eligibility | Track B is checked against the configured area, nature, date and amount; no automatic exception approval. |
| XML preparation | Read an XML, compare entered values and use extracted invoice fields in Accounting. This is parsing, not SUNAT certification. |
| Configuration health | The Super Admin console (System health) checks manager cycles, missing mappings, draft permissions, BBVA certification, document durability and taxpayer-cache/dataset freshness. |
| Payment preparation | Treasury preflight checks each selected CXP using the existing loader and BBVA serializer without creating a batch or confirming payment. |

### Deployment settings

- `DURABLE_ASSETS=true`: store protected evidence in MongoDB GridFS (`protectedAssets.files` /
  `protectedAssets.chunks`). Defaults on when `RENDER=true`, off otherwise. Upload/generation
  fails if the durable copy cannot be stored. Provision adequate MongoDB capacity and backups;
  a small free database is not unlimited document storage.
- `OPERATIONS_WORKER_ENABLED=true`: enable the in-process hourly scan (budget roll-forward, supplier
  approval reminders, follow-ups and the weekly report). Defaults on in production, off in
  development. The normal backend start command starts it after connecting to MongoDB; it also
  scans on startup. Keep `DRAFT_ENCRYPTION_KEY` stable and backed up.
- Existing SLA, invoice-processing and SUNAT workers retain their own settings.
- A sleeping or stopped web service cannot run scans. Exact uninterrupted schedules require an
  always-running backend. These changes do not make a free sleeping instance always-on.

### Additive data/storage rollout

1. Back up MongoDB and the existing `uploads` / `generated` directories.
2. From `backend`, run `node scripts/archiveExistingAssets.js` (dry-run only; no database writes).
3. Review file count, total bytes and errors. Ensure database capacity before enabling archive writes.
4. With the intended `MONGODB_URI` configured, run
   `node scripts/archiveExistingAssets.js --apply` on the installation containing those files.
5. Enable durable storage, deploy and test an authorized upload/download. GridFS copies are
   checksum-verified when recovering a missing local file. Keep the existing financial database
   and file backups; lost files that are no longer on any disk cannot be reconstructed.

The archive migration is idempotent for each path/content hash. It never changes financial
records or deletes local files. It adds the GridFS collections; existing workflows and fiscal records
need no rewrite. The `recurringtemplates`, `statementimports` and `statementclaims` collections left
by the former Work review page are no longer read and can stay. Rollback: disable the new worker and
restore the previous application only when all required files are on persistent disk; the old
application cannot read GridFS-only documents. Do not drop archival or financial evidence to roll
back the UI.

### Verification commands

```powershell
node backend/test/run.js
npm run test --workspace frontend
npm run build
node frontend/test/approvalPendingSupplier.browser.mjs
```

The browser check uses local mocked responses only. If the matching Playwright Chromium is not
installed, set `PLAYWRIGHT_CHANNEL=msedge` to use an installed Edge browser. Backend tests create
and remove isolated local test databases; never point the test suite at production.
