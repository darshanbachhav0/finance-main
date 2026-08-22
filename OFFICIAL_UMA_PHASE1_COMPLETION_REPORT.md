# UMA Official Financial Formats - Stage 2 Phase 1 Completion Report

Verification date: 2026-08-19  
Repository commit verified: `473b017` (`main`)  
Phase 1 implementation commit: `cc3d97254a4c8ce1f57b7f4153992cf017bcbef9`

This is a verification and closeout report only. No Phase 2 Supplier, Request, Rendition, approval-routing, Treasury, Purchase Order, or PDF-export functionality was implemented during this closeout.

## A. Phase 1 implementation status

**Overall: PASS_WITH_NOTES**

The Phase 1 foundation is present, additive, migration-safe in the tested scenarios, and compatible with the existing financial lifecycle. The full backend suite passed 55/55 tests, the frontend passed 16/16 tests, and the Vite production build completed successfully. The official migration dry run did not change any monitored MongoDB collection.

The four original sources were inspected directly:

- `data/Formato_Maestro_Requerimiento_CAPEX_OPEX.xlsx`: one sheet (`Maestro CAPEX OPEX`), `A1:G50`, with formulas in `G36:G39`; no Excel data-validation objects or cell comments.
- `data/Formato_Ficha_Homologacion_Nuevos_Proveedores.xlsx`: one sheet (`Ficha Nuevo Proveedor`), `A1:G43`; no formulas, Excel data-validation objects, or cell comments.
- `data/Formato_Rendicion_Gastos_UMA.xlsx`: one sheet (`Rendicion de Gastos`), `A1:E31`, with formulas in `E18`, `E26`, and `B31`; no Excel data-validation objects or cell comments.
- `data/Manual_Simple_Formatos_Financieros_UMA.pdf`: three pages covering RCO-FOR-001, RCO-FOR-002, unsupported-expense rendition, and the three-step practical flow.

Notes preventing a plain `PASS`:

1. The current important database has not had the migration applied. This closeout intentionally ran only the dry run. A reviewed backup and authorized apply remain deployment prerequisites.
2. `EmployeeReimbursementBankAccount.accountHolderName` is required for new records although the catalog only explicitly marks the account number as required. This is a safe, stricter validation difference.
3. Employee reimbursement bank values use Mongoose `select: false`, but there is no at-rest encryption.
4. The Phase 1 commit also contained two unrelated public-sharing port/script changes. They are identified below and were not treated as Phase 1 functionality.

## B. Files changed

The exact Phase 1 commit changed 30 files. Later deployment-link and demo-login commits are not attributed to Phase 1.

### Modified - required for Phase 1

- `backend/package.json` - migration scripts.
- `backend/src/controllers/masterDataController.js` - whitelisted FinanceConfiguration CRUD and server-owned actor fields.
- `backend/src/models/DocumentRule.js` - quotation policy.
- `backend/src/models/FinancialRequest.js` - request, quotation, commercial, and rendition foundation.
- `backend/src/models/Supplier.js` - supplier official-format foundation and PRV guard.
- `backend/src/models/SupplierBankAccount.js` - account type, verification, normalization, and preferred-account index.
- `backend/src/models/User.js` - optional employee code.
- `backend/src/routes/index.js` - FinanceConfiguration route registration.
- `backend/src/routes/masterDataRoutes.js` - FinanceConfiguration RBAC.
- `backend/src/seed/seed.js` - development-only Phase 1 demo fields, mobility configuration, PRV counters, and employee reimbursement profile.
- `backend/src/services/documentRuleService.js` - configurable structured quotation policy foundation.
- `backend/src/services/renditionService.js` - RG assignment, beneficiary acknowledgment/snapshot, typed details, and mobility evaluation.
- `backend/src/services/requestService.js` - whitelisted official-format request fields and quotation snapshots.
- `backend/src/services/sequenceService.js` - atomic PRV and RG references.
- `backend/src/services/supplierService.js` - official supplier fields, PRV assignment, verification metadata, and compatible bank history.
- `backend/src/utils/constants.js` - controlled enums and configuration keys.
- `package.json` - root migration commands.

### New - models, services, utilities, and migration

- `backend/scripts/migrateOfficialUmaFormatsFoundation.js`
- `backend/src/models/EmployeeReimbursementBankAccount.js`
- `backend/src/models/FinanceConfiguration.js`
- `backend/src/services/financeConfigurationService.js`
- `backend/src/services/officialFormatsFoundationMigrationService.js`
- `backend/src/utils/bankAccountValidation.js`

### Tests

- `backend/test/financialLifecycle.test.js` - existing test fixtures updated to use valid 20-digit CCI values.
- `backend/test/officialFormatsFoundation.test.js` - new 11-subtest Phase 1 verification suite.
- `backend/test/run.js` - Phase 1 suite registration.

### Documentation

- `docs/OFFICIAL_UMA_PHASE1_FIELD_CATALOG.md`
- `docs/OFFICIAL_UMA_PHASE1_MIGRATION.md`

### Extra undocumented changes in the Phase 1 commit

| Path | Change | Classification | Assessment |
|---|---|---|---|
| `backend/public-server.js` | Default public-server port changed from 5050 to 5174. | OUT_OF_SCOPE | Deployment-only; no financial behavior changed. |
| `scripts/share-cloudflare.ps1` | Tunnel port changed, managed server shutdown added, and help text updated. | OUT_OF_SCOPE | Deployment-only; no Phase 1 schema or workflow dependency. |

No Phase 1 commit change altered approval routing, Treasury logic, Purchase Orders, frontend screens, roles, existing request statuses, or legacy field deletion.

## C. Field-catalog reconciliation

The catalog contains 78 field rows. Result: 77 `IMPLEMENTED_AND_MATCHES`, 1 `IMPLEMENTED_WITH_DIFFERENCE`, 0 `MISSING`.

### FinancialRequest - 31 items

| Catalog item | Result | Actual implementation |
|---|---|---|
| `areaCorrelative` | IMPLEMENTED_AND_MATCHES | Optional trimmed string with non-unique path index; `requestNumber` remains primary and immutable. |
| `title` | IMPLEMENTED_AND_MATCHES | Optional string, default `""`; migration derives at most 120 characters from `description`. |
| `detailedDescription` | IMPLEMENTED_AND_MATCHES | Optional string, default `""`; migration copies legacy `description`. |
| `businessJustification` | IMPLEMENTED_AND_MATCHES | Optional string, default `""`; no inferred migration value. |
| `nonApprovalRisk` | IMPLEMENTED_AND_MATCHES | Optional string, default `""`; no inferred migration value. |
| `capexDetails.projectPep` | IMPLEMENTED_AND_MATCHES | Optional string, default `""`; legacy `project` remains. |
| `capexDetails.projectSnapshot.{id,code,name}` | IMPLEMENTED_AND_MATCHES | Optional Project ObjectId and string snapshot fields; accepted only inside the whitelisted `capexDetails` payload. |
| `capexDetails.assetCategory` | IMPLEMENTED_AND_MATCHES | Controlled enum: INFRASTRUCTURE, MACHINERY, IT_HARDWARE, SOFTWARE_LICENSES. |
| `capexDetails.usefulLifeYears` | IMPLEMENTED_AND_MATCHES | Optional number with minimum 0. |
| `capexDetails.npv.{amount,currency}` | IMPLEMENTED_AND_MATCHES | Recorded Number plus PEN/USD; no formula or posting effect. |
| `capexDetails.payback.{value,unit}` | IMPLEMENTED_AND_MATCHES | Value minimum 0; MONTHS/YEARS enum; no automatic calculation. |
| `opexDetails.expenseFrequency` | IMPLEMENTED_AND_MATCHES | ONE_OFF, MONTHLY_RECURRING, ANNUAL_RENEWAL enum; no generated schedule. |
| `lines[].itemDescription` | IMPLEMENTED_AND_MATCHES | Optional string, default `""`; legacy accounting line fields retained. |
| `lines[].quantity` | IMPLEMENTED_AND_MATCHES | Optional number, minimum 0. |
| `lines[].unitOfMeasure` | IMPLEMENTED_AND_MATCHES | Optional string, default `""`. |
| `lines[].unitPrice` | IMPLEMENTED_AND_MATCHES | Optional number, minimum 0; rounded with existing money helper. |
| `lines[].commercialTotal` | IMPLEMENTED_AND_MATCHES | Browser value is not mapped; model derives quantity x unit price with money helpers. |
| `totalCommercialAmount` | IMPLEMENTED_AND_MATCHES | Model derives the line sum; default 0. |
| `commercialTotalDifference` | IMPLEMENTED_AND_MATCHES | Model derives commercial total minus accounting total. |
| `commercialTotalStatus` | IMPLEMENTED_AND_MATCHES | NOT_APPLICABLE/INCOMPLETE/MATCH/MISMATCH; mismatch does not block Phase 1. |
| `quotations[].supplier` | IMPLEMENTED_AND_MATCHES | Optional Supplier ObjectId. |
| `quotations[].supplierSnapshot` | IMPLEMENTED_AND_MATCHES | Server fills identifier type, identifier, and legal name from Supplier. |
| `quotations[].amount` | IMPLEMENTED_AND_MATCHES | Optional non-negative number for commercial comparison only. |
| `quotations[].currency` | IMPLEMENTED_AND_MATCHES | PEN/USD, default PEN. |
| `quotations[].deliveryPeriod` | IMPLEMENTED_AND_MATCHES | Optional string, default `""`. |
| `quotations[].paymentConditions` | IMPLEMENTED_AND_MATCHES | Optional string, default `""`. |
| `quotations[].commercialConditions` | IMPLEMENTED_AND_MATCHES | Optional string, default `""`. |
| `quotations[].attachment` | IMPLEMENTED_AND_MATCHES | Optional attachment ObjectId; structured validator reports missing evidence. |
| `quotations[].recommended` | IMPLEMENTED_AND_MATCHES | Boolean default false; validator requires exactly one where the policy applies. |
| `supplierSelectionReason` | IMPLEMENTED_AND_MATCHES | Optional string, default `""`; validator reports absence where applicable. |
| `quotationException` | IMPLEMENTED_AND_MATCHES | Schema foundation exists; requester create/update whitelist does not accept authorization fields. |

Existing accounting `netAmount`, `igvAmount`, `totalAmount`, PEN conversion, status, approval, budget, AP, and Treasury fields remain authoritative. The commercial calculation hook reconciles to them but does not overwrite their meaning.

### Embedded rendition - 12 items

| Catalog item | Result | Actual implementation |
|---|---|---|
| `rendition.number` | IMPLEMENTED_AND_MATCHES | RG assignment on submission, additive migration for submitted/observed/validated records, assign-once guard, partial unique index. |
| `rendition.beneficiarySnapshot` | IMPLEMENTED_AND_MATCHES | Captures user, employee code, name, email, area, and Cost Center snapshot at submission; no DNI added. |
| `rendition.mobilityLines[]` | IMPLEMENTED_AND_MATCHES | Date, origin, destination, service purpose, and amount; amount rounded server-side. |
| `mobilityLines[].limitExceeded` | IMPLEMENTED_AND_MATCHES | Default false; set from effective configuration evaluation. |
| `rendition.unsupportedExpenseLines[]` | IMPLEMENTED_AND_MATCHES | Date, description, GOODS/SERVICES, and gross amount; existing non-deductible posting remains separate. |
| Rendition subtotals and `reimbursementTotal` | IMPLEMENTED_AND_MATCHES | Server-derived from typed details with money helpers; defaults 0. |
| `rendition.detailReconciliation` | IMPLEMENTED_AND_MATCHES | Server-derived amount, difference, and status; existing `amountRendered` remains authoritative. |
| `rendition.unsupportedExpenseDeclaration` | IMPLEMENTED_AND_MATCHES | Optional foundation, default false/blank; no premature Phase 1 submission rule. |
| `rendition.financeReview` | IMPLEMENTED_AND_MATCHES | PENDING/APPROVED/OBSERVED/REJECTED schema, default PENDING; not requester writable or automatically approved. |
| `rendition.beneficiaryAcknowledgment` | IMPLEMENTED_AND_MATCHES | Current submission captures authenticated user, timestamp, IP, and signature reference; optional physical attachment field exists. |
| `rendition.reimbursementBankSnapshot` | IMPLEMENTED_AND_MATCHES | Optional separate employee-profile snapshot; holder/account/CCI hidden by default; no supplier-account migration. |
| `rendition.limitEvaluation` | IMPLEMENTED_AND_MATCHES | Stores configuration reference, value, dates, behavior, evaluation time, and exceeded count. |

`SOL-...` remains the parent request identifier. Old rendition records load in the compatibility test.

### Supplier - 16 items

| Catalog item | Result | Actual implementation |
|---|---|---|
| `supplierCode` | IMPLEMENTED_AND_MATCHES | Atomic PRV code at successful homologation, sparse unique index, assign-once guard; rejected suppliers receive none. |
| `personType` | IMPLEMENTED_AND_MATCHES | LEGAL_ENTITY/NATURAL_PERSON_WITH_BUSINESS enum; optional. |
| `commercialName` | IMPLEMENTED_AND_MATCHES | Pre-validation fallback from `name`; migration fills missing value without deleting legacy names. |
| `location` | IMPLEMENTED_AND_MATCHES | District, province, department, ubigeo strings; free-text addresses retained. |
| `website` | IMPLEMENTED_AND_MATCHES | Optional string, default `""`. |
| `legalRepresentativeDocument` | IMPLEMENTED_AND_MATCHES | DNI/CE plus number; existing representative evidence remains. |
| `commercialContact` | IMPLEMENTED_AND_MATCHES | Name, position, phone, email; legacy generic contact fields retained. |
| `operationsContact` | IMPLEMENTED_AND_MATCHES | Separate name, position, phone, email structure. |
| `goodsServicesProfile` | IMPLEMENTED_AND_MATCHES | Optional string; legacy `supplierType` retained. |
| `paymentTerms` | IMPLEMENTED_AND_MATCHES | CREDIT_30/CREDIT_45/CUSTOM; days derived for standard options and positive for custom. |
| `delivery` | IMPLEMENTED_AND_MATCHES | CENTRAL_WAREHOUSE/DESTINATION_SITE/OTHER plus optional text. |
| `declarations.stateSanctions` | IMPLEMENTED_AND_MATCHES | YES/NO/NOT_DECLARED plus comments/date; no inferred declaration. |
| `declarations.complianceModel` | IMPLEMENTED_AND_MATCHES | YES/NO/NOT_DECLARED plus comments/date; no inferred declaration. |
| `complianceReview` | IMPLEMENTED_AND_MATCHES | Separate review result/actor/date/comments; conservative legacy mapping; Accounting/Admin route. |
| Genuine `REJECTED` supplier status | IMPLEMENTED_AND_MATCHES | Added to homologation and operational enums without changing defaults. |
| `bankHistory[]` metadata | IMPLEMENTED_AND_MATCHES | Additive verification/ownership metadata; existing embedded history and canonical account collection retained. |

There is still one Supplier model and one canonical `SupplierBankAccount` collection; no duplicate Vendor master was created.

### SupplierBankAccount - 7 items

| Catalog item | Result | Actual implementation |
|---|---|---|
| `accountType` | IMPLEMENTED_AND_MATCHES | CURRENT/DETRACTION; required for new records, default CURRENT; migration fills legacy rows. |
| `accountHolderName` | IMPLEMENTED_AND_MATCHES | Optional string; migration makes no ownership claim. |
| `preferred` | IMPLEMENTED_AND_MATCHES | Default false; replacement path creates preferred; migration selects only a sole active legacy account. |
| `verificationStatus` | IMPLEMENTED_AND_MATCHES | PENDING/VERIFIED/OBSERVED/REJECTED/LEGACY_ACCEPTED; legacy rows are not marked VERIFIED. |
| `ownershipResult` | IMPLEMENTED_AND_MATCHES | NOT_REVIEWED/MATCH/MISMATCH/MANUAL_ACCEPTED; legacy default is NOT_REVIEWED. |
| Verification metadata | IMPLEMENTED_AND_MATCHES | Reviewer, date, source, document, and comments are present and Accounting/Admin controlled. |
| `BANCO_NACION` supplier-bank support | IMPLEMENTED_AND_MATCHES | Added to supplier/employee bank catalog only; Treasury bank-file adapters remain unchanged. |

Legacy bank records are retained. Safely formatted numeric account/CCI strings normalize; malformed legacy strings remain readable under `legacyImported` and are reported for manual review.

### User and EmployeeReimbursementBankAccount - 7 items

| Catalog item | Result | Actual implementation |
|---|---|---|
| `User.employeeCode` | IMPLEMENTED_AND_MATCHES | Optional uppercase string, sparse unique index; migration does not infer values. |
| Employee bank `.user` | IMPLEMENTED_AND_MATCHES | Required User ObjectId; no API route exists. |
| Employee bank `.bank`, `.currency` | IMPLEMENTED_AND_MATCHES | Supplier-bank catalog and PEN/USD; required with PEN default. |
| `.accountHolderName`, `.accountNumber`, `.cci` | IMPLEMENTED_WITH_DIFFERENCE | All are hidden by default and normalized; account is required and CCI optional as documented. The implementation additionally requires `accountHolderName` for new records. |
| `.active`, `.preferred` | IMPLEMENTED_AND_MATCHES | Defaults true/false; partial unique index permits one active preferred profile per user. |
| Verification fields | IMPLEMENTED_AND_MATCHES | Status, reviewer, date, source, and document; default PENDING. |
| Validity/history actor fields | IMPLEMENTED_AND_MATCHES | Valid-from/to and created/changed actor references; records are additive. |

The model is separate from Supplier banking. Default queries omit holder/account/CCI, and a direct isolated query confirmed an embedded reimbursement snapshot serializes as `{}` unless sensitive paths are explicitly selected. No at-rest encryption is implemented.

### FinanceConfiguration and DocumentRule - 5 items

| Catalog item | Result | Actual implementation |
|---|---|---|
| `FinanceConfiguration.key` | IMPLEMENTED_AND_MATCHES | LOCAL_MOBILITY_DAILY_LIMIT and UNSUPPORTED_EXPENSE_LIMIT enums; no unsupported-expense row is seeded. |
| Numeric value/currency/behavior | IMPLEMENTED_AND_MATCHES | Non-negative amount, PEN/USD, INFORMATION/WARNING/FLAG/BLOCK; initial mobility rule is 41 PEN WARNING. |
| Effective dates and active state | IMPLEMENTED_AND_MATCHES | Required `effectiveFrom`, optional `effectiveTo`, active default true, validated range. |
| Provenance and actors | IMPLEMENTED_AND_MATCHES | Description/source plus createdBy/updatedBy; API actor IDs are server-owned. Offline migration records source and timestamps without fabricating a user. |
| `DocumentRule.quotationPolicy` | IMPLEMENTED_AND_MATCHES | Enabled, minimumCount >= 1, exception support, reason requirement; migration enables existing quotation rules. |

### Index-safety commitments

All six catalog commitments match the schema:

1. Supplier PRV: `{ supplierCode: 1 }`, `unique: true`, `sparse: true`.
2. Rendition RG: `{ "rendition.number": 1 }`, unique partial filter `{ "rendition.number": { $type: "string" } }`.
3. Supplier preferred account: unique `{ supplier, currency, accountType, preferred }` with partial filter `{ active: true, preferred: true }`.
4. Employee preferred profile: unique `{ user, preferred }` with partial filter `{ active: true, preferred: true }`.
5. Finance configuration lookup: non-unique `{ key, active, effectiveFrom: -1, effectiveTo: 1 }`.
6. Existing request, voucher, supplier identity, workflow, AP, and audit indexes were not replaced by Phase 1.

`User.employeeCode` is additionally `{ employeeCode: 1 }`, unique and sparse. Current important data contains zero explicit null/empty values for PRV, employee code, or RG; legacy documents omit those paths. Isolated index creation with omitted legacy fields passed. Sparse indexes would still treat explicit empty strings as indexed values, so external/manual imports must continue to omit unknown optional identifiers rather than write `""`.

## D. Schema verification

### Backward compatibility and serialization

- A hydrated legacy FinancialRequest retains `description`, accounting lines, and existing rendition status.
- A hydrated legacy Supplier retains legacy `name`, operational status, and free-text fields.
- A `legacyImported` bank record with malformed CCI remains readable.
- Existing `SOL-...` request numbers and MongoDB `_id` values are unchanged.
- New optional nested objects receive safe defaults without making historical records invalid.
- Sensitive request attachment paths and employee reimbursement bank values remain excluded from normal serialization.

### Model hooks

- FinancialRequest pre-validation continues to round and validate accounting amounts first, then derives commercial totals and rendition detail totals.
- Supplier pre-validation normalizes identifier semantics and payment-term days while retaining legacy names/addresses.
- Supplier and FinancialRequest pre-save guards prevent changing already assigned PRV/RG values through normal model saves.
- New bank writes normalize account/CCI; `legacyImported` records tolerate malformed historical values.
- FinanceConfiguration and bank profile effective-date ranges are validated.

### Enum validation

Focused tests confirmed invalid supplier person type and unsupported account type are rejected. Mongoose schema inspection confirmed every catalog enum listed in Section C.

## E. Migration verification

### Current important database - dry run only

Command:

```powershell
npm run migrate:official-formats
```

Result:

- Mode: `DRY_RUN`
- Database: `erp_financial_system`
- Suppliers scanned/changed: 6/6
- Supplier codes planned: 5
- Requests scanned/changed: 18/18
- Rendition numbers planned: 1
- Bank accounts scanned/changed: 6/6
- Document rules planned: 1
- Finance configurations planned: 1
- Manual review: 0
- Already applied: false

Report:

`backend/migration-reports/2026-08-official-uma-formats-foundation-v1-dry-run-2026-08-19T16-21-02-131Z.json`

SHA-256 hashes and counts were captured before and after the dry run for `suppliers`, `financialrequests`, `supplierbankaccounts`, `documentrules`, `financeconfigurations`, `counters`, and `migrationruns`. Every count and hash was identical. No migration run record or FinanceConfiguration record was inserted.

### Malformed-data reporting

An isolated database containing `accountNumber: "legacy/account"` and `cci: "bad-cci"` produced one `manualReview` item:

`Legacy account/CCI could not be safely normalized; original value was retained.`

The before/after document was identical in dry-run mode.

### Isolated apply and idempotency

An isolated database was created and dropped for this test:

1. Dry run planned one PRV, one RG, and one mobility configuration.
2. First apply returned `alreadyApplied: false`, assigned `PRV-0001`, assigned `RG-2026-00001`, created one configuration, and created one migration-run record.
3. Index creation completed for Supplier, SupplierBankAccount, EmployeeReimbursementBankAccount, FinanceConfiguration, FinancialRequest, and User.
4. Second apply returned `alreadyApplied: true`, zero changes, and zero manual-review entries.
5. Counts after the second apply remained one PRV, one RG, one configuration, and one migration-run record.

Counter synchronization was separately tested with existing `PRV-0099` and `RG-2026-00042`. The next migrated values were `PRV-0100` and `RG-2026-00043`; counters ended at 100 and 43 respectively.

The migration writes only additive title/detail, supplier review/code, rendition number, conservative bank metadata, quotation policy, configuration, counters, indexes, and migration-run metadata. It does not set request status, request number, approval, period, financial amounts, FX, budget, journals, AP, payments, reconciliation, or Treasury snapshots.

## F. PRV sequence verification

- Implementation: atomic `Counter.findOneAndUpdate` with `$inc`, upsert, and returned post-update value.
- Format: `PRV-` plus at least four digits; sequence can grow past 9999 without reuse.
- Concurrency: 20 parallel calls produced 20 unique values.
- Assignment: only the successful homologation branch assigns a missing code.
- Rejection: rejected supplier test retained `supplierCode === undefined`.
- Immutability: attempting to replace an assigned code through model save was rejected.
- Migration: existing code maximum is synchronized before assignment; existing codes are not regenerated.
- MongoDB `_id`: never replaced or reinterpreted.

## G. RG sequence verification

- Implementation: the same atomic counter service, partitioned by UTC year under key `rendition`.
- Format: `RG-YYYY-XXXXX` with a minimum five-digit sequence.
- Concurrency: 20 parallel 2026 calls produced 20 unique valid references.
- Assignment: current submission uses `request.rendition.number ||= ...`; old `SOL-...` remains unchanged.
- Migration: only SUBMITTED/OBSERVED/VALIDATED legacy renditions lacking RG receive a planned value.
- Immutability: changing an assigned RG through normal model save was rejected.
- Idempotency: second apply created no duplicate RG.

## H. Configuration verification

- The architecture supports `LOCAL_MOBILITY_DAILY_LIMIT` and `UNSUPPORTED_EXPENSE_LIMIT`.
- Initial local mobility configuration is 41 PEN, effective 2026-01-01, active, behavior WARNING, with official-workbook provenance.
- Daily evaluation groups typed mobility lines by date using existing money helpers.
- An isolated evaluation of 20 + 22 PEN on one day produced WARNING, two flagged lines, and `shouldBlock: false`.
- Phase 1 submission does not reject only because the 41 PEN warning is exceeded.
- No unsupported-expense numeric limit is inserted by migration or development seed.

Mobility-related `41` occurrences found in tracked source/docs:

| Path | Occurrence | Assessment |
|---|---|---|
| `backend/src/services/officialFormatsFoundationMigrationService.js:237` | Initial configuration value. | Required single migration default. |
| `backend/src/seed/seed.js:618` | Development seed configuration. | Required demo/config seed, not workflow logic. |
| `backend/test/officialFormatsFoundation.test.js:165,173,345,346,379,386` | Warning, migration, and idempotency fixtures/assertions. | Test-only. |
| `docs/OFFICIAL_UMA_FORMATS_GAP_ANALYSIS.md:72,144,163` | Source extraction and unresolved policy note. | Documentation only. |
| `docs/OFFICIAL_UMA_PHASE1_FIELD_CATALOG.md:115` | Catalog value. | Documentation only. |
| `docs/OFFICIAL_UMA_PHASE1_MIGRATION.md:31` | Migration description. | Documentation only. |

Unrelated matches such as workbook cell references `A41`, requirements ID `FR-41`, and package-lock integrity hashes are not mobility logic.

## I. Security review

### Mass assignment

- No Phase 1 path uses `Model.create(req.body)`.
- Generic master-data CRUD uses an explicit `pick(req.body, fields)` whitelist.
- Request create/update maps approved fields explicitly. Browser-provided commercial totals and supplier snapshots are ignored/rebuilt server-side.
- `quotationException` is not in the Solicitor request whitelist.
- Supplier proposal does not accept `supplierCode`, `complianceReview`, bank verification, ownership decision, reviewer, or homologation result.
- Supplier review/update route is restricted to Admin/Accounting. Reviewer IDs/timestamps and PRV assignment are server-owned.
- FinanceConfiguration create/update routes are Admin/Accounting only; `createdBy`/`updatedBy` are overwritten from `req.user`.
- Rendition review routes are Admin/Accounting only. Solicitor submission does not map `rendition.financeReview`.

### Sensitive banking data

- Employee reimbursement banking is a separate model, not SupplierBankAccount.
- `accountHolderName`, `accountNumber`, and `cci` use `select: false` in both the employee profile and embedded request snapshot.
- No EmployeeReimbursementBankAccount API route exists.
- An isolated default-query test returned no sensitive snapshot fields; explicit server selection was required to retrieve them.
- Migration does not fabricate employee bank data or copy Supplier banking into employee profiles.
- Development seed creates one clearly demo-only employee profile. This is not migration behavior.
- At-rest encryption is **not implemented**.

### Review outcome

No clear Phase 1 security regression was found, so no security code correction was made. Internal services still depend on route-level RBAC in several places; current routes are correctly protected. Future reuse of those services must preserve the same authorization boundary.

## J. Backend tests

Command:

```powershell
npm run test:backend
```

Result:

- Test files loaded by `backend/test/run.js`: 7
- Node test count: 55
- Passed: 55
- Failed: 0
- Skipped: 0
- Cancelled: 0
- Todo: 0
- Reported duration: 3437.1858 ms

The Phase 1 suite contributed one parent suite with 11 passing subtests. The production financial-control suite and all pre-existing unit tests also passed.

## K. Frontend tests

Command:

```powershell
npm run test:frontend
```

Result:

- Test files/groups loaded: 3
- Total contract tests: 16
- Passed: 16
- Failed: 0
- Skipped: 0
- Groups: 4 row-menu tests, 7 financial-contract tests, 5 UI/UX contract tests.

The current total is one more than the pre-implementation 15-test baseline because a later, unrelated demo-login contract test is present. Phase 1 itself made no frontend change.

## L. Build

Command:

```powershell
npm run build
```

Result: success, exit code 0.

- Vite: 5.4.21
- Modules transformed: 2286
- Build time reported by Vite: 8.46 seconds
- CSS: 68.21 kB (13.09 kB gzip)
- Main index JS: 312.22 kB (101.92 kB gzip)
- Largest reported chunk: `formatters` 436.80 kB (124.33 kB gzip)
- Build warnings: none
- Build errors: none

## M. Lint/static checks

No lint, typecheck, formatting-validation, or dependency-check script is configured in the root, backend, or frontend package scripts. No new framework was introduced for closeout.

Supplemental `git diff --check cc3d972^ cc3d972` completed with no whitespace errors. Backend tests import and execute the Phase 1 modules; the frontend production build completed module transformation.

## N. Regression verification

| Area | Verification | Result |
|---|---|---|
| Request | Draft creation, complete submission, missing evidence, XML mismatch, Cost Center/account dimensions, money authority. | PASS |
| Approvals | Director, Vice Rector, assigned-level RBAC, self-approval block, SLA, closed-period approval block. | PASS |
| Higher approval foundation | Approval route service remains generic for Rectorate/General Management steps; Phase 1 did not change it. No full E2E extraordinary route exists in the current automated suite. | PASS_WITH_EXISTING_TEST_GAP |
| Budget | Transitional commitment, active sufficient budget, insufficient branch, idempotent release. | PASS |
| Supplier | Proposal compatibility, duplicate identifier, homologation, rejection, PRV, active bank history, second verified account. | PASS |
| Accounting | Duplicate voucher, CXP/AP, balanced provision, OPEX/CAPEX mappings, unsupported reimbursement, Account 14 advance and rendition. | PASS |
| Treasury | Batch/TXT persistence without false payment, destination snapshot, payment confirmation, journal, reconciliation and close. | PASS |
| Existing rendition | Paid Entrega a Rendir review, evidence, balance, Account 14 clearing, legacy record loading. | PASS |

No test was disabled or weakened. The only existing lifecycle fixture edit replaced invalid short CCI examples with valid 20-digit values required by the approved Phase 1 rule.

## O. Phase 1 corrections made during verification

No application code, schema, migration, test, seed, route, or workflow correction was made during closeout.

The only new tracked artifact from this task is this completion report. Generated migration JSON and frontend `dist` output are ignored by Git. Existing unrelated worktree files (`canges.txt`, `data/~$planation.docx`, and `data/Camila.docx`) were not modified.

## P. Remaining ambiguities

The following nine items remain explicitly classified `NEEDS_BUSINESS_CLARIFICATION` in the approved gap analysis:

1. **C05 - S/41 mobility policy:** confirm amount, legal authority, effective period, aggregation, and whether behavior is warning, block, or tax treatment. Phase 1 uses effective-dated WARNING only.
2. **C12 - Unsupported-expense limit:** supply threshold(s), scope, dates, and exception behavior. No value is configured.
3. **C14 - Rendition form lifecycle:** decide whether the official format belongs to Entrega a Rendir, Reembolso sin Sustento, both, or another combined process.
4. **D01 - Quotation evidence:** decide whether structured three-supplier comparison is mandatory or whether three files plus rationale are sufficient, and for which request scopes.
5. **D03 - Compliance declarations:** confirm whether both workbook questions are mandatory and how each affects homologation.
6. **D04 - Rendition source difference:** confirm combined mobility/unsupported scope and whether the PDF-only beneficiary signature is mandatory.
7. **D05 - SUNAT 2026 wording versus Finance limits:** obtain formal legal/accounting confirmation before treating 41 PEN as tax-authoritative.
8. **D07 - Purchase/Service Orders:** identify request types and thresholds and whether service orders require separate behavior.
9. **D08 - Official-form output:** decide whether digital capture is sufficient or versioned Excel/PDF generation is required.

Additional unresolved `CONFLICT` decisions retained from the gap analysis:

- Whether three quotations apply to every CAPEX/OPEX request and how SolPed is represented.
- Exact mapping of Area Management and Control de Gestion/CFO signatures to Director, Vice Rector, Budget, and/or Management roles.
- Whether several supplier accounts can be simultaneously active and how Treasury selects current versus detraccion accounts.
- Whether the three supplier-form sign-offs require separate permissions/approval levels.

Phase 1 deliberately did not resolve these through invented workflow rules.

## Q. Recommendation

**READY_FOR_PHASE_2**

The code foundation is ready for Phase 2: catalog coverage is complete apart from one safe stricter validation, migration behavior is additive and repeat-safe in isolation, security boundaries are intact, all automated tests pass, and the production build is clean.

Before Phase 2 is demonstrated against the current important database, UMA should:

1. Review the dry-run JSON.
2. Back up MongoDB and local file storage.
3. Authorize and run `npm run migrate:official-formats:apply` in the intended environment.
4. Resolve the Phase 2 business decisions listed in Section P before enforcing new UI/workflow rules.

No Phase 2 implementation has been started.
