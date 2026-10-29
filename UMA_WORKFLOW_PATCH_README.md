# UMA Finance — B / C / A1 / A2 workflow and budget handoff patch

Sources: uploaded **doc 1(6).pdf**, **doc 2(6).pdf**, **Pagos UMA Piloto (Copy)(6).html**. This archive is the full existing codebase with targeted patches. It has not been deployed to production.

## Process responsibility / route

| Route | Requester | Approvals | After approvals | Accounting | Treasury / end |
|---|---|---|---|---|---|
| B — factura directa | Solicitor uploads the supplier invoice XML/PDF and validates cost center, supplier, payment terms | CeCo responsible, applicable superior, GAF >5 UIT, GG >20 UIT; Por encargo beneficiaries give visto | Final approval reserves assigned CeCo budget; SUNAT issues must be corrected or reviewed | Verifies signed acta for credit; fiscal account/SPOT/period; posts provision and creates CXP | Only provisioned CXP enters payable scheduling; GAF authorizes batch; bank payment and reconciliation |
| A1 — compra con OC | Solicitor raises purchasing need with three quotations and CAPEX business case when necessary | Same CeCo, hierarchy and UIT rules | Final approval reserves budget, Procurement issues linked purchase order | Invoice against authorized OC, signed credit acta, fiscal and cost center controls, CXP | Schedules, GAF batch authorization, bank proof, reconciliation |
| A2 — lote contra OC | Authorized user uploads XML invoices in a batch against an **existing A1 OC** | Uses A1 order's authorization, not an independent new purchase approval; exception or overrun requires proper route | Batch validates OC balance, invoice identifiers and allocation | Accounting provisions validated invoices, potentially in pieces | Each valid payable appears only after provision; schedule, authorize bank batch, reconcile |
| C — entrega a rendir | Solicitor requests employee advance with cost center and purpose, eligible bank account | Same CeCo, hierarchy and UIT rules; 10-day rendition follow-up | Final approval reserves budget **without creating CXP** | Accounting verifies employee bank and books Account 14 advance, creating CXP | Treasury pays authorized employee; employee submits rendition, Accounting validates, remaining balance settled, reconcile |

Special C reimbursement types retain their dedicated existing approval and rendition rules. An unsupported reimbursement requiring a Finance declaration is not converted to an employee advance. For **adelanto**, signed acceptance/acta and invoice may be received after payment under their separate documented deadlines. For credit purchases, signed acta is required before provision.

## What changed

1. `backend/src/services/approvalService.js`: Track C final approval performs budget reservation and hands off to Accounting instead of silently creating a payable in the approver's session. Shared A1/B approval and budget logic stays intact.
2. `backend/src/services/directPaymentService.js`: Track C advance CXP creation requires a committed budget and is now called only from the Accounting workflow; no duplicate budget reservation.
3. `backend/src/services/accountingService.js`: Accounting provisions Track C advances using employee/Account 14 handling; no supplier fiscal form. Missing verified employee bank receives a hold. Ordinary A1/B invoice path remains.
4. `backend/src/services/advanceBankHoldService.js`: Verifying an employee bank account releases the hold and re-notifies Accounting. It no longer creates an Accounting payable without Accounting action.
5. `backend/src/services/approvalRuleService.js`: Required reporting-superior approval may not be silently omitted from CeCo approval routes if no authorized superior exists. Submission returns a configuration error.
6. `frontend/src/pages/AccountingEntries.jsx`: Accounting user sees an employee-advance provision form and person label for Track C. Pending work is not hidden by the selected journal/report month.
7. `frontend/src/utils/requestJourney.js` and `frontend/src/utils/plainStatus.js`: The requester journey distinguishes APROBADO, budget committed, Accounting provisioned, Treasury, plus employee bank and rendition steps. Only a paid advance tells an employee to present a post-payment rendition.
8. `frontend/src/context/i18n/lively.js`: Relevant bilingual UI messages.
9. Integration tests adapted for the new explicit Accounting step: `backend/test/trackCRenditions.test.js`, `backend/test/advancePaidToday.test.js`, `backend/test/advanceWaitsForBank.test.js`.
10. Added dependency-free regression test: `backend/test/umaManualFlowUnit.test.js`.

## Existing budget rules retained

The original source already implemented CeCo Propio and Por encargo allocation (100% total, multiple charged CeCos), annual/monthly mode, transactional budget commitment/execution/release and budget exceptions in `budgetService.js`, `budgetPlanService.js`, `budgetExceptionService.js`, `shared/costCenterAllocation.mjs`. Its approvalRuleService uses configurable UIT (2026 initial S/ 5,500), reporting superior, GAF > 5 UIT and GG > 20 UIT, plus thirty-day supplier/charged-CeCo anti-fragmentation. These modules were **preserved** and are not claimed to have been rebuilt. Verify organization hierarchy, FinanceConfiguration and ACTIVE vs TRANSITIONAL budget settings before enabling enforcement.

## Tests run here

- `node --test backend/test/umaManualFlowUnit.test.js`: **5 passed, 0 failed**.
- `node --check` for changed JS service, test, i18n and utility files: **syntax passed**.
- `AccountingEntries.jsx` parsed with TypeScript JSX parser: **0 syntax diagnostics**.

**NOT verified here:** End-to-end MongoDB transactions, live SUNAT, bank integrations, invoice data, seeded hierarchy configurations and UI in a running browser. This sandbox has no backend `node_modules` or running MongoDB. Do not apply directly to production without staging tests.

## Run locally / safely

1. Back up MongoDB and the current Git commit. Unpack the archive and inspect changed files.
2. Run `npm install` at the project root (or `npm ci` if the lockfile works for your environment).
3. Run `node --test backend/test/umaManualFlowUnit.test.js`.
4. On isolated staging MongoDB, run the existing backend test suite (`npm run test:backend` from root, or `npm test` inside backend). Expect some old test fixtures to need updating with required CeCo superior approvers.
5. Test full manual B, A1/OC, A2/linked invoice, and C/advance cases in staging, including 5 UIT and 20 UIT thresholds, two-beneficiary Por encargo, insufficient budget and verified/unverified bank accounts. Verify CXP and Treasury queue transitions, accounting journal, and bank batch approval.
6. Only then promote the code. Migrate older already-accounted C advances cautiously: do not replay reservation or Accounting provision. Never run a destructive seed/reset or rollback script against production.

## Known limits

- No live production DB record was examined: the specific request SOL-2026-00144 cannot be diagnosed conclusively from this archive alone.
- The A1/B/A2 pre-existing flows were kept; this patch addresses their shared approval/budget consistency and C's principal missing Accounting handoff, **not** a newly certified complete end-to-end implementation of every manual exception.
- Exact org-level approvers require actual CeCo assignments and reporting hierarchy populated in the DB. Required missing superiors now block routing instead of being silently skipped.
- Do not treat a downloaded TXT as paid until a bank event/payment confirmation and reconciliation are recorded.
