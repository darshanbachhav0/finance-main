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
(`ROLE_PERMISSIONS`). On a manager-chain request any approver, whatever their role, may finalize
or send the approval to their own jefe (`forward: true` in `decideApproval`) — see §3.3. Each role's `approvalLevel` (`AREA_DIRECTOR` / `VICE_RECTOR`) is implied by the role
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
- **ManagementViewer** — management portal only: the read-only aggregate API
  (`/api/management/v1`) and its portal screen. No internal Reports, dashboards, audit or request
  data (the internal API gate refuses it), and it can never be granted any other permission.

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
  SUNAT/XML validation) → accounting → treasury → payment → reconciliation → close. Wherever quotations apply (`DocumentRule`), **at
  least one** supplier quotation with evidence is required; there is no minimum amount and three
  quotations are not compulsory — the requester adds or removes quotations freely. The former
  single-source quotation exception was retired with the three-quotation rule, and legacy rules
  that still store "3" are normalized to 1 (`documentRuleService.QUOTATION_MINIMUM_COUNT`).
  A1 requests whose expense nature is never bought through an order (`TRAVEL`, `RESEARCH`,
  `PETTY_CASH`, `REIMBURSEMENT_LIQUIDATION`) report procurement readiness as *not applicable*
  (`procurementReadinessService.requiresPurchaseOrder`) and go from budget commitment straight to
  Accounting's invoice (XML/SUNAT) processing and provisioning without a Purchase Order.
  **Purchase Order closure:** invoicing is complete when the request is **closed** (`CERRADO`,
  every obligation paid and reconciled). At that moment the order's uninvoiced remainder is
  cancelled (order status `CLOSED`, `cancelledAmount`) and the never-executed part of the budget
  commitment is released back to its Cost Center / plan, both audited. A remaining order balance
  therefore no longer blocks closure. Voiding a request cancels its order (`CANCELLED`) and releases
  its commitment.
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
  (`REEMBOLSO_SIN_SUSTENTO`).** An advance pays out first (against Account 14), then requires the
  employee to submit a rendition within a configurable deadline counted in **working days** from
  the actual payment date (default 10, `FinanceConfiguration` key `RENDITION_OVERDUE_DAYS`;
  weekends, Peruvian holidays and `UMA_EXTRA_HOLIDAYS` excluded; the deadline ends at the close of
  that Lima working day). Several advances may be open at once; a new advance is blocked only while
  the employee has a rendition past its deadline that is not submitted (`PENDING`, or `OBSERVED`
  and returned for correction). A rendition submitted and awaiting Accounting never blocks. A
  rendition can be `OBSERVED` (correctable, resubmit) or terminally `REJECTED`: the advance minus
  what the employee already returned becomes a recovery obligation (see §3.1), settled via
  reimbursement (bank operation number, date and amount) or payroll deduction,
  `POST /requests/:id/rendition/recover`. An undocumented reimbursement pays nothing up front: after
  approval the budget is committed, the employee submits the signed declaration with a verified
  reimbursement account, Accounting's approval provisions the payable, and Treasury pays it.

### 3.3 Approval routing

One engine, two identity sources, resolved in `backend/src/services/approvalRuleService.js`:

1. **Manager chain (primary, flexible).** If the requester has a `jefe` (supervisor) set in the
   organizational roster, the route starts with the requester's nearest *available* jefe (inactive
   or on-leave managers are skipped going up; if nobody is available, submission fails with a
   "contact the Admin" error). At every chain step the approving jefe chooses either **Approve and
   finalize** (the manager chain is complete at that level) or **Send to my jefe**
   (`forward: true`), which records the approval and only then adds the approver's own nearest
   available jefe as the next step. "Send to my jefe" is offered only while the current approver
   has such a jefe (`GET /approvals/:id/options`). Levels that were never asked are simply not on
   the route, so the history shows exactly who decided. Any *configured* policy stage
   (`ApprovalRule`) matching the request is appended after the chain and still applies after the
   chain is finalized, unless someone who approved in the chain already holds that
   role/approval level (it is then recorded as `SKIPPED`).
2. **Rule-based fallback.** If the requester has no `jefe` at all, a specifically configured
   `ApprovalRule` for the request's exact area/type/flow/amount is required. **There is no silent
   generic default anymore** — a missing supervisor with no matching rule is treated as a real
   master-data/configuration gap and submission is rejected with `APPROVAL_ROUTE_NOT_CONFIGURED`,
   naming the missing roster entry or rule so an administrator can fix it (Track B always has its
   own always-available expedited default and is unaffected by this gate).

Approval actions: `APPROVE` (advances the route), `OBSERVE` (non-terminal — the requester supplies
clarification and resubmits), `RETURN` (sends it back to the requester for correction), `REJECT`
(terminal — no further processing; any unexecuted budget/commitments are released). Submission
controls (documents, dimensions, XML, period) gate `APPROVE` only; an approver can always observe,
return or reject.

- **Resubmission** after `OBSERVE`/`RETURN` (or a withdrawal) re-resolves the route from scratch for
  the request's current amount, track, area and roster, and restarts at the first approver. The
  replaced route is kept in an `APPROVAL_ROUTE_RESET` audit entry.
- **Withdrawal.** The requester may withdraw a submitted request back to `BORRADOR`
  (`POST /requests/:id/withdraw`) while it is `PENDIENTE_APROBACION` and no step has been
  `APPROVED`. Open steps become `SKIPPED`, the approver's task and SLA alerts are resolved, and a
  `REQUEST_WITHDRAWN` audit entry is written.
- **Absence.** `User.onLeave` (set by Admin in Users, or by the user via `PUT /users/me/leave`) or
  deactivation moves every pending manager-chain step waiting on that user to their
  `User.substitute` when one is set and available (the step records `coveringFor`), otherwise to
  their nearest available jefe, with an `APPROVAL_REASSIGNED` audit entry and a notification to the
  new approver (Admin is notified when nobody is available). New submissions and "send to my jefe"
  resolve the same way, and the next level above a covering step is above the absent manager. On
  return from leave (or when the substitute changes) the covered steps are re-routed again
  (`reassignPendingApprovalsFor`), so they go back to the manager.
- **SLA in working days.** Due dates use the Peruvian working-day calendar
  (`businessCalendarService.addWorkingDays`: weekends, national holidays and `UMA_EXTRA_HOLIDAYS`
  excluded). `APPROVAL_SLA_WORKING_DAYS` (default 1, the former 24h) sets a chain step's SLA; a
  rule's `slaHours` is read as 24 per working day. An overdue step escalates after
  `SLA_ESCALATION_WORKING_DAYS` more working days (default 1) to the approver's own nearest
  available jefe (Management only if there is nobody above), and the requester is told the
  approval is overdue.
- **After final approval** every route — rule-based, manager-chain or Management-final — runs the
  automatic budget commitment (`commitApprovedRequestBudget`). A budget shortfall keeps the
  existing exception/observation/rejection behaviour; any other failure leaves the commitment to
  Budget's manual retry. The requester is notified that the request was approved.

## 4. Budget

`backend/src/services/budgetService.js`. A `BudgetRule` per dimension (cost center / expense type /
project) decides `mode` (`TRANSITIONAL` — informational only, never blocks — or `ACTIVE` — real,
enforced funds) and `exceptionStrategy` when a request would exceed availability:

- **`REJECT`** (the default for any unconfigured `ACTIVE` dimension) — hard rejection, audited, no
  `BudgetException` is created. There is no retry path; the requester must resubmit within budget or
  ask Finance to configure a different strategy for that dimension.
- **`REQUEST_BUDGET_INCREASE`** — creates a `BudgetException`, request goes to `OBSERVADO_PRESUPUESTO`
  until resolved. When Management approves it, the shortfall is **added to the budget automatically**
  (annual plan and the request's month, a legacy allocation, or the Cost Center's annual budget —
  audited as an `EXCEPTION_INCREASE` adjustment), so the retried commitment proceeds.
- **`EXTRAORDINARY_APPROVAL`** — creates a `BudgetException` that only **Management** may
  approve/reject (never Admin, never any other configurable role — `BudgetRule.exceptionApproverRole`
  can only ever be `"Management"` at the schema level). Budget prepares/reviews; Management decides.
  An optional `exceptionEscalationAmount` can require a second look above a threshold, but the
  authority is still Management either way — there is no higher role to escalate to.

**Exception workflow:** Budget (or Admin) reviews first (`REVIEWED`); Management can approve or reject
only a reviewed exception, and is notified — and counted on its dashboard — once the review is saved.
A resubmitted request whose previous exception was `REJECTED`, or `APPROVED` but now exceeded, gets a
**new** exception that `supersedes` the stale one (only one `PENDING` exception per request dimension
is allowed). A `PENDING` exception that became moot — the commitment later succeeded, or the budget
was released — is auto-resolved (`RESOLVED`) so it neither blocks closure nor inflates counters.

**TRANSITIONAL never blocks:** a larger invoice (e.g. USD at a higher rate) grows the informational
commitment instead of attempting an enforced top-up, and TRANSITIONAL usage is reported in the budget
overview's committed/executed/paid totals (`totals.transitional`) without reducing availability.

**Year-end carry-over** (`POST /budget/year-end/carry-over`, Budget/Admin, confirmation dialog in
Budget Control): every commitment of the fiscal year that is still open (committed, not yet executed
by an invoice) moves with its funds into January of the next year's plan/allocation for the same
dimension (created if missing). Executed/paid history stays in the closing year. It is audited and
idempotent — running it again changes nothing.

An annual/monthly `BudgetAllocation` ("budget plan") always forces `ACTIVE` mode for its dimension
regardless of the cost center's own default. Committed → executed → paid amounts are tracked
per-line and reversed symmetrically on cancellation/void (`releaseBudget`,
`reverseBudgetExecution`).

## 5. Accounting, Accounts Payable & Treasury

- **Provisioning** (`accountingService.js`) posts a balanced journal (expense/asset debit, AP
  credit, from `ExpenseType.accountNumber`; AP/bank/advance-transit/IGV/return-receivable accounts
  resolved via `AccountingMapping`) and creates an `AccountsPayable` record per request/invoice.
- **Accounting mappings** are maintained by Admin and Accounting in *Configuration → Accounting
  mappings* (`/configuration/accounting-mappings`, backed by `/api/accounting-mappings`, which only
  those two roles can read or write; every change is audited and records are deactivated, never
  deleted). A mapping has a purpose (`ACCOUNTS_PAYABLE`, `BANK`, `ADVANCE_TRANSIT`, `IGV`,
  `RETURN_RECEIVABLE`, `SUPPLIER_CREDIT`, `EXCHANGE_GAIN`, `EXCHANGE_LOSS`), an account and
  sub-account, and optional request-type / expense-nature / bank / currency scopes (`*` = any).
  `EXCHANGE_GAIN`/`EXCHANGE_LOSS` must be configured for USD payments to post exchange differences.
- **Cancelling an unpaid CXP** (`POST /accounting/accounts-payable/:id/cancel`, Admin/Accounting) is
  only possible while it's `OPEN` or `SCHEDULED` (no money has moved) — it posts a `REVERSAL` journal
  entry that exactly offsets the original provision and moves the budget back to committed. A
  partially paid or fully paid CXP cannot be cancelled this way — real money has moved, so it is
  corrected with a supplier credit note instead.
- **Credit and debit notes** (`adjustmentNoteService.js`): every note is linked to its original
  voucher (from the XML reference or chosen by Accounting) and reverses the matching accounting
  amount. A credit note on an unpaid invoice reduces its outstanding balance; on a paid invoice the
  paid part becomes a `SupplierCredit` (receivable, mapping `SUPPLIER_CREDIT`) that is applied to a
  later invoice from the same supplier or recovered into the bank. A debit note increases the
  original payable. A note is never booked as a new payable.
- **Scheduling & payment**: Treasury resolves the payment destination (verified supplier bank
  account or the request's frozen employee-reimbursement snapshot for Track C/reimbursements),
  generates a BBVA fixed-width payment file (`POST /treasury/batch` — **BBVA is the only source
  bank that can generate an outbound file**; see §6), then confirms the actual bank operation.
  Confirming an amount less than the outstanding balance records a **partial payment**
  (`AP_STATUS.PARTIALLY_PAID`); each confirmation posts a journal for exactly that amount, in the
  actual payment date's month, keyed on the CXP + bank operation number (a repeated operation
  number is refused with 409). Treasury can put the unpaid remainder into a new BBVA file.
- **Payment cycle**: payments run on the 15th and 30th (last day in February). Scheduling defaults
  to the next cycle date; another date needs an audited reason; past dates are refused.
- **Bounced payments** carry a reason category. `BANK_DETAILS` (incorrect/invalid/changed/unverified
  data) flags the destination account `OBSERVED` until Accounting re-verifies it and requires a
  signed CCI letter to reprogram; `TECHNICAL` on a still-verified account is retried without a
  letter. Track C/reimbursement destinations are refreshed from the employee's current verified
  profile on reprogram.
- **Cancelling a generated file** (`POST /treasury/bank-files/:id/cancel`, whole file or selected
  items, audited, reason required) is allowed only before any payment in it is confirmed; the CXPs
  return to the queue without a bounce.
- **Detracciones (SPOT)**: UMA is not an IGV withholding agent, so no IGV retention is applied.
  When an expense type carries a SPOT category (configurable `SpotCategory` table seeded from
  R.S. 183-2004/SUNAT) and the operation exceeds its threshold, the BBVA file pays the net amount
  and Treasury records the Banco de la Nación deposit separately (`POST
  /treasury/payables/:id/detraction-deposit`, constancia/date/amount). The CXP is `PAID` only after
  both; AP is debited for the full amount across the two balanced journals.
- **Reconciliation & close**: a bank-statement reconciliation record per paid CXP; a request closes
  once every CXP is reconciled (or, for Track C, once its rendition is `VALIDATED`, or `REJECTED` with
  the advance fully `RECOVERED`). A remaining Purchase Order balance does not block closure — it is
  released at closure (see §3.2).

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
alone only re-triggers bank-account verification, not full re-homologation. The person who
registered a bank account cannot verify it. The supplier's Banco de la Nación detracciones account
(`Supplier.detractionAccount`) receives SPOT deposits and is never a BBVA transfer destination.

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

**SIRE**: validates the period's payables and generates SUNAT's official RCE replacement TXT
(Anexo 11, official file name; cancelled CXPs excluded) — see `OPERATIONS.md` §1. There is no direct
SUNAT submission — that remains a distinct, not-yet-built integration.

## 9. What's intentionally out of scope for this release

- Electronic submission of detracción deposits to Banco de la Nación (Treasury records the
  constancia of a deposit made outside the system).
- Direct SIRE/RCE submission to SUNAT (export/preparation only).
- Per-voucher SUNAT API validation without real production credentials (padrón-only baseline).
- Fixed-asset depreciation/amortization from CAPEX fields (`assetCategory`, `usefulLifeYears`,
  `npv`, `payback` are captured for approval-committee context and reporting only).
- BBVA/SUNAT production certification itself — those are external approvals this codebase cannot
  grant to itself; `BankFormatConfiguration.certified` and the SUNAT provider mode both stay in
  their honest, uncertified/unconfigured state until the real institution provides them.
