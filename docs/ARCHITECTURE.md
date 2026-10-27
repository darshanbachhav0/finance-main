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

Thirteen stored operational roles (`backend/src/utils/constants.js`, `ROLES`): `Admin`, `Solicitor`,
`AreaDirector`, `ViceRector`, `Accounting`, `Treasury`, `Procurement`, `Management` (Gerencia
General), `GAF`, `Legal`, `HumanResources`, `Auditor`, `ManagementViewer` (plus `SuperAdmin`, which takes part in no process; it only manages CECO budget
plans with Admin and Treasury). The former `Budget` role was
folded into `Treasury` (`RETIRED_ROLES`): users, previous roles and approval rules still stored as
`Budget` are moved to `Treasury` when the server starts (`services/legacyRoleService.js`, audited).
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
- **Treasury** — the budget (annual/monthly plans, rules, allocations, commitments, year-end
  carry-over, and preparing/reviewing budget exceptions — only Management decides them), payment
  scheduling, BBVA bank-file generation, payment confirmation, reconciliation, BBVA format
  certification (with Admin). Does **not** issue Purchase Orders — that's Procurement.
- **Procurement** — issues Purchase/Service Orders once a request is approved and budget-committed
  (Track A1), tracks invoices registered against open orders, has its own dashboard.
- **Management** — executive reporting, and the sole authority that may approve/reject a
  configured budget exception.
- **GAF** — Gerencia de Administración Financiera: approves the amount tier above 5 UIT and step 2
  of every Track D transfer (§3.3), and verifies bank files like Accounting (never one it generated).
- **Legal / HumanResources** — Asesoría Legal and Gestión de Personas: requesters of their own area
  (`REQUESTER_ROLES`), with the Solicitor's controls.
- **Auditor** — reads every workspace like the Super Admin (`READ_ONLY_OVERSIGHT_ROLES`; GET passes any
  guard an Admin passes, bank numbers masked) and writes nothing but its notification settings.
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

### 3.2 Tracks A1 / A2 / B / C / D

Requesters do not choose a track. A new request is one form in four steps, in the order the work
happens (`pages/RequestCreate.jsx`): **1. Datos de proveedor** (who is paid: a supplier of the
requester's area — searched on the server, or registered inline with its bank accounts — and the
supplier account it is paid into; or "Me" for an advance to render / undocumented reimbursement),
**2. Comprobante y automatización** (the factura's XML or PDF is read automatically — RUC, number,
issue date, currency, IGV, total — and checked or corrected by the requester; without a receipt the
request goes with the supplier's quote and the receipt is *pending*), **3. Detalles del
requerimiento** (description, why, purchase order or direct payment, expense type, priority
Alta/Media/Baja, frequency, requirement date, CECO, month, amount or items, the budget check) and
**4. Resumen y envío**. Track C has no receipt step. The answers decide the track — a supplier paid
through an order → A1, a supplier paid directly → B, money for the employee → C. A1 and B take a
supplier quote, the receipt or both, and more suppliers' quotes can be added. There is no separate
"full form": the one form keeps every field (optional ones under "More details").
The cost center, unit, an open month and the currency are filled in from the profile and the
supplier's account; a dropped invoice fills the amounts and item lines. Petty cash and
reimbursement are not expense types of a new request (they are Track C's). The title defaults to
the description's first line, the "risk if not approved" is optional, a supplier selection reason
is asked only when two or more quotations are compared, and the CAPEX planning fields are collapsed
below the `CAPEX_DETAILS_THRESHOLD` finance configuration (default PEN 50,000). Requesters see four
plain statuses (Draft, Waiting for approval, In process, Paid, plus "Needs your changes" / Rejected /
Cancelled) with one line saying what is needed from them; Finance roles keep the detailed statuses.

Every request records its payment `priority` P1 Crítica / P2 Urgente / P3 Normal / P4 Programada
(`shared/requestPriority.mjs`; + `priorityRank`, so lists sort P1 first; it never skips an approval
or control). P1 and P2 need an `urgencyJustification`; an optional `dueDate` (fecha de vencimiento)
moves P3/P4 to the last payment day before it (§5, payment cycle). Older Alta / Media / Baja are read
as P2 / P3 / P3 and moved once at server start (`legacyPriorityService`). `frequency` (`ONE_OFF`, `MONTHLY_RECURRING`, `EVERY_3_MONTHS`,
`ANNUAL_RENEWAL` — recorded only, nothing is repeated or paid automatically; OPEX keeps
`opexDetails.expenseFrequency` in step), `observations`, `paymentAccount` (the supplier account the
requester chose: bank, type, currency and last four digits only) and `invoiceDetails` (the receipt
as read or typed, `PENDING` when not issued yet; Accounting still validates the voucher itself).
The request page's "Resumen de solicitud" shows the requirement date and the receipt's issue date
(the registered voucher's, else the receipt read on the request, else "Pendiente"), in Lima time.
Request numbers (`SOL-YYYY-#####`) are taken when the request is saved, from one atomic counter, so
two people saving at once never share a number and a refused request takes none.

- **A1 — standard procurement** (default track). Full path: submission → approval → budget
  commitment → Procurement issues a Purchase Order → invoice registered against the order (with
  SUNAT/XML validation) → accounting → treasury → payment → reconciliation → close. A1 is sent
  with **a quote or the invoice, at least one** (`documentRuleService.QUOTE_OR_INVOICE`: any of
  QUOTATION, XML, PDF or FEE_RECEIPT); quotations entered are checked (each with its file, one
  recommended, a selection reason when two or more are compared), and the invoice can stand in for
  them (`quotationPolicy.invoiceInstead`). There is no minimum amount and three quotations are not
  compulsory — the requester adds or removes quotations freely. The former
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
- **B — direct payment.** Skips A1's Purchase Order step (e.g. a small recurring service
  payment). The requester chooses it; there is no eligibility rule by area, expense nature or amount
  (the former `DirectPaymentEligibilityRule` was removed). Like A1 it is sent with **a quote or the
  invoice, at least one**, and the Track B approval route applies. With a validated invoice it
  auto-provisions to Treasury on approval. Sent with only a quote, approval commits the budget and
  the request waits at `COMPROMISO_PRESUPUESTAL`; the requester is notified (`INVOICE_NEEDED`) and
  registers the invoice from the request (`POST /requests/:id/invoice`,
  `directInvoiceService.registerDirectPaymentInvoice`; owner, Accounting or Admin). It must match the
  approved amounts; the request is then provisioned to Treasury, which is notified.
- **C — advances (`ENTREGA_RENDIR`) and undocumented reimbursements
  (`REEMBOLSO_SIN_SUSTENTO`).** An advance is paid into the employee's verified reimbursement
  account: the preferred one, or the only verified one in that currency. Without one, the final
  approval keeps the request at `APROBADO` with the observation `REIMBURSEMENT_BANK_REQUIRED`, the
  employee is told to register the account (or Accounting to verify one waiting for review), and
  verifying the account (or choosing a verified one as preferred) provisions it automatically
  (`advanceBankHoldService`). The account is captured on the advance at approval; while nothing of
  the advance is scheduled or in a bank file, it follows the employee's current verified account:
  automatically when Accounting verifies a corrected account (or a verified one is chosen as
  preferred), and on demand with Treasury's "Use current bank account"
  (`POST /treasury/payables/:id/use-current-bank-account`), each audited
  (`ADVANCE_DESTINATION_REFRESHED`) with a Treasury notice (`advanceDestinationService`). A BBVA
  current account (employee or supplier) must have the account-number length the BBVA file
  format requires (`bbva.internalAccountLength`, 20 by default), checked when it is saved
  (`bankFileAccountRules`); other banks are paid by CCI. The automatic Track C steps run whatever the final approver's role
  (`automatic: true`, as for the other tracks). Track C lines carry no IGV: the model computes them
  IGV-exempt (`calculateRequestLineAmounts({ igvExempt })`), so the amount typed is the amount paid,
  and the form hides the IGV option. The employee's own paid advance has a simple view: one card
  saying what to do and by when, Summary / Receipts / History tabs, and a receipts form
  (`SimpleRenditionForm`). Each expense is a receipt with its photo or PDF (`rendition.receiptLines`,
  a factura's XML or PDF fills its details), transport without receipt (`mobilityLines`) or an
  expense without receipt (`unsupportedExpenseLines`); the money returned comes with its deposit
  slip (`returnDepositSlip`, a `RETURN_RECEIPT` attachment); the accounting line is built on the
  request's CECO with a factura's 18% IGV separated. Accounting keeps the full review view.
  Every request page opens with a "Your turn" card (`utils/nextStep.js`, `NextStepCard`) for the
  person whose step it is: approve, commit the budget, register the invoice, verify the bank file,
  pay, confirm, reconcile, close, settle a rendition balance or recover a rejected advance. Its
  button does the action or opens the exact section or screen. Accounting reviews a submitted
  rendition on that card (`RenditionReviewPanel`): the money, each receipt with its file, the
  deposit slip, the checks the server enforces, and Approve / Send back / Reject through the same
  endpoints. "My tasks" also lists payments to reconcile, requests ready to close, rendition
  balances to settle and advances to recover.
  Uploaded file names are decoded as UTF-8 (`utils/fileName.js`), and names stored before were
  repaired once at startup. An advance pays out first (against Account 14), then requires the
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

- **D — transfer between UMA's own accounts (`TRASPASO`).** Registered by Treasury (or Admin) from
  Payments › Transfers (`POST /api/treasury/transfers`, `services/treasuryTransferService.js`), never
  from the request form: a source and a destination among UMA's own accounts
  (`TreasuryBankAccount`, maintained by Treasury/Admin at `/api/treasury/accounts`, each with its
  class-10 ledger account), same currency (nothing is converted), purpose funding or placement
  (instrument and reference). It is sent straight to approval: a Treasury user other than the
  requester (`TREASURY_HEAD`), then the GAF. There is no supplier, budget, IGV or payable: on
  approval it stays `APROBADO` and Treasury is told to execute it. Treasury records the bank
  operation (`POST /transfers/:id/execute`: journal `TRANSFER`, debit destination, credit source, in
  the execution date's period) → `PAGADO`, then reconciles it with the statement
  (`POST /transfers/:id/reconcile`, a difference needs a comment) → `CONCILIADO` → `CERRADO`.
  `workflowService` gives D its own transitions (`APROBADO → PAGADO → CONCILIADO → CERRADO`) whose
  evidence is the execution and the reconciliation, not payables.

### 3.3 Approval routing

One engine, two identity sources, resolved in `backend/src/services/approvalRuleService.js`:

0. **Cost-center cascade (Manual técnico, "Ruta de aprobación").** When the request's CECO has a
   `responsible` (CostCenter: `parentCode`, `level` 2-7, `line`, `responsible`; loaded from
   `data/ceco-cascade.json` with `npm run import:ceco-cascade`), the route is fixed when it is sent
   (`resolveCostCenterRoute`): the CECO's responsible (`RESPONSIBLE`), then in a Por Encargo request
   the "visto" of each beneficiary CECO (`BENEFICIARY`), then the superior in the cascade
   (`SUPERIOR`: the Vicerrectorado, level 4, it depends on, else its parent's responsible; the
   responsible's jefe when the cascade names nobody), then the UIT tiers below. These are person
   steps (`source: MANAGER_CHAIN`, `fixed: true`, `costCenterRole`, `costCenterCode`), so leave,
   substitutes and SLA escalation work as for jefes, but their approver only approves: there is no
   "send to my jefe" and approving opens the next step. Each person once; a later fixed step whose
   person already approved is SKIPPED. Without a responsible on the CECO the jefe chain below applies.
1. **Manager chain (primary, flexible).** If the requester has a `jefe` (supervisor) set in the
   organizational roster, the route starts with the requester's nearest *available* jefe (inactive
   or on-leave managers are skipped going up; if nobody is available, submission fails with a
   "contact the Admin" error). At every chain step the approving jefe chooses either **Approve and
   finalize** (the manager chain is complete at that level) or **Send to my jefe**
   (`forward: true`), which records the approval and only then adds the approver's own nearest
   available jefe as the next step. "Send to my jefe" is offered only while the current approver
   has such a jefe (`GET /approvals/:id/options`). Levels that were never asked are simply not on
   the route, so the history shows exactly who decided. The first chain step is the cost center's
   responsible and carries `superiorRequired` (amount above `SUPERIOR_APPROVAL_UIT`, default 0 =
   always): while that approver has an available jefe, their approval is always sent up
   (`superiorApprovalRequired`; the options report `canFinalize: false`), so every request has the
   responsible's and their superior's approval.
   **Amount tiers.** After the chain the route carries role-based `tier` steps by the request's PEN
   amount in UIT (`approvalThresholds`: FinanceConfiguration `UIT_VALUE` 5,500, `GAF_APPROVAL_UIT` 5,
   `GENERAL_MANAGEMENT_APPROVAL_UIT` 20): `GAF` (role GAF) and `GENERAL_MANAGEMENT` (role
   Management). Finalizing the chain opens the next tier (`activateNextRouteStep`); a tier is
   `SKIPPED` when someone who already approved on the route holds its role. Any active user of the
   role other than the requester decides it (inbox pool, notification to the role); a tier with no
   such user refuses the submission with `APPROVAL_ROUTE_NOT_CONFIGURED`. Track D's route is two
   tiers, `TREASURY_HEAD` (role Treasury) then `GAF`.
2. **Rule-based fallback.** If the requester has no `jefe` at all, a specifically configured
   `ApprovalRule` for the request's exact area/type/flow/amount is required. **There is no silent
   generic default anymore** — a missing supervisor with no matching rule is treated as a real
   master-data/configuration gap and submission is rejected with `APPROVAL_ROUTE_NOT_CONFIGURED`,
   naming the missing roster entry or rule so an administrator can fix it (Track B always has its
   own always-available expedited default and is unaffected by this gate).

Approval actions: `APPROVE` (advances the route), `OBSERVE` (non-terminal — the requester supplies
clarification and resubmits), `RETURN` (sends it back to the requester for correction), `REJECT`
(terminal — no further processing; any unexecuted budget/commitments are released). The screens
offer three decisions: **Approve**, **Send back** (`OBSERVE`, or `RETURN` where only that is
allowed) and **Reject**; a manager-chain approver can also approve and send it to their own jefe.
The approval email's "Aprobar ahora" opens a one-page approval (`/approvals/:id`) with the request
summary, its documents and those three decisions. Submission
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
  (`reassignPendingApprovalsFor`), so they go back to the manager. `GET /users/me/leave`
  (`userLeaveService.leaveSummary`) previews who covers and what is waiting; a leave past its
  `leaveUntil` (the last day) ends by itself on the SLA worker scan or when the person opens the app
  (`endExpiredLeaves`).
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
  Treasury's manual retry. The requester is notified that the request was approved.

### 3.4 Online validations and who sees which request

Sending a request runs the manual's online validations (`requestSubmissionChecks.js`), and the form
shows them live with the approval route and the estimated payment day (`POST
/requests/submission-preview`, `SubmissionPreviewPanel`): P1/P2 justification, the Por Encargo job
category, the CAPEX business-case code (`capexDetails.businessCaseCode`, CN-AAAA-NNN), A1's
quotations from different suppliers (`A1_MINIMUM_QUOTATIONS`, default 3), a unique invoice (RUC +
series + number) and a payment account verified in the request's currency (a supplier still waiting
for its review is a warning: approval goes on and the payment waits).

Read scope (`utils/permissions.js`): the GAF, Gerencia General and the Auditor read every submitted
request; Accounting, Treasury and Procurement everything; a requester the submitted requests of
their own CECO; an Area Director or Vice-Rector those of every CECO they are responsible for (or
their own) and all below it in the cascade (`visibleCostCenterIdsFor`, computed at sign-in). Everyone
keeps their own requests and those routed to them.

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
  can only ever be `"Management"` at the schema level). Treasury prepares/reviews; Management decides.
  An optional `exceptionEscalationAmount` can require a second look above a threshold, but the
  authority is still Management either way — there is no higher role to escalate to.

**Exception workflow:** Treasury (or Admin) reviews first (`REVIEWED`); Management can approve or reject
only a reviewed exception, and is notified — and counted on its dashboard — once the review is saved.
A resubmitted request whose previous exception was `REJECTED`, or `APPROVED` but now exceeded, gets a
**new** exception that `supersedes` the stale one (only one `PENDING` exception per request dimension
is allowed). A `PENDING` exception that became moot — the commitment later succeeded, or the budget
was released — is auto-resolved (`RESOLVED`) so it neither blocks closure nor inflates counters.

**TRANSITIONAL never blocks:** a larger invoice (e.g. USD at a higher rate) grows the informational
commitment instead of attempting an enforced top-up, and TRANSITIONAL usage is reported in the budget
overview's committed/executed/paid totals (`totals.transitional`) without reducing availability.

**Year-end carry-over** (`POST /budget/year-end/carry-over`, Treasury/Admin, confirmation dialog in
Budget Control): every commitment of the fiscal year that is still open (committed, not yet executed
by an invoice) moves with its funds into January of the next year's plan/allocation for the same
dimension (created if missing). Executed/paid history stays in the closing year. It is audited and
idempotent — running it again changes nothing.

An annual/monthly `BudgetAllocation` ("budget plan") always forces `ACTIVE` mode for its dimension
regardless of the cost center's own default. Committed → executed → paid amounts are tracked
per-line and reversed symmetrically on cancellation/void (`releaseBudget`,
`reverseBudgetExecution`).

**CECO budgets.** A plan belongs to one CECO (shown with its area) and holds the annual budget,
either annual-only or spread over the twelve months. **Admin, Treasury and the Super Admin**
(`BUDGET_PLAN_MANAGERS`, the one business write the Super Admin may make) create and change plans;
changes above `BUDGET_CHANGE_APPROVAL_THRESHOLD` still wait for Management. The months are split
equally (`splitAnnualBudget`: never below what a month already used; "from this month" leaves the
earlier months with their usage and splits the rest until December) or typed one by one. A plan can
start mid-year when the CECO's earlier spending that year was only informational (TRANSITIONAL);
that amount is returned as `priorUnplannedAmount` so the page says it is not in the plan.
Budget-controlled (`ACTIVE`) usage in the year still blocks a second plan. Requests are charged to
the requester's own CECO (or one their profile authorizes), and an advance's rendition only to the
advance's own CECO. At rendition, the check follows the approval rule: an advance approved without
a plan (`NO_BUDGET`) and TRANSITIONAL lines never block, and an ACTIVE line counts what the advance
itself reserved.

**Tipo de Centro de Costo: Propio / Por Encargo** (`shared/costCenterAllocation.mjs`). A supplier
request (A1/B) is `PROPIO` by default (every request saved before the field, too): charged as
above. `POR_ENCARGO` means the requester's department buys on behalf of another school or
department: `requesterArea` / `requesterCostCenter` stay the requesting department and
`costAllocations` name the beneficiary CECO(s), chosen from the active CECO master
(`GET /requests/beneficiary-cost-centers`), never typed. The distribution must add up to 100%
(two decimals at most, each CECO once; one beneficiary is 100%); it is checked by the form, the
service and the model, and each share's amount follows the request total to the cent. The lines
carry the first beneficiary's CECO; a request shared by several CECOs reserves each one's budget
by its percentage (`groupedRequestLines`) and books each expense debit to each CECO
(`shareExpenseLines`), so the month-end consolidation shows each school. Track C stays `PROPIO`.
Each beneficiary CECO's responsible (else its head: its Area Director or Vice-Rector by area, or
the CECO's top jefe in the roster, `costCenterHeads`) gives its "visto" as a fixed approval step
after the requesting CECO's approvers (§3.3); they are also recorded in `costCenterReviewers`,
notified, and may open and comment on the request. A beneficiary CECO with nobody to approve
refuses the sending (`APPROVAL_ROUTE_NOT_CONFIGURED`). Only job categories 3, 5 and 6
(`User.jobCategory`, `permissions.mayChargeAnotherCostCenter`) may send a Por Encargo request or
charge a CECO authorized on their profile; the draft is refused when saved, and the category is
kept on the request when it is sent (`requesterJobCategory`). Type and distribution are in the request's
CREATED/UPDATED audit entries.

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
  corrected with a supplier credit note instead. The request also lets go of the cancelled invoice
  (its `fiscalData` moves to another active invoice of the request, or is cleared), so the same or a
  corrected invoice can be registered again on this or another request.
- **Duplicate invoices** (`DUPLICATE_VOUCHER`, one RUC + type + series + number per platform) are
  refused with what to do, never only "already registered": `duplicateVoucherError` in
  `sunatVoucherService.js` says whether the invoice is already on this request (nothing to correct),
  on another one (upload this purchase's invoice, or have Accounting cancel the other unpaid CXP),
  or somewhere unknown, and its details carry the invoice, the RUC and the request holding it. The
  invoice form shows this as numbered steps (`DuplicateInvoiceHelp`).
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
- **Payment cycle** (Manual técnico, "Programación de pagos"): payments run on the 15th and on the
  last day of the month, each moved back to the previous working day (`shared/businessCalendar.mjs`),
  and urgent ones on the Wednesday urgency window. A CXP is created with `suggestedPaymentDate` from
  its request's priority (`suggestedPaymentDate`: P1 today, P2 the next Wednesday, P3 the first
  payment day at least `PAYMENT_CUTOFF_WORKING_DAYS` (3) away, P3/P4 with a due date the last payment
  day before it), Treasury's default until it schedules. A payment day or a Wednesday needs no reason,
  nor today when every selected payment is P1; another date needs an audited reason; past dates are
  refused.
  **Advances to render are the exception**: they are paid the same working day they are approved
  (`advancePaymentService`, shared `advancePaymentDate`): today in Lima, or the next working day
  when approved from the cut-off hour (`FinanceConfiguration` key `ADVANCE_PAYMENT_CUTOFF_HOUR`,
  default 15) or on a weekend/holiday. The advance payable is due on that date, Treasury gets an
  urgent "Advance to pay now" notice and dashboard task, and Payments shows an "Advances to pay
  now" banner whose **Pay now** lists and ticks them (`GET /treasury/advances-due`, queue filter
  `advancesDue=true`). A bank file holding only advances can be dated today without a typed reason
  (the platform records `ADVANCE_PAYMENT_REASON`); Accounting is asked to verify such a file today.
  The rendition then follows the usual 10 working days from the actual payment date. The
  employee's rendition screen and the "Rendition pending" notice show where to return unspent
  money (`FinanceConfiguration` key `ADVANCE_RETURN_ACCOUNT`, a `textValue`).
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
- **Beneficiary bank** — where a supplier or employee's own account can be held, paid via CCI
  interbank transfer regardless of the source bank. The one list is `shared/peruBanks.mjs`: the SBS
  empresas bancarias (bulletin B-2201, Aug-2026) plus Banco de la Nación and BTG Pactual, and
  `OTHER` ("Otro / No disponible", which needs the bank's name and its CCI). Each bank carries its
  3-digit CCI entity code; the codes confirmed by more than one source (BCP 002, Interbank 003,
  Scotiabank 009, BBVA 011, Banco de la Nación 018) are checked against the CCI typed, the rest are
  hints until UMA confirms them. A supplier account is a cuenta de ahorros (`SAVINGS`) or corriente
  (`CURRENT`), in soles or dollars; both are payable (`PAYABLE_ACCOUNT_TYPES`), `DETRACTION` never
  is. Treasury's account choice starts with the account the requester chose on the request, and an
  account in another currency than the payable is flagged — nothing is converted.

## 7. Suppliers

`backend/src/services/supplierService.js`. Proposal (RUC/DNI-unique — a near-duplicate *legal name*
with a different RUC is surfaced as an advisory warning, never a hard block; it may register one
account per currency, e.g. soles and dollars) gets its permanent `PRV-####` code when it is
registered, from one counter (a refused proposal takes none) → approval by the proposer's jefe,
which homologates it. The RUC file, legal representative ID, bank certificate and the two compliance
declarations are no longer asked by the proposal form and no longer block the approval; ones already
on file still show, and a risky declared answer still warns the jefe.

**Suppliers by department** (`supplierVisibilityService.js`). Every user belongs to one department,
their area (`User.area`; "General" when nobody assigned one). `Supplier.departments` lists the
departments that see a supplier; empty means shared with every area (suppliers registered before
departments existed). A new supplier belongs to the department of whoever registers it, so everyone
in that department sees it at once and nobody else does. Each user's Proveedores list holds their
department's suppliers, the shared ones and their own proposals — Accounting, Treasury and
Procurement included; only the Admin and the read-only Super Admin see every department. The same
rule guards the detail, every change, the RUC lookup, global search, the invoice reader, supplier
files and a saved request (the API refuses another department's supplier with
`SUPPLIER_OTHER_DEPARTMENT`; the RUC stays unique, so a second department is told the supplier
exists instead of registering it again). Work still reaches another department's supplier without
adding it to the list: Accounting reviews every proposal and verifies pending bank accounts (its
task links open `/suppliers?awaitingMyApproval=true` and `/suppliers?bankReview=pending`), and
Accounting, Treasury and Procurement open the supplier of any submitted request they process. The
Admin chooses any supplier's departments (`PUT /suppliers/:id/departments`; Accounting only for its
own list) and answers requests to share one (`POST /suppliers/:id/access-request`). A request may be sent
with a supplier still waiting for that approval: the jefe approves the supplier together with the
request (`approveSupplier: true` on `POST /approvals/:id/approve`, shown on the approval screens),
a supplier that is not ready yet sends the request back, and no approval completes while the
supplier still waits. Rejected, inactive or observed suppliers still block sending. Homologation now expires after a
configurable validity window (default 12 months, `FinanceConfiguration` key
`SUPPLIER_HOMOLOGATION_VALIDITY_MONTHS`) and is automatically reset to pending on a material
fiscal/legal field change or on reactivating a previously inactive supplier — a bank-account change
alone only re-triggers bank-account verification, not full re-homologation. The person who
registered a bank account cannot verify it. The supplier's Banco de la Nación detracciones account
(`Supplier.detractionAccount`) receives SPOT deposits and is never a BBVA transfer destination.

## 8. SUNAT / SIRE integration

`backend/src/services/sunatService.js` selects a provider by `SUNAT_PROVIDER_MODE`
(`backend/src/config/sunatMode.js`):

- **`CONSULTA_RUC`** (the default) — verifies a RUC on SUNAT's public Consulta RUC page only
  (`ConsultaRucSunatProvider`, `sunatConsultaRucRepresentativesService.js`, headless Chromium):
  ACTIVO/HABIDO and a matching legal name make it valid, and the page's whole taxpayer profile is
  kept as the supplier's validation evidence. No Padrón fallback and no simulated answer: SUNAT
  unreachable leaves the validation pending. Like the Padrón it cannot validate an individual
  voucher (CPE).
- **`PADRON`** — validates taxpayer status/HABIDO against
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
- **`MOCK`** — offline and always valid; only for the automated tests and the demo seed's own run
  (its RUCs are fictional), never selected by default.

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
