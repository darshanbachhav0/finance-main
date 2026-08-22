# Official UMA Formats - Phase 1 Migration

## Commands

Dry run (default, no MongoDB writes):

```powershell
npm run migrate:official-formats
```

Apply after reviewing the generated JSON report and taking a database/file backup:

```powershell
npm run migrate:official-formats:apply
```

Reports are written to `backend/migration-reports/` with a timestamp and `dry-run` or `apply` in the file name.

## Additive changes

The migration may:

- Add `commercialName` from an existing supplier `name`/`legalName`.
- Map an existing Finance compliance result to the separate `complianceReview` structure. Supplier declarations are not fabricated.
- Assign an atomic `PRV-XXXX` only to existing homologated/active suppliers that do not already have a code. Rejected suppliers are excluded.
- Add a title and detailed-description fallback from an existing request `description`.
- Assign an atomic `RG-YYYY-XXXXX` only to legacy renditions already submitted, observed, or validated.
- Add conservative legacy bank metadata (`CURRENT`, `LEGACY_ACCEPTED`, `NOT_REVIEWED`) and normalize only safely formatted numeric account/CCI values.
- Mark a bank account preferred only when it is the supplier's sole active legacy account.
- Enable quotation policy metadata on existing `DocumentRule` records that already require quotation attachments.
- Insert the initial 41 PEN warning-only mobility configuration when no active configuration covers 2026-01-01.
- Synchronize PRV/RG counters with existing valid codes before generating new references.
- Create the new sparse/partial indexes after data changes succeed.

## Intentionally untouched

The migration does not:

- Delete or reset any collection.
- Change request status, request number, approval history, accounting period, financial amount, exchange rate, budget, journal, AP, payment, reconciliation, or Treasury snapshot.
- Convert `NON_COMPLIANT` into genuine `REJECTED`; it is reported for manual review.
- Infer supplier declarations from a Finance review result.
- Infer person type, CAPEX values, OPEX frequency, quotation comparison, employee code, or employee bank profile.
- Move an employee reimbursement account out of a supplier record automatically.
- Mark a legacy bank account `VERIFIED` or claim account-holder ownership.
- Set an unsupported-expense Finance limit.
- Change approval routing or Treasury account selection.

## Repeat safety

The migration records key `2026-08-official-uma-formats-foundation-v1` in `migrationruns` only after the apply operation and index creation succeed. A repeated apply exits as already applied. Atomic counters never reuse allocated references; a gap is acceptable if a later write fails.

Malformed legacy account/CCI values are retained and listed under `manualReview` instead of being rewritten. The field remains readable through the `legacyImported` compatibility path.

## Rollback characteristics

Application code can be rolled back because all schema changes are additive and legacy fields remain. The migration itself does not provide a destructive down migration: assigned PRV/RG references and audit-relevant metadata should not be removed or reused. Restore from backup only if UMA authorizes a full operational rollback.
