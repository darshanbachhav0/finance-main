# UMA Finance Role Permissions Guide

Detailed access and workflow reference for the ten operational profiles

**Version date 24 September 2026**

## Changelog

This revision adds two profiles that did not exist when the guide was last reviewed: **Procurement** (issues Purchase/Service Orders after Track A1 budget commitment) and **ManagementViewer** (strictly read-only: external portal, internal Reports, and audit history). It also corrects five items against `constants.js`/route code: order issuance is Procurement's action, not Budget's; Treasury can now certify a BBVA bank-file format alongside Admin (`BANK_FORMAT_CERTIFY`); only BBVA is a valid outbound payment-file source, while BCP/Interbank/Scotiabank/Banco de la Nación remain beneficiary-only banks; Track B now requires a configured eligibility rule and is no longer a free choice; a new `PARTIALLY_PAID` accounts-payable status exists; and only Management may decide a budget exception — Admin can never approve one directly, only repair the underlying configuration.

This guide explains what each profile can view, create, change, approve, and execute in the UMA finance platform. It also identifies the conditions that can block an otherwise permitted action. Use it for onboarding, assigning accounts, reviewing responsibilities, and diagnosing access issues.

The platform separates requesting, authorization, budget control, accounting, and payment execution. An approval is a business decision; it does not itself grant the approver manual access to Accounting or Treasury. Some successful workflow steps automatically create downstream records.

**Scope.** The guide describes the current project implementation and its default permissions. Administrators can change user assignments, extra permissions, approval rules, budgets, and policies. Seeded examples in this guide are configuration examples, not a statement of the current production database settings.

## The ten operational profiles

| Profile | Stored role | Approval level or purpose |
| --- | --- | --- |
| Administrator | Admin | System administration and authorized exceptions |
| Requester or Solicitante | Solicitor | Creates and follows own requests |
| Area Director or Director de Área | Approver | AREA_DIRECTOR |
| Vice Rector or Vicerrectorado | Approver | VICE_RECTOR |
| Accounting or Contabilidad | Accounting | Supplier review, fiscal processing and renditions |
| Treasury or Tesorería | Treasury | Scheduling, bank files, payment and reconciliation |
| Budget or Presupuesto | Budget | Validates, commits and reserves funds; prepares exceptions |
| Procurement or Abastecimiento | Procurement | Issues Purchase/Service Orders after budget commitment |
| Management or Gerencia and Rectorado | Management | Usually RECTORATE; GENERAL_MANAGEMENT can be configured |
| Management Viewer | ManagementViewer | Read-only institutional portal, reports and audit history |

There are **ten operational profiles and nine stored role names**. Director and Vice Rector share Approver permissions and menus. Their approval level and area assignments determine which decisions they can make. A job title alone does not change access.

ManagementViewer is the platform's only strictly read-only profile: every permission it holds is a view/report/audit token, and it never appears in an `authorize()`/`authorizePermission()` check on a POST, PUT, PATCH or DELETE route.

**Reading the guide.** Start with the two capability matrices, then the common access rules and your role section. Later sections explain approval routes, annual/monthly budget limits, data visibility, exceptions, practical scenarios, and the technical permission catalog.

SOURCES S01 S02 S03 S04

<!-- pagebreak -->

## Capability matrix for financial work

ADM Administrator; REQ Requester; DIR Director; VR Vice Rector; ACC Accounting; TRE Treasury; BUD Budget; MGT Management. Procurement (PRO) and ManagementViewer (MGV) are shown in their own table immediately below, to keep this matrix's columns aligned with the source layout.

**Y** permitted subject to workflow checks; **O** own records only; **S** assigned approval stage only; **R** read only; **-** no default action access. These describe manual actions. Automated downstream processing is explained later.

| Capability | ADM | REQ | DIR | VR | ACC | TRE | BUD | MGT |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Create a financial request | Y | Y | - | - | - | - | - | - |
| View own request details | Y | O | R | R | R | R | R | R |
| Browse other users' requests | Y | - | R | R | R | R | R | R |
| Open another user's draft | Y | - | - | - | R | R | R | - |
| Edit a request | Y | O | - | - | - | - | - | - |
| Delete a draft or rejected request | Y | O | - | - | - | - | - | - |
| Submit or resubmit a request | Y | O | - | - | - | - | - | - |
| Approve observe return or reject | Y | - | S | S | - | - | - | S |
| Use budget overview and plans | Y | - | R | R | R | - | Y | R |
| Create or adjust annual/monthly plans | Y | - | - | - | - | - | Y | - |
| Decide budget exceptions | - | - | - | - | - | - | - | Y |
| Manually commit an approved budget | Y | - | - | - | - | - | Y | - |
| Manually issue Purchase or Service Order | Y | - | - | - | - | - | - | - |
| Upload an A1 invoice and conformity | Y | O | - | - | Y | - | - | - |
| Upload invoice batches against an order | Y | O | - | - | Y | - | - | - |
| Resolve batch invoice observations | Y | - | - | - | Y | - | - | - |
| Process Accounting and Accounts Payable | Y | - | - | - | Y | - | - | - |
| Submit an expense rendition | Y | O | - | - | - | - | - | - |
| Review or validate a rendition | Y | - | - | - | Y | - | - | - |
| Settle validated non-deductible balance | Y | - | - | - | Y | Y | - | - |
| Schedule or generate bank payment files | Y | - | - | - | - | Y | - | - |
| Confirm payments or record a bounce | Y | - | - | - | - | Y | - | - |
| Reprogram a bounced payment | Y | - | - | - | - | Y | - | - |
| Reconcile a payment | Y | - | - | - | - | Y | - | - |
| Use the explicit request close action | Y | - | - | - | Y | - | - | - |
| Void an eligible request with a reason | Y | - | - | - | Y | - | - | - |

**Procurement (PRO) and ManagementViewer (MGV)**, for the same capability rows in the same order:

| Capability | PRO | MGV |
| --- | --- | --- |
| Create a financial request | - | - |
| View own request details | R | - |
| Browse other users' requests | R | - |
| Open another user's draft | R | - |
| Edit a request | - | - |
| Delete a draft or rejected request | - | - |
| Submit or resubmit a request | - | - |
| Approve observe return or reject | - | - |
| Use budget overview and plans | - | - |
| Create or adjust annual/monthly plans | - | - |
| Decide budget exceptions | - | - |
| Manually commit an approved budget | - | - |
| Manually issue Purchase or Service Order | Y | - |
| Upload an A1 invoice and conformity | - | - |
| Upload invoice batches against an order | - | - |
| Resolve batch invoice observations | - | - |
| Process Accounting and Accounts Payable | - | - |
| Submit an expense rendition | - | - |
| Review or validate a rendition | - | - |
| Settle validated non-deductible balance | - | - |
| Schedule or generate bank payment files | - | - |
| Confirm payments or record a bounce | - | - |
| Reprogram a bounced payment | - | - |
| Reconcile a payment | - | - |
| Use the explicit request close action | - | - |
| Void an eligible request with a reason | - | - |

**Scope notes.** Approver and Management request lists/details exclude drafts but are not restricted to the requester's area. Director approval decisions are area-restricted. Accounting, Treasury, Budget and Procurement can view drafts (all four hold request:view-all without the Approver/Management draft exclusion). Requester edits/deletions have additional status restrictions. Treasury settlement can lead to automatic closure even though the explicit Close endpoint is reserved to Admin and Accounting. ManagementViewer has no row of manual action in this matrix at all: it lacks request:view-all, so it cannot open Requests, and its access is confined to reporting/audit, covered in the next matrix and its own role section. Only Management may approve or reject a budget exception; Budget and Admin may prepare one or mark it reviewed, but neither can decide it — Admin can only repair the underlying approver-role configuration through the audited master-data screen, never approve the exception directly. Budget no longer holds "Manually issue Purchase or Service Order" — Procurement does (Y in the table above), alongside Admin; see the Procurement and Budget role sections.

SOURCES S02 S03 S05 S06 S07 S08 S09 S10 S11 S12

<!-- pagebreak -->

## Capability matrix for supporting functions

Use the same profile abbreviations as the preceding matrix. **P** means propose data without Finance verification or activation authority; **O** means own eligible records only.

| Capability | ADM | REQ | DIR | VR | ACC | TRE | BUD | MGT |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Open Supplier Master | Y | R | - | - | Y | R | - | - |
| Create a supplier proposal | Y | P | - | - | Y | - | - | - |
| Correct an eligible supplier proposal | Y | O | - | - | Y | - | - | - |
| Add supplier bank account facts | Y | O | - | - | Y | - | - | - |
| Verify banking or set preferred account | Y | - | - | - | Y | - | - | - |
| Validate review or homologate supplier | Y | - | - | - | Y | - | - | - |
| Update or remove supplier master record | Y | - | - | - | Y | - | - | - |
| Manage employee reimbursement profiles | Y | O | - | - | - | - | - | - |
| Review employee reimbursement banking | Y | - | - | - | Y | - | - | - |
| Read employee banking profiles | Y | O | - | - | R | R | - | - |
| Maintain CECO expense types projects FX | Y | - | - | - | Y | - | - | - |
| Maintain budget rules and allocations | Y | - | - | - | - | - | Y | - |
| Maintain document rules/account mappings | Y | - | - | - | Y | - | - | - |
| Maintain finance control settings | Y | - | - | - | Y | - | R | - |
| Configure approval rules | Y | - | - | - | - | - | - | - |
| Configure bank file formats | Y | - | - | - | - | - | - | - |
| Certify a bank file format | Y | - | - | - | - | Y | - | - |
| Open close or reopen accounting periods | Y | - | - | - | Y | - | - | - |
| View and export management reports | Y | - | R | R | R | R | R | R |
| Export accounting consolidation or SIRE | Y | - | - | - | Y | - | - | - |
| Download existing generated bank file | Y | - | - | - | R | Y | - | - |
| Use global audit log | Y | - | - | - | R | - | - | - |
| Create update deactivate user accounts | Y | - | - | - | - | - | - | - |

**Procurement (PRO) and ManagementViewer (MGV)**, for the same capability rows in the same order:

| Capability | PRO | MGV |
| --- | --- | --- |
| Open Supplier Master | R | - |
| Create a supplier proposal | - | - |
| Correct an eligible supplier proposal | - | - |
| Add supplier bank account facts | - | - |
| Verify banking or set preferred account | - | - |
| Validate review or homologate supplier | - | - |
| Update or remove supplier master record | - | - |
| Manage employee reimbursement profiles | - | - |
| Review employee reimbursement banking | - | - |
| Read employee banking profiles | - | - |
| Maintain CECO expense types projects FX | - | - |
| Maintain budget rules and allocations | - | - |
| Maintain document rules/account mappings | - | - |
| Maintain finance control settings | - | - |
| Configure approval rules | - | - |
| Configure bank file formats | - | - |
| Certify a bank file format | - | - |
| Open close or reopen accounting periods | - | - |
| View and export management reports | R | R |
| Export accounting consolidation or SIRE | - | - |
| Download existing generated bank file | - | - |
| Use global audit log | - | R |
| Create update deactivate user accounts | - | - |

**Important differences.** Reading a supplier does not authorize verifying its bank account. Downloading an already generated bank file does not authorize generating, scheduling, or confirming payments. Budget's configuration menu does not grant project-master write access; project writes remain Admin/Accounting. Bank-format certification is a narrow, additional exception to Admin-only configuration: Treasury holds `bank-format:certify` and can certify or decertify an existing bank-file format, but creating, editing, deactivating or reactivating that configuration record remains Admin-only. Only BBVA is a supported source/generator format (`SOURCE_BANKS`); BCP, Interbank, Scotiabank and Banco de la Nación (`BENEFICIARY_BANKS`) can be a supplier's or employee's beneficiary bank for a CCI transfer, but none of them is a format UMA can generate an outbound payment file through. Procurement's Supplier Master access mirrors Treasury's: read-only, for confirming an eligible homologated supplier before issuing an order, never a proposal, verification or homologation action.

Supplier proposals are correctable only while pending validation or observed. A Requester must also be the proposer. Supplier bank entry does not permit changing verification, ownership-review, active/preferred, or Finance decision fields. Employee profile preference/deactivation follows the separate owner permissions shown above.

Procurement and ManagementViewer can both call the management-report summary and CSV-export endpoints directly (reportRoutes.js admits every profile except Requester), but the generated-file category list behind the generic stored-file download route still excludes both of them (it remains Admin, Approver, Accounting, Treasury, Budget and Management) — so neither role can re-download a report file from the export-history list after the fact; a fresh call to the export endpoint is required instead.

SOURCES S03 S09 S10 S13 S14 S15 S16

<!-- pagebreak -->

## How access decisions are made

### Authentication and current account status

Protected APIs require a valid sign-in token and an active user record. The server reloads the user from the database, so disabling an account or changing its server-side role affects subsequent API requests. A menu still visible in an old browser session is not proof that the action remains authorized.

### Role gates and extra permissions

Most module routes explicitly allow particular stored roles. Some routes, especially batch invoices, global audit, bank-format certification and the management-report/portal group, check named permissions instead of a role list — that is how Treasury gained bank-format certification and ManagementViewer gained audit/report access without a broader role grant. A user's effective named permissions are the union of the role defaults and their additional permissions. Extra permissions add capabilities; they do not remove role defaults.

An extra permission does not bypass a route that explicitly requires another role, a record-ownership check, or a workflow condition. Sidebar visibility also follows role-based navigation rules. Consequently, adding a permission does not necessarily create a working menu or authorize an entire module.

### Record ownership and organizational scope

Requesters can view and work on their own requests. Request creation and official line/rendition validation restrict their CECO choices to their primary cost center plus authorized cost centers. Admin is exempt from that CECO assignment restriction.

Directors and Vice Rectors share the Approver role. A Director's action must match the active approval level, route role and allowed area. A Vice Rector's level must match the active step. Management similarly needs the exact assigned level and route role.

### Status and financial controls

A permitted action can still be blocked by an ineligible status, pending prior approval, missing evidence, invalid accounting dimensions, insufficient budget, supplier eligibility, an unavailable exchange rate, or a closed accounting period. Admin is subject to these business controls unless a specific exception path exists.

Closed-period blocking is action-specific and controlled by period policy. Default behavior blocks relevant financial changes; Admin and Accounting manage the period rather than silently bypassing the guard.

### Reading is not editing

All profiles except ManagementViewer have Requests navigation. ManagementViewer's own navigation is limited to the Management Portal, Reports and Audit, matching its strictly read-only scope; it lacks request:view-all and is neither a requester nor an approver, so the request-visibility filter returns nothing for it even if it reached that screen. Request Detail can include related accounting, budget, payment and audit information without granting edit access to those modules. The common dashboard and some reference-data APIs have broader scope than the dedicated request list. See the visibility limitations section before treating a hidden menu as a confidentiality boundary.

SOURCES S01 S02 S03 S05 S17 S18 S19

<!-- pagebreak -->

## Administrator

**Stored role Admin.** The administrator configures the platform, manages identities, and performs permitted operational actions across finance modules. The default catalog grants all 29 named permissions.

### What the administrator can view

All requests, including other users' drafts; supplier and banking information; budget plans and exceptions; accounting entries and payables; Treasury queues and files; employee reimbursement banking; reports, configuration, and the global audit log.

### What the administrator can do

- Create, edit and submit requests, register invoices, upload batches, manage renditions, and execute authorized approval decisions.
- Maintain annual/monthly plans, allocations and budget rules; commit approved budgets; and issue eligible procurement orders (the same order-issuance action Procurement holds). Admin can prepare a budget exception or mark it reviewed, and can repair a broken exception-approver configuration, but cannot approve or reject the exception itself — see Limitations.
- Review and homologate suppliers, verify banking, process Accounting, control periods, generate exports, schedule and confirm payments, reconcile, and handle bounced payments.
- Create, update or deactivate users; assign the role, approval level, approval areas, primary/authorized CECOs, and additional permissions.
- Maintain approval rules, bank formats, document rules, accounting mappings, projects, expense types and exchange rates.

### Limitations and exceptions

Admin does not have unlimited status transitions. Request deletion is restricted to draft or rejected records. Approved/completed documents cannot be deleted through that action. Closed-period policies, approval completeness, required evidence, supplier readiness and payment-account eligibility continue to apply.

Admin can act across approval levels and areas. If the Admin is also the requester, approval requires an explicit, non-empty admin override reason. The exception is part of the recorded approval; it is not blanket self-approval permission.

Admin cannot approve or reject a budget exception. Only Management may decide one; the service layer enforces this even for Admin, so Admin's role in that workflow is limited to preparing the exception, marking it reviewed, or repairing the underlying approver-role configuration through the audited master-data screen — never approving it directly.

The account-management API blocks deactivating the currently signed-in account. User removal deactivates the account; it does not erase its historical actions. Passwords are replaced through the administrative flow, not displayed as existing plaintext values.

### Example and operating responsibility

An Admin can correct a user assigned to the wrong approval level, then let the responsible approver act. An Admin cannot make an unpaid request eligible for closure simply by changing a menu selection. Administrative exceptions should have a clear business reason and retained evidence.

SOURCES S01 S02 S05 S06 S17 S19 S20

<!-- pagebreak -->

## Requester or Solicitante

**Stored role Solicitor.** The requester originates business needs, proposes suppliers and supplies evidence. The platform assigns financial approvals, supplier verification and payment execution to other profiles.

### What the requester can view

Own requests and their progress, quotations, related accounting/payment information and request audit timeline. The requester can use Supplier Master for selection and proposals, see their own reimbursement bank profiles, and access eligible invoice batches and own Purchase Orders.

The dedicated Budget and Management Reports modules are unavailable. Authorized CECO choices and an individual request's budget preview still provide the information needed to create the request.

### What the requester can do

- Create A1 procurement requests, Track B direct-payment requests, and Track C advances/renditions supported by the form; enter items, quotations and required supporting documents. Track B is not a free choice: submission is only accepted when an active Track B eligibility rule (matching area, expense nature and PEN-equivalent amount, configured by Admin) covers the request; otherwise the requester must use Track A1 instead.
- Edit and resubmit owned draft, rejected, returned, observed, budget-observed, SUNAT-observed, amount-exceeded-observed, or batch-observed requests. Delete only owned draft or rejected requests.
- Propose a supplier; correct a proposal they created while pending validation or observed; add bank facts and supporting documents for that eligible proposal.
- Register an owned A1 invoice after the PO/budget stage, with XML, PDF and conformity evidence. Upload batches against an eligible owned order and follow progress.
- Submit an owned rendition at its eligible lifecycle stage. Create, update, choose the preferred, or deactivate their own reimbursement bank profiles.

### Limitations

The requester cannot approve, manually commit budgets, issue orders, homologate suppliers, verify banking, process Accounting, schedule payments, generate bank files, confirm/reconcile payments, close/void requests, or manage users.

A submitted request is not freely editable. The return/observation process controls corrections. A valid invoice upload may trigger automatic fiscal processing and CXP creation; it does not grant manual Accounting access. Batch observations are resolved by Accounting/Admin.

Bank verification and lifecycle fields are Finance-controlled. For supplier records, full bank data is available to the proposer only during an editable proposal; other supplier bank values are masked. Supplier document downloads have the same ownership/status restriction.

### Example

A supplier's incorrect CCI is reported to Accounting for verification. The requester can correct their pending proposal, but cannot mark the CCI verified to make a payment eligible.

SOURCES S02 S05 S09 S10 S13 S14 S21 S22

<!-- pagebreak -->

## Area Director

**Stored role Approver with AREA_DIRECTOR.** The Director checks the business need and supporting evidence for the area before the next required institutional approval.

### What the Director can view

Dashboard, non-draft Requests, Approval Inbox, Budget and Management Reports. Request Detail provides quotations, budgets and related financial history for review. Supplier Master, user administration, Accounting and Treasury workspaces are unavailable.

The Requests list/detail is broader than the Director's approval authority: it permits non-draft requests outside the assigned area. The Approval Inbox normally filters to the configured level and permitted areas. Request-based management reporting restricts Approver users to their configured areas unless wildcard access is present.

### What the Director can do

- Approve the currently pending Area Director step when the route assigns it to Approver and the request belongs to an allowed area.
- Observe a request for correction, return it, or reject it at that active step. These three decisions require comments.
- Read budget availability and commitments, compare suppliers and payment terms, examine supporting evidence, and export permitted management reports.

Allowed areas are the user's area plus approvalAreas. A wildcard grants all-area approval scope. Viewing a request or obtaining its ID does not grant permission to decide another level or another area.

### Limitations

The Director cannot approve their own request, skip required earlier stages, act on a completed step, edit the requester's financial data, create a request under the default role, or assign themselves a broader scope.

The Director has budget read access, not manual budget-plan adjustment, exception-decision or order-issuance authority. Accounting, period maintenance, supplier homologation, banking verification, Treasury and user administration remain unavailable.

A successful final approval can invoke automatic budget reservation/order processing or direct-payment provisioning. This is workflow behavior and remains subject to its checks; it is not access to the corresponding manual endpoint.

### Example

A Director assigned to Health Sciences may review a submitted Engineering request in Requests, but cannot approve it unless Engineering is included in the Director's allowed areas and the current step is AREA_DIRECTOR.

SOURCES S01 S02 S03 S06 S07 S18 S23

<!-- pagebreak -->

## Vice Rector

**Stored role Approver with VICE_RECTOR.** The Vice Rector performs the institutional approval required after earlier steps in the configured route. This is a separate operational profile, not a separate stored role.

### What the Vice Rector can view

The same main modules as a Director: Dashboard, non-draft Requests, Approval Inbox, Budget, and Management Reports. The inbox normally shows the configured Vice Rector stage. The seeded Vice Rector profile uses wildcard areas; actual report visibility depends on the user's saved area configuration.

The general Requests view is not limited to the Vice Rector's current inbox. That wider reading access does not authorize changing request data or deciding a Director or Management step.

### What the Vice Rector can do

- Approve a request when its active step is VICE_RECTOR and the step's required role is Approver.
- Observe, return or reject at that stage, with required comments for those decisions.
- Review the prior approval trail, item totals, quotations, payment terms, budget information and evidence.
- View/export the reports allowed to Approver users.

If another required Management stage follows, the Vice Rector's approval advances the route to that stage. It does not complete the whole approval chain.

### Limitations

The Vice Rector cannot approve their own request, skip an earlier required approval, decide an Area Director step, or substitute for a Management step while their saved level remains VICE_RECTOR.

The role cannot create/edit financial requests, change budget plans, decide budget exceptions, maintain suppliers, process Accounting, execute Treasury payments, configure approval rules, or administer accounts. Budget access is read only.

When the Vice Rector completes the last required approval, the application may automatically attempt the financial handoff. Insufficient budget or supplier readiness can still stop that handoff. The Vice Rector cannot solve those issues by changing master data or increasing a budget.

### Example

After a Director approves an ordinary A1 request, the Vice Rector may complete the next approval. If the applicable route also requires Rectorate approval, the request must proceed to Management before budget/order completion.

SOURCES S01 S02 S03 S04 S06 S07 S23

<!-- pagebreak -->

## Accounting

**Stored role Accounting.** Accounting controls supplier validation, fiscal processing, financial master data, accounting periods, and expense-rendition review.

### What Accounting can view

All requests, including drafts; Supplier Master and full banking data; employee bank profiles; Accounting and Accounts Payable; invoice observations and batches; budget plans/commitments/exceptions; reports; accounting/SIRE exports; and the global audit log.

Accounting can download existing generated bank files through the file-access rule. This does not grant the Treasury workspace or payment generation/execution actions.

### What Accounting can do

- Create or maintain supplier records, correct eligible proposals, check taxpayer data, review compliance, homologate, verify bank ownership and account status, set preferred accounts, and remove/deactivate accounts through supported lifecycle actions.
- Maintain cost centers, expense types, projects, exchange rates, document rules, accounting mappings and Finance settings. Create, close and reopen accounting periods.
- Register A1 invoice evidence across requests; upload/retry invoice batches; review and resolve fiscal observations; process accounting entries/payables and export consolidation or SIRE files.
- Review employee bank profiles; observe, reject, approve or validate submitted renditions; settle eligible non-deductible Account 14 balances.
- Close or void requests through eligible workflow actions. Voiding requires a reason.

### Limitations

Accounting cannot create/edit the underlying request form, issue approval decisions, increase annual/monthly budgets, decide budget exceptions, manually issue procurement orders, schedule/confirm/reconcile Treasury payments, or manage users.

Accounting can review employee bank profiles but does not have the owner profile-edit endpoints. Supplier verification requires the prescribed evidence and decisions; homologation is not a single unrestricted activation switch.

Accounting's void access is an explicit route/workflow allowance even though its default named-permission list omits request:void. Similarly, some supplier write actions rely on explicit role gates rather than supplier:propose. The technical catalog alone is therefore insufficient to describe this role.

### Example

Accounting validates the supplier and resolves an invoice observation. It then processes the payable or lets valid invoice automation provision it. Treasury selects the eligible payment destination and executes the payment process.

SOURCES S01 S05 S08 S09 S10 S13 S14 S15 S16 S21 S22

<!-- pagebreak -->

## Treasury

**Stored role Treasury.** Treasury executes the approved payment process and records its outcome. It works from eligible payables and approved bank destinations.

### What Treasury can view

All requests, including drafts; payment queues, bank files, confirmations, bounced payments and reconciliation; Supplier Master in read mode; full supplier/employee banking needed for payments; employee bank profiles; and management reports.

Treasury does not have the dedicated Budget, Accounting, SIRE, global audit or configuration workspaces. Relevant accounting and budget information can still appear inside a permitted Request Detail.

### What Treasury can do

- Schedule eligible requests or individual payables using the selected bank, currency, payment date and eligible account. Only BBVA is a supported source/generator bank format (SOURCE_BANKS); the other supported banks (BCP, Interbank, Scotiabank, Banco de la Nación) are beneficiary-only destinations reached by CCI transfer, never a format Treasury generates a file through.
- Generate supported bank files; inspect existing files and payment batches. Certify or decertify an existing bank-file format (bank-format:certify) — a narrow exception shared with Admin; creating, editing or deactivating the format configuration itself remains Admin-only.
- Confirm a request/payable payment in full or in part — a partial confirmation moves the CXP to PARTIALLY_PAID rather than PAID and remains open for a further confirmation — record a bank rejection, and reprogram a bounced payable after required replacement evidence.
- Reconcile the recorded payment with bank evidence/reference.
- Read eligible employee reimbursement destinations and settle validated non-deductible rendition balances using the supported reimbursement/payroll-deduction methods.

### Limitations

Treasury cannot create or approve requests, homologate suppliers, verify/add supplier banking, review employee banking, modify budgets, issue orders, post ordinary Accounting entries, control periods or administer users.

For suppliers, selectable payment accounts must be active CURRENT accounts and match the bank/currency. Verification and ownership checks apply; eligible LEGACY_ACCEPTED accounts remain supported. Detraction accounts and invalid, mismatched or unverified accounts are not ordinary supplier payment destinations.

A destination is frozen when the payable is scheduled. Treasury cannot substitute another account in that normal flow. The bounced-payment reprogramming process requires a signed CCI letter, resets the payable for rescheduling, and retains evidence/history. It does not verify a replacement master account.

Employee reimbursements use the captured, verified employee destination; Treasury cannot replace it with an arbitrary supplier account. Generating a bank file is not proof that the bank paid it. Confirmation and reconciliation are separate actions.

### Example

For a bounced payment, Treasury records the rejection and attaches the signed replacement CCI evidence through reprogramming. Accounting must handle any supplier bank verification required before rescheduling to the replacement account.

SOURCES S05 S11 S13 S14 S16 S22 S24

<!-- pagebreak -->

## Budget

**Stored role Budget.** Budget manages financial availability, annual/monthly planning, and commits an approved request's budget. It no longer issues the Purchase or Service Order itself; that action, and the underlying route permission, belong to Procurement (see the comment above `ROLES.PROCUREMENT` in `constants.js`). Budget's part of a budget exception ends at preparing or reviewing it — only Management may approve or reject one.

### What Budget can view

All requests, including drafts; budget overview, annual and monthly plan detail, allocations, commitments and exceptions; management reports; and the configuration workspace available to Budget. Request Detail includes procurement readiness, quotations, order terms and related financial information.

Budget does not have Supplier Master, full employee banking, Accounting, Treasury, user administration or global audit access. It also does not have the Purchase/Service Order issuance action — that belongs to Procurement and Admin.

### What Budget can do

- Create annual budget plans, set the permitted monthly structure/control mode, and post supported adjustments with reasons and an audit trail.
- Maintain budget rules and allocations; review insufficient-budget cases and prepare or mark reviewed a supported exception outcome. Budget cannot itself approve or reject the exception — only Management may decide it.
- Commit the approved request's budget after all required approvals are complete, or after a budget observation has been resolved. This commitment is what makes the request eligible for Procurement to issue the order next; Budget's own involvement ends here.
- Read project reference data and Finance configurations available to Budget.

### Limitations

Budget cannot approve requests, edit request item/quotation facts, create or verify suppliers, register invoices, **issue a Purchase or Service Order**, decide (approve/reject) a budget exception, process Accounting, control accounting periods, pay or reconcile, or maintain user accounts. This guide previously described order issuance as a Budget action, which was accurate before Procurement existed as a distinct stored role; `procurement-order:create` has since moved to Procurement's permission set, and Budget's own set no longer includes it.

The configuration menu does not grant project create/update/delete authority. Project Master writes remain Admin/Accounting. Approval-rule configuration and the Track B eligibility-rule configuration are Admin-only. Bank-format configuration is also Admin-only for creating, editing or deactivating a format, though Treasury shares the narrow certify/decertify action on an existing one.

The role cannot commit an unapproved request. Order issuance — now a Procurement/Admin action, not Budget's — requires the applicable A1 procurement flow, completed required approvals, Budget's eligible commitment, mandatory documents/quotations, and a usable homologated supplier with a PRV code. Reissuing the same request is designed to return the existing order rather than create a second one.

Annual and monthly controls are cumulative business constraints. An annual balance does not automatically make an over-limit month available. Adjusting a plan is not permission to alter accounting actuals or erase committed/executed amounts. Exception behavior depends on the configured rule and selected strategy, but the approving authority is always Management regardless of that configuration.

### Example

Management finishes a CAPEX approval. Budget confirms availability, prepares or reviews any budget exception for Management's decision, and commits the approved budget. Procurement then issues the Purchase or Service Order — Budget's role ends at the commitment. If the project or supplier is wrong, Budget asks the responsible profile to correct it instead of editing that master itself.

SOURCES S01 S03 S07 S12 S15 S23 S25

<!-- pagebreak -->

## Procurement

**Stored role Procurement.** Procurement issues the Purchase or Service Order once an A1 request's required approvals are complete and Budget has committed the funds. A global route-gate defect had blocked this role from the API entirely even though its `ROLE_PERMISSIONS` entry was correct; that defect is now fixed, so Procurement operates as a normal, fully functional profile.

### What Procurement can view

All requests, including drafts, through the same unrestricted request:view-all access as Accounting, Treasury and Budget (Procurement is not subject to the Approver/Management draft exclusion). Supplier Master in read mode, including supplier bank-view data, to confirm a homologated supplier's readiness before issuing an order. Issued Purchase/Service Orders and management reports. Request Detail exposes procurement readiness, quotations, the order snapshot and related financial information.

Procurement does not have the Budget, Accounting, Treasury, user-administration or global audit workspaces — its route access is limited to Requests, Suppliers (read) and Reports. It cannot open the Approval Inbox to decide a step, and it has no Budget-module access at all (`budgetRoutes.js` does not admit it).

### What Procurement can do

- Manually issue the Purchase or Service Order for an eligible A1 request once procurement readiness passes: completed required approvals, Budget's eligible commitment, mandatory documents/quotations, and a usable homologated supplier with a PRV code. This is the order-issuance action the guide previously (and incorrectly) attributed to Budget; Admin can also issue it, and Procurement is notified automatically once a request's budget is committed and ready for its action.
- Read Supplier Master and supplier banking to confirm a recommended supplier is active, homologated and holds a matching PRV code before issuing an order.
- View and export the same management reports available to Accounting, Treasury, Budget and Management.

### Limitations

Procurement cannot create or edit a request, approve/observe/return/reject an approval step, adjust or commit a budget, decide a budget exception, propose/verify/homologate a supplier, register invoices, process Accounting, schedule or confirm Treasury payments, control accounting periods, or manage users.

Order issuance still depends on Budget's prior commitment and Accounting/Admin's supplier readiness; Procurement cannot commit a budget or homologate a supplier itself to unblock its own order action. Reissuing an already-ordered request returns the existing order rather than creating a duplicate.

### Practical dashboard and example

Procurement's dashboard shows its own dedicated metrics, distinct from Budget's plan/commitment totals: approved requests still awaiting a Purchase Order, open Purchase Orders, recent orders, invoices registered against those orders, and pending supplier-validation warnings. Its sidebar is limited to Dashboard, Requests, Suppliers and Reports.

After Budget commits an approved A1 request's funds, Procurement confirms the recommended supplier's PRV code and issues the Purchase or Service Order. If the supplier is not yet homologated, Procurement asks Accounting to complete homologation rather than issuing the order against an ineligible supplier.

SOURCES S01 S02 S03 S05 S19 S23

<!-- pagebreak -->

## Management and Rectorate

**Stored role Management.** Management performs higher-level business approvals selected by the configured route and reviews institutional financial information.

### What Management can view

Dashboard, non-draft Requests, Approval Inbox, Budget and Management Reports. Request Detail exposes the submitted justification, financial amounts, quotations/payment terms, approval history and related execution records.

Management request lists/details are not restricted by area in the same way as a Director's decision authority. The management-report request filter applies area restrictions to Approver users, not automatically to Management users.

### What Management can do

- Approve, observe, return or reject an active step assigned to Management and matching the user's approvalLevel.
- Approve or reject a pending budget exception. Management is the only role that may decide one — Budget and Admin can only prepare it or mark it reviewed, and Admin can never approve it directly, only repair the exception-approver configuration if it is broken.
- Review institutional budget availability, commitments, spending, pending approvals and financial execution.
- View and export permitted management reports.

The seeded Management profile uses RECTORATE. GENERAL_MANAGEMENT is another supported approval-level value, but assigning that value alone does not add a required step to every request. The user assignment and approval rule must agree.

### Limitations

Management cannot substitute for a Director or Vice Rector while assigned another approval level, approve its own request, skip required approvals, or approve a request merely because its amount is high.

Management cannot create/edit requests, manually adjust budgets, decide budget exceptions, maintain suppliers or bank accounts, post Accounting, execute Treasury, or manage users/configuration under the default role.

A completed approval by a Management user is explicitly handed to Budget for financial completion. Management approval does not itself perform the budget/order handoff used after some other final approval actors.

### Amount rules and example

The seed configuration contains a Rectorate rule whose name refers to CAPEX above PEN 100,000. Its numeric condition is actually **PEN 100,000 or more**, because amountFrom is inclusive and the amount is evaluated in PEN equivalent. This is a seeded example, not a permanent role limit or a claim about the current live settings.

For an applicable CAPEX request that reaches its Rectorate step, Management can approve after checking the business case and prior approvals. Budget then performs the permitted financial handoff.

SOURCES S01 S02 S03 S04 S06 S07 S23

<!-- pagebreak -->

## Management Viewer

**Stored role ManagementViewer.** ManagementViewer is a strictly read-only profile: every permission it holds (`management-portal:view`, `report:view`, `audit:view`) is a view/report/audit token, and the role never appears in an `authorize()`/`authorizePermission()` check on a POST, PUT, PATCH or DELETE route anywhere in the codebase. It was recently expanded from an external aggregate-only portal account to also reach the internal Reports module and the global audit log.

### What ManagementViewer can view

The external institutional Management API (`/api/management/v1` — overview, budget, workflow, payments, SLA and filter aggregates, with its own documentation at `/api/management/v1/api-docs` and OpenAPI document). That external API's own documentation states it "does not expose transaction-level records, personal data, supplier identifiers, bank details, files, or write operations."

The internal Reports module's management summary and CSV export/export-history endpoints — the same `/reports/management*` routes Approver, Accounting, Treasury, Budget, Procurement and Management use. The global audit log and per-request audit timeline through `audit:view`, exactly like Accounting (the audit routes check only that permission, with no additional role restriction).

Its sidebar is limited to Management Portal, Reports and Audit. It has no Dashboard or Requests entry, and — unlike every other profile — it cannot view an individual request or the request list at all: it lacks request:view-all and is neither a requester nor an approver on any request, so the request-visibility filter returns nothing for it even if it reached that screen.

### What ManagementViewer can do

- Call the read-only external Management API endpoints for institutional aggregates.
- View the internal management-report summary and generate/download its CSV export directly from that endpoint.
- Read the global audit log and a request's audit timeline.

### Limitations

ManagementViewer cannot create, edit, approve, commit, homologate, schedule, confirm, reconcile, certify, or configure anything. It cannot open Requests, Suppliers, Accounting, Treasury, Budget, or any configuration screen. It is excluded from the approval-decision route entirely: `approvalRoutes.js` explicitly authorizes every other stored role and excludes only ManagementViewer.

A previously generated report file is downloaded through the same generic stored-file route as other categories, and that route's role list for the "reports" category was not changed when ManagementViewer was added (it remains Admin, Approver, Accounting, Treasury, Budget and Management). So ManagementViewer can generate and immediately download a fresh CSV export, but cannot later re-download that same file from the generated-exports history list; a fresh call to the export endpoint is required each time.

### Example

An institutional trustee or auditor is given a ManagementViewer account to review spend, budget and workflow aggregates and the audit trail without being able to act on any individual request, supplier, or payment. They can read the history behind a suspicious entry but cannot correct it — that remains Accounting/Admin's job.

SOURCES S01 S02 S03 S16 S18 S26 S27

<!-- pagebreak -->

## Approval routes and financial handoffs

### Rules determine which approvals apply

Approval routes are selected using active rules, request area, request type, flow type and PEN-equivalent amount. amountFrom and amountTo are inclusive. Matching exact-flow rules take precedence over wildcard-flow rules. Required steps are processed by sequence and captured on the request.

For A1 and other ordinary flows with no matching rules, the fallback route is Area Director then Vice Rector, normally 24 hours per step. Track B uses an explicitly configured B route or an express Area Director fallback of four hours. A due date or overdue indicator is an SLA signal, not automatic approval or a new permission.

Track B eligibility is gated separately from its approval route: a request can only be submitted as Track B when an active Track B eligibility rule — matching area, expense nature and PEN-equivalent amount, configured by Admin — covers it. This check runs at submission (not at draft save), and a request with no matching rule is rejected before any route is even selected; the requester must resubmit through Track A1 instead.

Seed examples include area Director rules, Vice Rector, and a CAPEX Rectorate threshold of PEN 100,000 with a 36-hour SLA. Admin can change the rules. Check the current rule and request snapshot for a specific case; do not treat seed amounts as fixed spending authority.

### Handoff by track

| Track | Operational handoff and ownership |
| --- | --- |
| A1 formal procurement | Requester supplies need and quotations; configured approvers decide; final approval automatically reserves/commits the budget. Order issuance is a separate, manual step: Admin/Procurement issue the Purchase or Service Order once that commitment exists (Budget's part ends at the commitment). Requester or Accounting supplies XML, PDF and conformity after the order stage. Valid invoices can provision CXP before Treasury payment, which can now be confirmed in full or in part (PARTIALLY_PAID) rather than only fully paid. |
| A2 invoice batches | Requester or Accounting uploads a batch against an eligible order; the worker validates invoices and provisions valid items. Accounting/Admin resolves observed items. An upload permission does not authorize overriding duplicate, SUNAT or order-ceiling controls. |
| B direct payment | Only available when an active Track B eligibility rule matches the request's area, expense nature and amount; otherwise submission is rejected. Requester supplies the required fiscal evidence; express approval is selected by rule. Successful final processing validates fiscal data, reserves applicable budget and provisions CXP (also capable of a PARTIALLY_PAID state before full payment). Treasury performs the payment. |
| C advance and rendition | Requester obtains advance approval and later submits the rendition. The workflow provisions the advance and Treasury pays. Accounting validates the final expense treatment and any non-deductible balance; eligible settlement can be recorded by Accounting/Treasury/Admin. |

### Decisions that stop or defer progress

Observe, Return and Reject require comments. Approval requires the current pending step and validated controls. Self-approval is blocked except for Admin with an explicit override reason. A missing supplier homologation or insufficient budget can leave approval completed but financial handoff unresolved.

Management completion has a separate Budget handoff. The existence of an approval permission does not give Management manual budget or order permission. Likewise, automated provisioning by a valid invoice or batch is not an Accounting menu permission for the uploader.

SOURCES S04 S06 S07 S21 S22 S23

<!-- pagebreak -->

## Financial and configuration limits

### Budget controls

Admin and Budget create/adjust annual/monthly plans and maintain allocations/rules. Only Management may decide (approve/reject) a budget exception; Admin and Budget can prepare one or mark it reviewed, but never approve or reject it themselves. Directors, Vice Rector, Accounting and Management can read the Budget module. Treasury, Procurement and Requester do not have that module, although individual requests can display related budget data.

Budget availability is calculated from the applicable dimensions, period and commitments/execution. Monthly limits can block a transaction even where annual capacity remains. A supported adjustment or exception must be processed by the authorized profile; typing a different requested amount does not override the configured controls.

### Periods and master data

Admin/Accounting maintain accounting periods, cost centers, expense types, projects, exchange rates, document rules, accounting mappings and Finance settings. Admin alone maintains approval rules and the Track B eligibility-rule configuration (area/expense-nature/amount) that now gates whether a requester can submit through Track B at all. Admin alone creates, edits, and deactivates bank-file format configurations; Treasury shares only the narrow certify/decertify action on an existing format. Budget writes budget rules/allocations and can read Finance settings.

Closed-period controls are action-specific. They affect request changes, approvals and financial transitions according to the saved policy. Admin/Accounting may reopen a period through its controlled action; broad role access does not implicitly override the closed-period guard.

### Payment and procurement controls

Procurement readiness requires a complete required approval route, the applicable request/expense type, valid commitment and documents, and a homologated active supplier with its PRV code. Procurement (or Admin) issues the order once these conditions are met; Budget's own role ends at the commitment step that makes readiness possible. Order snapshots capture request lines and the recommended supplier's payment terms. Editing a quotation later does not replace an already issued order's terms.

Payment-term cards and automatic IGV calculations simplify entry; they do not change role permissions. Users enter source values. The server derives item financial amounts and payment splits. Those display totals are not an authorization to change a budget, payable, journal entry or bank destination.

### Renditions and exception handling

The requester submits only an owned eligible rendition. Accounting/Admin validates submitted renditions and reviews employee-bank verification. For a validated Track C non-deductible balance, settlement requires a supported method, a receipt/payroll reference, and a positive amount no larger than the outstanding balance.

Treasury/Admin can reprogram a bounced payable only through the supported evidence-based workflow. The signed CCI replacement document is required. Supplier bank verification remains with Accounting/Admin; reprogramming is not a shortcut to verify bank data.

SOURCES S05 S11 S12 S15 S17 S21 S22 S24 S25

<!-- pagebreak -->

## Data visibility and download boundaries

### Requests and related records

Requester ownership is enforced on request details, modification, submission, invoice registration and rendition submission. Approver/Management direct request access excludes drafts. Other operational roles can read all requests, including drafts.

Request Detail returns related accounting, budget, order, payment and audit information. The global audit log is restricted to Admin/Accounting by default, but an authorized request viewer can read that request's audit history through Request Detail.

The common dashboard scopes Requesters to their own records. Other roles receive a broader common summary/recent-request feed. Therefore, the direct-request draft restriction should not be described as a guarantee that an approver sees no draft-related information anywhere.

### Banking visibility

Dedicated Supplier APIs show full bank information to Admin, Accounting and Treasury. A Requester sees full bank data for a proposal they created only while it is pending validation or observed; other bank values are masked.

Employee bank profile access is limited to Admin, Requester, Accounting and Treasury. Requesters list their own profiles. The dedicated request rendition-destination endpoint is further restricted to the owner or those finance roles; the owner receives masked snapshot values, while the finance roles receive full values.

Related payable/payment-batch serializers mask bank account values for users outside Admin, Accounting and Treasury. These are endpoint-specific protections. The primary request payload also populates related documents, so the current implementation should not be described as universal field-level banking redaction across all response paths.

### Files and exports

| Stored file category | Current access rule |
| --- | --- |
| Request uploads | Allowed when the user can view the parent request |
| Supplier uploads | Supplier-view roles; Requester additionally must own a pending/observed proposal |
| Generated bank files | Admin, Accounting and Treasury |
| Generated accounting files | Admin and Accounting |
| Generated management reports | Admin, Approver, Accounting, Treasury, Budget and Management |
| Batch observation XML/PDF | Dedicated batch-review permission; Admin/Accounting by default |

Generated report-file downloads are category/role-based, not rechecked against the requesting user's area or the original export's ownership. Management-export history also has no per-user/area ownership filter. Area-limited report generation must therefore not be presented as end-to-end export-file confidentiality.

SOURCES S02 S03 S13 S14 S16 S18 S19 S26

<!-- pagebreak -->

## Current limitations administrators should understand

### Permissions and navigation are separate layers

A role matrix, the named-permission catalog, the sidebar and the route gates are not identical. Accounting can void an eligible request through explicit role/workflow checks despite lacking the default request:void token. Budget can access a configuration screen without being authorized to write projects. An extra token does not bypass an explicit role gate. Procurement previously illustrated the opposite failure mode: a global route-gate defect blocked the role from the API entirely even though its ROLE_PERMISSIONS entry was correct. That defect is now fixed — a correct catalog entry is necessary but was not, on its own, sufficient.

There is no subtractive per-user deny mechanism in permissionsFor. Removing a token from a user's extra-permission list does not revoke a permission inherited from the role. Changing an assignment should include a review of role, level, areas, CECOs and extra permissions together.

### Reading can be broader than the intended working queue

The approval action checks stage, role and area, while the Requests list permits wider non-draft reading. The inbox normally applies the user's stage but its stage query parameter can change the displayed filter; action authorization is checked again when a decision is submitted.

Budget overview, plan, commitment and exception reads are not automatically restricted to the approver's area. Some report panels read budget/reference data independently of the area-filtered request query. Several master-data list routes require authentication only, even where the matching maintenance menu is hidden. Treat those lists as shared reference access, not as proof of a write permission.

### Segregation of duties has specific boundaries

Approver self-approval is blocked, with a reasoned Admin exception. There is not a universal second-person requirement for every Accounting and Treasury operation. For example, the Treasury role can both generate a bank file and confirm payment. Bank-side authorization and organizational review remain distinct from those application actions.

A general Management or GENERAL_MANAGEMENT label does not guarantee every custom route can finish. The route must satisfy the implemented lifecycle and actor checks. New combinations should be tested end to end before they are used operationally.

### Administration recommendations

Review extra permissions sparingly; use separate user accounts for different people; keep area and CECO assignments current; review high-impact Admin activity; and verify access from the intended role after changes. These are operating recommendations, not newly enforced controls.

This documentation records the current behavior. It does not change role permissions, close the identified visibility gaps, or certify that every configured deployment enforces a stricter institutional policy.

SOURCES S01 S02 S03 S06 S07 S15 S18 S19 S23 S26

<!-- pagebreak -->

## Common questions and role assignment

| Situation | Explanation and responsible profile |
| --- | --- |
| A Director sees a request but cannot approve it | Check the active stage, route role, assigned approval level and allowed area. Admin corrects assignments; the current responsible approver makes the decision. |
| A requester cannot edit a submitted request | Editing is limited to owned correctable states. The active approver observes/returns it when correction is required. |
| An approved request has no order | Check remaining approvals, supplier/PRV readiness, evidence and budget commitment. Budget/Admin commits the budget; Procurement/Admin then issues the order — Budget no longer issues it. Accounting handles supplier readiness. |
| Annual funds exist but the month fails | The plan's monthly control can also apply. Budget/Admin reviews the monthly balance, plan adjustment or permitted exception. |
| Treasury cannot select a bank account | Check active CURRENT type, bank/currency, verification/ownership, and whether a destination is frozen. Accounting/Admin verifies supplier banking. |
| A requester cannot resolve a batch observation | Uploading is separate from reviewing. Accounting/Admin resolves the observation and retries processing where appropriate. |
| Accounting cannot generate a payment file | Accounting can download an existing bank file but Treasury/Admin performs generation and payment actions. |
| An extra permission does not reveal a menu | The menu and many API routes use stored roles. Admin must review the complete assignment rather than assuming the token unlocks a module. |
| A Management approval is complete but funding is pending | Management completion is deliberately handed to Budget for the financial step. |
| A period blocks an otherwise permitted action | Admin/Accounting reviews the period and the relevant policy. Broad permissions do not automatically bypass it. |

### Assigning a user correctly

1. Choose the person's operational responsibility, then assign the corresponding stored role.
2. For Director, Vice Rector or Management, set the exact approvalLevel and verify matching active approval rules.
3. Set the user's area and approvalAreas. Use wildcard scope only where institution-wide authority is intended.
4. For Requesters, set the primary cost center and any authorizedCostCenters.
5. Review additional permissions separately. They are additive and do not replace role/stage/ownership controls.
6. Verify the account is active and check both a permitted action and a prohibited action using the intended profile.
7. When duties end, deactivate the account. Historical audit activity remains associated with that user.

SOURCES S01 S02 S06 S07 S11 S12 S17 S20 S23

<!-- pagebreak -->

## Technical permission catalog

The following table is generated from the current default permission catalog. It identifies inherited tokens, not every effective endpoint action. DIR and VR share the Approver row. PRO is Procurement and MGV is ManagementViewer. Custom user permissions are additive.

| Permission token | Default profiles |
| --- | --- |
| request:create | ADM, REQ |
| request:view-all | ADM, DIR VR, ACC, TRE, BUD, PRO, MGT |
| request:approve | ADM, DIR VR, MGT |
| request:void | ADM |
| supplier:propose | ADM, REQ |
| supplier:homologate | ADM, ACC |
| supplier:bank-view | ADM, ACC, TRE, PRO |
| budget:view | ADM, DIR VR, ACC, BUD, MGT |
| budget:manage | ADM, BUD |
| accounting:process | ADM, ACC |
| period:manage | ADM, ACC |
| treasury:schedule | ADM, TRE |
| treasury:file | ADM, TRE |
| payment:confirm | ADM, TRE |
| payment:reconcile | ADM, TRE |
| report:view | ADM, DIR VR, ACC, TRE, BUD, PRO, MGT, MGV |
| management-portal:view | ADM, MGT, MGV |
| audit:view | ADM, ACC, MGV |
| master-data:manage | ADM, ACC |
| user:manage | ADM |
| employee-bank:manage-own | ADM, REQ |
| employee-bank:review | ADM, ACC |
| employee-bank:view-payment | ADM, ACC, TRE |
| rendition:review | ADM, ACC |
| procurement-order:create | ADM, PRO |
| batch-invoice:upload | ADM, REQ, ACC |
| batch-invoice:review | ADM, ACC |
| payment:reprocess | ADM, TRE |
| bank-format:certify | ADM, TRE |

The default counts are Admin 29, Requester 4, Director 4, Vice Rector 4, Accounting 14, Treasury 10, Budget 4, Procurement 4, Management 5 and ManagementViewer 3. A token is only one layer of access: use the capability matrices and limitations above when assigning responsibilities.

SOURCES S01 S02

<!-- pagebreak -->

## Source register and maintenance

The guide is based on the repository's current role catalog, server routes, service guards, navigation rules and seed definitions, reviewed on 24 September 2026. It describes default application behavior rather than the saved settings of a particular live user.

| Source | Repository path and subject |
| --- | --- |
| S01 | backend/src/utils/constants.js and backend/src/models/User.js - roles, permission defaults, user fields |
| S02 | backend/src/utils/permissions.js and backend/src/middleware/auth.js - ownership, role/permission gates |
| S03 | frontend/src/utils/navigationAccess.js - visible module access |
| S04 | backend/src/seed/seed.js - eight core profiles and example approval rules |
| S05 | backend/src/routes/requestRoutes.js and backend/src/services/requestService.js - request operations |
| S06 | backend/src/routes/approvalRoutes.js and backend/src/services/approvalService.js - approval decisions and handoff |
| S07 | backend/src/services/approvalRuleService.js - route selection and stage completion |
| S08 | backend/src/routes/accountingRoutes.js - Accounting processing and exports |
| S09 | backend/src/routes/batchInvoiceRoutes.js - batch upload/review route gates |
| S10 | backend/src/routes/employeeReimbursementBankRoutes.js - employee profile operations |
| S11 | backend/src/routes/treasuryRoutes.js and backend/src/services/treasuryService.js - payment actions |
| S12 | backend/src/routes/budgetRoutes.js and backend/src/controllers/budgetController.js - budget actions |
| S13 | backend/src/routes/supplierRoutes.js and backend/src/services/supplierService.js - supplier/proposal banking |
| S14 | backend/src/services/employeeReimbursementBankService.js - ownership, verification and banking visibility |

<!-- pagebreak -->

## Source register continued

These sources complete the reference list for configuration, reporting, workflow guards and data visibility.

| Source | Repository path and subject |
| --- | --- |
| S15 | backend/src/routes/masterDataRoutes.js - configuration and master-data gates |
| S16 | backend/src/services/fileAccessService.js and backend/src/routes/sireRoutes.js - downloads and SIRE |
| S17 | backend/src/services/periodService.js - accounting period policies |
| S18 | backend/src/controllers/reportController.js and backend/src/routes/reportRoutes.js - report scope and exports |
| S19 | backend/src/controllers/dashboardController.js - common and role-specific dashboard scope |
| S20 | backend/src/routes/userRoutes.js and backend/src/controllers/userController.js - account administration |
| S21 | backend/src/services/invoiceRegistrationService.js - A1 invoice ownership and evidence |
| S22 | backend/src/services/renditionService.js and backend/src/services/batchInvoiceService.js - rendition and batch controls |
| S23 | backend/src/services/workflowService.js and backend/src/services/procurementReadinessService.js - lifecycle gates |
| S24 | backend/src/services/paymentDestinationService.js - eligible and frozen bank destinations |
| S25 | backend/src/services/budgetPlanService.js and docs/ANNUAL_MONTHLY_BUDGETS.md - annual/monthly planning |
| S26 | backend/src/routes/auditRoutes.js and backend/src/services/requestService.js - global versus request audit access |
| S27 | backend/src/routes/externalManagementRoutes.js and backend/src/routes/managementDocsRoutes.js - external Management API scope and its own documentation |

The default-permission unit checks were run during this review and passed. Detailed claims were checked against route and service code; the guide does not represent a new end-to-end certification of every role and deployment configuration.

**Maintenance.** Update this guide when the role catalog, navigation, route gates, masking, approval rules, budget workflow or payment controls change. Recheck any organization-specific policy against the actual enforcement path before treating it as a restriction in the platform.
