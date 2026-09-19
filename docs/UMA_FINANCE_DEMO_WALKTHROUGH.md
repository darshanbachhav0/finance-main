# UMA Finance demonstration

54 labelled sample requests are loaded in the existing local database `uma_finance_triple_track_fresh`. They span April–September 2026, six departments, PEN/USD, A1/A2/B/C and 15 workflow statuses. Existing records, accounts, passwords, permissions and master configuration were not overwritten.

Refresh the platform after signing in. For the strongest opening, choose **Management / Gerencia**, open **Management Reports / Reportes gerenciales**, clear filters and leave the accounting period blank to show all six months. Dashboard metrics are role-specific; the Management and Budget accounts show the most financial information.

## Suggested 10-minute presentation

| Screen / example | What to explain |
|---|---|
| Management Reports → Executive summary | “This is our university-wide financial view: budgets, available funds, spending trends, CAPEX/OPEX and departmental activity.” |
| Management Reports → Spending analysis | Compare the six departments and expense accounts. Use a chart to drill into the supporting requests. |
| Budget Control | Show the nine annual/monthly sample plans. Explain that reserved budget, recorded expenditure and confirmed payment are different measures. |
| Requests → `SOL-2026-900030` | Draft example: information can be prepared and saved before submission. |
| Approval Inbox → `SOL-2026-900048` | A Health-area request awaiting Director approval. Show the assigned stage and due date. |
| Requests → `SOL-2026-900049` | Director-approved request waiting for Vice Rector review. |
| Requests → `SOL-2026-900034` | Budget committed, before accounting. Explain the reservation and remaining budget. |
| Requests → `SOL-2026-900035` | Accounted request with linked CXP and journal evidence. |
| Treasury → `SOL-2026-900036` | Scheduled payment, still unpaid. |
| Requests → `SOL-2026-900045` | Two invoices: one paid, one awaiting confirmation. The parent remains `TXT_GENERADO`; partial progress is visible. |
| Requests → `SOL-2026-900046` | Track C: paid advance with rendition still pending. |
| Requests → `SOL-2026-900047` | Track C: paid advance with submitted rendition. Accounting has not yet recognized the actual expense. |
| Budget → `SOL-2026-900043` | Insufficient-budget example requiring an extraordinary decision. |
| Requests → `SOL-2026-900040` | Completed, reconciled and closed example. Open linked records and the audit trail. |

Suggested introduction: “These figures and documents are demonstration data. We will follow how a university expense moves from a departmental request to approval, budget control, accounting, payment and reconciliation.”

## Dataset

- 54 requests, six fictional suppliers and 34 sample purchase orders.
- 52 CXP records and 95 balanced sample journals.
- Nine annual/monthly budget plans, 43 commitments and one budget exception.
- 32 sample reconciliation records, including request-level reconciliations covering multiple invoices.
- 145 labelled sample PDF/text files, nine in-app notices and 54 import audit records.
- Six monthly points, six department groups, CAPEX/OPEX/advances, paid/pending/overdue obligations and on-time/overdue sample approval histories.

The imported request numbers occupy the `900000` range and have immutable `developmentScenarioKey` identifiers. Supplier names, projects, files and request descriptions explicitly identify DEMO data. USD values are marked non-authoritative simulated reference rates.

This is a walkthrough dataset, not evidence of real transactions. Approval history is labelled simulated, and audit entries identify the importer rather than claiming real user signatures. Fictional supplier identifiers are not valid operating RUCs. Suppliers remain unverified/inactive; no real beneficiary bank accounts were created. Fiscal vouchers remain unverified and are excluded from eligible SIRE exports. The two TXT placeholders explicitly say they are not bank files. Existing backend checks remain active, so attempting to progress a sample request may require real configuration/evidence; do not use these samples for an actual bank or tax submission.

## Repeatability and verification

`backend/scripts/seedUmaPresentation.js` defaults to dry-run and requires an explicit local `MONGODB_URI` and matching `--database` argument. Apply additionally requires `--apply`. It validates all fixture models and derived child progress before inserting, uses deterministic IDs and insert-only writes, and records completion in `demopresentationimports`. A completed dataset is skipped on rerun, preserving any later demo edits. It does not reset the database or change existing users/configuration.

`testUmaPresentationSeed.js` tests dry-run, preservation and repeat application on a disposable local master-data copy. `verifyUmaPresentation.js` checks the populated database, balanced journals, budget counters, partial progress, role dashboards/chart APIs and exclusion from fiscal exports. `captureUmaPresentation.js` renders read-only desktop/mobile screenshots with the production frontend.

Validation results and screenshots: `data/reports/uma-presentation/`. Existing records passed before/after preservation checks. The frontend suite/build passed after two small display fixes: readable dashboard amounts and grouped chart colors matching their legends.

No automatic deletion/reset is included. Any later cleanup should use the recorded dataset IDs and preserve records modified or used after the presentation.
