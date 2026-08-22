# Official UMA Formats - Stage 2 Phase 2 Completion Report

Scope: `RCO-FOR-002` Supplier Master and Supplier Homologation only  
Verification date: 2026-08-19  
Repository: UMA Integrated Finance Allocation / CAPEX-OPEX / Accounts Payable Management System

## A. Overall Result

**PASS_WITH_NOTES**

The existing Supplier Master now implements the official RCO-FOR-002 onboarding and homologation process through the existing React, Express, MongoDB, upload, audit, RBAC, sequence, and SUNAT-provider architecture. The implementation is additive and preserves legacy suppliers, requests, banking history, and Treasury behavior.

Notes:

- The current important database was not migrated or reset.
- The pending Phase 1 migration is still required to populate official-format foundation fields such as PRV codes on existing records. Legacy records remain readable until authorized migration.
- SUNAT defaults to authorized `MANUAL` mode in this environment. No live SUNAT verification is claimed.
- External bank ownership verification is not configured. Bank review is recorded as an authorized manual Finance action.
- Phase 3 and all explicitly excluded Phase 2 scope were not started.

## B. Pre-Implementation Verification

- Branch: `main`
- Starting commit: `473b0178dc65110ba8b84cfec19aadd6ceee18e6` (`473b017 Update ERP gateway target`)
- The worktree was already dirty. Unrelated user files/changes, including `canges.txt`, `data/~$planation.docx`, `data/Camila.docx`, and the root Phase 1 report, were not reverted or modified as part of Phase 2.
- Phase 1 verified baseline: backend `55/55`, frontend `16/16`, production build successful.
- The RCO-FOR-002 workbook, supplier section of the PDF manual, Phase 1 completion report, Phase 1 catalog/migration documentation, models, services, routes, UI, and tests were re-read before implementation.
- Repository behavior matched the reported Phase 1 foundation. No replacement supplier collection, upload system, audit system, bank-history collection, or authentication system was introduced.

## C. Files Changed

### Backend

- `backend/src/controllers/supplierController.js`
- `backend/src/integrations/sunat/ManualSunatProvider.js`
- `backend/src/models/Supplier.js`
- `backend/src/models/SupplierBankAccount.js`
- `backend/src/routes/supplierRoutes.js`
- `backend/src/services/fileAccessService.js`
- `backend/src/services/sunatService.js`
- `backend/src/services/supplierService.js`

### Frontend

- `frontend/src/components/StatusBadge.jsx`
- `frontend/src/components/suppliers/SupplierDetail.jsx`
- `frontend/src/components/suppliers/SupplierForm.jsx`
- `frontend/src/pages/RequestCreate.jsx`
- `frontend/src/pages/RequestDetail.jsx`
- `frontend/src/pages/Suppliers.jsx`
- `frontend/src/styles/global.css`

### Tests

- `backend/test/financialLifecycle.test.js`
- `backend/test/officialFormatsFoundation.test.js`
- `backend/test/run.js`
- `backend/test/supplierPhase2.test.js`
- `frontend/test/run.js`
- `frontend/test/supplierPhase2Contracts.test.js`

### Translations

- `frontend/src/context/LanguageContext.jsx`

### Schema / Migration

- `backend/src/models/Supplier.js` adds optional proposal ownership and taxpayer-validation metadata.
- `backend/src/models/SupplierBankAccount.js` adds structural DETRACTION/Banco de la Nación and inactive/preferred validation.
- No Phase 2 migration script was required or added. All new Phase 2 fields are optional and additive.

### Documentation

- `docs/OFFICIAL_UMA_PHASE2_SCHEMA_ADDENDUM.md`
- `docs/OFFICIAL_UMA_PHASE2_COMPLETION_REPORT.md`

## D. Supplier UI

The existing Suppliers page was extended into a role-aware RCO-FOR-002 workspace. It retains the shared page header, DataTable, saved views, density control, export, portal action menu, mobile action sheet, Drawer, confirmation dialog, toast, status badge, and protected-file components.

Implemented sections:

1. Legal Identification: legal/commercial name, identifier, person type, fiscal address, location, website, legal representative, and representative document.
2. Commercial Contact: name, position, phone, and email.
3. Operations / Logistics Contact: separate name, position, phone, and email.
4. Commercial Conditions: PEN/USD, 30/45/custom terms, goods/services profile, and delivery method.
5. Banking Information: multiple active and historical accounts, preferred state, verification state, ownership review, CCI, and DETRACTION account type.
6. Compliance Declarations: both official Yes/No declarations and visible risk flags.
7. Mandatory Documents: updated RUC, legal representative identification, and official bank certificate using protected uploads.
8. Finance / Compliance Review: separate PENDING, APPROVED, OBSERVED, and REJECTED decision.
9. ERP Supplier Code: immutable PRV display or an honest pending-migration state for legacy records without a code.
10. Audit / History: append-only supplier event timeline.

Additional behavior:

- Onboarding starts with normalized identifier lookup. Existing records open instead of being duplicated.
- Homologation readiness shows specific backend issue codes, messages, and official/existing-rule sources.
- Request supplier choices and request detail display PRV where it exists; the full request form was not redesigned.
- English and Spanish are synchronized for Phase 2 labels, actions, statuses, rules, and feedback.
- Desktop and 390 px mobile layouts were verified. The Drawer becomes full-screen on mobile, the action menu becomes a bottom sheet, and no page-level horizontal overflow was found.

## E. Supplier API / Service Changes

| Method and endpoint | Action | Authorized roles | Authoritative field owner |
|---|---|---|---|
| `GET /api/suppliers` | Paginated/filterable supplier list | Admin, Accounting, Treasury, Solicitor | Server applies role-aware projection/masking |
| `GET /api/suppliers/lookup/:identifier` | Normalized lookup before onboarding | Admin, Accounting, Treasury, Solicitor | Server normalization and uniqueness rules |
| `POST /api/suppliers` | Create pending supplier proposal with protected evidence | Admin, Accounting, Solicitor | Proposer fields only; actor/time from JWT/server |
| `GET /api/suppliers/:id` | Detail, bank history, documents, permissions | Admin, Accounting, Treasury, Solicitor | Server masks banking for unrelated Solicitors |
| `GET /api/suppliers/:id/homologation-readiness` | Structured blocking issues and risk warnings | Admin, Accounting, Treasury, Solicitor | Shared backend validator |
| `PATCH /api/suppliers/:id/proposal` | Correct permitted proposal fields and upload evidence | Admin, Accounting; owning Solicitor in pending/observed lifecycle | Explicit proposal whitelist |
| `POST /api/suppliers/:id/bank-accounts` | Add a new PENDING account without replacing history | Admin, Accounting; owning Solicitor in editable lifecycle | Proposer supplies account facts only |
| `POST /api/suppliers/:id/bank-accounts/:accountId/verify` | Finance verification and ownership decision | Admin, Accounting | Finance actor/time/source/status |
| `POST /api/suppliers/:id/bank-accounts/:accountId/preferred` | Change preferred account in scoped unique group | Admin, Accounting | Finance action, audited |
| `DELETE /api/suppliers/:id/bank-accounts/:accountId` | Deactivate account while retaining history | Admin, Accounting | Finance action, audited |
| `POST /api/suppliers/:id/taxpayer-validation` | Record provider/manual taxpayer result | Admin, Accounting | Provider/server actor and match metadata |
| `POST /api/suppliers/:id/review` | Record Finance PENDING/APPROVED/OBSERVED/REJECTED | Admin, Accounting | Backend owns reviewer and review date |
| `POST /api/suppliers/:id/homologate` | Run centralized validator and assign/retain PRV | Admin, Accounting | Atomic backend operation |
| `PUT /api/suppliers/:id` | Preserve legacy Admin/Accounting update compatibility | Admin, Accounting | Explicit server whitelist and workflow locks |
| `DELETE /api/suppliers/:id` | Deactivate supplier, not erase history | Admin, Accounting | Audited server action |

No controller mass-assigns supplier or bank review data from `req.body`. The service separates proposer, Finance-review, banking-review, and system-owned fields.

## F. Homologation Rules

| Rule | Source | Blocking / Non-blocking | Responsible role / permission |
|---|---|---|---|
| Normalize RUC/DNI and reject a duplicate identifier | RCO-FOR-002 legal identification; existing Supplier unique identifier rule | Blocking | Backend; proposal roles initiate lookup |
| Legal name is required | RCO-FOR-002 legal identification | Blocking | Proposer; backend validates |
| Person type is required for a new official supplier | RCO-FOR-002 person-type field | Blocking | Proposer; backend validates |
| Fiscal address is required | RCO-FOR-002 fiscal address; PDF manual supplier guidance | Blocking | Proposer; backend validates |
| Legal representative and representative document are required | RCO-FOR-002 legal representative section | Blocking | Proposer; backend validates |
| Registration justification is required for new proposals | RCO-FOR-002 `A41:G43` | Blocking at proposal creation | Proposer; backend validates |
| Updated RUC document is present | RCO-FOR-002 `A5:G6` | Blocking final homologation | Proposer uploads; Finance reviews |
| Legal representative identification is present | RCO-FOR-002 `A5:G6` | Blocking final homologation | Proposer uploads; Finance reviews |
| Official bank certificate is present | RCO-FOR-002 `A5:G6` | Blocking final homologation | Proposer uploads; Finance reviews |
| Both declarations have explicit Yes/No answers | RCO-FOR-002 `A34:G35`; approved Phase 2 decision | Blocking final homologation | Proposer answers; Finance reviews |
| A risky declaration displays a review warning | Approved Phase 2 decision | Non-blocking by itself; never auto-approves/rejects | Finance evaluates separately |
| Taxpayer review exists and returned RUC/legal name do not mismatch | PDF manual exact RUC/legal-name guidance; existing taxpayer-validation rule | Blocking final homologation | Accounting/Admin |
| Finance compliance review is APPROVED | RCO-FOR-002 responsibility section plus approved current-role mapping | Blocking final homologation | Accounting/Admin |
| Supplier is not OBSERVED, REJECTED, or INACTIVE | Existing homologation lifecycle | Blocking | Backend transition check |
| At least one active acceptable payment account exists | RCO-FOR-002 banking section | Blocking final homologation | Proposer supplies; Finance verifies |
| New bank account starts PENDING | Approved Phase 2 bank policy | Blocking until Finance review for new homologation | Backend default; Accounting/Admin review |
| Ownership MISMATCH cannot satisfy homologation | RCO-FOR-002 exact legal account-holder requirement | Blocking | Accounting/Admin |
| MANUAL_ACCEPTED requires Finance/Admin comments and audit | Approved Phase 2 decision | Blocking unless authorized and documented | Accounting/Admin |
| New CCI is normalized and must contain 20 digits | RCO-FOR-002 CCI field; verified Phase 1 helper | Blocking account save | Backend |
| Explicit DETRACTION account must use BANCO_NACION | RCO-FOR-002 banking section; approved Phase 2 decision | Blocking account save | Backend; no tax classification inferred |
| PRV is assigned only after all controls pass | RCO-FOR-002 ERP code/responsibility section; Phase 1 sequence foundation | Blocking/atomic completion rule | Accounting/Admin homologation action |
| Already-homologated legacy records remain usable | Existing historical compatibility rule; approved Phase 2 decision | Non-blocking compatibility path | Backend |

## G. Required Documents

The existing protected upload/storage system is reused. Supplier proposal and permitted correction requests accept the existing multipart upload fields and persist metadata in the existing Supplier document structure.

Required for final new-supplier homologation:

- `RUC_FILE`: updated RUC record.
- `LEGAL_REP_ID`: legal representative identification.
- `BANK_CERTIFICATE`: official bank certificate.

The UI shows type, filename, presence, and protected preview/download controls. The backend independently checks all three types in `assertSupplierCanBeHomologated`; missing evidence produces structured issue codes rather than a generic failure. Supplier file access is allowed to Admin/Accounting/Treasury and to the owning Solicitor only while their pending/observed proposal is editable.

## H. Compliance Declarations

- Both official declarations remain separate and require explicit `YES` or `NO` before final new-supplier homologation.
- `NOT_DECLARED` remains valid while drafting but blocks final homologation.
- Supplier declarations do not set the Finance decision.
- Declared State sanctions/proceedings or the absence of a compliance/prevention model create visible risk warnings. They do not automatically approve or reject the supplier.
- `OBSERVED` returns permitted proposal fields to the correction lifecycle and retains history.
- `REJECTED` is final for that onboarding record, assigns no PRV, and duplicate identifier creation cannot bypass the rejection.
- `INACTIVE` remains distinct from `REJECTED`.

## I. PRV Behavior

- PRV assignment occurs only in the authorized final homologation service after every backend control passes.
- Codes use the existing atomic Phase 1 sequence and `PRV-XXXX` format.
- The Supplier unique sparse index prevents duplicate codes.
- Atomic `findOneAndUpdate` completion prevents repeated/concurrent homologation from assigning different codes.
- A repeated homologation call retains the same code.
- Existing/migrated codes are retained and never regenerated.
- Proposers cannot submit or change `supplierCode` through normal proposal APIs.
- Rejected suppliers receive no PRV.
- PRV assignment and successful homologation append separate audit events.

## J. Supplier Bank Accounts

- Multiple active accounts are supported across bank, currency, and account type.
- Adding an account never deletes or overwrites prior accounts.
- Deactivation sets the account inactive and records validity/history; historical rows remain readable.
- The existing partial unique index allows at most one active preferred account per supplier, currency, and account type.
- Changing preferred account clears only the competing preferred flag in the same scope; it does not delete either account.
- Inactive accounts cannot be preferred.
- New accounts start `PENDING` and `NOT_REVIEWED`.
- Finance/Admin may record `VERIFIED`, `OBSERVED`, or `REJECTED`, plus ownership `NOT_REVIEWED`, `MATCH`, `MISMATCH`, or `MANUAL_ACCEPTED`.
- `MANUAL_ACCEPTED` requires comments and is audited. No external bank-verification claim is made.
- CCI formatting is normalized with the existing helper; new CCI values require exactly 20 digits. No invented checksum is used.
- `DETRACTION` is accepted only with `BANCO_NACION`. The system does not infer whether detracción legally applies.
- `LEGACY_ACCEPTED` remains readable and compatible and is never relabelled `VERIFIED`.
- Treasury payment destination semantics were not redesigned. The existing compatibility lookup prefers a configured preferred active account, then the newest active account.

## K. SUNAT Behavior

Current default provider: `MANUAL` (`SUNAT_PROVIDER_MODE` is not set to a live production integration).

Actually recorded:

- provider mode and configured state;
- validation source;
- returned/reviewed RUC and legal name;
- identifier and legal-name match result;
- authorized reviewer, date, and comments;
- valid/invalid taxpayer review result.

Not performed or claimed:

- no live SUNAT production call;
- no official SUNAT credential use;
- no hidden official API endpoint;
- no production-certified validation;
- no external bank validation.

`MOCK`, `MANUAL`, and `NOT_CONFIGURED` modes report their real source. The UI never displays “Verified by SUNAT” for these modes.

## L. Permissions

| Role | View | Propose | Edit | Upload | Finance review | Verify banking | Observe / reject | Homologate |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Admin | Yes, full banking | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Solicitor | Yes; unrelated banking masked | Yes | Own pending/observed proposal only | Own pending/observed proposal only | No | No | No | No |
| Approver / Director / Vice Rector | No Supplier module access | No | No | No | No | No | No | No |
| Accounting | Yes, full banking | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Treasury | Yes, full banking read-only | No | No | No | No | No | No | No |
| Budget | No Supplier module access | No | No | No | No | No | No | No |
| Management / Rectorate | No Supplier module access | No | No | No | No | No | No | No |

These permissions are enforced in backend routes and services. Frontend visibility is only an ergonomic reflection of backend authorization.

## M. Security

- Explicit per-operation field whitelists prevent mass assignment.
- JWT actor identity and server time own proposer, reviewer, verifier, and homologation metadata.
- Solicitors cannot set PRV, homologation status, Finance review, review actor/time, bank verification status, ownership result, verifier, or verification time.
- Supplier bank values are masked for unrelated Solicitors; Admin, Accounting, and Treasury retain full operational visibility.
- Protected supplier evidence is served through the existing authorized file-access service, not public paths.
- Supplier identifier uniqueness is enforced both by lookup/service logic and MongoDB indexes.
- PRV uniqueness and immutability are enforced server-side.
- Audit records are appended through the existing audit service; no update/delete audit path was added.
- Confirmation dialogs explain deactivation, rejection, bank review, and homologation outcomes before mutable Finance actions.

## N. Migration

**The important/current database was not modified by a migration apply or reset.**

Executed only:

```text
npm run migrate:official-formats
```

Result: `DRY_RUN`, `alreadyApplied: false`.

Report:

`backend/migration-reports/2026-08-official-uma-formats-foundation-v1-dry-run-2026-08-19T17-20-00-225Z.json`

Dry-run summary:

- Suppliers scanned/changed: `6/6`
- PRV codes proposed: `5`
- Requests scanned/changed: `18/18`
- Rendition numbers proposed: `1`
- Bank accounts scanned/changed: `6/6`
- Document rules changed: `1`
- Finance configurations proposed: `1`
- Manual-review records: `0`

The apply command was deliberately not run. Before a future authorized apply, back up MongoDB and all local upload/generated-file directories, review the dry-run report, and then obtain explicit authorization for `npm run migrate:official-formats:apply`.

## O. Backend Test Result

Command:

```text
npm run test:backend
```

Result:

- Total: `70`
- Passed: `70`
- Failed: `0`
- Skipped: `0`
- Cancelled: `0`
- Todo: `0`

The new RCO-FOR-002 suite contributes 15 grouped subtests covering all 24 supplier-specific test areas in the Phase 2 instruction, including concurrent PRV assignment, RBAC, bank history, preferred policy, CCI, ownership mismatch/manual acceptance, DETRACTION, legacy compatibility, and honest SUNAT provider modes.

## P. Frontend Test Result

Command:

```text
npm run test:frontend
```

Result:

- Total: `19`
- Passed: `19`
- Failed: `0`
- Skipped: `0`

The Phase 2 contracts verify all official Supplier sections, shared UI use, staged endpoints, protected-field ownership, and synchronized English/Spanish labels.

## Q. Production Build

Command:

```text
npm run build
```

Result: **SUCCESS**

- Vite version: `5.4.21`
- Modules transformed: `2,288`
- Supplier lazy chunk produced successfully.
- No build error or warning blocked delivery.
- No lint script is configured in the root, backend, or frontend package scripts; scoped `git diff --check` passed for all Phase 2 source, test, and documentation files. The only repository-wide whitespace warning belongs to the pre-existing unrelated `canges.txt` change.

## R. Regression Testing

The full backend suite confirms no regression in:

- Request: draft creation, submission, document/XML rules, permission ownership, and canonical lifecycle.
- Approval: Director and Vice Rector actions, SLA, period controls, and segregation of duties.
- Budget: commitment, insufficient-budget branch, rollback, and dimensional controls.
- Accounting: duplicate voucher control, CXP/provision, balanced journals, period guard, special mappings, and month-end consolidation.
- Treasury: bank TXT batch generation without false payment, payment confirmation, payment journal, reconciliation, and closure.

The frontend suite confirms navigation permissions, shared tables/menus, login roles, request taxonomy, responsive interaction contracts, and the Supplier Phase 2 UI contract.

Live read-only browser verification used isolated ports so the existing share process remained untouched:

- Accounting login and authorized Supplier navigation.
- RCO-FOR-002 list, filters, row menu, pending supplier detail, readiness issue sources, taxpayer review, Finance review, and disabled homologation state.
- Solicitor navigation, absence of Finance actions, masked account/CCI data, and protected supplier evidence visibility.
- English/Spanish switching for Phase 2 content.
- 390 px mobile Drawer and action sheet with no page-level horizontal overflow.
- Escape closes the action sheet and restores focus to the row-action trigger.
- No browser console warning or error was recorded during the verification flow.

## S. Remaining Ambiguities

The following items remain `NEEDS_BUSINESS_CLARIFICATION` or require external specifications and were intentionally not invented:

1. Production SUNAT provider endpoint, credentials, response contract, and certification criteria.
2. External bank ownership-verification provider and authoritative response format.
3. Legal/service classification that determines whether a supplier or transaction is subject to detracción.
4. Formal supplier reactivation approval rules beyond the existing inactive lifecycle.
5. Whether UMA later requires separate CFO, Control de Gestión, or Procurement actors; Phase 2 uses the approved current Accounting/Admin responsibility mapping.
6. Treasury selection semantics when several verified active accounts exist; the Phase 2 compatibility selection is not a Treasury redesign.
7. Security and lifecycle requirements for any future external supplier self-service portal.
8. Official PDF/export layout and signature requirements for a generated RCO-FOR-002 document.

None of these items blocks the approved internal Phase 2 Supplier Master and homologation implementation.

## T. Recommendation

Phase 2 is complete and verified. Proceed to Phase 3 only after explicit user approval. Before demonstrating migrated PRV values on the important database, complete the documented backup/review process and obtain separate authorization for the Phase 1 migration apply.

READY_FOR_PHASE_3
