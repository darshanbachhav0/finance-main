# Official UMA Formats - Phase 1 Persistent Field Catalog

## Scope and conventions

This catalog documents the additive fields introduced for Stage 2, Phase 1. Sources are the three official UMA workbooks, the accompanying PDF manual, and approved decisions D01-D08 in `OFFICIAL_UMA_FORMATS_GAP_ANALYSIS.md`.

- All new business fields are optional in Phase 1 unless the table says otherwise. Existing records and APIs remain valid.
- `FinancialRequest.description`, accounting lines, Net, IGV, Total, PEN conversion, statuses, approvals, budget, AP, and Treasury records remain authoritative.
- Requirements that become mandatory during a later workflow are documented but are not prematurely enforced in Phase 1.
- Sensitive employee reimbursement banking fields use Mongoose `select: false`; no route exposes that model in Phase 1.

## FinancialRequest

| Source | Field path | Type / options | Required, default, fallback, migration and index | Security / ownership |
|---|---|---|---|---|
| RCO-FOR-001 A9:G11; approved numbering decision | `areaCorrelative` | String | Optional; no default; no historical inference; non-unique search index | Solicitor-editable foundation; global immutable `requestNumber` remains primary |
| RCO-FOR-001 A15:G16 | `title` | String | Optional in Phase 1; default `""`; migration derives up to 120 characters from legacy `description` | Request data |
| RCO-FOR-001 A17:G18 | `detailedDescription` | String | Optional in Phase 1; default `""`; migration copies legacy `description` when absent | Request data |
| RCO-FOR-001 A19:G20 | `businessJustification` | String | Optional until Phase 2 submission rules; default `""`; no inferred backfill | Request data |
| RCO-FOR-001 A21:G22 | `nonApprovalRisk` | String | Optional until UMA confirms mandatory scope; default `""`; no inferred backfill | Request data |
| RCO-FOR-001 A25:C27 | `capexDetails.projectPep` | String | Optional CAPEX field; default `""`; legacy `project` remains supported | Request data |
| RCO-FOR-001 A25:C27 | `capexDetails.projectSnapshot.{id,code,name}` | ObjectId/String snapshot fields | Optional; no default values; no automatic historical inference | Immutable-use snapshot foundation; write path remains whitelisted |
| RCO-FOR-001 D26:G26 | `capexDetails.assetCategory` | Enum: `INFRASTRUCTURE`, `MACHINERY`, `IT_HARDWARE`, `SOFTWARE_LICENSES` | Optional CAPEX field; invalid enums rejected; no backfill | Request data |
| RCO-FOR-001 A27:C27 | `capexDetails.usefulLifeYears` | Number >= 0 | Optional pending mandatory-scope decision; no backfill | Request data |
| RCO-FOR-001 D27:G27; approved VAN decision | `capexDetails.npv.{amount,currency}` | Number; PEN/USD | Optional recorded value only; no formula, discount rate, or automated calculation | Financial planning data; no posting effect |
| RCO-FOR-001 D27:G27; approved Payback decision | `capexDetails.payback.{value,unit}` | Number >= 0; `MONTHS`/`YEARS` | Optional recorded value only; no formula or automated calculation | Financial planning data; no posting effect |
| RCO-FOR-001 D30:G30 | `opexDetails.expenseFrequency` | Enum: `ONE_OFF`, `MONTHLY_RECURRING`, `ANNUAL_RENEWAL` | Optional OPEX field; no schedule generation in Phase 1 | Request data |
| RCO-FOR-001 A34:G38 | `lines[].itemDescription` | String | Optional; default `""`; legacy line fields unchanged | Request line data |
| RCO-FOR-001 A34:G38 | `lines[].quantity` | Number >= 0 | Optional; no default; used only when unit price is also present | Server-calculated commercial amount input |
| RCO-FOR-001 A34:G38 | `lines[].unitOfMeasure` | String | Optional; default `""`; catalog not invented | Request line data |
| RCO-FOR-001 A34:G38 | `lines[].unitPrice` | Money number >= 0 | Optional; normalized with existing two-decimal money helper | Server-calculated commercial amount input |
| RCO-FOR-001 G36:G39 | `lines[].commercialTotal` | Money number >= 0 | Server-derived as quantity x unit price; default 0; browser value is ignored | Informational/reconciliation value; not accounting authority |
| RCO-FOR-001 G39 | `totalCommercialAmount` | Money number >= 0 | Server-derived sum; default 0; no migration rewrite | Informational/reconciliation value |
| RCO-FOR-001 G39 | `commercialTotalDifference` | Money number | Server-derived commercial total minus accounting total; default 0 | Does not change posting totals |
| RCO-FOR-001 G39; approved D01 | `commercialTotalStatus` | `NOT_APPLICABLE`, `INCOMPLETE`, `MATCH`, `MISMATCH` | Server-derived; default `NOT_APPLICABLE`; Phase 1 does not block mismatch | Does not change posting totals |
| PDF p.1 quotation table; D01 | `quotations[].supplier` | Supplier ObjectId | Optional in Phase 1; later required by configured quotation policy | Supplier reference |
| PDF p.1 quotation table; historical traceability | `quotations[].supplierSnapshot.{identifierType,identifier,legalName}` | String snapshot fields | Filled from referenced supplier by request service; no legacy backfill | Historical identity snapshot |
| PDF p.1 quotation table; D01 | `quotations[].amount` | Money number >= 0 | Optional in Phase 1 | Commercial comparison only |
| PDF p.1 quotation table; D01 | `quotations[].currency` | PEN/USD | Default PEN | Commercial comparison only |
| PDF p.1 quotation table; D01 | `quotations[].deliveryPeriod` | String | Default `""`; no invented unit | Commercial comparison only |
| PDF p.1 quotation table; D01 | `quotations[].paymentConditions` | String | Default `""` | Commercial comparison only |
| PDF p.1 quotation table; D01 | `quotations[].commercialConditions` | String | Default `""` | Commercial comparison only |
| PDF p.1 quotation table; D01 | `quotations[].attachment` | Embedded attachment ObjectId | Optional in schema; foundational validator reports missing evidence | Protected request attachment reference |
| RCO-FOR-001 A41:G44; D01 | `quotations[].recommended` | Boolean | Default false; foundational validator expects exactly one where policy applies | Must correspond to request supplier when later enforced |
| RCO-FOR-001 A42:G44; D01 | `supplierSelectionReason` | String | Default `""`; foundational validator reports when absent | Request/approval evidence |
| D01 authorized exception preservation | `quotationException.{authorized,authorizedBy,authorizedAt,reason,ruleCode}` | Boolean, User ref, Date, String | Default unauthorized; not accepted through Solicitor request payload; no legacy backfill | Finance/admin-controlled future workflow foundation |

## Embedded rendition extension

| Source | Field path | Type / options | Required, default, fallback, migration and index | Security / ownership |
|---|---|---|---|---|
| Rendition A6:B6 | `rendition.number` | `RG-YYYY-XXXXX` String | Assigned on rendition submission; legacy submitted/observed/validated records receive additive migration value; unique partial index; assign-once model guard | Does not replace `SOL-...` |
| Rendition C6:E9; D04 | `rendition.beneficiarySnapshot.{user,employeeCode,name,email,area,costCenter,costCenterCode,costCenterName}` | User/CostCenter refs and Strings | Captured at submission; Employee Code preferred; no DNI field added; no historical guess | Snapshot prevents later profile edits changing history |
| Rendition A11:E17 | `rendition.mobilityLines[].{date,origin,destination,servicePurpose,amount}` | Date, Strings, PEN money | Optional typed details in Phase 1; amount rounded server-side | Rendition data |
| Rendition A12:E12; D05 | `rendition.mobilityLines[].limitExceeded` | Boolean | Default false; set by configured daily evaluation | Warning/flag only in initial configuration |
| Rendition A20:E25; D04 | `rendition.unsupportedExpenseLines[].{date,description,goodsServiceType,grossAmount}` | Date, String, GOODS/SERVICES, PEN money | Optional typed details in Phase 1; amount rounded server-side | Existing non-deductible accounting path remains separate and authoritative |
| Rendition A18, A26, A31 | `rendition.mobilitySubtotal`, `unsupportedExpenseSubtotal`, `reimbursementTotal` | Money numbers >= 0 | Server-derived; defaults 0; no browser authority | Informational until Phase 2 reconciliation rules |
| Rendition A31 | `rendition.detailReconciliation.{accountingRenderedAmount,difference,status}` | Money/Money; `NOT_APPLICABLE`, `MATCH`, `MISMATCH` | Server-derived; no Phase 1 blocking | Existing `amountRendered` remains accounting authority |
| PDF p.2 exceptional use | `rendition.unsupportedExpenseDeclaration.{confirmedExceptionalUse,comments,declaredAt}` | Boolean, String, Date | Default false/blank; later submission requirement | Beneficiary declaration, separate from Finance decision |
| PDF p.2; D03 separation principle | `rendition.financeReview.{result,reviewer,reviewedAt,comments}` | `PENDING`, `APPROVED`, `OBSERVED`, `REJECTED`; User/Date/String | Default pending; no automatic approval | Finance-controlled future workflow field |
| PDF p.2 beneficiary signature; D04 | `rendition.beneficiaryAcknowledgment.{type,signer,signerName,signedAt,ip,reference,attachment}` | Authenticated/physical type plus references | Authenticated acknowledgment captured at current submission; physical attachment optional | Electronic sign-off, not described as certified digital signature |
| Rendition A28:E30; approved employee-bank architecture | `rendition.reimbursementBankSnapshot.{profile,bank,currency,accountHolderName,accountNumber,cci,verificationStatus,capturedAt}` | Profile ref and snapshot fields | Optional in Phase 1; no migration from supplier accounts | Holder/account/CCI use `select: false`; immutable-use snapshot foundation |
| Rendition A12:E12; D05 | `rendition.limitEvaluation.{configuration,key,configuredValue,currency,effectiveFrom,effectiveTo,behavior,evaluatedAt,exceededLineCount}` | Config ref, values and metadata | Stored when typed mobility lines are evaluated against an effective rule | Auditable policy snapshot; no automatic rejection in Phase 1 |

## Supplier

| Source | Field path | Type / options | Required, default, fallback, migration and index | Security / ownership |
|---|---|---|---|---|
| RCO-FOR-002 E38:G38 | `supplierCode` | `PRV-XXXX` String | Assigned only at successful homologation; existing homologated suppliers receive migration code; assign-once guard; sparse unique index; rejected suppliers receive none | Human reference; Mongo `_id` retained |
| RCO-FOR-002 A9:G10 | `personType` | `LEGAL_ENTITY`, `NATURAL_PERSON_WITH_BUSINESS` | Optional in Phase 1; no legacy inference | Supplier identity |
| RCO-FOR-002 A10:D10 | `commercialName` | String | Defaults from legacy `name`; migration adds fallback without removing `name`/`legalName` | Supplier identity |
| RCO-FOR-002 A11:G12 | `location.{district,province,department,ubigeo}` | Strings | Optional; defaults blank; free-text fiscal/tax addresses retained | Supplier identity |
| RCO-FOR-002 A11:G12 | `website` | String | Optional; default blank | Supplier contact data |
| RCO-FOR-002 A13:G13 | `legalRepresentativeDocument.{type,number}` | DNI/CE and String | Optional in Phase 1; representative file remains required for homologation | Personal identifier; access remains supplier-role controlled |
| RCO-FOR-002 A16:G17 | `commercialContact.{name,position,phone,email}` | Strings | Optional; defaults blank; legacy generic fields retained | Contact data |
| RCO-FOR-002 A18:G19 | `operationsContact.{name,position,phone,email}` | Strings | Optional; defaults blank | Contact data |
| RCO-FOR-002 A23:G23 | `goodsServicesProfile` | String | Optional; legacy `supplierType` retained | Supplier commercial data |
| RCO-FOR-002 E22:G22 | `paymentTerms.{option,days,comments}` | `CREDIT_30`, `CREDIT_45`, `CUSTOM`; Number/String | Optional; 30/45 derive days; custom requires positive days; AP due-date behavior unchanged in Phase 1 | Supplier commercial data |
| RCO-FOR-002 A24:G24 | `delivery.{method,other}` | `CENTRAL_WAREHOUSE`, `DESTINATION_SITE`, `OTHER`; String | Optional; no backfill | Supplier commercial data |
| RCO-FOR-002 A34:G35; D03 | `declarations.stateSanctions.{answer,comments,declaredAt}` | YES/NO/NOT_DECLARED, String, Date | Default not declared; migration does not infer from legacy Finance decision | Supplier declaration, not approval |
| RCO-FOR-002 A34:G35; D03 | `declarations.complianceModel.{answer,comments,declaredAt}` | YES/NO/NOT_DECLARED, String, Date | Default not declared; migration does not infer | Supplier declaration, not approval |
| RCO-FOR-002 A38:G43; D03 | `complianceReview.{result,reviewedBy,reviewedAt,comments}` | PENDING/APPROVED/OBSERVED/REJECTED and review metadata | Legacy COMPLIANT/OBSERVED Finance results map conservatively; NON_COMPLIANT remains manual review | Accounting/Admin writable only through existing route |
| RCO-FOR-002 A38:D38 | `homologationStatus`, `status` enum addition | Adds genuine `REJECTED` | No default change; OBSERVED and INACTIVE retained; no status migration | Existing backend review authorization retained |
| RCO-FOR-002 A28:G31 | `bankHistory[].{accountType,accountHolderName,preferred,verificationStatus,ownershipResult,verifiedBy,verifiedAt,verificationSource,verificationDocument}` | Same bank metadata options below | Optional history metadata; legacy history remains; no history deletion | Embedded compatibility history; canonical account collection remains source |

## SupplierBankAccount

| Source | Field path | Type / options | Required, default, fallback, migration and index | Security / ownership |
|---|---|---|---|---|
| RCO-FOR-002 B29:B31; D06 | `accountType` | `CURRENT`, `DETRACTION` | Required for new records; default CURRENT; migration adds CURRENT to legacy rows | Accounting/Admin verification foundation |
| RCO-FOR-002 account ownership | `accountHolderName` | String | Optional in Phase 1; no ownership claim inferred in migration | Banking data |
| D06 | `preferred` | Boolean | Default false; current replacement path creates preferred account; migration selects only when exactly one legacy active account exists | Partial unique index per supplier/currency/type |
| RCO-FOR-002 account review; D06 | `verificationStatus` | PENDING/VERIFIED/OBSERVED/REJECTED/LEGACY_ACCEPTED | Default PENDING; legacy rows become LEGACY_ACCEPTED, not VERIFIED | Treasury behavior unchanged in Phase 1 |
| RCO-FOR-002 account ownership | `ownershipResult` | NOT_REVIEWED/MATCH/MISMATCH/MANUAL_ACCEPTED | Default NOT_REVIEWED; legacy rows are not claimed as matched | Finance review data |
| RCO-FOR-002 account ownership | `verifiedBy`, `verifiedAt`, `verificationSource`, `verificationDocument`, `verificationComments` | User ref, Date, Strings/ObjectId | Optional review metadata; no fabricated legacy reviewer | Accounting/Admin review data |
| RCO-FOR-002 B29:B31 | `bank` enum addition | Adds `BANCO_NACION` to supplier/employee account catalog | Existing bank-file `BANKS` list is unchanged | Does not imply detraccion applicability or bank TXT support |

## User and EmployeeReimbursementBankAccount

| Source | Field path | Type / options | Required, default, fallback, migration and index | Security / ownership |
|---|---|---|---|---|
| Rendition C6:E9; approved Employee Code decision | `User.employeeCode` | Uppercase String | Optional; sparse unique index; migration does not guess codes | No DNI introduced |
| Rendition A28:E30; approved separate profile | `EmployeeReimbursementBankAccount.user` | User ObjectId | Required | No API route in Phase 1 |
| Same | `.bank`, `.currency` | Supplier bank catalog; PEN/USD | Required; PEN default | Protected profile |
| Same | `.accountHolderName`, `.accountNumber`, `.cci` | Strings; account required; CCI optional but 20 digits when present | Normalized for new writes; no supplier-to-employee migration | All three use `select: false`; no at-rest encryption exists yet |
| Same | `.active`, `.preferred` | Booleans | Defaults true/false; one active preferred profile per employee via partial unique index | Protected profile |
| Same | `.verificationStatus`, `.verifiedBy`, `.verifiedAt`, `.verificationSource`, `.verificationDocument` | Verification enum and metadata | Default PENDING; no fabricated review | Finance-controlled future workflow |
| Same | `.validFrom`, `.validTo`, `.createdBy`, `.changedBy` | Dates/User refs | Historical validity and audit metadata | Records are retained rather than overwritten |

## Configuration and document rules

| Source | Field path | Type / options | Required, default, fallback, migration and index | Security / ownership |
|---|---|---|---|---|
| D05, Rendition A12:E12 | `FinanceConfiguration.key` | `LOCAL_MOBILITY_DAILY_LIMIT`, `UNSUPPORTED_EXPENSE_LIMIT` | Required; unsupported-expense value is intentionally not seeded | Admin/Accounting write; Admin/Accounting/Budget read API |
| D05 | `.numericValue`, `.currency`, `.behavior` | Number >= 0; PEN/USD; INFORMATION/WARNING/FLAG/BLOCK | Required; initial mobility row is 41 PEN, WARNING | Helper reports `shouldBlock` but Phase 1 does not reject |
| D05 | `.effectiveFrom`, `.effectiveTo`, `.active` | Dates/Boolean | Required from, optional to, active default true; range validated | Effective-dated lookup index |
| D05 | `.description`, `.source`, `.createdBy`, `.updatedBy` | Strings/User refs | Source identifies the official workbook; actor IDs set server-side | Audit provenance |
| D01 | `DocumentRule.quotationPolicy.{enabled,minimumCount,allowAuthorizedException,exceptionReasonRequired}` | Boolean, Number >= 1, Booleans | Defaults false/3/true/true; migration enables rules already requiring quotation documents | Existing DocumentRule CRUD authorization retained |

## Index safety

- `Supplier.supplierCode`: sparse unique; legacy records without a code are excluded.
- `FinancialRequest.rendition.number`: partial unique for string values; legacy records without RG are excluded.
- `SupplierBankAccount`: non-unique operational lookup plus partial unique preferred account by supplier/currency/type.
- `EmployeeReimbursementBankAccount`: user/active/date lookup plus partial unique active preferred profile per user.
- `FinanceConfiguration`: key/active/effective-date lookup; overlaps are not silently resolved by a unique index.
- Existing request, voucher, supplier-identifier, workflow, AP, and audit indexes are unchanged.
