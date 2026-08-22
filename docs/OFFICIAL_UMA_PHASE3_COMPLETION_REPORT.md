# Official UMA Formats - Stage 2 Phase 3 Completion Report

## A. Overall Result

**PASS_WITH_NOTES**

RCO-FOR-001 is implemented inside the existing `FinancialRequest` lifecycle. The implementation is additive, preserves legacy requests, uses the existing Supplier, Budget, Approval, upload, audit, and accounting domains, and does not introduce a parallel request model or workflow.

## B. Phase 2 Readiness

`docs/OFFICIAL_UMA_PHASE2_COMPLETION_REPORT.md` ends with `READY_FOR_PHASE_3`. The approved Supplier implementation and schema addendum were present before Phase 3 work began.

Starting verified baseline:

- Backend: 70/70 passed.
- Frontend: 19/19 passed.
- Frontend production build: successful.

## C. Files Changed

### Backend

- `backend/src/controllers/requestController.js`
- `backend/src/middleware/upload.js`
- `backend/src/routes/requestRoutes.js`
- `backend/src/services/accountingDimensionService.js`
- `backend/src/services/approvalService.js`
- `backend/src/services/budgetService.js`
- `backend/src/services/documentRuleService.js`
- `backend/src/services/requestService.js`
- `backend/src/services/supplierService.js`
- `backend/src/services/workflowService.js`
- `backend/src/utils/constants.js`

### Frontend

- `frontend/src/pages/RequestCreate.jsx`
- `frontend/src/pages/RequestDetail.jsx`
- `frontend/src/pages/Suppliers.jsx`
- `frontend/src/styles/global.css`

### Tests

- `backend/test/requestPhase3.test.js` (new)
- `backend/test/run.js`
- `frontend/test/requestPhase3Contracts.test.js` (new)
- `frontend/test/run.js`

### Translations

- `frontend/src/context/LanguageContext.jsx`

### Schema

- No schema files changed in Phase 3.
- No `OFFICIAL_UMA_PHASE3_SCHEMA_ADDENDUM.md` is required. All persistent fields were already established in Phase 1.

### Documentation

- `docs/OFFICIAL_UMA_PHASE3_COMPLETION_REPORT.md` (new)

## D. RCO-FOR-001 UI

The existing four-step request wizard now organizes the official form as:

1. General information, official narratives, and conditional CAPEX/OPEX planning data.
2. Commercial/accounting lines, supplier quotations, recommended supplier, and read-only budget preview.
3. Existing protected supporting-document uploads with the configured requirement checklist.
4. Submission review and summary.

Autosave, backward navigation, draft behavior, existing request editing, document storage, and the original submission route are retained. The form does not reproduce Excel cells or introduce another UI framework.

## E. CECO Behavior

- The wizard loads CECO choices from `GET /api/requests/authorized-cost-centers`.
- A single authorized CECO is selected automatically; labels show code, name, and area.
- New lines inherit the header CECO. Header changes propagate only to empty lines or lines still using the previous header value.
- The backend rechecks header and every line against the requester's authorized Cost Centers.
- Manipulated IDs fail with `INVALID_COST_CENTER` or `INVALID_COST_CENTER_LINE`; line errors include line number and known CECO code/name/area.

## F. Official Request Fields

New official CAPEX/OPEX submissions require `title`, `detailedDescription`, `businessJustification`, and `nonApprovalRisk`. `areaCorrelative` is exposed separately from the immutable SOL reference. Drafts may remain incomplete, and legacy `description` remains available as the historical fallback.

## G. CAPEX

- Reuses the existing Project master for Project/PEP selection.
- The server builds the project snapshot from the selected Project record and ignores client names/codes.
- Supports the approved asset categories, non-negative useful life, optional supplied NPV amount/currency, and optional Payback value/unit.
- No NPV, Payback, depreciation, or accounting-posting calculation was added.

## H. OPEX

- Supports `ONE_OFF`, `MONTHLY_RECURRING`, and `ANNUAL_RENEWAL` as informational frequency values.
- Continues to use the existing Expense Type/account master and the existing OPEX/Class 6 accounting validation.
- No recurring schedule or automatic renewal behavior was added.

## I. Commercial Lines

Commercial fields live on the existing accounting lines: item/service description, quantity, unit of measure, and unit price. The server calculates each commercial total and the request total with the existing money helpers. Client-supplied commercial totals are ignored. The UI presents commercial total, accounting total, difference, and `NOT_APPLICABLE`, `INCOMPLETE`, `MATCH`, or `MISMATCH` without changing accounting amounts.

## J. Quotation Policy

- Applicability and minimum count come from the existing `DocumentRule.quotationPolicy`.
- A configured policy enforces distinct suppliers, the configured minimum, one protected attachment per quotation, exactly one recommendation, supplier consistency, and selection reason.
- A policy-disabled classification is not forced to provide three quotations and receives a direct Supplier selector. Empty generated quotation placeholders are removed when the user changes to such a classification; entered quotation data is preserved.
- The upload subsystem is reused. It accepts up to 20 quotation evidence files within the existing overall upload controls.
- Exception authorization fields remain server-owned. No new exception-approval action or role was invented.

## K. Supplier Integration

- Supplier selection reuses the Phase 2 Supplier search and records Supplier references only.
- The existing official Supplier proposal route can be opened from Request Create and returns the created Supplier to the request context.
- The server creates quotation and recommended-supplier snapshots from current Supplier data; client RUC, name, status, taxpayer source, and PRV values are not trusted.
- Pending and observed suppliers can participate in early request review. Rejected and inactive suppliers cannot be recommended for submission. Existing later supplier-dependent controls still require an active homologated supplier.
- Request Detail displays current status and the server-assigned PRV when present. It does not claim SUNAT verification beyond the actual Phase 2 provider result.

## L. Recommended Supplier

For an enabled quotation policy, exactly one quotation must be recommended. Its Supplier must equal `FinancialRequest.supplier`, and `supplierSelectionReason` is mandatory. The server rejects zero/multiple recommendations and mismatches independently of the frontend radio control.

## M. Budget Preview

`POST /api/requests/budget-preview` calls `BudgetService.previewBudget`, which uses the same configured rule/allocation dimensions and aggregation logic as the existing Budget domain. The UI can show requested, assigned, committed, executed, paid, available, projected balance, and state where data is sufficient. Incomplete dimensions show pending validation. The preview is read-only, ignores client budget status, and creates no `BudgetCommitment`.

## N. Approval Compatibility

The existing Director, Vice Rector, Budget, Management/Rectorate, Accounting, and Treasury hierarchy was not reordered or replaced. Approvers receive the new request fields through the existing Request Detail response. Final approval preserves the decision when a pending supplier needs homologation, while budget commitment and later supplier-dependent stages remain blocked until the existing strict Supplier rule passes.

## O. Security

- Request input is parsed through explicit allowlists; `req.body` is not mass assigned.
- Requester, SOL number, supplier/project snapshots, commercial totals, reconciliation state, budget state, exception authorization, approval metadata, Supplier status, and PRV remain server-controlled.
- Direct API manipulation of CECO, project snapshot, supplier snapshot, commercial total, budget status, and quotation authorization is covered by backend tests.
- Existing RBAC, protected file access, upload validation, accounting-period checks, and audit append behavior remain in force.
- Existing request update audits now include meaningful official-field, quotation-count, recommended-supplier, and selection-reason snapshots without changing historical audit events.

## P. I18N

All Phase 3 labels, status text, guidance, and validation codes use the shared language context. English remains the source text and synchronized Spanish translations cover official narratives, CAPEX/OPEX fields, commercial lines, quotations, supplier states, budget preview, and CECO/quotation validation errors.

## Q. Responsive Verification

- Desktop: Request Create and Request Detail visually verified at the normal 1280px browser viewport.
- Mobile: Request information and item/supplier steps verified at 390x844. `window.innerWidth` was 390px and document scroll width was 375px; unintended page-level horizontal overflow was false.
- Long CECO and supplier labels stay inside their controls; wizard sections collapse to one column.
- Browser log: no application errors or warnings. Only Vite connection/hot-update debug entries and the React development-tools informational message were present.

## R. Important Database

**Migration apply executed: NO**

Command executed: `npm run migrate:official-formats`

Dry-run result:

- Mode: `DRY_RUN`
- Suppliers scanned/changed: 6/6
- Supplier codes proposed: 5
- Requests scanned/changed: 18/18
- Rendition numbers proposed: 1
- Bank accounts scanned/changed: 6/6
- Document rules proposed: 1
- Finance configurations proposed: 1
- Manual review: 0
- Report: `backend/migration-reports/2026-08-official-uma-formats-foundation-v1-dry-run-2026-08-19T18-10-44-005Z.json`

The dry run produced a report and did not mutate the important database.

## S. Backend Tests

Command: `npm test --workspace backend`

- Total: 82
- Passed: 82
- Failed: 0
- Skipped: 0
- Cancelled: 0
- Todo: 0

The 12 additional reported test cases include the Phase 3 suite and its subtests while retaining all previous lifecycle, foundation, and Supplier coverage.

## T. Frontend Tests

Command: `npm test --workspace frontend`

- Total: 28
- Passed: 28
- Failed: 0
- Skipped: 0
- Cancelled: 0
- Todo: 0

Nine Phase 3 contract tests cover reuse of the existing wizard, authorized CECO sourcing, CAPEX/OPEX sections, commercial authority, quotations, direct Supplier selection, budget preview, Request Detail visibility, i18n, and the 390px layout contract.

## U. Production Build

Command: `npm run build --workspace frontend`

Result: **SUCCESS**. Vite transformed 2,288 modules and generated the production bundle without errors.

No lint/static-check script is configured in the root, backend, or frontend package scripts.

## V. Regression

- Supplier: proposal, compliance review, bank verification/history, status handling, duplicate protection, and PRV homologation tests pass.
- Approval: Director, Vice Rector, SLA, and self-approval protection tests pass.
- Budget: preview, sufficient/insufficient funds, commitment, rollback, and no-preview-side-effect tests pass.
- Accounting: dimensions, mappings, duplicate voucher, CXP, balanced provision, periods, and consolidation tests pass.
- Treasury: batch creation, payment confirmation, journal creation, and reconciliation tests pass; TXT generation still does not mark AP paid.
- Rendition: Account 14 advance and rendition-to-expense regression tests pass; no Phase 4 UI was added.

## W. New Ambiguities

`NEEDS_BUSINESS_CLARIFICATION`

1. The responsible role and approval action for authorizing a quotation-count exception are not defined. Existing exception foundation is preserved and protected, but no CFO/Procurement role or new authorization endpoint was invented.
2. The official documents describe RCO-FOR-001 as upstream of SolPed, but no approved SolPed entity, API, or integration contract exists in the current scope. No parallel SolPed module was created.

## X. Recommendation

READY_FOR_PHASE_4
