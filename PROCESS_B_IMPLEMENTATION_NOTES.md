# UMA Finance — Process B Fixes (October 2026)

## Scope

This release modifies the uploaded `finance-main-main (3)(1).zip` project. **Requested exclusion: Fix 1 is NOT implemented.** The existing Track B quotation-first / XML-or-PDF documentary policy in `backend/src/services/documentRuleService.js` is retained byte-for-byte.

All changes below must be tested on a staging copy of the UMA database, with the supplier and employee hierarchies, actual Accounting permissions, SUNAT provider, valid cost centers, budget periods, supplier banking, and payment batch configuration.

## Intended Track B lifecycle

1. Submit B invoice directly, or submit a quotation according to the preserved existing documentary policy. Final approvals are calculated from the live cost-center cascade, beneficiary CeCos, and UIT thresholds.
2. Final approval reserves the budget and records `COMPROMISO_PRESUPUESTAL`. An invoice does **not** cause automatic Accounting posting or Treasury release.
3. Quotation-first requests wait for their verified invoice; after registration, notify Contabilidad.
4. For credit/post-delivery B, the receiver creates the digital acta and gathers the responsible manager's signature (plus Vice-Rector signature when required). An incomplete, partial, or nonconforming acta cannot release the entire B payable. Accounting can request a replacement, preserving the prior record in `digitalActaHistory`.
5. Contabilidad confirms account mapping, invoice fiscal identity, IGV, and an explicit SPOT category or non-applicability; SUNAT verification or an audited Accounting-only manual exception is required. Only Contabilidad provisions accounts payable and the journal.
6. Treasury uses the correct payment period and original P1–P4 business priority to schedule, batch, authorize, release and confirm bank operations.
7. Reconcile using bank evidence, then close; the old request-creation period does not block later valid payment/closure transactions.
8. For B advances, the application records the post-payment invoice (15 days) and acta (30 days) evidence deadlines, raises overdue alerts and blocks closure while either is missing. **Caution:** This patch adds the controls and deadlines; it does not introduce a separate invoice-free B advance payment/accounting product or a split advance/balance ledger. Existing B invoice-verification requirements before provisioning remain in effect. Those more extensive features need distinct financial design, accounting approval and integration tests before use.

## Fixes included

- **#2:** Disabled automatic direct-B CXP/journal posting from an approver or requester; Accounting must provision.
- **#3:** Mandatory total, fully signed acta for B credit/post-delivery provisioning, regardless of the A1/A2 rollout flag.
- **#4:** Corrected notifications and B provisioning handoff to Accounting; SPOT must be explicitly confirmed before creating the payable.
- **#5:** Updated periods for scheduling, actual bank payment, SPOT deposit and final closure; journal periods are tied to actual transactions.
- **#6:** Calculate anti-fragmentation at the charged beneficiary CeCo rather than only the requester CeCo, using weighted amounts.
- **#7:** Remove the hardcoded B-specific fixed approval fallback in the legacy route preview; actual B submissions continue to use the dynamic approval chain.
- **#8:** Map P1/P2 to expedited priority, P3/P4 to normal payable priority; avoid promoting every B invoice to urgent.
- **#9:** Invoice postings use the invoice document period; request period and payment periods stay separate.
- **#10:** Digital acta PDF download, audit-preserving partial/nonconforming correction flow and advance follow-up deadlines/alerts.
- **#11:** Verify B voucher through existing SUNAT gateway/manual-exception logic, and ensure an approved manual exception resumes budget commitment before Accounting review; live provider credentials still need deployment configuration and external acceptance tests.

## New endpoints

- `GET /api/requests/:id/acta/pdf` — authenticated, request-scoped, downloadable completed digital acta PDF.
- `POST /api/requests/:id/acta/correction` — requires `ACCOUNTING_PROVISION`; body `{ "reason": "..." }` (at least 10 characters); preserves archived acta evidence and notifies the receiver.

## Regression checks run in this environment

- `node --check` on every modified or newly added JS/MJS module: **PASS**.
- TypeScript parser check of `frontend/src/components/DigitalActaPanel.jsx`: **PASS**.
- `node --test backend/test/processBCompliance.test.js backend/test/directPaymentWorkflow.test.js`: **6 passing tests** (unit/source guards and PDF renderer).
- Example digital-acta PDF was generated and parsed successfully as A4, one page.

**NOT run:** Full MongoDB-backed E2E/integration suite, real SUNAT voucher requests, actual bank API/TXT uploading, Playwright frontend integration, production migrations or deployment. The repository's `node_modules` and an authorized UMA database were not provided. Do not treat this package as production-verified until staging validation succeeds.

## Staging validation checklist

- Verify credit B with full XML/PDF or preserved quotation-first route; both initial invoice and later invoice registration.
- Verify receipt acta: missing, partial, observed, fully signed, corrected and downloaded PDF; verify Accounting alone can request correction.
- Verify Por encargo with two CeCos and 30-day same-supplier aggregation crossing 5 UIT/20 UIT.
- Verify SUNAT accepted, unavailable/manual-exception, invalid supplier, duplicate invoice, foreign-currency issue-date exchange rate.
- Verify SPOT applies/not-applicable, Accounting posting, journal balancing, period closure and one CXP per invoice.
- Verify P1/P2 vs P3/P4, Treasury schedule in another month, GAF batch authorization, partial payment, bounce/retry, statement reconciliation, and final closure.
- Verify A1, A2, C, D and other routes have no regressions, especially Track C advances, and A1/A2 acta optional flag.

## Run locally (PowerShell)

```powershell
cd .\finance-main-main
npm ci
npm run test:backend
npm run test:frontend
npm run dev
```

If `npm run test:backend` is not defined in your package version, run `npm test` from the root or `npm run test --workspace backend`. Run only against a safe staging database and snapshot the database before any migrations.
