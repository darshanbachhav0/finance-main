# System Architecture

## Purpose and Boundaries

The UMA Integrated CAPEX / OPEX / Accounts Payable Management System is a modular monolith. It keeps the existing React/Vite frontend, Express backend, MongoDB database, and local file storage while centralizing authoritative financial rules in backend domain services.

```text
Browser (React/Vite)
        |
        | HTTPS/JSON + authenticated file downloads
        v
Express API (JWT, RBAC, validation, rate limits)
        |
        +-- Domain services and integration adapters
        |
        +-- MongoDB (transactional records, history, configuration)
        |
        +-- Local storage (uploads and generated files)
```

## Frontend

The frontend is under `frontend/src`.

- `App.jsx`: lazy-loaded routes and route-level role gates.
- `layouts/AppLayout.jsx`: responsive shell, grouped/collapsible navigation, breadcrumbs, language toggle, tasks, notifications, and user menu.
- `pages/`: role dashboards and operational screens.
- `components/DataTable.jsx`: reusable search, filters, sorting, pagination, selection, loading/empty states, and row actions.
- `components/RowActionMenu.jsx`: Floating UI portal positioning, viewport flip/shift, desktop menu, mobile action sheet, keyboard behavior, and focus restoration.
- `components/ConfirmDialog.jsx`: portalled, focus-managed confirmation and required-comment dialog.
- `hooks/usePaginatedResource.js`: server-driven table queries with cancellation and search debounce.
- `context/LanguageContext.jsx`: English source labels and complete Spanish dictionary.

Frontend permission checks improve usability but are not security controls. The API rechecks every protected action.

## Backend Layers

The backend is under `backend/src`.

### HTTP Layer

- `routes/`: authentication, requests, approvals, budget, accounting, Treasury, reports, SIRE, notifications, files, audit, users, suppliers, and master data.
- `controllers/`: request parsing and response composition; financial decisions are delegated to services.
- `middleware/auth.js`: JWT verification, inactive-user rejection, role/permission authorization.
- `middleware/upload.js`: safe generated names, MIME/extension allow-list, count and size limits.
- `middleware/sanitizeInput.js`: strips unsafe Mongo-style input keys.
- `middleware/errorHandler.js`: sanitized, consistent API errors.

### Domain Services

- `requestService.js`: draft/save/edit/submit/void/detail/list behavior.
- `workflowService.js`: the only canonical request transition graph and transition audit.
- `documentRuleService.js`: configurable required-document evaluation.
- `xmlValidationService.js`: safe XML metadata extraction and fiscal comparison.
- `supplierService.js`: identifier normalization, onboarding, homologation, and bank history.
- `approvalRuleService.js` and `approvalService.js`: configurable route, SLA, sign-off, SOD, and decisions.
- `budgetService.js` and `budgetOverviewService.js`: dimensional balances, commitments, exceptions, rollback, execution, and payment.
- `accountingService.js`: fiscal processing, voucher uniqueness, AP, balanced provision/payment/rendition journals.
- `treasuryService.js`: scheduling, bank batches, payment confirmation, and reconciliation.
- `renditionService.js`: advance/rendition validation and Account 14 clearing.
- `periodService.js`: centralized open-period guard and blocked-action audit.
- `sireService.js` and `exportService.js`: period validation, exports, and history.
- `auditService.js` and `notificationService.js`: append-only evidence and deduplicated tasks.
- `transactionService.js`: MongoDB transaction boundary with standalone-development fallback.

### Integration Adapters

- `integrations/sunat/`: mock, manual, and explicit not-configured providers.
- `integrations/banks/`: one common bank-file interface and BCP, BBVA, Interbank, and Scotiabank adapters.
- `integrations/sire/`: preparation/export boundary for a future official submission provider.

See `EXTERNAL_INTEGRATIONS.md` for certification limits.

## Core Data Model

`FinancialRequest` is the master workflow record. Independent financial entities prevent status from being overloaded:

- `ApprovalRule` and embedded approval events: route, decisions, SLA, sign-off.
- `BudgetAllocation`, `BudgetRule`, `BudgetCommitment`, `BudgetException`: budget dimensions and lifecycle.
- `AccountsPayable`: supplier liability and outstanding amount.
- `JournalEntry`: balanced accounting transaction with debit/credit lines.
- `PaymentBatch`: bank instruction and immutable bank-account snapshots.
- `Reconciliation`: bank matching after confirmed payment.
- `PurchaseOrder`: internal quotation-originated order reference.
- `SupplierBankAccount`: validity-dated history; previous bank data is retained.
- `XmlValidationAttempt`: successful and failed fiscal validation evidence.
- `AuditLog`: append-only application audit.
- `Notification`: deduplicated user task/alert event.
- `Counter`: atomic request, purchase-order, journal, and batch sequences.

Historical snapshots on the request, accounting line, AP, and payment item preserve the financial meaning even if master data changes later.

## Canonical Request State Machine

Only `workflowService.transitionRequest()` can change the canonical request status during normal application operation.

```text
BORRADOR
  -> EN_VALIDACION -> ENVIADO -> PENDIENTE_APROBACION
  -> APROBADO_DIRECTOR -> APROBADO_VICERRECTOR
  -> COMPROMISO_PRESUPUESTAL -> CONTABILIZADO
  -> PROGRAMADO -> TXT_GENERADO -> PAGADO
  -> CONCILIADO -> CERRADO
```

Controlled alternate states are `OBSERVADO`, `DEVUELTO`, `RECHAZADO`, and `ANULADO`. An advance request moves from `PAGADO` to `RENDICION_PENDIENTE`, then to `CONCILIADO` only after a valid rendition.

Every transition checks the graph, role/permission, approval level, accounting period, dimensions, supplier status, document/XML requirements, and relevant budget/fiscal/payment prerequisites. Every successful transition appends workflow and audit evidence.

## Financial Control Boundaries

### Money

Calculations use centralized minor-unit helpers and consistent two-decimal rounding. PEN uses rate 1. USD requests snapshot an exact dated exchange rate and PEN equivalent.

### Budget

Budget state is independent from request status. The source-of-truth service controls Assigned, Committed, Executed, Paid, and Available values by period, Cost Center, account/budget classification, and project. Commit/release/payment operations are idempotent.

### Accounting and CXP

Accounting processing requires approved workflow, documents, dimensions, and an open period. Voucher keys are normalized and uniquely constrained by supplier + voucher type + series + number. A journal cannot post unless total debit equals total credit.

### Treasury

Scheduling moves AP to `SCHEDULED`. Bank-file generation creates a payment instruction and `PAYMENT_FILE_CREATED` AP state, not payment. Actual bank confirmation creates the payment journal and settles AP. Reconciliation and closure are separate controls.

## Security

- JWT authentication and bcrypt password hashes.
- Inactive-user rejection and backend RBAC/permission checks.
- Segregation of duties: a requester cannot approve their own request.
- Audited Admin override requires a reason.
- Helmet headers, production CORS allow-list, body limits, login rate limiting.
- Upload extension, MIME, signature, filename, count, and size checks.
- Authenticated file-download route with record/role authorization and path-traversal protection.
- Sanitized errors do not expose stack traces or server paths to normal users.
- Production startup refuses a missing/default JWT secret.

## Storage and Deployment

MongoDB stores business records and file metadata. Physical files are organized under:

```text
backend/uploads/requests/{requestId}/
backend/uploads/suppliers/{supplierId}/
backend/generated/bank-files/
backend/generated/reports/
backend/generated/accounting/
```

The current application remains host-local. A Cloudflare Quick Tunnel can expose the production server temporarily, but it does not move MongoDB or files off the PC. Backups must include MongoDB, uploads, and generated files together.
