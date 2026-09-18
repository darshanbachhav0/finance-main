# Budget, SUNAT exchange-rate and fiscal-validation implementation

Scope: Budget, exchange-rate evidence and fiscal invoice validation. BBVA, CeCo import, SIRE and SLA calculations were not changed. Existing work already in the checkout was retained.

## Behavior

- New A1/A2/B commitments enforce annual/monthly or Cost Center availability. A transitional configuration no longer bypasses funding checks. Insufficiency produces an auditable exception; the default rejection policy becomes a funding-increase request, not permission to overspend.
- Budget/Admin users prepare and review exceptions. Only the Management role approves/rejects; a requester, exception initiator or preparer cannot approve their own case. Funding-increase approval still requires actual allocation. Extraordinary approval cannot authorize more than its recorded requested amount.
- Accounting requires a valid commitment and rejects amounts exceeding its remaining capacity. A USD invoice exchange-rate increase can reserve additional funds within the approved source-currency amount, subject to availability or a separate approved exception. The adjustment preserves the original reservation and rate evidence. Successful non-advance postings execute the corresponding reserved budget at the shared accounting boundary. Cancellation retains movements and releases only the unexecuted reservation; existing restrictions against cancelling posted obligations remain.
- As confirmed by the user, new Track C advances reserve funds before Account 14 posting. Advance payment does not execute expense budget. Rendition validates actual-expense availability, replaces the reservation with eligible actual expense, and releases the unused portion. The original reservation is retained in a snapshot/history. Already-posted historical DEFERRED advances remain compatible.
- PEN uses rate 1. New USD invoice postings use the invoice date and store their own rate evidence on the payable and journal. Authoritative SUNAT records/adapters take priority. Missing publications use a prior published business-day rate within seven calendar days; future/stale rates are rejected. Exact requested date, used date, source, authority and fallback reason are retained.
- BCRP/manual saved rates are reference-only. Reference fallback is disabled by default; enabling it never labels those rates official. Existing transaction snapshots are not rewritten.
- Supplier ACTIVO/HABIDO status is separate from invoice acceptance. Public Padron alone cannot authorize accounting. Production responses must establish voucher acceptance; a generic active-taxpayer response is insufficient.
- XML checks cover issuer, series/number, currency, subtotal, IGV and total. Fiscal duplicates remain protected by the compound fiscal-identity index and posting checks. A1 first/additional invoices, A2 processing/retries, Track B and generic accounting use the same final checks.
- Accounting can explicitly accept corrected XML values in the observation drawer. Original and corrected values are audited. This action does not bypass supplier, voucher, PO, duplicate, budget or closed-period checks.

## Configuration and live integration limits

Configure a trusted SUNAT-backed adapter using the existing settings:

```
SUNAT_API_BASE_URL=<trusted adapter base URL>
SUNAT_API_TOKEN=<server-side token>
SUNAT_EXCHANGE_RATE_ENDPOINT=<selling-rate path>
SUNAT_VOUCHER_ENDPOINT=<individual CPE validation path>
SUNAT_API_METHOD=POST
EXCHANGE_RATE_ALLOW_REFERENCE_FALLBACK=false
```

An exchange-rate response must contain a positive `sellingRate` (or `venta`/`rate`), actual ISO publication `date` and `source` equal to `SUNAT` or `SUNAT_PRODUCTION`. It must not substitute BCRP/SBS data or echo a requested date when returning an earlier rate. Nested `data` fields are supported. A voucher response must provide accepted voucher status (including SUNAT `data.estadoCp = 1`) or explicit voucher verification, and must not mark it unverified/public-dataset-only.

`PUBLIC_PADRON` can continue fast local supplier validation while the voucher endpoint supplies individual invoice validation. Full PRODUCTION mode also needs a taxpayer endpoint. The adapter must handle its upstream SUNAT authentication and response mapping; these environment settings are not themselves SUNAT credentials or a newly implemented OAuth flow.

Live SUNAT connectivity was **not certified** in this environment. A direct request to the public exchange-rate page returned a rejection page. No endpoint was guessed and no BCRP value was presented as official SUNAT. Configure/test the adapter before enabling new USD accounting and automatic invoice acceptance in production. When it is unavailable and no permitted dated evidence exists, progression is blocked.

SUNAT's [official publication notes](https://e-consulta.sunat.gob.pe/cl-at-ittipcam/tcS01Alias) explain that an unpublished day's rate uses the preceding publication. The application additionally limits fallback age to seven calendar days to avoid silently using stale rates.

## Database and deployment

No bulk data migration or historical FX rewrite is required. Schema changes are additive. Existing manual/BCRP records keep their original evidence; missing historical authority metadata is displayed as unknown, not inferred to be official.

An **unposted** old `NO_BUDGET` commitment can be revalidated on its next accounting attempt. Its original record is copied to `legacyUnreservedSnapshot`, the same ID and prior history remain, and a funded reservation is appended. Already-posted unreserved legacy records are not automatically reinterpreted; further work on those cases requires a Finance-reviewed budget adjustment.

Populate applicable budget allocations and assign an independent Management user before rollout. Restart the backend to load the schema/code and publish the rebuilt frontend. Existing production transaction guarantees still depend on the deployment's MongoDB transaction support; use a replica set for atomic multi-document financial operations.

No further business-rule decision is pending: the user confirmed reservation before Track C advances. SUNAT adapter configuration and live certification remain deployment requirements.

## Verification

- Backend full regression suite: 208 tests passed in the final full run; includes actual XML/ZIP invoice processing, correction audit, budget release/exception controls, Track C reservation/rendition, historical rates and closed periods.
- Frontend test suite passed, including new financial evidence and role-control checks.
- Production frontend build passed after the final UI changes (Vite, 2.91 seconds).
- Integration fixtures use temporary test databases and simulated provider responses. These tests do not claim live SUNAT certification.

## Files changed in this task

| File | Change |
|---|---|
| [backend/.env.example](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/.env.example) | Documents the SUNAT adapter response and disabled-by-default reference fallback. |
| [backend/src/controllers/budgetController.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/controllers/budgetController.js) | Uses the separated review/decision service and loads XML for Track B budget retries. |
| [backend/src/controllers/batchInvoiceController.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/controllers/batchInvoiceController.js) | Passes explicit XML correction confirmation to the observation service. |
| [backend/src/controllers/masterDataController.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/controllers/masterDataController.js) | Verifies SUNAT rates server-side on save; current-rate lookup uses Lima date and the new resolver. |
| [backend/src/controllers/requestController.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/controllers/requestController.js) | Returns budget exception evidence with request details. |
| [backend/src/routes/budgetRoutes.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/routes/budgetRoutes.js) | Allows Management decisions while retaining Budget review access. |
| [backend/src/models/BudgetCommitment.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/models/BudgetCommitment.js) | Adds optimistic concurrency and preserved snapshots for legacy reservation/rendition conversion. |
| [backend/src/models/BudgetException.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/models/BudgetException.js) | Adds preparation metadata and append-only review/decision history. |
| [backend/src/models/FinancialRequest.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/models/FinancialRequest.js) | Adds exchange-rate/fiscal evidence and XML currency comparison. |
| [backend/src/models/AccountsPayable.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/models/AccountsPayable.js) | Stores the invoice-specific exchange-rate evidence. |
| [backend/src/models/JournalEntry.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/models/JournalEntry.js) | Stores the exchange-rate evidence used by the journal. |
| [backend/src/models/SunatVoucher.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/models/SunatVoucher.js) | Stores separate supplier and voucher validation evidence. |
| [backend/src/services/budgetService.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/services/budgetService.js) | Enforces available funds for new reservations, creates shortage exceptions, validates posting capacity, safely upgrades unposted legacy reservations, and settles Track C reservations against actual rendition. |
| [backend/src/services/budgetExceptionService.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/services/budgetExceptionService.js) | New: Budget preparation, Management authorization, self-approval prevention, concurrent-decision protection and audit history. |
| [backend/src/services/exchangeRateService.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/services/exchangeRateService.js) | Official-first dated selection, bounded previous-publication fallback, explicit reference opt-in and historical snapshot preservation. |
| [backend/src/services/sunatExchangeRateProvider.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/services/sunatExchangeRateProvider.js) | New: verifies adapter provenance, dates, positive selling rates and fallback evidence. |
| [backend/src/services/xmlValidationService.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/services/xmlValidationService.js) | Preserves identifier text, compares currency and all invoice amounts/identity, and exposes a common posting guard. |
| [backend/src/services/sunatVoucherService.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/services/sunatVoucherService.js) | Rejects taxpayer-only results and stores the two validation results separately. |
| [backend/src/services/sunatService.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/services/sunatService.js) | Allows local Padron taxpayer lookup with a separately configured production voucher adapter. |
| [backend/src/integrations/sunat/PublicPadronSunatProvider.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/integrations/sunat/PublicPadronSunatProvider.js) | Never reports an individual voucher as valid based on the Padron. |
| [backend/src/integrations/sunat/ProductionSunatProvider.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/integrations/sunat/ProductionSunatProvider.js) | Requires voucher-specific acceptance and actual SUNAT rate publication date/source; supports separately configured capabilities. |
| [backend/src/services/accountingService.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/services/accountingService.js) | Budget and fiscal controls at AP/journal boundaries, centralized expense-budget execution, XML rechecks, common fiscal ledger linkage and per-invoice FX snapshots. |
| [backend/src/services/invoiceRegistrationService.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/services/invoiceRegistrationService.js) | Explicit missing-XML error for A1 instead of a null-file crash. |
| [backend/src/services/batchInvoiceService.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/services/batchInvoiceService.js) | Blocks disagreement with replacement XML, retains failed replacement evidence, and audits explicit correction acceptance. |
| [backend/src/services/directPaymentService.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/services/directPaymentService.js) | Rechecks Track B XML and reserves new Track C budgets before advance posting. |
| [backend/src/services/renditionService.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/services/renditionService.js) | Checks posting periods and actual-expense budget before rendition accounting. |
| [backend/src/services/requestService.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/services/requestService.js) | Includes exception records in authorized request detail responses. |
| [backend/src/services/workflowTaskPolicy.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/src/services/workflowTaskPolicy.js) | Routes a prepared budget exception to Management without changing SLA values. |
| [backend/test/budgetFiscalImprovements.test.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/test/budgetFiscalImprovements.test.js) | New behavior/integration tests for budget, exceptions, FX, historical evidence, duplicate vouchers and XML/provider validation. |
| [backend/test/fiscalFixtures.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/test/fiscalFixtures.js) | New real XML and ZIP fixtures for financial regression tests. |
| [backend/test/workflowStatus.test.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/test/workflowStatus.test.js) | Real A1 first/additional, A2 worker/correction and Track B tests; fixtures now include funded reservations and invoice evidence. |
| [backend/test/financialLifecycle.test.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/test/financialLifecycle.test.js) | Updates lifecycle fixtures to include the required budget/XML evidence and retains historical deferred-advance coverage. |
| [backend/test/workflowPhase5.test.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/test/workflowPhase5.test.js) | Uses actual invoice XML evidence in payable snapshot tests. |
| [backend/test/budgetSimulator.test.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/test/budgetSimulator.test.js) | Uses an explicitly authoritative SUNAT fixture instead of treating a manual rate as official. |
| [backend/test/run.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/backend/test/run.js) | Registers the new backend suite. |
| [frontend/src/components/FinancialValidationSummary.jsx](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/frontend/src/components/FinancialValidationSummary.jsx) | New separate supplier/invoice results, rate evidence, availability and exception display. |
| [frontend/src/utils/financialEvidence.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/frontend/src/utils/financialEvidence.js) | New rate/date/source/authority/fallback presentation helper. |
| [frontend/src/pages/RequestDetail.jsx](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/frontend/src/pages/RequestDetail.jsx) | Connects financial evidence and XML currency results to the request detail view. |
| [frontend/src/pages/BudgetControl.jsx](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/frontend/src/pages/BudgetControl.jsx) | Separates preparation/review from Management approval and hides self-approval actions. |
| [frontend/src/pages/ExchangeRates.jsx](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/frontend/src/pages/ExchangeRates.jsx) | Loads SUNAT evidence, supports SUNAT mode and describes server verification. |
| [frontend/src/pages/InvoiceObservations.jsx](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/frontend/src/pages/InvoiceObservations.jsx) | Adds explicit, audited acceptance of corrected XML values. |
| [frontend/src/context/LanguageContext.jsx](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/frontend/src/context/LanguageContext.jsx) | Adds Spanish labels for the new controls. |
| [frontend/test/budgetFiscal.test.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/frontend/test/budgetFiscal.test.js) | New presentation and UI wiring tests. |
| [frontend/test/run.js](C:/Users/TI-SJL-0010/Downloads/finance-main-triple-track-updated/finance-main/frontend/test/run.js) | Registers the new frontend tests. |
