# UMA production completion review — 24 September 2026

## 1. What was fixed

Started from the existing clean `main` checkout at `a3ed6af`. Preserved the implemented Procurement, manager hierarchy, financial engines, reports and UMA UI. Used `UMA_Financial_Management_System_Final_Documentation_EN.docx` as the functional target. No live financial database was migrated, seeded, reset or otherwise changed during this work.

- Manager routes now persist every stage correctly (`NOT_REACHED` was missing from the schema), reject cycles/inactive or external-only supervisors, and cannot skip required approvals. Configured authority stages remain required alongside the organizational hierarchy. Historical routes keep their assigned identities on resubmission, including routes with an optional first step.
- Assigned managers receive approval bell alerts, dashboard work and SLA notifications even when their normal role is Solicitor. The Approval Inbox is accessible to internal managers, and its final Approve action is available at the appropriate stage. Forwarding remains necessary while required stages remain.
- Admin Users supports supervisor, job title and organizational unit. New/reset passwords require a first-login password change, enforced by the backend and frontend. Password changes revoke previously issued tokens. Bad identifiers and concurrent edits produce useful validation/conflict errors.
- Procurement issues A1 purchase orders explicitly after budget approval; budget commitment no longer silently issues an order. The older Accounting posting path now also requires and consumes the issued PO.
- Explicit ACTIVE budgets remain blocking even when their assigned budget is zero. Phase 1 TRANSITIONAL budgets continue recording informational usage. Users cannot overwrite computed committed/executed/paid CeCo balances through generic master-data editing.
- A2 corrected-XML retries retain the original observed voucher and link it to its accepted replacement. The superseded evidence no longer traps the parent request behind its paid/reconciled invoices. No original XML, fiscal identity or financial history is deleted.
- Track C advances use the employee DNI for bank beneficiary identification and a fitting request reference for the BBVA format. Payment and rendition remain independent; the regression now exercises actual advance provision through payment, rendition, unused-balance release and closure.
- Payment confirmation rejects future execution dates, invalid amounts and newly blocking invoice observations. Payment journals use the actual execution period and validate that period before posting.
- Production BBVA generation requires certification. Editing the layout invalidates certification, while past generated files and their certification snapshots stay unchanged.
- Forced period closure over unresolved financial controls is disabled. Ordinary audited closing/reopening remains available through existing authorized routes.
- Frontend status badges, filters and stage indicators recognize canonical `APROBADO`; historical Director/Vice Rector labels remain readable.
- Migration and configuration safeguards now preserve customized document rules on repeat, reject ambiguous CeCo apply operations, fix roster ObjectId handling, and require explicit confirmation of nickname-based supervisor mappings. The environment example now lists the actual SUNAT adapter configuration instead of unused OAuth/demo-bank switches.

## 2. Architecture decisions

1. A person's organizational role does not determine whether they can approve an assigned hierarchy step. The backend checks the frozen approver identity, active stage, ownership and terminal-state rules. Read-only ManagementViewer accounts cannot become supervisors.
2. Every required route step must finish. Early final approval is refused; organizational hierarchy does not exempt a request from configured authority. Existing snapshots are not rewritten to fit today's hierarchy.
3. `APROBADO` describes completed approval. `TXT_GENERADO`, payment confirmation, reconciliation and rendition are independent evidence-based steps. Tests never use TXT generation as payment evidence.
4. Financial values are controlled by financial services, not generic master editors. An explicit ACTIVE budget never becomes informational merely because the balance is zero.
5. Corrected fiscal evidence is linked rather than deleted. New optional supersession fields exclude only explicitly replaced unposted vouchers from pending progress; ambiguous historical observations are not guessed or backfilled.
6. BBVA sample equivalence is structural verification, not bank certification. Production refuses uncertified formats. SUNAT taxpayer validation alone never authorizes an invoice posting or SIRE row.
7. Existing standalone MongoDB support remains for development. Production requires replica-set transactions; integration tests were also executed against a separate local replica set with `REQUIRE_ATOMIC_WRITES=true`.

## 3. Files and migrations

The complete changed-file manifest is at the end of this document. Changes are concentrated in authorization/hierarchy, approval handoff, budget/posting/payment controls, fiscal retry progress, related screens and regression tests.

Additive model fields: `User.tokenVersion` (legacy value defaults to zero); `SunatVoucher.supersededBy`, `supersededAt`, `supersededByUser`. The approval-step enum now accepts `NOT_REACHED`. Existing records need no destructive rewrite for these additions.

Migration order for an older installation, **only after backup and review of that database's dry run**:

| Order | Script | Conditions |
|---|---|---|
| 1 | `migrateCanonicalWorkflow.js` | Only if the canonical foundation migration is outstanding. Review legacy identity/status mappings. |
| 2 | `migrateOfficialUmaFormatsFoundation.js` | Only if outstanding; review snapshot and official-format backfills. |
| 3 | `migrateTripleTrackWorkflow.js` | Only if outstanding; review duplicate/index conflicts before financial link/index changes. |
| 4 | `migrateDocumentPhases.js` | Seeds missing phased rules, preserves existing canonical policy edits and historical approval routes. Review retained custom rules. |
| 5 | `migrateWorkflowStatusesV2.js` | Evidence-based status/index migration; stop on manual-review/conflict results. Requires exact database and maintenance flags for apply. |
| 6 | `migrateOrgRosterAndManagerChain.js` | Authoritative HR JSON roster; DNI identity; use explicit `jefeDni` for uncertain names. Resolve hierarchy conflicts before apply. |
| 7 | `importUmaCostCenters.js` | After employee identities are present and all conflicting mappings are resolved. Never apply the current ambiguous workbook unchanged. |

Five CLI migrations and the actual CeCo workbook were dry-run against an isolated test database, not the live installation. Populated-fixture tests additionally verify additive workflow migration, index repair, document-policy idempotency and roster assignment/idempotency. A target-database rehearsal is still required: empty-database CLI success does not certify live historical data.

Stop API/workers before applying financial migrations. Take and restore-test a consistent MongoDB and attachment/generated-file backup first. Keep migration reports and the private roster credential file secure. Roll back by restoring a consistent backup with the matching application version, never by deleting financial evidence or applying ad-hoc reverse updates. Do not rerun already-applied foundation migrations blindly.

## 4. Removed or deprecated behavior

- Removed automatic A1 PO issuance during budget commitment: Procurement now owns issuance.
- Removed early final approval while required stages remain.
- Disabled forced period closure and manual editing of computed CeCo usage balances.
- Removed obsolete title-specific statuses from new frontend lifecycle options, retaining historical display support.
- Removed unused OAuth and demo bank-mode settings from the environment example; no supported integration was deleted.
- Replaced nickname guessing during roster apply with a manual-review suggestion and explicit supervisor DNI.

No historical requests, invoices, payments, bank files, CeCo snapshots or audit records were deleted. Demonstration records in the user's local database were left intact.

## 5. Backend results

`npm run test:backend`: **306 passed, 0 failed, 0 skipped**. Covers fiscal/XML/FX, supplier validation, budgets/exceptions, permissions, frozen hierarchy, approval/document phases, posting, workflow status, BBVA, SIRE, SLA, notifications, immutable audit and migrations. After the final shared hierarchy-depth cleanup, the focused production-control suite passed again.

Additional replica-set runs: `financialLifecycle.test.js` **23/23**, `workflowStatus.test.js` **15/15**, with atomic writes required. These used an isolated MongoDB process on port 27029 and generated test databases; the process was shut down afterward.

## 6. Frontend results

`npm run test:frontend`: **PASS**, including the complete registered unit/contract suite. **145 responsive page checks passed** (29 pages, including My Team). Browser checks cover desktop/tablet/mobile widths (1440, 1024, 768, 390, 320), role menus, dialogs, Spanish, printing and first-login password change. Browser APIs are isolated fixtures, not live financial actions. Final browser results are retained in `.tmp/uma-ui/results.json`.

## 7. Production build

`npm run build`: **PASS**. Production assets generated successfully. `git diff --check` reports no whitespace errors.

## 8. A1 / A2 / B / C verification

| Flow | Verified |
|---|---|
| A1 | Submission/approval/budget/explicit Procurement PO/accounting/payment/reconciliation/closure; first/additional XML invoices; goods/service/professional-document rules; no PO bypass; partial invoice progress. |
| A2 | Actual ZIP/XML batch processing, per-invoice observations, corrected-XML retry, duplicate protection, budget/PO consumption, partial payment, separate reconciliations and final closure. |
| B | Director/Vice Rector rules, budget controls, authoritative XML mismatch blocking, individual provision, BBVA generation, explicit payment confirmation, reconciliation and closure. |
| C | Verified employee destination, DNI beneficiary, reserved advance, BBVA generation, paid plus rendition pending, submitted/reviewed rendition, actual expense accounting, unused balance release, reconciliation and closure. |

These are automated application/service integrations plus browser interaction tests, not a claim of live bank or tax-authority execution. The core financial paths also passed with MongoDB transactions enabled.

BBVA generated PEN and USD files are byte-identical to supplied samples: **151-byte headers, 277-byte details**; PEN 8 payments totaling 17,711.90; USD 1 payment totaling 3,694.70. Test artifacts and comparison are in `data/reports/bbva-structure-tests/` and are not payment instructions to upload. The SIRE suite generated repeated test exports, checked one fiscal identity per row and preserved independent export history; its temporary test files were cleaned up.

## 9. Genuine external deployment gates

| Area | Remaining requirement |
|---|---|
| CeCo/HR | Workbook: 153 valid rows, 39 codes, 34 ready codes, **5 conflicting codes**, 28 ambiguous employee rows. Confirm **30004, 40020, 50103, 20007, 20002/RECTORADO**. The isolated empty user database naturally leaves 125 employees unmatched; that is not a count of errors in the live roster. Obtain/approve authoritative employee/supervisor DNI mappings. |
| BBVA | Treasury/bank acceptance for PEN and USD, source accounts, document/transfer codes, purpose/layout fields, operational limits and execution-confirmation procedure. Record real certification references; test/sample references are not acceptance. |
| SUNAT/FX | UMA-approved authenticated voucher/taxpayer/FX adapter endpoints and credentials; validate actual response contracts. Official FX responses must identify SUNAT and the actual publication date. Padrón by itself cannot validate invoices. |
| SIRE/RCE | Accounting approval of fiscal codes, column/export specification and live SUNAT acceptance. Current tested export functionality is not a certification of official submission. |
| Finance configuration | Approved chart/mappings, source-bank accounts, periods, opening balances, budget phase/rules/amounts and approver authority. Rehearse migrations on a protected production clone. |
| Infrastructure | Production replica-set MongoDB, durable shared attachment/generated-file storage, HTTPS, restricted origins/secrets, process supervision, backup restoration and monitoring. A deployment with ephemeral-only financial file storage does not satisfy this application's persistence needs. |
| UAT | Finance signs off on realistic historical-data rehearsal and controlled end-to-end UAT before real posting/payment use. |

Required production configuration: `NODE_ENV=production`, `MONGODB_URI`, strong stable `JWT_SECRET`, `JWT_EXPIRES_IN`, `CLIENT_URLS`, `PORT`; stable `DRAFT_ENCRYPTION_KEY`; durable `UMA_STORAGE_ROOT` or `UPLOAD_DIR` plus `GENERATED_DIR`. For SUNAT configure `SUNAT_PROVIDER_MODE`, `SUNAT_API_BASE_URL`, `SUNAT_API_TOKEN`, `SUNAT_TAXPAYER_ENDPOINT` (PRODUCTION), `SUNAT_VOUCHER_ENDPOINT`, `SUNAT_EXCHANGE_RATE_ENDPOINT`, method/timeout. Configure a persistent `SUNAT_PADRON_DATA_DIR` if using Padrón. Keep `EXCHANGE_RATE_ALLOW_REFERENCE_FALLBACK=false` unless Finance explicitly authorizes references. BBVA layout and certification live in database configuration, independently by currency.

Supervised production processes: API (`npm start`); batch worker (`npm run worker:batch --workspace backend`, with `BATCH_INVOICE_INLINE_PROCESSING=false`); SLA worker (`npm run worker:sla --workspace backend`, configure `SLA_DUE_SOON_HOURS`, `SLA_ESCALATION_HOURS`, `SLA_POLL_MS`); one Padrón updater (`npm run sunat:padron:worker --workspace backend`) where applicable. API and workers must share the database and appropriate durable file locations. Perform Padrón bootstrap separately from web startup.

## 10. Final status

**NOT PRODUCTION READY for live financial operations yet.** Automated code, build, UI and atomic-workflow checks pass, and the identified code defects above are fixed. Institutional master-data decisions, real external certifications, deployment configuration and Finance acceptance remain. Suitable for internal testing and controlled non-production Finance UAT; historical-data testing should use a protected clone after migration review.


## Changed-file manifest

### Backend implementation

- `backend/src/controllers/authController.js`
- `backend/src/controllers/dashboardController.js`
- `backend/src/controllers/masterDataController.js`
- `backend/src/controllers/userController.js`
- `backend/src/integrations/banks/BbvaBankFileAdapter.js`
- `backend/src/middleware/auth.js`
- `backend/src/middleware/errorHandler.js`
- `backend/src/models/BankFormatConfiguration.js`
- `backend/src/models/FinancialRequest.js`
- `backend/src/models/SunatVoucher.js`
- `backend/src/models/User.js`
- `backend/src/routes/approvalRoutes.js`
- `backend/src/routes/authRoutes.js`
- `backend/src/services/accountingService.js`
- `backend/src/services/approvalRuleService.js`
- `backend/src/services/approvalService.js`
- `backend/src/services/batchInvoiceService.js`
- `backend/src/services/budgetService.js`
- `backend/src/services/directPaymentService.js`
- `backend/src/services/notificationService.js`
- `backend/src/services/periodAdministrationService.js`
- `backend/src/services/requestActionPolicy.js`
- `backend/src/services/requestService.js`
- `backend/src/services/slaMonitoringService.js`
- `backend/src/services/treasuryService.js`
- `backend/src/services/workflowTaskPolicy.js`

### Migration/import scripts

- `backend/scripts/importUmaCostCenters.js`
- `backend/scripts/migrateDocumentPhases.js`
- `backend/scripts/migrateOrgRosterAndManagerChain.js`

### Backend regressions

- `backend/test/budgetPhaseMode.test.js`
- `backend/test/financialLifecycle.test.js`
- `backend/test/managerChainApproval.test.js`
- `backend/test/run.js`
- `backend/test/workflowStatus.test.js`
- `backend/test/productionControls.test.js`

### Frontend implementation

- `frontend/src/App.jsx`
- `frontend/src/components/StatusBadge.jsx`
- `frontend/src/context/AuthContext.jsx`
- `frontend/src/context/LanguageContext.jsx`
- `frontend/src/pages/AdminUsers.jsx`
- `frontend/src/pages/ApprovalInbox.jsx`
- `frontend/src/pages/Login.jsx`
- `frontend/src/pages/RequestDetail.jsx`
- `frontend/src/routes/ProtectedRoute.jsx`
- `frontend/src/utils/navigationAccess.js`
- `frontend/src/utils/options.js`
- `frontend/src/utils/requestStage.js`
- `frontend/src/utils/umaPresentation.js`

### Frontend regressions

- `frontend/test/financialContracts.test.js`
- `frontend/test/umaResponsive.browser.mjs`
- `frontend/test/workflowStatus.test.js`

### Shared workflow

- `shared/workflowStatus.mjs`

### Environment template

- `backend/.env.example`

### Handover

- `documentation/PRODUCTION_COMPLETION_2026-09-24.md`

Verification logs are retained locally under `.tmp/readiness/`; responsive screenshots/results under `.tmp/uma-ui/`. These generated artifacts are intentionally excluded from version control.
