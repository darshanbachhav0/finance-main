# Migration and Operations Guide

## Environment

Create `backend/.env` from `backend/.env.example`.

| Variable | Purpose | Safe development default |
|---|---|---|
| `PORT` | Express port | `5000` |
| `MONGODB_URI` | MongoDB connection | `mongodb://127.0.0.1:27017/erp_financial_system` |
| `JWT_SECRET` | JWT signing secret | Replace before shared use |
| `JWT_EXPIRES_IN` | Session lifetime | `8h` |
| `CLIENT_URLS` | Comma-separated CORS allow-list | Local Vite origins |
| `UPLOAD_DIR` | Compatibility upload setting | `backend/uploads` |
| `JSON_BODY_LIMIT` | JSON request limit | `2mb` |
| `FORM_BODY_LIMIT` | Form request limit | `2mb` |
| `SUNAT_PROVIDER_MODE` | `MOCK`, `MANUAL`, or not-configured production placeholder | `MANUAL` |
| `FX_ALLOW_BCRP_FALLBACK` | Expose optional editable BCRP reference | `false` |
| `BANK_FILE_MODE` | Bank adapter mode | `DEMO` |

Production-style startup refuses a missing or known development JWT secret. Use a long random secret and restrict `CLIENT_URLS` to approved origins.

## Install, Run, and Verify

From the project root:

```powershell
npm install
Copy-Item backend\.env.example backend\.env
npm run seed
npm run dev
```

Development URLs:

- Frontend: `http://localhost:5174`
- Backend health: `http://localhost:5000/health`

Run the complete automated gate:

```powershell
npm run verify
```

Individual commands:

```powershell
npm run test:backend
npm run test:frontend
npm run build
npm run verify:data
```

No separate lint command exists in the repository. The JavaScript runtime tests and Vite production build are the current static/runtime gates.

## Safe Existing-Data Migration

The canonical migration is conservative and does not drop collections or delete financial records.

1. Stop user activity.
2. Back up MongoDB and file storage.
3. Run the migration in dry-run mode.
4. Review the generated report, especially `manualReview`.
5. Apply only after approval.
6. Run data verification and application tests.

```powershell
npm run backup
npm run migrate:workflow
npm run migrate:workflow:apply
npm run verify:data
npm run verify
```

Reports are saved under `backend/migration-reports`. The migration key is recorded in MongoDB so an applied run is not repeated accidentally.

### Conservative Mapping Rules

- Exact legacy status mappings are applied where meaning is clear.
- `APROBADO_POR_PAGAR` becomes `CONTABILIZADO` only when conclusive fiscal/accounting evidence exists.
- Historical bank-processed records are flagged if real payment confirmation cannot be proven.
- Historical request numbers are retained; only new/missing references use atomic sequences.
- Explicit CXP records are created only from conclusive evidence; the migration never invents balanced journal lines from incomplete legacy entries.
- Ambiguous records remain visible in the report for Accounting/Treasury review.

## Backup

Run:

```powershell
npm run backup
```

The command creates `backend/backups/backup-{timestamp}` containing:

- `database/*.ejson`: each MongoDB collection in canonical Extended JSON.
- `uploads/`: request and supplier evidence.
- `generated/`: bank, report, and accounting exports.
- `manifest.json`: database name, collection counts, timestamp, and copied-storage flags.

Copy the complete timestamped directory to protected storage. A database-only backup is incomplete because MongoDB holds metadata while physical evidence/export files remain on disk.

## Recovery Procedure

Recovery is an administrator-controlled operation and should first be rehearsed against a separate database/host.

1. Stop the ERP and prevent new transactions.
2. Preserve a copy of the current database and file directories.
3. Verify `manifest.json`, collection counts, and backup directory completeness.
4. Restore each `.ejson` collection with approved MongoDB tools into a clean target database.
5. Restore `uploads` and `generated` to their original backend locations while preserving directory names.
6. Point `MONGODB_URI` to the restored database.
7. Run `npm run verify:data`, backend tests, and a read-only role smoke test.
8. Confirm protected attachment/report downloads before reopening access.

No automatic destructive restore command is provided. This prevents an operator from replacing live financial data with a mistyped path or incomplete backup.

## Development Seed and Reset

`npm run seed` is idempotent and creates the fictional UMA development dataset documented in `docs/UMA_DEMO_DATA.md`: eight primary role accounts, supporting area users, active/closed periods, a non-authoritative manual demo exchange rate, Peruvian-format suppliers for four banks, bank history, UMA Cost Centers, accounts, budgets, approval/document/budget rules, mappings, and linked lifecycle scenarios.

To reset the development database only:

```powershell
npm run seed:reset
npm run seed
```

The reset script:

- Refuses to run when `NODE_ENV=production`.
- Requires the built-in `--confirm` flag supplied by the npm script.
- Refuses a database name that does not look like a development ERP database.
- Purges active `backend/uploads` and `backend/generated` data through the npm script's `--purge-files` flag.

Run `npm run backup` before reset when the current development state may need to be recovered. Never run development reset against UMA production data.

## Local File Operations

New files use unique generated physical names and organized entity directories. Users retrieve them through `/api/files/download`; direct public `/uploads` or `/generated` access is not enabled. The backend authorizes the user against the related request, supplier, or generated-file role before sending the file.

Operational housekeeping must keep MongoDB metadata and physical files synchronized. Do not manually rename or move one file without an audited migration/update.

## Temporary Public Sharing

```powershell
npm run share
npm run share:status
npm run share:stop
```

The quick tunnel points to the local production server. The PC, MongoDB, server, and tunnel must remain running. The Cloudflare URL changes when a new quick tunnel is created.

To update the stable Render pointer page:

```powershell
npm run share:publish
```

The Render page is only a stable link directory; the ERP and its data still run on the host PC.

## Operational Close Checklist

Before closing an accounting period:

1. Resolve pending fiscal processing and missing exchange rates.
2. Review open CXP and payment confirmations.
3. Reconcile paid bank operations.
4. Resolve pending renditions and budget exceptions.
5. Generate month-end preview and confirm source total equals centralization total.
6. Export required Accounting/SIRE reports and retain history.
7. Record closure comments and confirm the close dialog result.
8. Run a backup after closure.

A closed period is enforced by the backend. Blocked attempts return `ACCOUNTING_PERIOD_CLOSED` and are appended to the audit log with user, role, IP, module, entity, action, period, time, and reason.
