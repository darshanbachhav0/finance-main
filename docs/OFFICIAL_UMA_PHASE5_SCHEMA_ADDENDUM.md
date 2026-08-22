# Official UMA Phase 5 Schema Addendum

## 1. Purpose

Phase 5 connects the official UMA request, supplier-homologation, and rendition records to the existing approval, budget, procurement-order, Accounts Payable, and Treasury lifecycle. The changes below are additive and preserve existing documents.

This addendum records only persistent schema changes introduced by Phase 5. Procurement readiness itself is derived at request time and is not stored as a competing workflow state.

## 2. Source And Business Reason

| Model | Source reason | Result |
| --- | --- | --- |
| `PurchaseOrder` | The official process distinguishes an Order of Purchase from an Order of Service, while the repository already had one reusable order entity. | Added a small `orderKind` distinction and approved-data snapshots. |
| `AccountsPayable` | RCO-FOR-002 records supplier payment terms; Accounting must retain the terms that applied when AP was created. | Added an optional payment-terms snapshot and expanded the optional payment-destination snapshot. |
| `PaymentBatch` | Treasury may choose only an eligible validated destination, and later Supplier Master edits must not rewrite the scheduled payment instruction. | Expanded each item snapshot with its source and validation references. |

## 3. PurchaseOrder

The following optional fields were added:

| Field | Type | Purpose |
| --- | --- | --- |
| `orderKind` | Enum: `PURCHASE`, `SERVICE` | Represents the official purchase/service distinction in the existing order lifecycle. |
| `supplierCodeSnapshot` | String | Retains the Supplier Master PRV used for the order. |
| `supplierSnapshot.identifier` | String | Retains the approved supplier RUC/DNI. |
| `supplierSnapshot.legalName` | String | Retains the approved legal name. |
| `lines[]` | Embedded array | Retains approved item, quantity, unit, price/total, Cost Center, and account references where available. |

The existing unique request index remains the idempotency boundary: one order can be created for one financial request. No second Service Order model was introduced.

## 4. AccountsPayable

The following optional fields were added:

| Field | Type | Purpose |
| --- | --- | --- |
| `paymentTermsSnapshot.option` | Existing supplier payment-term enum | Retains the payment-term option effective when AP was created. |
| `paymentTermsSnapshot.days` | Number | Retains the corresponding credit days. |
| `paymentTermsSnapshot.comments` | String | Retains supplier payment-term comments. |
| `paymentTermsSnapshot.capturedAt` | Date | Records when the terms were copied to AP. |

The existing `bankAccountSnapshot` was extended with optional fields:

- `sourceType`: `SUPPLIER` or `EMPLOYEE_REIMBURSEMENT`
- `supplierBankAccountId`
- `employeeReimbursementBankId`
- `accountType`
- `accountHolderName`
- `verificationStatus`
- `ownershipResult`
- `capturedAt`

Existing `bank`, `currency`, `accountNumber`, and `cci` snapshot fields remain supported.

Phase 5 does not derive a new due date. An explicitly supplied existing `dueDate` is preserved. Historical AP records without `paymentTermsSnapshot` remain valid.

## 5. PaymentBatch

Each payment-batch item can now retain these optional snapshot fields in addition to the existing bank, currency, account, and CCI values:

- `sourceType`
- `supplierBankAccountId`
- `employeeReimbursementBankId`
- `accountType`
- `accountHolderName`
- `verificationStatus`
- `ownershipResult`
- `capturedAt`

These values identify the validated destination selected at scheduling time. They are snapshots, not live Supplier Master lookups.

## 6. Backward Compatibility

- All new fields are optional.
- Existing Purchase Orders continue to load without `orderKind` or expanded snapshots.
- Existing AP documents continue to load without captured payment terms.
- Existing due dates are not recalculated.
- Existing payment batches retain their historical bank snapshots.
- Supplier or employee bank edits do not rewrite scheduled AP or batch snapshots.
- No historical journal, reconciliation, payment, request, supplier, or audit record is rewritten.

Automated tests cover legacy AP loading, immutable payment destinations, and repeated/concurrent order creation.

## 7. Index And Migration Impact

No new Phase 5 index or destructive migration is required. The existing unique `PurchaseOrder.request` index provides duplicate-order protection.

The official Phase 1 foundation migration remains pending for the important/current database. Its Phase 5 verification was dry-run only.

- Migration apply executed: **NO**
- Direct important-database data modification: **NO**
- Phase 5 schema backfill required: **NO**

## 8. Business Clarifications

`NEEDS_BUSINESS_CLARIFICATION — AP_DUE_DATE_BASE_DATE`

UMA must define the authoritative date from which supplier credit days are counted. Until then, the application snapshots terms but preserves the existing explicit due-date behavior.

`NEEDS_BUSINESS_CLARIFICATION — DETRACTION_TRANSACTION_TRIGGER`

Supplier DETRACTION accounts are excluded from normal payment selection. No legal transaction-level detraccion classification is inferred.

`NEEDS_BUSINESS_CLARIFICATION — SUPPLIER_REACTIVATION_APPROVAL_POLICY`

Inactive suppliers remain blocked. Phase 5 does not invent a reactivation approval route.

`NEEDS_BUSINESS_CLARIFICATION — PROCUREMENT_ORDER_CLASSIFICATION`

Controlled expense natures with an established goods/service meaning map to Purchase or Service. UMA must define policy for any remaining nature that cannot be classified reliably without guessing.
