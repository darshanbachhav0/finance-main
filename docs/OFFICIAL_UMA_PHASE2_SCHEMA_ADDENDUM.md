# Official UMA Formats - Phase 2 Schema Addendum

## Scope

This addendum records the minimum additive persistence introduced for Stage 2, Phase 2 (`RCO-FOR-002`). It does not replace the Phase 1 field catalog and does not create a second Supplier or bank-account collection.

## Supplier additions

| Field | Type | Source / reason | Backward compatibility |
|---|---|---|---|
| `proposedBy` | `ObjectId -> User` | Approved Phase 2 responsibility mapping: the authenticated UMA proposer owns the supplier-registration request and permitted correction lifecycle. | Optional for legacy suppliers. Missing ownership never changes historical supplier usability. |
| `proposedAt` | `Date` | Records when the authenticated supplier proposal was created. | Optional for legacy suppliers; `createdAt` remains available. |
| `proposalJustification` | `String` | RCO-FOR-002 `A41:G43`, "Sustento del Requerimiento de Alta". | Optional on old records. Required only for new proposals created through the Phase 2 API. |
| `taxpayerValidation.status` | Enum | Honest persistent result for supplier taxpayer review. | Defaults to `NOT_VERIFIED`; old `taxpayerStatus` and `compliance.taxpayerActive` remain readable. |
| `taxpayerValidation.providerMode` | Enum | Approved Phase 2 SUNAT decision: distinguish NotConfigured, Manual, Mock, and Production. | Defaults to `NOT_CONFIGURED`; does not reinterpret historical validation. |
| `taxpayerValidation.providerConfigured` | Boolean | Records whether the provider was configured when the decision was made. | Defaults to `false`. |
| `taxpayerValidation.source` | String | Stores the provider-reported source without claiming stronger verification. | Empty for legacy rows. |
| `taxpayerValidation.returnedIdentifier` | String | Supports RUC comparison when the selected provider/manual review returns an identifier. | Optional. |
| `taxpayerValidation.returnedLegalName` | String | RCO-FOR-002 legal-name control and PDF manual p.2 exact-name guidance. | Optional. |
| `taxpayerValidation.identifierMatch` | Enum | `MATCH`, `MISMATCH`, or `NOT_VERIFIED`. | Defaults to `NOT_VERIFIED`. |
| `taxpayerValidation.legalNameMatch` | Enum | `MATCH`, `MISMATCH`, or `NOT_VERIFIED`. | Defaults to `NOT_VERIFIED`. |
| `taxpayerValidation.validatedAt` | Date | Review traceability. | Optional. |
| `taxpayerValidation.validatedBy` | `ObjectId -> User` | Backend-owned authorized reviewer identity. | Optional. |
| `taxpayerValidation.comments` | String | Manual/provider review context. | Empty by default. |

## Index addition

`Supplier` adds `{ proposedBy: 1, homologationStatus: 1, createdAt: -1 }` to support the proposer correction queue. Existing unique indexes for normalized supplier identifiers and PRV codes remain unchanged.

## Existing Phase 1 fields used without expansion

- `SupplierBankAccount` already contained account type, holder, CCI, verification, ownership, preferred-account, validity, and actor metadata.
- The Phase 1 partial unique index continues to enforce one active preferred account per supplier, currency, and account type.
- `Supplier.declarations`, `Supplier.complianceReview`, `Supplier.documents`, and `Supplier.bankHistory` are reused.
- `supplierCode` continues to use the atomic `PRV-XXXX` sequence and remains immutable after assignment.

## Migration decision

No Phase 2 data migration is required for these optional additive fields. Legacy already-homologated suppliers remain usable and `LEGACY_ACCEPTED` bank records are not relabelled. The separate Phase 1 official-form foundation migration remains the only pending migration for the current important database and was not applied during Phase 2.
