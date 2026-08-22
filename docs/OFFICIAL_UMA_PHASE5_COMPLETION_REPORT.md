# Official UMA Phase 5 Completion Report

## A. Overall Result

**PASS_WITH_NOTES**

Phase 5 is implemented and verified. The official UMA request, supplier-homologation, and rendition data now connect to the existing approval, budget, procurement order, AP, Treasury, payment, and reconciliation lifecycle. No parallel workflow, new financial role, official PDF/Excel export, automatic detraccion classification, or production integration was introduced.

The notes in Section X are business-policy questions and do not block the verified Phase 5 integration.

## B. Phase 4 Readiness

`docs/OFFICIAL_UMA_PHASE4_COMPLETION_REPORT.md` ends with `READY_FOR_PHASE_5`.

The starting repository baseline was reproduced before Phase 5 changes:

| Check | Starting result |
| --- | --- |
| Backend tests | 93/93 pass |
| Frontend tests | 39/39 pass |
| Production build | Success |

No blocking Phase 4 issue was found. The requested `OFFICIAL_UMA_PHASE1_COMPLETION_REPORT.md` source is not present in this repository; Phase 1 was checked from its field catalog, migration guide, implementation, automated tests, and the later Phase 2-4 closeout reports.

## C. Files Changed

Backend application:

- `backend/src/controllers/requestController.js`
- `backend/src/controllers/treasuryController.js`
- `backend/src/models/AccountsPayable.js`
- `backend/src/models/PaymentBatch.js`
- `backend/src/models/PurchaseOrder.js`
- `backend/src/routes/requestRoutes.js`
- `backend/src/routes/treasuryRoutes.js`
- `backend/src/services/accountingService.js`
- `backend/src/services/approvalService.js`
- `backend/src/services/paymentDestinationService.js` (new)
- `backend/src/services/procurementReadinessService.js` (new)
- `backend/src/services/purchaseOrderService.js`
- `backend/src/services/requestService.js`
- `backend/src/services/supplierService.js`
- `backend/src/services/treasuryService.js`
- `backend/src/utils/constants.js`

Backend tests:

- `backend/test/financialLifecycle.test.js`
- `backend/test/run.js`
- `backend/test/workflowPhase5.test.js` (new)

Frontend application:

- `frontend/src/context/LanguageContext.jsx`
- `frontend/src/pages/AccountsPayable.jsx`
- `frontend/src/pages/RequestDetail.jsx`
- `frontend/src/pages/TreasuryQueue.jsx`
- `frontend/src/styles/global.css`

Frontend tests:

- `frontend/test/run.js`
- `frontend/test/workflowPhase5Contracts.test.js` (new)

Documentation:

- `docs/OFFICIAL_UMA_PHASE5_COMPLETION_REPORT.md` (new)
- `docs/OFFICIAL_UMA_PHASE5_SCHEMA_ADDENDUM.md` (new)

No dependency was added.

## D. Official Approval Responsibility Mapping

| Official concept | Existing system actor/stage |
| --- | --- |
| Authorized Requester | Authenticated request owner with role `SOLICITOR` |
| Area Management / Head | Existing `APPROVER` assigned at `AREA_DIRECTOR` level and constrained by configured area/rules |
| Financial/budget validation | Existing `BUDGET` commitment followed by `ACCOUNTING` fiscal/AP processing |
| Vice Rector | Existing mandatory `VICE_RECTOR` approval wherever selected by `ApprovalRule` |
| Management / Rectorate | Existing conditional `MANAGEMENT` stage where configured by `ApprovalRule` |

The current approval snapshot and `ApprovalRule` engine remain authoritative. Self-approval, role, approval-level, and area controls remain backend-enforced. UI responsibility labels show the actual system actor/role and do not falsely rename Accounting or Admin as CFO, Procurement, or Control de Gestion.

## E. Supplier Gate

Supplier-dependent procurement execution now requires one Supplier Master record that is:

- `HOMOLOGATED`
- operationally active
- linked to a server-assigned `PRV-...` code

Distinct blockers are returned for pending homologation, observed homologation, rejection, inactivity, non-homologated state, and missing PRV. A supplier may still appear in quotations, a draft, or a proposal before homologation. Supplier correction remains in the Supplier module; the gate never alters, duplicates, reactivates, or silently replaces a supplier.

The PRV is read from Supplier Master. Request or order input cannot supply a fake PRV.

## F. Procurement Readiness

`procurementReadinessService` provides one centralized, structured, derived result. It checks:

- applicability to a controlled CAPEX/OPEX procurement type
- configured approval route completion
- valid existing budget-control record (`COMMITTED`, or transitional-mode `NO_BUDGET`)
- recommended supplier existence
- homologation, active status, and PRV
- configured quotation comparison
- required procurement evidence
- observed, returned, rejected, annulled, or otherwise blocked request status
- existing order/idempotency state

Readiness is **derived, not persisted**. It does not create another state machine or duplicate the request status. Missing approval or budget does not create a commitment as a side effect.

Endpoints:

- `GET /api/requests/:id/procurement-readiness`
- `POST /api/requests/:id/procurement-order`

Errors use structured codes such as `REQUEST_APPROVAL_PENDING`, `BUDGET_NOT_COMMITTED`, `SUPPLIER_HOMOLOGATION_PENDING`, `SUPPLIER_PRV_MISSING`, and `PROCUREMENT_NOT_READY`.

## G. Purchase / Service Order Integration

The existing `PurchaseOrder` and `purchaseOrderService` are reused.

- Controlled goods natures create `PURCHASE` orders.
- Controlled service natures create `SERVICE` orders.
- Classification uses the explicit controlled expense nature, never free-text parsing.
- `ENTREGA_RENDIR`, supported/unsupported reimbursements, employee reimbursements, and non-procurement requests do not create orders.
- Order creation requires approvals, budget control, supplier readiness, quotations, and documents.
- The order is normally generated in the existing approval-to-budget handoff; authorized Admin/Budget users can invoke the idempotent endpoint when appropriate.
- One request has at most one order through the existing unique request boundary and duplicate-key recovery.
- Repeated and concurrent calls return the existing order.
- Supplier, PRV, approved lines, currency, and amount come from the approved request and Supplier Master, not from caller-owned order fields.
- Creation is audited as `PurchaseOrder/ISSUED`.

## H. Payment Terms / AP

When a new supplier AP is created, Accounting captures an immutable snapshot of:

- payment-term option
- credit days
- comments
- capture time

Later Supplier Master edits do not change historical AP. Old AP records without the optional snapshot remain readable. Existing explicit `dueDate` input and stored due dates remain unchanged.

`NEEDS_BUSINESS_CLARIFICATION — AP_DUE_DATE_BASE_DATE`: no official canonical base date was found for adding credit days, so Phase 5 does not invent or silently calculate one.

## I. Supplier Bank Selection

Treasury receives only accounts that pass server-side eligibility:

- belongs to the AP supplier
- active
- `CURRENT` account type
- compatible currency
- supported bank data present
- `VERIFIED` with ownership `MATCH` or `MANUAL_ACCEPTED`
- approved compatibility status `LEGACY_ACCEPTED`, provided ownership is not `MISMATCH`

Pending, observed, rejected, inactive, ownership-mismatch, currency-incompatible, another supplier's account, and DETRACTION accounts are excluded or rejected. Preferred eligible accounts are ordered first, but Treasury can choose another eligible account. Arbitrary IDs are rejected by the backend.

Endpoint:

- `GET /api/treasury/requests/:id/eligible-accounts`

## J. Detraccion

DETRACTION accounts are not offered for a normal supplier payment. Phase 5 does **not** determine whether a transaction is legally subject to detraccion and does not create an automatic legal classification.

Legal applicability inferred: **NO**.

## K. Employee Reimbursement Payment

Employee reimbursement and rendition payments use the Phase 4 employee reimbursement destination snapshot. They never fall back to Supplier Master banking. Once scheduled, later employee-profile or bank-record edits do not change the pending payment destination.

## L. Treasury

The Treasury queue now returns eligible accounts, a selected/frozen destination summary, and a locked indicator. Scheduling and batch generation accept an account ID only as a selection request; the backend resolves and validates the destination again before storing its snapshot.

The UI provides preferred/alternate selection, missing-bank warnings, immutable employee destination summaries, and frozen scheduled destination details. Existing behavior is preserved:

- TXT generation creates a bank batch/instruction.
- TXT generation does not mark AP paid.
- Payment confirmation settles AP and posts the payment journal.
- Reconciliation remains a separate step.
- Historical payment and batch snapshots remain unchanged.

## M. Traceability

Standard procurement chain:

`SOL -> Supplier/RUC -> PRV -> ApprovalRule route -> Budget commitment -> OC Purchase/Service Order -> AP/CXP -> payment destination snapshot -> Treasury batch -> payment confirmation -> reconciliation -> close`

Rendition/reimbursement chain:

`SOL -> RG -> rendition details -> beneficiary acknowledgment -> Finance review -> employee bank snapshot -> Treasury payment -> close`

Request Detail combines real references and existing histories so authorized users can trace the workflow without duplicating financial records.

## N. Permissions

| Role | Phase 5 responsibility |
| --- | --- |
| Admin | Technical administration and authorized order operation; cannot bypass backend readiness. |
| Solicitor | Own requests, quotations, supplier proposals, corrections, and renditions; cannot issue orders or manipulate finance-owned fields. |
| Approver / Area Director | Assigned technical approval and required request information; cannot change supplier verification or Treasury banking. |
| Approver / Vice Rector | Existing configured Vice Rector decision; same backend approval-level protection. |
| Budget | Existing budget commitment/control and authorized procurement-order action; cannot homologate suppliers unless a separate existing permission grants it. |
| Accounting | Supplier review/homologation and AP/fiscal processing; cannot execute Treasury payment. |
| Treasury | View eligible destinations, select an eligible account, schedule, generate batch, confirm payment, and reconcile; cannot verify or edit Supplier Master banking. |
| Management/Rectorate | Existing conditional approval and management visibility; no new bypass. |

## O. Security

- Readiness, supplier status, PRV, budget completion, order supplier, order amount, and order lines are server-derived.
- Order creation requires backend permission and centralized readiness.
- Supplier usage is strict: active plus `HOMOLOGATED`.
- Treasury account lists and selections are server-filtered.
- Caller-supplied arbitrary, inactive, pending, mismatched, or cross-supplier account IDs are rejected.
- Employee bank details are explicitly selected only for authorized Treasury operations.
- Request Detail masks account/CCI/holder data from non-Finance viewers.
- Scheduled destination snapshots are immutable operational evidence.
- Existing JWT, RBAC, period guards, audit controls, and financial transaction service boundaries are preserved.

## P. Audit

Phase 5 uses the existing insert-only audit service. Relevant events include:

- `PurchaseOrder / ISSUED` with request, order kind, supplier, PRV, amount, currency, actor, and time
- `AccountsPayable / CREATED` with captured payment terms and existing due date
- `FinancialRequest / PAYMENT_DESTINATION_SELECTED` with source and masked last-four values
- existing `PAYMENT_SCHEDULED`
- existing `BANK_FILE_GENERATED` / `GENERATED_DEMO_BANK_FILE`
- existing `PAYMENT_CONFIRMED`
- existing `RECONCILED`

No editable Phase 5 audit store was added.

## Q. I18N

All new visible Phase 5 labels, readiness concepts, order types, supplier blockers, payment terms, destination controls, confirmations, and structured error codes use the existing English/Spanish language context. The implementation does not introduce a second translation system.

## R. Responsive Verification

Browser verification used the running local application at `http://127.0.0.1:5174/`.

| View | Verification |
| --- | --- |
| Request Detail, Budget role, 1280x900 | Readiness, actor mapping, order/AP summaries rendered; no page-level overflow. |
| Request Detail, Budget role, 390x844 | One-column readiness layout; tables retain their own horizontal scrolling; no page-level overflow. |
| Accounts Payable, Accounting role | Payment terms, due date, and destination summary rendered; legacy AP showed optional empty terms correctly. |
| Treasury, Treasury role, desktop/mobile | Eligibility warning, locked snapshot, selection layout, and internal table scrolling rendered without page overflow. |
| Browser console | No application errors or warnings on the verified Vite session. |

The current important database has not received the official foundation migration, so its unmigrated supplier records correctly remain blocked by missing Phase 2 PRV/verification data. Isolated automated tests verify positive eligible-account and alternate-selection paths.

## S. Important Database

- Migration apply executed: **NO**
- Direct important-database data modification: **NO**
- Database reset executed: **NO**

Dry-run command:

```powershell
npm run migrate:official-formats
```

Dry-run result:

- mode: `DRY_RUN`
- suppliers inspected: 6/6
- proposed PRV assignments: 5
- requests inspected: 18/18
- proposed RG assignments: 1
- bank accounts inspected: 6/6
- document-rule insertions proposed: 1
- finance-configuration insertions proposed: 1
- manual-review records: 0
- records changed: 0

Report: `backend/migration-reports/2026-08-official-uma-formats-foundation-v1-dry-run-2026-08-19T20-40-45-444Z.json`

## T. Backend Tests

Command:

```powershell
npm test --workspace backend
```

Result: **109/109 PASS**, 0 failed, 0 skipped.

Coverage includes the original financial lifecycle, Phase 1 foundation, Phase 2 Supplier, Phase 3 request, Phase 4 rendition, and the new Phase 5 integration/security suite.

## U. Frontend Tests

Command:

```powershell
npm test --workspace frontend
```

Result: **50/50 PASS**.

Breakdown: 4 frontend tests, 7 financial contracts, 5 UI/UX contracts, 3 Phase 2 Supplier contracts, 9 Phase 3 request contracts, 11 Phase 4 rendition contracts, and 11 Phase 5 workflow contracts.

## V. Build

Command:

```powershell
npm run build --workspace frontend
```

Result: **SUCCESS** with Vite 5.4.21; 2,290 modules transformed.

The repository has no configured lint script. `git diff --check` is used as the available static patch check.

## W. Regression

| Area | Result |
| --- | --- |
| Supplier / RCO-FOR-002 | Pass: proposal, review, homologation, PRV, bank history, and strict execution gate preserved. |
| Request / RCO-FOR-001 | Pass: official request data, quotation linkage, controlled approvals, and status locks preserved. |
| Rendition | Pass: RG, mobility, Finance review, employee banking, and historical snapshots preserved. |
| Approval | Pass: Director, Vice Rector, conditional route model, and self-approval controls preserved. |
| Budget | Pass: active commitment, insufficient-budget branch, transitional mode, release, and idempotency preserved. |
| Accounting | Pass: AP creation, terms snapshot, duplicate voucher, balanced journal, and old AP compatibility. |
| Treasury | Pass: eligible destinations, batch/TXT semantics, payment confirmation, reconciliation, and historical snapshots. |

Official PDF/Excel generation remains intentionally out of scope for Phase 5. Existing demo/non-certified bank-file behavior remains explicitly demo behavior.

## X. New Ambiguities

`NEEDS_BUSINESS_CLARIFICATION — AP_DUE_DATE_BASE_DATE`

The official files store payment terms but do not establish a single canonical date from which AP credit days must be counted. Existing explicit due dates remain unchanged.

`NEEDS_BUSINESS_CLARIFICATION — DETRACTION_TRANSACTION_TRIGGER`

The official sources do not provide a safe transaction-level legal trigger. DETRACTION is excluded from normal account selection, but applicability is not inferred.

`NEEDS_BUSINESS_CLARIFICATION — SUPPLIER_REACTIVATION_APPROVAL_POLICY`

An inactive supplier remains blocked. The official sources do not define the actor and evidence required to reactivate it.

`NEEDS_BUSINESS_CLARIFICATION — PROCUREMENT_ORDER_CLASSIFICATION`

Goods/service mappings use controlled expense natures. UMA must decide whether currently unmapped natures should create an order and, if so, their explicit Purchase/Service classification.

`NEEDS_BUSINESS_CLARIFICATION — PHASE1_CLOSEOUT_SOURCE`

The requested `OFFICIAL_UMA_PHASE1_COMPLETION_REPORT.md` is absent. This did not block implementation because the Phase 1 field catalog, migration guide, implementation, automated tests, and Phase 2-4 reports were available and consistent.

## Y. Recommendation

READY_FOR_PHASE_6
