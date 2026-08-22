# UMA Integrated CAPEX / OPEX / Accounts Payable Management System

## Gap Analysis

Date: 2026-08-10

This analysis compares the tracked application and the current local MongoDB data with the final production-oriented requirements. It is intentionally based on the code and data that exist in this repository, not only on earlier documentation.

> **Implementation disposition:** This table is the required pre-change baseline and is intentionally preserved as the historical audit of what was found. The resulting implementation status, code locations, tests, and unavoidable external limitations are recorded in `docs/REQUIREMENTS_TRACEABILITY.md` and `docs/EXTERNAL_INTEGRATIONS.md`.

Baseline verification before modification:

- Backend tests: 15 passed, 0 failed.
- Frontend tests: 4 passed, 0 failed.
- Frontend production build: passed.
- Current database: 7 requests, 3 suppliers, 2 cost centers, 11 accounting-entry rows, 5 generated files.
- Historical statuses currently present: `PENDIENTE_APROBACION`, `PROCESADO_BANCO`, `RENDICION_PENDIENTE`, and `LIQUIDADO_CERRADO`.

Status definitions:

- **COMPLETE**: implemented and materially consistent with the target requirement.
- **PARTIAL**: useful implementation exists but needs strengthening or extension.
- **MISSING**: no material implementation exists.
- **INCORRECT**: implementation conflicts with a core financial-control requirement.

| Requirement | Current implementation | Status | Required modification | Files/components affected |
|---|---|---|---|---|
| Existing React/Vite, Express, MongoDB stack | Existing modular React frontend and Express/Mongoose backend are working. | COMPLETE | Preserve the stack and established component patterns. | `frontend/`, `backend/` |
| Eight financial functional areas | Requests, suppliers, documents, approvals, budget, accounting, Treasury, SIRE/reports exist, but several are shallow. | PARTIAL | Complete each area while keeping one integrated lifecycle. | Routes, controllers, models, pages |
| One canonical request lifecycle | Central constants exist, but legacy and canonical aliases coexist and controllers assign `request.status` directly. | INCORRECT | Remove competing runtime statuses, add one transition graph/service, and route every status change through it. | `constants.js`, all workflow controllers, new `workflowService.js` |
| Canonical statuses | Most required values are listed, but `ENVIADO` is absent and `APROBADO_POR_PAGAR`, `PROCESADO_BANCO`, `LIQUIDADO_CERRADO` remain active runtime statuses. | INCORRECT | Adopt the canonical set; retain old values only in migration mapping/reporting. | `constants.js`, schema, UI options/status badges |
| Safe historical migration | No migration framework or status migration script exists. | MISSING | Add dry-run/apply migration with idempotent marker and manual-review report for ambiguous records. | New `backend/scripts/migrateCanonicalWorkflow.js`, migration model/report |
| Atomic `SOL-YYYY-XXXXX` request number | Number uses `Date.now()` tail in a schema hook; formatting is seven digits and atomic uniqueness is not guaranteed. | INCORRECT | Add Mongo counter collection and atomic sequence service. Make request number immutable. | New `Counter.js`, `sequenceService.js`, request service/model |
| Request type versus expense nature | Separate fields exist, but values are human-language strings rather than stable canonical codes. | PARTIAL | Migrate toward canonical enum codes while accepting legacy values during migration. | `constants.js`, request model/UI, migration |
| Request header and PEN equivalent | Core fields exist. Exchange-rate date/source and source-currency amount are not snapshotted. | PARTIAL | Add FX metadata, requester/cost-center snapshots, project reference support, and immutable financial snapshots. | Request schema/services/UI |
| Requester Cost Center control | `User.costCenter` exists but create UI/controller permits any active Cost Center. | INCORRECT | Suggest/assign profile Cost Center and enforce authorized Cost Centers on the backend. | User/request models, permissions/request service/UI |
| Accounting lines | Cost Center, expense type, net, IGV and total are required. No budget item/project IDs or line-level FX snapshots. | PARTIAL | Add optional budget/project/subaccount dimensions, money normalization, and configured account validation. | Request schema, accounting mapping/rule services, wizard |
| Configurable accounting mappings | Expense types contain account/category, but special accounts `10` and `14` are hard-coded in accounting service. | INCORRECT | Add accounting-mapping master data for AP, bank, transit, deductible/non-deductible and tax accounts. | New `AccountingMapping.js`, accounting service, master-data routes/UI |
| Decimal-safe monetary math | Money is stored/calculated with JavaScript `Number` and `toFixed`. | INCORRECT | Centralize integer-minor-unit/decimal helpers and consistent two-decimal rounding at boundaries. | New `money.js`, financial services/models/tests |
| Configurable document-rule engine | A centralized pure function exists, but rules are hard-coded and not administrable. | PARTIAL | Add `DocumentRule` model/service and seeded defaults; keep fallback rules for migration safety. | New model/service/routes/UI, `requestRules.js` |
| Required evidence | Goods/services/professional fees/petty cash/reimbursement rules partly exist. Purchase order applicability and stable code taxonomy are incomplete. | PARTIAL | Seed complete rule matrix and return structured missing-document details. | Document-rule service, request/approval services, wizard |
| XML parsing and backend validation | XML is parsed backend-side and RUC/net/IGV/total are compared. Document number/date matches are not enforced; failed validations are not persisted. | PARTIAL | Store structured match booleans/errors/metadata and failed attempts; compare fiscal number and date when available. | XML service, request schema, audit/validation model, UI |
| Safe XML/file processing | Parser is local and no external entity resolution is used, but upload MIME/content checks are weak and files land in one root directory. | PARTIAL | Validate extension and MIME signatures, organize storage by domain/entity, sanitize paths, and clean rejected temporary files. | Upload middleware/storage service |
| SUNAT provider abstraction | No `SunatProvider`; BCRP online rate is directly exposed. | MISSING | Add MOCK/MANUAL/PRODUCTION-provider interface; production placeholder must report not configured. | New integration services/config/docs |
| Exchange-rate authority and history | PEN=1 and USD lookup/manual rates exist. BCRP/SBS result is displayed, but rate source/date are not fully snapshotted per request. | PARTIAL | Add configurable provider, label BCRP as non-SUNAT fallback, require applicable date, and preserve manual authorization. | FX provider/service/model/UI/docs |
| Supplier identifier and master | Unique RUC/DNI, onboarding data, documents and pending status exist. Identifier type, phone, taxpayer/homologation fields are incomplete. | PARTIAL | Normalize identifier, add explicit status fields and reviewer decision metadata. | Supplier model/service/controller/UI/migration |
| Supplier homologation | Accounting/Admin can validate and activate after documents/compliance. Status uses `ACTIVE` instead of canonical `HOMOLOGATED`. | PARTIAL | Separate active flag from homologation status and preserve legacy compatibility in migration. | Supplier schema/service/UI |
| Supplier bank-account history | Embedded history exists, but prior active rows are not consistently deactivated and validity dates/currency are missing. Treasury reads current flat fields. | INCORRECT | Add durable bank-account records/history, one active account per context, reused CCI/account warnings, and payment snapshot selection. | New `SupplierBankAccount.js` or enriched subdocuments, supplier/Treasury services/UI |
| Approval routing configuration | Two stages and SLA constants are hard-coded. | MISSING | Add `ApprovalRule` model/service with amount, area, type, sequence, level, role and SLA. | New approval models/services/routes/UI |
| Approval actions | Approve/reject exist. Observe and return are absent. | PARTIAL | Add APPROVE/OBSERVE/RETURN/REJECT with required comments where applicable. | Approval service/controller/routes/UI |
| Segregation of duties | No requester-self-approval check. Admin can approve any stage without explicit override reason. | INCORRECT | Block self-approval; require and audit Admin override reason. | Permission/workflow/approval services/tests |
| Electronic sign-off | User, role, time, IP and generated reference are stored. No request snapshot hash or provider distinction. | PARTIAL | Add cryptographic snapshot hash and explicitly label as authenticated sign-off, not certified signature. | Audit/sign-off service, approval event schema/UI |
| SLA | A 24-hour due date exists per two hard-coded stages. Completion/result/severity are not stored or fully calculated. | PARTIAL | Drive SLA from approval rules; store start/due/complete/result and compute severity consistently. | Approval-rule/SLA services, models, dashboards/UI |
| Budget modes | Cost Center has TRANSITIONAL/ACTIVE. | PARTIAL | Move policy to dimensional budget rules while preserving Cost Center default. | Budget models/services/UI |
| Dimensional budget ledger | Budget is one annual number per Cost Center; commitment lines include expense type/project but balances do not. | INCORRECT | Add budget allocation/ledger by period/year, Cost Center, budget item/account and project. | New `BudgetAllocation.js`, enhanced commitments/services/UI |
| Budget exception strategies | Active mode only rejects insufficient budget. | PARTIAL | Configure REJECT, REQUEST_BUDGET_INCREASE or EXTRAORDINARY_APPROVAL; never silently over-execute. | Budget rule/service, workflow/UI |
| Independent budget state | Commitment status has reserved/without budget/executed/released but not complete canonical states/history. | PARTIAL | Add budget status enum/history and paid/closed timestamps. | Budget commitment model/service |
| Idempotent budget rollback | Existing release checks terminal states and is mostly idempotent. | PARTIAL | Make financial updates atomic/session-aware and audit each release/no-op outcome. | Budget service, transaction helper/tests |
| TXT is not payment | Current TXT generation creates payment accounting entries, executes and marks budget paid, and moves requests to `PROCESADO_BANCO` or rendition pending. | INCORRECT | TXT must only create a batch/instruction and transition to `TXT_GENERADO`; payment confirmation alone settles AP, posts payment, updates budget and transitions to `PAGADO`. | Treasury controller, accounting/budget services, new AP/batch/payment models, UI |
| Accounting fiscal validation | Fiscal fields, duplicate query, open-period check and composite unique request index exist. | PARTIAL | Normalize voucher keys, use explicit voucher entity/AP record, validate documents/dimensions through shared services. | Accounting service/models/controller/tests |
| Balanced journals | Each accounting-entry document is a single debit or credit line; provision and payment generation do not create balanced journals. | INCORRECT | Introduce journal header with balanced debit/credit lines and enforce equality before posting. | New/rewritten accounting models/service/UI/migration |
| Explicit Accounts Payable | Request status substitutes for AP; no AP entity exists. | MISSING | Add idempotent Accounts Payable entity and lifecycle OPEN/SCHEDULED/PAYMENT_FILE_CREATED/PAID/CANCELLED. | New model/service/routes/UI |
| Entrega a Rendir | Provision uses hard-coded Account 14; TXT prematurely changes status; rendition upload immediately creates an unbalanced expense debit and closes request. | INCORRECT | Post balanced advance, wait for confirmed payment, capture amounts/documents, validate rendition, clear Account 14, reconcile, then close. | Rendition/accounting/payment/workflow services, request schema/UI |
| Reembolso sin sustento | An expense type category exists, but the request path does not force a configured non-deductible mapping. | INCORRECT | Resolve configured non-deductible mapping and block normal deductible posting. | Accounting mapping/service/tests |
| Purchase order | Attachment type exists but no PO entity, sequence, generation or lifecycle. | MISSING | Add `PurchaseOrder` with atomic `OC-YYYY-XXXXX` sequence and internal document metadata. | New model/service/routes/UI |
| Treasury payable filters/scheduling | Queue and bulk selection exist, but it is request-based and has limited server filtering. No schedule entity/state. | PARTIAL | Use AP queue, add bank/currency/date/Cost Center/supplier/status filters and PROGRAMADO transition. | Treasury/AP services/routes/page |
| Bank adapter architecture | TXT separator changes by selected bank in one controller; formats are fabricated/demo and not labelled clearly. | INCORRECT | Add adapter interface and per-bank DEMO adapters/config specs. Persist checksum, batch number, status and selected bank-account snapshot. | New bank adapters/config, payment batch model/service/docs |
| Payment confirmation | Manual operation/date exists, but confirmed amount is absent and the payment journal/budget update already happened at TXT time. | INCORRECT | Move settlement, balanced payment journal and budget paid update to idempotent confirmation transaction. | Payment service/controller/models/UI/tests |
| Reconciliation | `CONCILIADO` is listed but no reconciliation endpoint/entity/UI exists. | MISSING | Add manual reconciliation with reference, difference, comments, transition and audit. | New reconciliation service/routes/page/detail section |
| Accounting periods | OPEN/CLOSED administration exists, but opened metadata/comments are absent. | PARTIAL | Add opened/closed metadata, comments, policy configuration and audit. | Period model/service/controller/UI |
| Central closed-period guard | `ensurePeriodOpen` only checks closed periods and is called in several paths. Missing period is allowed; blocked attempts are not audited; master data paths bypass it. | INCORRECT | Add one action-aware guard with structured error code/details and blocked-action audit. Apply to all financial mutation services. | Period guard, error/audit middleware/services/controllers/tests |
| Month-end consolidation | Cost Center/expense aggregation and CSV/history exist. It is request-based and lacks debit/credit/source-total reconciliation. | PARTIAL | Aggregate posted journals, include source/centralization totals/difference, and block final export/close when non-zero. | Accounting/report services/controller/UI |
| SIRE/RCE | XML-backed preview, warnings, CSV and history exist. | PARTIAL | Add explicit preparation adapter, structured eligibility/errors, and documentation that direct submission is absent. | SIRE service/controller/UI/docs |
| Immutable audit | Insert-only model middleware exists and there are no routes to modify audit. Coverage is incomplete and no viewer exists. | PARTIAL | Expand schema, append audit for all critical/blocked actions, add authorized read-only viewer. | Audit model/service/routes/page/tests |
| Permission-based RBAC | Backend route role checks exist for five roles. Budget and management roles/permissions do not exist. | PARTIAL | Add permission catalog while preserving role names; add Budget and Management roles. | Constants/user/auth middleware/routes/nav/seed/tests |
| Role dashboards | Five current roles have real-data dashboards. Budget and Management dashboards are absent; metrics depend on incorrect status semantics. | PARTIAL | Add new role dashboards and source metrics from AP/budget/payment services. | Dashboard service/controller/page |
| Request Detail completeness | Header, lines, attachments, workflow, approval, budget, fiscal, bank and rendition sections exist. AP, balanced journals, XML match details, payment batch, reconciliation and full audit are absent. | PARTIAL | Expand detail API and UI with all related entities and permission-driven actions. | Request detail service/controller/page |
| Notifications | Task bell computes counts on demand. No persistent/deduplicated notification model. | PARTIAL | Add notification entity/service with deterministic event keys and read state. | New model/service/routes/layout UI |
| API pagination/filter/sort | Frontend tables paginate client-side after APIs load complete collections. | MISSING | Add reusable backend query parser and paginated endpoints for high-volume collections; keep compatibility response shape during rollout. | Query service, list controllers, DataTable/pages |
| Consistent API errors | Responses are `{message, details}` and codes are absent. | INCORRECT | Return `{success:false, code, message, details}` and map Mongo/validation/security errors. | `AppError.js`, error middleware, API client/UI |
| Security hardening | JWT, bcrypt, inactive-user check, Helmet, development CORS, login rate limit and filename sanitization exist. MIME verification, body sanitation, production CORS and secret enforcement need work. | PARTIAL | Add validation/sanitization middleware, strict production secret/CORS checks, MIME signatures, safe download route and body limits. | App/middleware/config/storage/tests |
| File storage organization | Files are uniquely named but stored in a single upload root; generated files use subdirectories. Physical server paths are stored in MongoDB. | PARTIAL | Introduce storage service with request/supplier/generated directories and keep private physical paths out of API serialization. | Upload/storage service, schemas/controllers/migration |
| Idempotency and transactions | Some existence checks prevent duplicate budget/entry operations. Multi-document flows are not transactional. | PARTIAL | Add idempotency keys/unique indexes and transaction helper with standalone-development fallback. | Transaction helper and financial services/tests |
| Required indexes | Some unique and query indexes exist. AP, batches, notifications, approvals, audit request/time, FX currency/date and supplier normalized ID indexes are absent. | PARTIAL | Add indexes with migration-time duplicate checks. | Models/migration report |
| Master data lifecycle | Suppliers/users are deactivated, but generic master-data delete physically removes Cost Centers, expense types, FX and periods. | INCORRECT | Replace destructive deletion with active/inactive or guarded deletion where history exists. | Master-data controller/routes/UI |
| Seed coverage | Six users and minimal master data exist. No Budget/Management users, approval/document/budget rules, AP/batch/reconciliation scenarios or full workflow fixtures. | PARTIAL | Add development-only, idempotent reference seed and separate opt-in scenario seed. | Seed scripts/docs |
| Automated backend tests | 15 tests cover basic permissions/documents/FX and one integration path. Most required financial scenarios are untested. | PARTIAL | Add the 33 required domain tests plus end-to-end scenario coverage. | `backend/test/` |
| Frontend tests | Four pure menu-navigation tests exist. | PARTIAL | Add role/navigation and critical workflow state tests using existing lightweight approach; verify live UI in browser. | `frontend/test/`, pages/components |
| External-integration limitations | README mentions BCRP and SIRE but lacks a formal limitations document and bank certification status. | MISSING | Add `docs/EXTERNAL_INTEGRATIONS.md`. | Documentation |
| Requirements traceability | No traceability document exists. | MISSING | Add `docs/REQUIREMENTS_TRACEABILITY.md`. | Documentation |
| User/operations documentation | Word manuals exist but README workflow is factually outdated and no current technical operations/backup guide exists. | INCORRECT | Update README and create actual-system manual covering architecture, workflow, security, backup and limitations. | `README.md`, `docs/USER_MANUAL.md` |

## Highest-Risk Existing Behavior

The following behavior must be corrected before the system can be described as production-oriented:

1. Bank TXT generation currently creates payment entries and executes/marks budget as paid before the bank confirms payment.
2. Accounting entries are individual unbalanced debit or credit rows rather than balanced journal transactions.
3. Status changes bypass a central transition service.
4. Historical `PROCESADO_BANCO` and `LIQUIDADO_CERRADO` records are ambiguous and cannot be blindly relabelled.
5. The current request number generator is not an atomic sequence.
6. Closed-period blocks are not centrally audited.
7. Supplier bank details are not snapshotted into a durable payment instruction.

## Preservation Decisions

- Keep React, Vite, Express, MongoDB, JWT, bcrypt, local storage, Floating UI, Lucide, the current responsive shell, data table and action-menu components.
- Preserve existing request and generated-file records. Migration will add canonical fields and manual-review markers without deleting old data.
- Preserve BCRP retrieval as an explicitly non-authoritative configurable fallback; do not label it SUNAT.
- Preserve local file URLs where existing records depend on them while routing new files into organized storage.
- Preserve current roles and add permission capabilities and optional Budget/Management profiles without invalidating existing users.
