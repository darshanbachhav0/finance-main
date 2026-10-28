> **Current build (27 October 2026): The separate Contracts feature has been removed temporarily.** This document describes an earlier build. See `CONTRACTS_FEATURE_REMOVED.md` for the active source modules and the removal details.

# UMA Finance — additional code implementation (27 October 2026)

## Deliverables and source of requirements

Based on `finance-main-main (1)(2).zip`, Claude's 60-point comparison `Pasted markdown(2).md`, UMA's 7-page PDF and the `Flujo de Pagos UMA` HTML prototype. The code in this archive continues the earlier ZIP `UMA_Finance_Claude_Updated_Full_Source.zip` and preserves existing A1/A2/B/C/D modules.

**Important: This is NOT a completed 60-of-60 implementation or a production-ready replacement.** It is a substantial incremental update containing standalone intake/review modules and improvements to existing prototype additions. Any finance-specific workflow that creates, posts, releases or reconciles payments requires Accounting/Treasury validation and real database tests. Features that are not implemented are listed below rather than represented as complete.

## New or improved features in this package

1. **Movilidad (M) intake** with per-date S/49.20 daily threshold, deductible/nondeductible split, employee, trip details, signed PDF attachment, unique numbered record, CECO scoping, sequential approval routing, observations and corrected resubmission. Does NOT create the accounting entries or bank payment.
2. **Honorarios (H) intake** for HR/GAF, with per-receipt duplicate checks *within a submission*, 8% simulated withholding for receipts over S/1500 without declared valid suspension, signed evidence and Director→GAF review. Does NOT verify suspension certificates with SUNAT or post taxes.
3. **Devoluciones (E) intake** including 704101–704106 classification, Motor de Ingresos attestation, Legal evidence reference, card-payment flag requiring a gateway reversal instead of a BBVA TXT, Legal→CECO manager→GAF (GAF above 5 UIT) review. No gateway integration, bank payout or journal posting.
4. **Special expense dossier security**: role and cost-center checks, protected stored signed-PDF evidence and SHA-256 check, audited state changes, disallow self-approval, concurrency-safe stage progression, correction after observation.
5. **Contract invoice consumption**: manually link an already-registered payable to a validated contract, require matching supplier/currency/CECO, in-force dates and completed digital acta, prevent exceeding total and monthly quota with atomic updates, maintain a unique CXP link and audit, expose the linked invoices in Contracts. **No automatic bypass of approval or accounting.** Requires MongoDB replica-set transaction support.
6. **Bank-statement workflow**: every movement is classified by Treasury as matching / unidentified / rejected with notes; only unique match suggestions may be accepted; the Accounting sign-off is independent of Treasury and only after classification. **Does not post ledger entries or mark requests reconciled automatically.**
7. **Inversiones register**: proposed placements, principal/currency/annual rate/date validation, ≤360-day term and simple-interest projection, GAF authorizes (other than proposer), 50% institution-concentration check by currency, Treasury records settlement, maturity alerts. **No bank placement or accrual-journal automation.** Starting a new portfolio from zero cannot meet the strict 50% rule for a single institution; business process must approve a diversified initial portfolio before activation.
8. **Consultas** expanded from two topics to nine: requests, payables, contracts, actas, suppliers, bank batches, statement reviews, special expenses, investments. CSV export protects against spreadsheet formula injection; responses intentionally omit bank-account values.
9. **Indicadores** now includes counts of special expenses, contract statuses and investments, in addition to existing status/priority/batch figures.
10. **Guía y modelos** page for A1/A2/B/C/D/M/H/E, with role-based menu entries.
11. **GAF-only bank-file approval:** the previous Admin approval exception was removed; backend checks now require GAF and a different generator. Admin may still see verification history, but cannot sign or reject bank files.

## Implemented or previously present (not reimplemented)

Previous source code already has: employee job categories and Por Encargo restrictions, cost-center hierarchy and approvals, P1–P4 priority and suggested payment dates, bank-file verification with GAF, Track D treasury transfers, electronic acta service, quote/document policy modes, purchase orders, rendition, departmental suppliers and other modules. Their end-to-end behavior was not certified in this session.

## Still pending from the comparison — must not be deployed as complete

- M/H/E **Accounts Payable integration, accounting journals, payment scheduling and supplier/student/teacher beneficiary controls**; cross-submission receipt uniqueness and full evidence validation.
- Contract automated invoice creation/exception-routing, all milestone and monthly receipt alerts, supply variation monitoring and scheduled notices.
- Automatic bank-statement-to-payment reconciliation, final bank journal posting, secure conflict resolution, statement coverage across banks and gateway matching.
- Official SUNAT SPOT/detraccion TXT certified file, deposit/constancia end-to-end processing, bank/invoice exceptions.
- Formal payment-gateway refunds, fee reconciliation, foreign bank transfers and settlement exports.
- Investment cash movements, accrued-yield accounting, safe batch GAF portfolio authorization and official accrual export.
- Fine-grained role-scoped Consultas, complete audit before/after coverage, expanded KPI timing indicators, historical data import from the original Tesorería workbook.
- Sensitive financial/identity field encryption at rest with key rotation and safe migrations. **Existing accounts and identifiers have not been encrypted by this package.**
- The decisions D1/D2/D3/D4/D6/D7 where Claude reports clashes between manuals and existing live financial rules (who validates suppliers, Por Encargo approval, 3 quotations, approval hierarchy, accounts class 9, compulsory Accounting queue). D5 GAF-only approval was tightened in this package. Do not change operating financial policy without review by UMA Finance/Accounting.
- Complete regression suite, UI integration tests, MongoDB replica set checks, end-to-end bank certification, staged migration and backup/rollback verification.

## Validation completed here

- Node.js syntax checks on every changed `.js` backend module.
- 10 focused tests passed: special expense amounts and validations; investments; contract quotas; prior CSV parsing/matching tests.
- No application build / MongoDB-connected integration tests were run, because frontend/server npm dependencies were unavailable in the environment. **Do not interpret these unit tests as deployment readiness.**

## Windows staging setup

After saving your working platform AND backing up the MongoDB database, extract this full ZIP into a NEW folder (do not overwrite production directly), copy your privately stored `backend/.env` (do not share this file), then from the folder containing `package.json` run:

```powershell
npm ci
node --test .\backend\test\umaSpecialRules.test.js .\backend\test\umaInvestmentRules.test.js .\backend\test\umaContractRules.test.js .\backend\test\umaPilotAdditions.test.js
npm run test:backend
npm run test:frontend
npm run build --workspace frontend
npm run dev
```

The backend creates its Mongoose collections on first use. Keep every new financial workflow in staging until cost centers, user roles, Accounting and Treasury sign-offs have been verified in a real test environment.
