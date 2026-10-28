> **Current build (27 October 2026): The separate Contracts feature has been removed temporarily.** This document describes an earlier build. See `CONTRACTS_FEATURE_REMOVED.md` for the active source modules and the removal details.

# UMA Finance — code update against Claude's 60-item comparison

**Input:** `finance-main-main (1)(2).zip` and `Pasted markdown(2).md` (Claude comparison).  
**Basis:** original full source retained. No database changes were executed.  
**Status:** **PARTIAL migration, NOT production complete.** Do not interpret a new page as evidence that its accounting workflow is integrated.

## What was already implemented in the uploaded source

The comparison appears to refer to an older revision in several places. Source inspection found:

- CECO parent, level, line, and responsible-person fields; hierarchy/cascade service and import scripts.
- Employee job category 1–8 and restricted *Por encargo* (3/5/6).
- P1–P4 priorities, a due-date field, and priority-based suggested business-day payment dates.
- Submission-preview endpoint and live request-form validation controls.
- A digital-acta service and request endpoints (with a gated accounting-enforcement setting).
- GAF payment-batch verification service (the current code retains an Admin exception).
- Department visibility, supplier-bank features, financial audit model, and Track D operations.

These are **existing implementations**, not new work in this package. They have NOT all been verified end to end.

## New functionality in this update

| Claude item | Delivered | What it does | Limit |
|---|---|---|---|
| 28 Contracts and supplies | **Partial implementation** | `UmaContract` data model, signed-PDF upload with SHA-256, CTR-YYYY-NNN numbering, department access, Treasury review, expiry alerts, dedicated frontend screen. | Does **not** bypass invoice approval, monitor contracted monthly invoice quotas, verify milestones, or schedule all contract notifications. |
| 43 Bank-statement reconciliation | **Partial implementation** | CSV import; date, amount and currency validation; suggested match against confirmed bank batches within ±3 days; ambiguous/duplicate matches flagged; separate Accounting review/sign-off; dedicated screen. | **No automatic accounting posting, payment status changes, or final reconciliation journal.** Statement source format is a defined basic CSV schema, not full BBVA native format. |
| 53 Consultas | **Partial implementation** | Secure request/CXP searches with date, currency and topic filters. | Two topics, not nine; no RUC/DNI account-statement report or Excel export. |
| 54 Indicadores | **Partial implementation** | Aggregated request status, priority and bank-batch counts. | Does not yet calculate late-payment / refund KPIs. |
| 56 Auditoría | **Implemented basic viewer** | Searchable paginated audit listing with CSV export and protected read-only presentation. Exports limited metadata, not bank account contents. | Does not guarantee every legacy module supplies comprehensive before/after diffs. |
| 57 Role menus | **Updated for new screens** | Five new routes and role-appropriate links. | Other MVP menu restructuring still pending. |

## High-risk / unresolved requests (NOT implemented in this update)

The following require process-owner sign-off and integration tests before changing how money moves:

- **D1/D2/D3/D4/D5/D6/D7:** Claude identified seven choices where the MVP and prior team decisions differ. This package deliberately does not reverse live supplier approval ownership, existing request approval routes, class-6 accounting, auto-provisioning, or the Admin emergency exception without approved business decisions. Some of these rules are already partially implemented in the source.
- **M/E/H specialized expense flows:** distinct legal approval hierarchy, correct tax withholding, student reversal via gateway, per-receipt uniqueness, journals and imported evidence.
- **End-to-end contracts:** in-quota invoice exception, milestone bookkeeping, notification jobs, accounting sign-offs.
- **Full reconciliation:** verified bank-statement ingestion, unique movement/batch linkage, manual allocation, two-person financial sign-off, compensating accounting entries, idempotent reconciliation and refund policies.
- **SPOT SUNAT TXT:** government-specified format certification, detraction deposit matching and accounting sign-off.
- **Encryption and masking at rest:** DNI/CCI/bank account key-management scheme, gradual migration and impact on unique indexes/search.
- **Payments abroad, student card gateway reversals, and investments:** operational bank integrations and ledger rules, beyond this UI update.
- **Period close, account reclassification and GAF-only parameter ownership:** approval from UMA Finance/Accounting is still needed.

All remaining Claude suggestions not itemized above should be treated as **pending or unverified**, not completed.

## Files added

- `backend/src/models/UmaContract.js`
- `backend/src/models/StatementReview.js`
- `backend/src/services/umaContractService.js`
- `backend/src/services/statementCsv.js`
- `backend/src/routes/umaContractRoutes.js`
- `backend/src/routes/statementReviewRoutes.js`
- `backend/src/routes/umaInsightsRoutes.js`
- `backend/test/umaPilotAdditions.test.js`
- `frontend/src/pages/UmaContracts.jsx`
- `frontend/src/pages/UmaStatementReviews.jsx`
- `frontend/src/pages/UmaAudit.jsx`
- `frontend/src/pages/UmaInsights.jsx`
- `frontend/src/styles/uma-pilot.css`

## Existing files changed

- `backend/src/routes/index.js` — register secured API routes.
- `backend/test/run.js` — add focused unit tests.
- `frontend/src/App.jsx` — register pages.
- `frontend/src/utils/navigationAccess.js` — route restrictions and menu entries.
- `frontend/src/utils/navigationIcons.js` — navigation icons.

## Setup on Windows (PowerShell)

**Back up your current code and MongoDB first. Test on a staging database, not production.**

```powershell
cd "C:\Users\TI-SJL-0010\Downloads\finance-main-triple-track-updated"
# Unzip the delivered full-source ZIP into a NEW folder, or copy only the changed files
cd ".\finance-main"
npm ci
node --test .\backend\test\umaPilotAdditions.test.js
npm run test:backend
npm run test:frontend
npm run build --workspace frontend
npm run dev
```

The new collections (`UmaContract`, `StatementReview`) use Mongoose schema creation; no destructive migration scripts are included.

### Expected CSV statement format

Semicolon or comma separators (choose a separator consistent with CSV quoting). UTF-8 with header:

```csv
fecha;referencia;monto;moneda;descripcion
2026-10-24;OP-00017;-1250.00;PEN;Pago a proveedor
2026-10-24;OP-00018;250.00;PEN;Crédito pendiente de identificar
```

Outgoing bank payments are negative; incoming credits are **not** auto-matched. Only a unique candidate matching the bank-batch total, currency and ±3-day date window is suggested. Accounting must still perform financial reconciliation separately.

## Validation recorded during preparation

- JavaScript syntax checked on the changed backend modules.
- Frontend JSX parsed with the available TypeScript parser (syntax only).
- Three new statement parsing/matching unit tests passed.
- `npm ci` could not complete in this environment (uncached dependency and download timeout), so full frontend bundling, API tests, MongoDB integration and live browser flows were **not** verified.

**Do not deploy until the existing suite, staging E2E payment flows, and security review pass.**
