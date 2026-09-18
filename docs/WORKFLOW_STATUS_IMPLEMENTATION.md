# Workflow and status update

Implemented only workflow/status logic. A1, A2, B and C remain available. Bank file formats, exchange-rate integrations, CeCo imports, SIRE, SLA policy and styling were not changed.

## Resulting behavior

- The main lifecycle is BORRADOR → PENDIENTE_APROBACION → APROBADO_DIRECTOR → APROBADO_VICERRECTOR → COMPROMISO_PRESUPUESTAL → CONTABILIZADO → PROGRAMADO → TXT_GENERADO → PAGADO → CONCILIADO → CERRADO, with existing track-specific skips and observation/return branches.
- Existing actions drive milestones. There is no editable workflow-status field.
- RECHAZADO, ANULADO and CERRADO are terminal. Ordinary editing, resubmission and deletion of rejected requests are refused for every role.
- Historical PAGADO_CERRADO is displayed/filtered as CERRADO and remains terminal. Original audit/approval history is retained.
- A posted payable needs actual payment confirmation and a posted payment journal before counting as paid. Downloading/generating a TXT does not count as payment.
- Parent progress uses every non-cancelled CXP. One paid invoice plus two generated instructions leaves TXT_GENERADO with 1/3 paid. All paid invoices move to PAGADO; all reconciled invoices move to CONCILIADO.
- Each invoice can be reconciled independently, including while other invoices remain unpaid. Exact statement amount and bank reference are required. Reconciliation does not close the request.
- Track C payment and rendition remain independent: PAGADO with rendition PENDING is supported, as is CONCILIADO while awaiting rendition validation.
- Closing is an Accounting/Admin action that validates all payment/reconciliation evidence, required approvals, open observations, pending budget exceptions and Track C rendition/settlement balances.
- Open purchase-order balances prevent final closure. Ordinary cancellation refuses requests with active financial obligations; it does not erase journals or silently reverse payments.
- Period validation runs before A1 posting, additional A1 invoices, A2 upload/worker/retry/posting, B/C provisioning and journal creation. skipControls cannot disable mandatory evidence or posting-period checks.
- Request details/lists show paid and reconciled invoice counts; management CSV includes those counts and separate rendition state. Treasury notifications remain pending for the other invoices when one is paid.

## Database migration — required before deployment

The migration has been tested on disposable databases, including dry-run immutability, repeat application and replacing the old unique request index. It has **not** been applied to the live database.

Additive fields: request workflowVersion/legacyWorkflowStatus; payable scheduledFor/reconciliation/reconciledAt; reconciliation scope. The new partial unique index applies to PAYABLE-scope reconciliations. Existing request-level reconciliation records remain intact.

1. Take and verify a backup. Stop the API and invoice workers during application so statuses and indexes are not changed concurrently.
2. From the project root, set MONGODB_URI explicitly to the intended database connection string.
3. Run a dry run, using the exact database name:

~~~powershell
npm run migrate:workflow-statuses --workspace backend -- --database=uma_finance_triple_track_fresh
~~~

4. Review changes, manualReview and conflicts. Legacy Track C budget observations with proven payment are returned to their separate payment milestone while retaining the observation. Evidence-incomplete active records are reported for Accounting review; the script does not invent confirmations or reconciliation evidence.
5. Apply during the same maintenance window:

~~~powershell
npm run migrate:workflow-statuses --workspace backend -- --database=uma_finance_triple_track_fresh --apply --maintenance-confirmed
~~~

6. Re-run the dry run, review any remaining manualReview entries, then start the updated API/workers.

The migration installs the per-payable uniqueness constraint before dropping only the obsolete unique index on request. It retains every journal, payment confirmation, reconciliation document, attachment and existing audit/approval event. Original statuses and application metadata are retained in workflowstatusmigrations; requests also retain legacyWorkflowStatus when renamed. Updates compare the original version/status/timestamp and report conflicts instead of overwriting concurrent changes. Exit code 2 means manual-review records or conflicts remain.

Do not restore the old per-request unique index after new per-invoice reconciliations exist. Rollback requires a coordinated application/database backup restore or a reviewed forward correction, not deleting financial records.

## Verification

- Focused backend gate: **62 passed, 0 failed** using `npm run test:workflow --workspace backend`.
- Full frontend suite: **passed** using `npm test --workspace frontend`.
- Frontend production build: **passed** using `npm run build --workspace frontend`.
- Full backend suite: **163 passed, 13 failed (176 total)**. A separate untouched HEAD checkout reproduced **14 existing failures** before these changes. The remaining failures are the pre-existing document-rule expectations and the financialLifecycle fixture that submits A1 without the current required quotation/narrative setup, with subsequent dependent failures. One old graph expectation was corrected for this workflow.
- Regression coverage includes rejected/cancelled/closed requests, premature closure, three-invoice partial payment and reconciliation, Track C paid plus pending rendition, A1/A2 and background closed-period rejection, historical status queries/aggregation, preserved migration evidence and idempotence.
- Tests used disposable databases on localhost:27017. The live application database was not migrated or used as test data.
- Existing standalone-Mongo transaction fallback remains unchanged. Replica-set failure/retry and live multi-worker deployment validation were not performed.

## Changed files

Only changes made for this request are listed. Pre-existing motion/UI edits and user-provided data files were preserved. RequestCreate.jsx and RequestDetail.jsx already contained unrelated local edits; the workflow edits were added without replacing them.

| File | Change |
| --- | --- |
| [shared/workflowStatus.mjs](../shared/workflowStatus.mjs) | Shared canonical lifecycle, historical aliases, terminal checks, separate rendition state and evidence-based child progress. |
| [backend/package.json](../backend/package.json) | Adds focused workflow regression and safe migration commands. |
| [backend/scripts/migrateWorkflowStatusesV2.js](../backend/scripts/migrateWorkflowStatusesV2.js) | Dry-run-first migration with explicit target/maintenance checks, compare-and-set updates, retained original status metadata, a migration manifest and reconciliation index conversion. |
| [backend/src/controllers/dashboardController.js](../backend/src/controllers/dashboardController.js) | Canonical active/closed metrics; rendition tasks counted separately; rejected requests excluded from active work. |
| [backend/src/controllers/reportController.js](../backend/src/controllers/reportController.js) | Separate rendition reporting; canonical CSV statuses and invoice payment/reconciliation counts. |
| [backend/src/controllers/requestController.js](../backend/src/controllers/requestController.js) | Returns financial progress and all reconciliation records in request details. |
| [backend/src/controllers/treasuryController.js](../backend/src/controllers/treasuryController.js) | Adds the per-payable reconciliation handler while retaining the request-level endpoint. |
| [backend/src/models/AccountsPayable.js](../backend/src/models/AccountsPayable.js) | Adds scheduled date and reconciliation references/timestamps. |
| [backend/src/models/FinancialRequest.js](../backend/src/models/FinancialRequest.js) | Adds workflow version/original-status metadata; normalizes serialized/aggregated statuses and keeps historical status filters working. |
| [backend/src/models/Reconciliation.js](../backend/src/models/Reconciliation.js) | Adds reconciliation scope and per-payable uniqueness; permits multiple reconciliations on a request. |
| [backend/src/routes/treasuryRoutes.js](../backend/src/routes/treasuryRoutes.js) | Routes authorized Treasury/Admin reconciliation to the selected CXP. |
| [backend/src/services/accountingService.js](../backend/src/services/accountingService.js) | Mandatory period/terminal checks before creating payables and journals; canonical consolidation states. |
| [backend/src/services/batchInvoiceService.js](../backend/src/services/batchInvoiceService.js) | Checks periods at upload, worker start, retry and each posting; derives the parent after batch processing. |
| [backend/src/services/directPaymentService.js](../backend/src/services/directPaymentService.js) | Keeps B/C automatic provisioning while checking periods and using CONTABILIZADO. |
| [backend/src/services/financialProgressService.js](../backend/src/services/financialProgressService.js) | Shared posting/closure guards and financial aggregation; batch fetching for request lists/reports. |
| [backend/src/services/invoiceRegistrationService.js](../backend/src/services/invoiceRegistrationService.js) | Checks A1 and additional-invoice posting periods; recomputes parent progress; preserves payment status during an additional-invoice observation. |
| [backend/src/services/periodAdministrationService.js](../backend/src/services/periodAdministrationService.js) | Treats historical closed aliases as terminal during period readiness checks. |
| [backend/src/services/periodService.js](../backend/src/services/periodService.js) | Closed periods always block accounting postings, including when the old posting-policy flag is false. |
| [backend/src/services/renditionService.js](../backend/src/services/renditionService.js) | Allows rendition at PAGADO/CONCILIADO, keeps observations separate from payment, removes premature automatic closure. |
| [backend/src/services/requestService.js](../backend/src/services/requestService.js) | Direct submission to PENDIENTE_APROBACION, terminal edit/delete restrictions, guarded cancellation/closure, child progress and separate rendition filters. |
| [backend/src/services/treasuryService.js](../backend/src/services/treasuryService.js) | Evidence-based scheduling/TXT/payment status; per-CXP reconciliation and notifications; keeps parent progress behind incomplete children. |
| [backend/src/services/workflowService.js](../backend/src/services/workflowService.js) | Canonical action transition graph; terminal states; mandatory evidence/period/closure checks even with skipControls. |
| [backend/src/services/workflowTaskPolicy.js](../backend/src/services/workflowTaskPolicy.js) | Stops correction tasks for terminal requests and keeps Track C rendition tasks visible after payment. |
| [backend/src/utils/constants.js](../backend/src/utils/constants.js) | Canonical CERRADO/CONTABILIZADO values with compatibility aliases. |
| [backend/src/utils/permissions.js](../backend/src/utils/permissions.js) | Rejects edits to terminal requests, including by Admin. |
| [backend/test/domainFoundation.test.js](../backend/test/domainFoundation.test.js) | Updates payment-to-reconciliation transition expectations. |
| [backend/test/permissions.test.js](../backend/test/permissions.test.js) | Tests rejected and active-stage edit restrictions. |
| [backend/test/renditionDeadline.test.js](../backend/test/renditionDeadline.test.js) | Removes the obsolete automatic PAGADO_CERRADO expectation. |
| [backend/test/run.js](../backend/test/run.js) | Includes the new regression suite. |
| [backend/test/workflowPhase5.test.js](../backend/test/workflowPhase5.test.js) | Configures the open accounting period explicitly before invoice posting. |
| [backend/test/workflowStatus.test.js](../backend/test/workflowStatus.test.js) | Real database regressions for terminal states, cancellation, payment/reconciliation aggregation, closure, Track C, closed periods, migration and historical compatibility. |
| [backend/test/workflowRegression.js](../backend/test/workflowRegression.js) | Focused runner for 62 relevant backend tests. |
| [frontend/src/components/StatusBadge.jsx](../frontend/src/components/StatusBadge.jsx) | Displays canonical statuses, preserving rendition as a separate badge. |
| [frontend/src/components/rendition/OfficialRenditionWorkspace.jsx](../frontend/src/components/rendition/OfficialRenditionWorkspace.jsx) | Enables rendition actions after payment/reconciliation and separates settlement from request closure. |
| [frontend/src/pages/ManagementReports.jsx](../frontend/src/pages/ManagementReports.jsx) | Uses the shared canonical lifecycle ordering. |
| [frontend/src/pages/RequestCreate.jsx](../frontend/src/pages/RequestCreate.jsx) | Prevents editing rejected requests. |
| [frontend/src/pages/RequestDetail.jsx](../frontend/src/pages/RequestDetail.jsx) | Canonical timeline, partial payment/reconciliation progress, separate rendition badge, all reconciliation records and guarded actions. |
| [frontend/src/pages/RequestsList.jsx](../frontend/src/pages/RequestsList.jsx) | Removes rejected edit/delete actions and shows invoice payment/reconciliation progress. |
| [frontend/src/pages/TreasuryQueue.jsx](../frontend/src/pages/TreasuryQueue.jsx) | Reconciles the selected CXP, identifies its voucher and keeps reconciliation drafts per payable. |
| [frontend/src/utils/options.js](../frontend/src/utils/options.js) | Removes obsolete main-status choices and rendition-as-payment-status from filters. |
| [frontend/src/utils/umaPresentation.js](../frontend/src/utils/umaPresentation.js) | Displays historical paid-and-closed records as Closed. |
| [frontend/test/financialContracts.test.js](../frontend/test/financialContracts.test.js) | Updates canonical lifecycle expectations. |
| [frontend/test/run.js](../frontend/test/run.js) | Includes the workflow UI regression checks. |
| [frontend/test/workflowStatus.test.js](../frontend/test/workflowStatus.test.js) | Checks canonical UI states, terminal compatibility, rendition separation and child progress wiring. |
| [docs/WORKFLOW_STATUS_IMPLEMENTATION.md](../docs/WORKFLOW_STATUS_IMPLEMENTATION.md) | This implementation, deployment, verification and complete changed-file record. |
