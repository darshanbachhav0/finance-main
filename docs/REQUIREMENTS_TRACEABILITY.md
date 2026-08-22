# Requirements Traceability

Date: 2026-08-10

Status meanings:

- **Implemented**: available and enforced by the application.
- **Implemented with stated limitation**: safe internal/manual/export capability exists; an external certified specification is still required.

| ID | Requirement | Backend implementation | Frontend implementation | Verification | Status |
|---|---|---|---|---|---|
| FR-01 | One canonical request lifecycle | `utils/constants.js`, `services/workflowService.js`; controllers delegate transitions | Canonical status labels, workflow stepper, contextual actions | `domainFoundation.test.js`, `financialLifecycle.test.js` | Implemented |
| FR-02 | Safe status/data migration | `scripts/migrateCanonicalWorkflow.js`, `MigrationRun`, manual-review report | N/A | Dry-run, apply, idempotency, `verifyCanonicalData.js` | Implemented |
| FR-03 | Atomic immutable request number | `Counter`, `sequenceService.js`, immutable `FinancialRequest.requestNumber` | Read-only reference after creation | Lifecycle tests and data verification | Implemented |
| FR-04 | Request type separated from expense nature | Canonical constants and schema fields | Separate wizard selectors and table filters | Frontend contract test | Implemented |
| FR-05 | Required request header and financial snapshots | Expanded `FinancialRequest` schema and `requestService.js` | Wizard and detail summary | Draft/submit lifecycle tests | Implemented |
| FR-06 | Restricted requester Cost Center | `permissions.canUseCostCenter`, `accountingDimensionService.js` | Profile suggestion and searchable allowed options | Missing/unauthorized dimension tests | Implemented |
| FR-07 | Accounting lines and mapping validation | `requestRules.js`, `accountingMappingService.js`, `AccountingMapping` | Dynamic lines, totals, inline validation | OPEX/CAPEX/non-deductible tests | Implemented |
| FR-08 | Decimal-safe financial calculations | `utils/money.js` used by financial services | Two-decimal display and derived totals | Money helper tests | Implemented |
| FR-09 | Configurable document rules | `DocumentRule`, `documentRuleService.js`, seeded rule matrix | Required-document explanation and upload controls | Missing attachment and rule tests | Implemented |
| FR-10 | XML parsing and fiscal consistency | `xmlValidationService.js`, `XmlValidationAttempt`, backend revalidation | Match panel and structured error feedback | XML mismatch/failed-attempt test | Implemented |
| FR-11 | SUNAT adapter architecture | `integrations/sunat/*`, `sunatService.js` | Honest configured/manual status | Provider behavior and documentation review | Implemented with stated limitation |
| FR-12 | Exact dated exchange rate and PEN equivalent | `ExchangeRate`, `exchangeRateService.js`; PEN=1, USD date required | Manual edit and optional online BCRP reference | Exchange-rate provider tests | Implemented |
| FR-13 | Supplier master and homologation | `Supplier`, `supplierService.js`, unique normalized identifier | Supplier create/edit/homologation UI | Duplicate supplier test | Implemented |
| FR-14 | Supplier bank-account history | `SupplierBankAccount`, validity/deactivation logic and warnings | History shown in supplier detail/editor | Bank history test | Implemented |
| FR-15 | Configurable approval route and SLA | `ApprovalRule`, `approvalRuleService.js`, `approvalService.js` | Approval inbox, SLA severity, route information | Director, Vice Rector, SLA tests | Implemented |
| FR-16 | Approve/observe/return/reject and sign-off | Approval events include actor, role, IP, reference, hash, SLA | Confirmation dialogs; required comments for negative decisions | Approval and permission tests | Implemented |
| FR-17 | Segregation of duties | Backend self-approval block; reasoned/audited Admin override | Disabled-action explanations | Permission enforcement test | Implemented |
| FR-18 | Dimensional budget control | `BudgetAllocation`, `BudgetRule`, `BudgetCommitment`, `BudgetException`, `budgetService.js` | Assigned/Committed/Executed/Paid/Available, paginated tables | Sufficient/insufficient budget tests | Implemented |
| FR-19 | Idempotent commitment and rollback | Unique commitment per request, guarded release/history | Commitment/exception actions with confirmations | Rollback/idempotency tests | Implemented |
| FR-20 | Open-period control and blocked audit | Central `periodService.ensurePeriodOpen()` and `AuditLog` | Structured closed-period error and period administration | Closed create/update/approval/audit tests | Implemented |
| FR-21 | Fiscal processing and duplicate voucher | `accountingService.js`, normalized composite unique index | Accounting queue and fiscal processing dialog | Duplicate voucher test | Implemented |
| FR-22 | Explicit Accounts Payable | `AccountsPayable` and AP lifecycle/history | CXP screen and request-detail section | CXP creation/settlement tests | Implemented |
| FR-23 | Balanced provision/payment journals | `JournalEntry`, equality guard, configured mappings | Accounting lines, debit/credit totals | Balanced journal and mapping tests | Implemented |
| FR-24 | Treasury scheduling and mass selection | AP-based queue and server filters | Select-visible, selected count, currency totals, review | Treasury live verification and lifecycle tests | Implemented |
| FR-25 | Bank adapter architecture and batch history | `integrations/banks/*`, `PaymentBatch`, checksum/snapshots | Batch confirmation, history, protected download | Four-bank seed/tests; access tests | Implemented with stated limitation |
| FR-26 | TXT does not mean paid | Batch changes AP/request to file-created/`TXT_GENERADO` only | Explicit warning and separate payment section | Required test 27 | Implemented |
| FR-27 | Actual payment confirmation | Idempotent confirmation settles AP, posts journal, updates budget | Operation number/date/amount/comments dialog | Required tests 28-29 | Implemented |
| FR-28 | Reconciliation and close | `Reconciliation`, manual reconcile, `PAGADO -> CONCILIADO -> CERRADO` | Reconciliation queue/detail/action | Required test 30 | Implemented |
| FR-29 | Entrega a Rendir | Account 14 provision; rendition balance/evidence/validation/clearing | Rendition detail and role actions | Required tests 21-22 | Implemented |
| FR-30 | Reembolso sin sustento | Configured non-deductible mapping | Separate canonical request type/nature | Required test 20 | Implemented |
| FR-31 | Quotation-originated purchase order | `PurchaseOrder`, `purchaseOrderService.js`, atomic `OC` reference | Purchase-order section in request detail | Sequence/domain integration | Implemented |
| FR-32 | Month-end consolidation | Journal aggregation by period + Cost Center + account, difference check, history | Preview, totals, warnings, protected CSV download | Required test 31 | Implemented |
| FR-33 | SIRE/RCE preparation | `SireProvider`, eligibility validation, CSV/history | Preview warnings/errors and download history | Service/build/live UI checks | Implemented with stated limitation |
| FR-34 | Immutable audit | `AuditLog` update/delete middleware blocks; append-only service; read-only route | Paginated authorized Audit Viewer | Required test 33 | Implemented |
| FR-35 | Permission-based RBAC | Permission catalog over existing roles; Budget/Management added | Role-filtered routes and grouped navigation | Backend/frontend role tests | Implemented |
| FR-36 | Role dashboards and notifications | Real-data dashboard/task aggregations, deduplicated `Notification` | Seven profiles, bell, counters, task links | Role navigation/live browser verification | Implemented |
| FR-37 | Request detail traceability | Detail API hydrates approvals, XML, budget, AP, journals, batch, payment, rendition, reconciliation, audit | Full detail sections and quick-view drawer | Browser and lifecycle verification | Implemented |
| FR-38 | Reports and export history | Period/date aggregations and `GeneratedFile` history | Role filters, previews, history tables, CSV downloads | Consolidation tests and browser verification | Implemented |
| FR-39 | Server pagination/filter/sort | `queryService.js` and paginated request, approval, budget, accounting, Treasury, master, audit, report endpoints | `usePaginatedResource`, controlled `DataTable` | Frontend remote-query test and live network checks | Implemented |
| FR-40 | Consistent API errors | `AppError`, `errorHandler.js`, canonical code/message/details payload | API client exposes clear code/message; toasts/dialog feedback | Integration and browser error checks | Implemented |
| FR-41 | Security hardening | JWT/bcrypt, inactive check, Helmet, allow-list CORS, rate limit, sanitation, upload signatures, protected files | Semantic controls, focus states, no public file links | Permission/file-access tests | Implemented |
| FR-42 | Organized local file storage | `storageService.js`, protected download service, generated export directories | Authenticated preview/download controls | Traversal/role access tests | Implemented |
| FR-43 | Transaction/idempotency boundaries | `transactionService.js`, unique indexes and idempotent financial services | Duplicate submissions prevented with loading states | Financial lifecycle suite | Implemented |
| FR-44 | Safe master-data lifecycle | Active/inactive lifecycle and guarded destructive behavior | Shared modal/panel forms, validation, warnings | API and live-role checks | Implemented |
| FR-45 | Responsive, accessible office UI | N/A | Collapsible/mobile nav, portal menus/action sheet, focus management, reduced motion, tables | Menu tests and responsive browser screenshots | Implemented |
| FR-46 | Development scenarios | Idempotent seed for roles, rules, four banks, periods, FX, and lifecycle cases | Scenarios visible by role | Seed run and data verification | Implemented |
| FR-47 | Documentation and limitations | Migration/operations docs and honest adapter contracts | Bilingual user manual | Document render/audit | Implemented |

## Automated Requirement Set

The mandatory 33 backend scenarios are implemented in `backend/test/financialLifecycle.test.js`, with supporting permission, foundation, workflow, upload, FX, and audit tests in the other backend test files. Frontend contract and action-menu keyboard tests are under `frontend/test`.

The real SUNAT connection, direct SIRE submission, certified proprietary bank layouts, and certified legal signature remain external dependencies. Their internal adapter boundaries are implemented, but they cannot safely be marked certified without UMA/vendor specifications.
