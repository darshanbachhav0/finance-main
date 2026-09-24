# UMA Financial Management System — Platform vs. Consolidated Documentation

**Comparison date:** 2026-09-24
**Spec compared against:** `UMA_Financial_Management_System_Final_Documentation_EN.docx`, v2.0 — Consolidated Recommended Baseline (23 Sept 2026)
**Method:** Six parallel code audits, one per spec domain, each verifying specific requirements against `backend/src` and `frontend/src` with file:line evidence. No files were modified during the audit.

## Executive summary

The codebase is a close, largely faithful implementation of the consolidated spec — not a partial or divergent build. Every "final adopted rule" the document treats as non-negotiable is correctly implemented in code:

- Payment is posted only after confirmed bank execution, never at TXT generation (`treasuryService.js:360-506` vs `508-599`).
- BBVA is the only reachable outbound bank generator, with byte-exact 151/277-byte fixed-width records, PEN/USD separation, and Latin-1 encoding.
- Supervisor relationships are an explicit, maintained field — never inferred from Cost Center/area.
- Track A2 tracks each invoice's CXP independently and aggregates the parent only when all children reach the same milestone; Track C keeps advance payment and rendition as two independent dimensions.
- SUNAT XML is authoritative over manual entry; duplicate vouchers are blocked at the database level; SIRE is generated at voucher granularity with export-only (no direct SUNAT submission).
- AuditLog is append-only at the schema level (blocked at the Mongoose middleware layer, not just by convention).

The gaps below are specific and scoped — mostly segregation-of-duties nuances, a few hardcoded shortcuts that bypass configuration the spec expects to be meaningful, and dashboard/role coverage that hasn't caught up to the spec's per-role detail. Nothing found requires a rebuild; each item below is an independent, targeted fix.

---

## Priority 1 — Financial/control-integrity gaps (fix before production certification)

### 1.1 Treasury can schedule payments for obligations with open observations
**File:** `backend/src/services/treasuryService.js:115`
The eligible-AP status allowlist for `loadPaymentItems` includes `OBSERVED_BATCH`, `OBSERVED_SUNAT`, and `OBSERVED_AMOUNT_EXCEEDED`. The spec (§12.1) requires Treasury eligibility to include "absence of blocking observations" as a precondition for scheduling.
**Why it matters:** An invoice with an unresolved SUNAT mismatch or amount-exceeded flag could still enter a payment batch and be paid before the observation is resolved — this is exactly the kind of silent-fallback risk the spec's "no silent fallback" operating principle (§2.3) is meant to prevent.
**Recommended change:** Exclude `OBSERVED_*` statuses from the Treasury eligibility query, or require an explicit resolved/override flag with the same admin-repair-style audit trail already used elsewhere (e.g. `periodAdministrationService.js`).

### 1.2 Budget "Phase 1 / Phase 2" mode is not actually enforced per configuration
**File:** `backend/src/services/budgetService.js:182`
`BudgetRule` correctly models a `mode` (`TRANSITIONAL`/`ACTIVE`) with an effective date, resolved by `resolveRule()`. But the real commitment path overrides it: `const mode = "ACTIVE"; // New commitments always enforce available funds.` TRANSITIONAL only affects the read-only `previewBudget()` display and the legacy Track C path.
**Why it matters:** The spec's two-phase model (§10.1) exists specifically so Finance can run informational-only budget checks during transition, per Cost Center, with an effective date. As implemented, that configuration is decorative for new commitments — every new commitment blocks on insufficient funds regardless of what `BudgetRule.mode` says, which could unexpectedly halt legitimate work in Cost Centers Finance intended to keep informational.
**Recommended change:** Make `reserveBudget()` read the resolved `BudgetRule.mode` for the request's dimensions instead of hardcoding `"ACTIVE"`, and store the mode used on the commitment (this part — snapshotting the mode on `BudgetCommitment.lines[].mode` — is already correctly implemented and just needs a real value flowing into it).

### 1.3 BBVA file "certified" state has no real workflow
**File:** `backend/src/services/treasuryService.js:466`; `backend/src/models/BankFormatConfiguration.js`
`GeneratedFile.metadata.certified` is a hardcoded `false` literal inside a `Mixed` blob — no code path ever sets it to `true`. A real `certified` boolean exists on `BankFormatConfiguration`, but it only gates whether the adapter is allowed to run (`BbvaBankFileAdapter.js:40`), not whether a specific generated file/version was formally accepted by Treasury/the bank after the fact.
**Why it matters:** The spec's go-live gate (§19, §12.3) explicitly blocks production Treasury use "until BBVA PEN and USD output is accepted by Treasury/bank and the generated-file configuration is explicitly marked certified." Without a real per-file certification workflow, there's no way to prove — or query — which specific file version/hash was the one Treasury/BBVA actually accepted.
**Recommended change:** Add a first-class `certified`/`certifiedAt`/`certifiedBy` field to `GeneratedFile` (not buried in `Mixed`), with a dedicated Treasury-only endpoint to mark a specific generated file certified after bank acceptance, audited the same way `periodAdministrationService.js` audits admin overrides.

---

## Priority 2 — Segregation-of-duties / structural divergences the spec calls out explicitly

### 2.1 Procurement is not a distinct role
**File:** `backend/src/utils/constants.js:1-10` (`ROLES`); `backend/src/routes/requestRoutes.js:44`
`createProcurementOrder` is gated to `ADMIN, BUDGET`. There is no `Procurement`/`Compras` role at all.
**Why it matters:** Spec §20 ("PO ownership") states this exact conflict and resolves it explicitly: *"Procurement/Compras owns PO issuance; Budget only confirms/commits funds."* Today the same role that reserves the budget also issues the purchase order — the segregation the spec calls a final rule doesn't exist in code.
**Recommended change:** Add a `PROCUREMENT` role and move PO-issuance authorization to it, leaving `BUDGET` with commit/release/exception-preparation authority only.

### 2.2 Manager-chain approval routes are built one step at a time, not frozen in full at submission
**File:** `backend/src/services/approvalRuleService.js:184-248` (`appendNextChainStep`)
Comment at lines 204-208 confirms the route is "built one decision at a time" — each subsequent supervisor step is only appended when the current approver chooses to forward. The amount/track/CeCo rule-based route (non-manager-chain) *is* built and frozen correctly at submission (`initializeApprovalRoute`).
**Why it matters:** Spec §8.1 steps 3-4 require the *complete* intended route (including required next-level management) to be constructed and snapshotted at submission, specifically so later org changes can't rewrite an in-flight request and so SLA/visibility tooling can show the whole path upfront. As implemented, nobody — including the requester or an SLA dashboard — can see how many approval hops a manager-chain request will actually need until each hop happens.
**Recommended change:** At submission, resolve the full active supervisor chain up to the required policy depth and snapshot it, while still allowing the existing forward mechanism to operate within that pre-built route (matching how the rule-based route already works).

### 2.3 Legacy `APROBADO_DIRECTOR`/`APROBADO_VICERRECTOR` remain live parent states
**File:** `shared/workflowStatus.mjs:1-9`; `backend/src/services/workflowService.js:29-33`
The canonical 11-state list is declared, but the two-stage approval flow actually transitions through `APROBADO_DIRECTOR`/`APROBADO_VICERRECTOR` as live states rather than collapsing to canonical `APROBADO` with per-approver detail kept in `ApprovalStep`/`approvalHistory`. `LEGACY_WORKFLOW_STATUSES` does not alias these away.
**Why it matters:** Spec §20 records this exact conflict and adopts a specific final rule: generic parent `APROBADO` after the frozen route completes, with individual approvals kept as step-level events — precisely so the parent status model isn't hard-coded to specific organizational titles that may not exist in every hierarchy. Leaving both title-specific states live undermines the scalability reason the spec gives for the change.
**Recommended change:** Transition the parent to canonical `APROBADO` once the frozen route's steps are all complete; keep `APROBADO_DIRECTOR`/`APROBADO_VICERRECTOR` only as derived labels/history events for backward compatibility, as the spec's compatibility note allows.

### 2.4 Managers cannot see who reports to them
**File:** `backend/src/routes/userRoutes.js:8` (Admin-only); no "my team" endpoint found anywhere in `userController.js` or frontend
Only Admins can list users. A manager approving requests has no endpoint to see their own direct reports.
**Why it matters:** Spec §3.2 ("Hierarchy rule") and §8.2 both state a manager should see "the people assigned beneath them," and the Supervisor dashboard (§15) is specified to include "people in assigned hierarchy." This is currently a straightforward Missing, not a Partial.
**Recommended change:** Add a scoped `/users/direct-reports` (or similar) endpoint restricted to the caller's own `jefe`-chain subordinates, and surface it on the Supervisor dashboard.

---

## Priority 3 — Coverage gaps (valuable, not control-critical)

### 3.1 Role-specific dashboards are generic, not purpose-built per role
**File:** `backend/src/controllers/dashboardController.js:106-222`; `frontend/src/pages/Dashboard.jsx`
One generic dashboard renders role-templated metrics. Coverage against spec §15 is uneven:
- **Procurement dashboard:** Missing entirely (follows directly from §2.1 — no Procurement role exists to key off of).
- **Higher Management:** missing cycle-time and exceptions views.
- **Accounting:** missing unaccounted-vouchers, supplier-balances, and SIRE-readiness widgets.
- **Treasury:** missing weekly-schedule grouping, batch-status breakdown (executed/bounced), and reconciliation backlog.
- **Supervisor:** missing "people in hierarchy" (follows from §2.4) and spend-by-area/CeCo.
**Recommended change:** Treat this as a backlog once §2.1/§2.4 land — the missing widgets are additive (all underlying data already exists and is derived from source records, per the audit's finding #9 that reports have no separately-edited totals to worry about).

### 3.2 `Auditor` and `Supplier/Accounting Validation` are not distinct roles
**File:** `backend/src/utils/constants.js:1-10`
`Auditor` is folded into `ManagementViewer` (an `AUDIT_VIEW` permission exists but isn't exclusive to a dedicated role); supplier/accounting validation is folded into the general `Accounting` role.
**Why it matters:** Lower risk than §2.1/§2.4 since the permissions largely exist under other roles, but it reduces the access-control granularity the spec's role table (§3.3) anticipates — e.g. an external auditor account currently must be given the broader `ManagementViewer` role rather than a role scoped tightly to audit evidence.
**Recommended change:** Split `Auditor` out as its own role wired to existing `AUDIT_VIEW`-gated routes; lower priority than the others above.

### 3.3 Budget exception approval authority is a single hardcoded role
**File:** `backend/src/services/budgetExceptionService.js:6-17`
Only the `Management` role may approve/reject an exception; `Budget`/`Admin` may only prepare one. This correctly implements the prepare-vs-approve segregation the spec requires (§10.3), but doesn't route to *different* authority levels by amount/type/unit the way §10.3 and the role table (§3.3, "Rectorate/General Management... according to configured thresholds") implies.
**Recommended change:** Lower priority — the core segregation-of-duties control already exists and is sound; graduated routing by exception size/type/unit is an enhancement, not a gap that needs closing before other items.

---

## Priority 4 — Cleanup / low-risk legacy debt

### 4.1 Dead BCP/Interbank/Scotiabank adapter files remain in the repo
**Files:** `backend/src/integrations/banks/BcpBankFileAdapter.js`, `InterbankBankFileAdapter.js`, `ScotiabankBankFileAdapter.js`
`assertBbvaSource()` correctly hard-rejects any bank but BBVA at the service layer, and these three adapters are never imported or reachable from any route — they're effectively inert. But the spec (§12.2, §20) calls for them to be "hidden/disabled," and shipping dead code that *looks* like a working generator is an avoidable audit and future-accidental-exposure risk.
**Recommended change:** Delete the three inert adapter files (or move them to a clearly-labeled non-production reference folder) now that BBVA-only is enforced structurally — there's no remaining reason to keep them live in `integrations/banks/`.

### 4.2 `RENDICION_PENDIENTE` / `PROVISIONADO_CXP` survive as parent-level legacy values in seed/migration data
**File:** `backend/src/seed/seed.js:1088,1147,1166`; `shared/workflowStatus.mjs:7-8`
Current live code never assigns these to `request.status` directly (they're correctly handled as aliases/derived fields), but historical seed/migration rows still use them as literal parent statuses.
**Recommended change:** A one-time data-migration pass to normalize any surviving legacy rows to their canonical equivalents, consistent with the auto-repair migrations already present in this repo's history (e.g. `a0b52f3 Auto-repair legacy non-sparse email index`).

### 4.3 `ExchangeRate` model lacks a first-class retrieval-timestamp field
**File:** `backend/src/models/ExchangeRate.js:3-23`
Retrieval evidence (`fallback.used/reason`, `requestedDate`, `usedDate`) is stored as a `Mixed` blob on *consuming* documents (e.g. `AccountsPayable.exchangeRateEvidence`) rather than as first-class fields on `ExchangeRate` itself; there's no dedicated `retrievedAt` (only generic Mongoose `timestamps`).
**Recommended change:** Promote the evidence fields onto the `ExchangeRate` schema for cleaner querying/auditability — cosmetic/data-hygiene, not a functional gap.

---

## What's already correctly aligned (no action needed)

- DNI + password authentication, bcrypt hashing, DNI omitted from general API projections and non-admin screens.
- Explicit, maintained supervisor field (`User.jefe`) — never inferred from Cost Center/area; CeCo import never touches it.
- Approval route snapshot (for the rule-based route) frozen at submission; resubmission replays the stored snapshot rather than re-deriving live.
- Self-approval blocked unconditionally, including for Admin.
- Cost Center snapshot stored per request line, independent of later master-data corrections.
- AuditLog is append-only at the Mongoose middleware level (blocks update/delete operations outright, not by convention).
- Track A2: each invoice creates its own `AccountsPayable`; parent aggregates only when all children reach the same milestone; UI shows "N of M paid."
- Track C: advance and rendition are independent fields; `RENDICION_PENDIENTE`-equivalent state correctly blocks `CERRADO` without overloading the main payment status.
- **Payment timing (the spec's single most emphasized rule):** the accounting entry marking a request Paid is created only in `confirmPayable()`, never in `generatePaymentBatch()` — TXT generation and payment confirmation are fully separate, sequential, gated steps.
- BBVA fixed-width generator: exact 151/277-byte records, header/detail count and total reconciliation, PEN/USD never mixed, Latin-1 encoding enforced, hash/version/batch metadata stored.
- SUNAT XML authoritative over manual entry, with rejection (not silent overwrite) on mismatch.
- Duplicate voucher protection via composite DB unique index (supplier + type + series + number), reinforced at the service layer.
- SIRE/RCE generated at voucher granularity; explicitly export/preview-only, no direct SUNAT submission.
- Phase-aware document gates: 3-quotation requirement enforced at submission, invoice/XML/conformity enforced later at their real phases.
- Budget commitment strictly precedes procurement/accounting; distinct `EXECUTED` vs `COMMITTED` states; cancellation releases only the *unexecuted* residual and never deletes history.
- Period-close guard enforced server-side (HTTP 423), not just a UI warning.
- SLA due-soon/overdue/overdue+24h tiers with idempotent notifications (unique `eventKey` + upsert).
- Reports/dashboards compute figures live from source collections — no separately-maintained editable totals found anywhere.

---

*Generated from a six-part parallel code audit against `UMA_Financial_Management_System_Final_Documentation_EN.docx` v2.0. All file:line references were verified by direct code inspection at the time of this analysis; re-verify before acting if significant time has passed, as this is a snapshot of the codebase at commit `db1ffb3`.*
