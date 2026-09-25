# UMA Finance Platform — Architecture & Business Workflow

This is the current, code-verified description of how the platform works. It replaces the
~35 historical planning/phase-completion documents that used to live in `docs/` — those tracked
work-in-progress at various points in the project's history and had drifted out of sync with the
actual implementation. This document, `OPERATIONS.md`, `ROLE_PERMISSIONS_GUIDE.md`, and the root
`README.md` are the maintained set going forward.

## 1. System overview

A Node.js/Express + Mongoose backend (`backend/`) and a React 18 + Vite frontend (`frontend/`)
implementing a financial-request lifecycle for a Peruvian university (UMA): request intake →
multi-stage approval → budget commitment → procurement / invoice registration → accounting →
treasury payment → reconciliation → closure, plus supplier management, SUNAT tax-authority
integration, and audit history throughout.

Shared logic that both the backend and its Mongoose models need (canonical status mapping,
financial-progress derivation, budget-planning math, payment-terms math, line-amount math) lives in
`shared/*.mjs` and is imported by both `backend/src` and the model layer.

## 2. Roles

Ten stored roles (`backend/src/utils/constants.js`, `ROLES`): `Admin`, `Solicitor`, `AreaDirector`,
`ViceRector`, `Accounting`, `Treasury`, `Budget`, `Procurement`, `Management`, `ManagementViewer`.
`AreaDirector` and `ViceRector` are distinct roles with identical permissions
(`ROLE_PERMISSIONS`) — the only difference is directional: an Area Director's approval on a
manager-chain request can be forwarded up to the Vice-Rector (`forward: true` in
`decideApproval`), but the Vice-Rector, sitting at the top of that pair, has no further level to
forward to. Each role's `approvalLevel` (`AREA_DIRECTOR` / `VICE_RECTOR`) is implied by the role
itself and set automatically by the backend, not chosen separately by Admin. Permissions are
role-based with a per-user `permissions` override array for exceptions. See
`docs/ROLE_PERMISSIONS_GUIDE.md` for the full capability matrix and per-role walkthrough — this
section only summarizes each role's purpose:

- **Admin** — technical administration, master data, audited exception handling. Deliberately
  *cannot* approve a budget exception or certify a bank format on Management's/Treasury's behalf;
  Admin's overrides are always a distinct, audited action, never a silent bypass. Assigns every
  user's role, including Area Director and Vice-Rector, from the Users administration screen.
- **Solicitor** — creates and owns requests, drafts, renditions, supplier proposals.
- **AreaDirector** — first-level approval decisions for their area's requests; has a "My Team"
  view over their direct reports; can forward an approval up to the Vice-Rector.
- **ViceRector** — same permissions as Area Director; the escalation target an Area Director can
  forward to, and the final approval level in that pair (cannot forward further).
- **Accounting** — supplier homologation, fiscal/XML processing, Accounts Payable, journals,
  periods, SIRE export, rendition review.
- **Treasury** — payment scheduling, BBVA bank-file generation, payment confirmation,
  reconciliation, BBVA format certification (with Admin).
- **Budget** — allocations, commitments, budget exceptions (prepares them; only Management
  decides), budget reporting. Does **not** issue Purchase Orders — that's Procurement.
- **Procurement** — issues Purchase/Service Orders once a request is approved and budget-committed
  (Track A1), tracks invoices registered against open orders, has its own dashboard.
- **Management** — executive reporting, and the sole authority that may approve/reject a
  configured budget exception.
- **ManagementViewer** — strictly read-only: the external aggregate API, plus internal Reports and
  Audit history. Never has a write/mutation permission of any kind.

## 3. The request lifecycle and the "triple-track" workflow

### 3.1 Canonical parent status

A `FinancialRequest`'s top-level `status` follows one spine (`shared/workflowStatus.mjs`,
`REQUEST_LIFECYCLE`):

```
BORRADOR → PENDIENTE_APROBACION → APROBADO → COMPROMISO_PRESUPUESTAL → CONTABILIZADO
→ PROGRAMADO → TXT_GENERADO → PAGADO → CONCILIADO → CERRADO
```

Branch/exception states off that spine: `OBSERVADO`, `OBSERVADO_PRESUPUESTO`, `OBSERVADO_SUNAT`,
`OBSERVADO_MONTO_EXCEDIDO`, `OBSERVADO_CARGA_MASIVA`, `DEVUELTO` (all correctable — the request goes
back through the same or an earlier checkpoint and can be resubmitted), and the terminal states
`RECHAZADO` (rejected) and `ANULADO` (voided). The full legal-transition graph is in
`backend/src/services/workflowService.js`; `shared/workflowStatus.mjs`'s simplified list above is
the UI-facing canonical spine, not a separate state machine — every branch state ultimately either
returns to the spine or terminates.

Approval-step state, Accounts Payable state, and rendition state are tracked on their own child
objects/records, never by overloading the parent `status`:

- **Approval route** — `request.approvalRouteSnapshot[]`, each step's own `status`
  (`PENDING`/`APPROVED`/`NOT_REACHED`/`SKIPPED`/etc.), independent of the parent status.
- **Accounts Payable (CXP)** — `AccountsPayable.status`: `OPEN → SCHEDULED → PAYMENT_FILE_CREATED
  → PARTIALLY_PAID → PAID` (or `PAYMENT_BOUNCED`, or `CANCELLED` for an unpaid obligation). A
  request only reaches parent `PAGADO` once every one of its CXPs is fully (not partially) paid.
- **Rendition (Track C accountability)** — `request.rendition.status`:
  `NOT_REQUIRED/PENDING/SUBMITTED/OBSERVED/VALIDATED/REJECTED`, plus its own `recovery` sub-object
  when a rejection requires recovering an already-disbursed advance. A request cannot reach `CERRADO`
  until its rendition is `VALIDATED`, or `REJECTED` with the recovery fully settled.

No user ever manually forces a parent status; every transition is the result of a real business
action or financial evidence (`assertTransitionControls`/`getFinancialProgress` in
`workflowService.js` / `financialProgressService.js` re-derive and validate the target status from
the actual child records before allowing it).

### 3.2 Tracks A1 / A2 / B / C

- **A1 — standard procurement** (default track). Full path: submission → approval → budget
  commitment → Procurement issues a Purchase Order → invoice registered against the order (with
  SUNAT/XML validation) → accounting → treasury → payment → reconciliation → close. Requires 3
  quotations for goods/services above the configured threshold (`DocumentRule`).
- **A2 — batch invoicing against an existing order.** Not created as a new request; it is produced
  by uploading a ZIP/XLSX invoice batch against an already-approved A1 Purchase Order
  (`/batch-invoices`), processed asynchronously by `backend/src/workers/batchInvoiceWorker.js`.
  Valid invoices post automatically; invalid ones become `InvoiceObservation`s for Accounting to
  resolve. **Requires the batch worker to actually be running** — see `OPERATIONS.md`.
- **B — direct payment.** Skips A1's Purchase Order/quotation steps for a configured exception case
  (e.g. a small recurring service payment) — but **only when a matching, Admin-configured
  `DirectPaymentEligibilityRule` exists** for the request's area/expense-nature/amount
  (`/configuration/direct-payment-eligibility`). Absent a matching rule, submitting via Track B is
  rejected outright; there is no free choice or hardcoded fallback threshold. When eligible, the
  invoice/XML is validated up front and the request auto-provisions to Treasury on approval.
- **C — advances (`ENTREGA_RENDIR`) and undocumented reimbursements
  (`REEMBOLSO_SIN_SUSTENTO`).** Pays out first (an advance against Account 14), then requires the
  employee to submit a rendition (accounting for how the advance was spent) within a configurable
  deadline (default 10 calendar days, `FinanceConfiguration` key `RENDITION_OVERDUE_DAYS`) before a
  new advance can be requested. A rendition can be `OBSERVED` (correctable, resubmit) or terminally
  `REJECTED` (the full advance becomes a recovery obligation — see §3.1 — resolved via
  reimbursement or payroll deduction, `POST /requests/:id/rendition/recover`).

### 3.3 Approval routing

One engine, two identity sources, resolved in `backend/src/services/approvalRuleService.js`:

1. **Manager chain (primary).** If the requester has a `jefe` (supervisor) set in the organizational
   roster, the full chain (jefe, jefe's jefe, …) is resolved and frozen at submission time, then
   augmented with any *configured* policy stage (`ApprovalRule`) not already covered by someone in
   the chain. This is what makes the "manager chain vs. rule-based" split largely academic in
   practice — the chain is enriched with policy, not replaced by it.
2. **Rule-based fallback.** If the requester has no `jefe` at all, a specifically configured
   `ApprovalRule` for the request's exact area/type/flow/amount is required. **There is no silent
   generic default anymore** — a missing supervisor with no matching rule is treated as a real
   master-data/configuration gap and submission is rejected with `APPROVAL_ROUTE_NOT_CONFIGURED`,
   naming the missing roster entry or rule so an administrator can fix it (Track B always has its
   own always-available expedited default and is unaffected by this gate).

Approval actions: `APPROVE` (advances the route), `OBSERVE` (non-terminal — request stays at the
current checkpoint for the requester to supply clarification, then returns to the same checkpoint),
`RETURN` (sends it back to the requester/previous stage for correction), `REJECT` (terminal — no
further processing; any unexecuted budget/commitments are released).

## 4. Budget

`backend/src/services/budgetService.js`. A `BudgetRule` per dimension (cost center / expense type /
project) decides `mode` (`TRANSITIONAL` — informational only, never blocks — or `ACTIVE` — real,
enforced funds) and `exceptionStrategy` when a request would exceed availability:

- **`REJECT`** (the default for any unconfigured `ACTIVE` dimension) — hard rejection, audited, no
  `BudgetException` is created. There is no retry path; the requester must resubmit within budget or
  ask Finance to configure a different strategy for that dimension.
- **`REQUEST_BUDGET_INCREASE`** — creates a `BudgetException`, request goes to `OBSERVADO_PRESUPUESTO`
  until resolved.
- **`EXTRAORDINARY_APPROVAL`** — creates a `BudgetException` that only **Management** may
  approve/reject (never Admin, never any other configurable role — `BudgetRule.exceptionApproverRole`
  can only ever be `"Management"` at the schema level). Budget prepares/reviews; Management decides.
  An optional `exceptionEscalationAmount` can require a second look above a threshold, but the
  authority is still Management either way — there is no higher role to escalate to.

An annual/monthly `BudgetAllocation` ("budget plan") always forces `ACTIVE` mode for its dimension
regardless of the cost center's own default. Committed → executed → paid amounts are tracked
per-line and reversed symmetrically on cancellation/void (`releaseBudget`,
`reverseBudgetExecution`).

## 5. Accounting, Accounts Payable & Treasury

- **Provisioning** (`accountingService.js`) posts a balanced journal (expense/asset debit, AP
  credit, from `ExpenseType.accountNumber`; AP/bank/advance-transit/IGV/return-receivable accounts
  resolved via `AccountingMapping`) and creates an `AccountsPayable` record per request/invoice.
- **Cancelling an unpaid CXP** (`POST /accounting/accounts-payable/:id/cancel`, Admin/Accounting) is
  only possible while it's `OPEN` or `SCHEDULED` (no money has moved) — it posts a `REVERSAL` journal
  entry that exactly offsets the original provision and moves the budget back to committed. A
  partially paid or fully paid CXP cannot be cancelled this way — real money has moved, so it needs a
  refund/credit-note process, which is intentionally outside this system's current scope.
- **Scheduling & payment**: Treasury resolves the payment destination (verified supplier bank
  account or the request's frozen employee-reimbursement snapshot for Track C/reimbursements),
  generates a BBVA fixed-width payment file (`POST /treasury/batch` — **BBVA is the only source
  bank that can generate an outbound file**; see §6), then confirms the actual bank operation.
  Confirming an amount less than the outstanding balance now records a **partial payment**
  (`AP_STATUS.PARTIALLY_PAID`) — the CXP stays open for the remainder rather than requiring one
  all-or-nothing confirmation.
- **Bounced payments**: reopens the CXP to `OPEN` with its bank-account snapshot cleared, requiring
  a signed replacement CCI letter — the next scheduling attempt re-resolves and re-verifies the
  destination account from scratch (there is no way to reuse an unverified snapshot).
- **Reconciliation & close**: a bank-statement reconciliation record per paid CXP; a request closes
  once every CXP is reconciled (or, for Track C, once its rendition is resolved).

## 6. Banks — source vs. beneficiary

Two distinct concepts, split into separate enums (`SOURCE_BANKS` / `BENEFICIARY_BANKS` in
`constants.js`) precisely because they used to be conflated:

- **Source bank** — which bank UMA can actually generate an outbound payment file through. Today
  that is **BBVA only** (`assertBbvaSource`); `BankFormatConfiguration` and `PaymentBatch.bank` are
  schema-restricted to it.
- **Beneficiary bank** — where a supplier or employee's own account can be held (BCP, BBVA,
  Interbank, Scotiabank, Banco de la Nación), paid via CCI interbank transfer regardless of the
  source bank.

## 7. Suppliers

`backend/src/services/supplierService.js`. Proposal (RUC/DNI-unique — a near-duplicate *legal name*
with a different RUC is surfaced as an advisory warning, never a hard block) → Finance compliance
review → homologation (assigns the permanent `PRV-####` code). Homologation now expires after a
configurable validity window (default 12 months, `FinanceConfiguration` key
`SUPPLIER_HOMOLOGATION_VALIDITY_MONTHS`) and is automatically reset to pending on a material
fiscal/legal field change or on reactivating a previously inactive supplier — a bank-account change
alone only re-triggers bank-account verification, not full re-homologation. Detraction-type bank
accounts are recorded for compatibility but cannot be newly selected for payment — there is no
complete detracción payment workflow yet.

## 8. SUNAT / SIRE integration

`backend/src/services/sunatService.js` selects a provider by `SUNAT_PROVIDER_MODE`:

- **`PADRON`** (the realistic production baseline) — validates taxpayer status/HABIDO against
  SUNAT's public national RUC registry, downloaded and indexed locally
  (`sunatPadronService.js`, refreshed by a dedicated worker — see `OPERATIONS.md`). It cannot
  validate an individual voucher (CPE), only taxpayer status.
- **`PRODUCTION`** — a real per-voucher SUNAT API client, but only if the actual endpoint/token env
  vars are configured; otherwise it safely degrades to a "not configured" 503 (now also flagged at
  server boot, not just discovered via a runtime error).
- **`MANUAL_EXCEPTION`** — a dedicated, audited human override
  (`POST /requests/:id/invoice/:voucherId/manual-sunat-override`, Admin/Accounting only, mandatory
  reason + evidence reference) for operational continuity during a SUNAT outage. It marks the
  voucher's status explicitly as `MANUAL_EXCEPTION` — non-authoritative, never silently treated as
  `VALID`.
- **`MOCK`** — development-only, always valid.

XML voucher validation itself (RUC/currency/amounts/date match) is fully offline and independent of
which SUNAT provider is active. Legal-representative lookup (Playwright scraping SUNAT's public
website) is a best-effort supplementary check during supplier onboarding — it never blocks supplier
creation and no financial transition depends on it succeeding.

**SIRE**: prepares and exports a CSV register of SIRE/RCE-eligible payables. There is no direct
SUNAT submission — that remains a distinct, not-yet-built integration.

## 9. What's intentionally out of scope for this release

- Automatic detracción (withholding) payment processing.
- Direct SIRE/RCE submission to SUNAT (export/preparation only).
- Per-voucher SUNAT API validation without real production credentials (padrón-only baseline).
- Fixed-asset depreciation/amortization from CAPEX fields (`assetCategory`, `usefulLifeYears`,
  `npv`, `payback` are captured for approval-committee context and reporting only).
- Refund/credit-note remediation for a partially or fully paid Accounts Payable record (only an
  *unpaid* CXP can be cancelled — see §5).
- BBVA/SUNAT production certification itself — those are external approvals this codebase cannot
  grant to itself; `BankFormatConfiguration.certified` and the SUNAT provider mode both stay in
  their honest, uncertified/unconfigured state until the real institution provides them.
