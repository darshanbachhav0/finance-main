# UMA BBVA payment files

New Treasury batches use BBVA exclusively, in PEN or USD. Beneficiaries can use another bank through a 20-digit CCI. Historical batches, bank records and files are retained. Generation creates an instruction and never confirms payment. Actual confirmation uses the batch's source bank for the accounting bank account, including interbank beneficiaries.

## Verified structure

The generator reproduces both supplied files byte for byte. The samples use LF separators, no final newline, no BOM, and single-byte accented characters compatible with Latin-1. Record lengths exclude newline bytes. All unknown controls remain explicit configuration; sample values are not automatically activated.

| Reference | Payments | Total | Header | Detail |
|---|---:|---:|---:|---:|
| BBVAPROVSOLES31082026.txt | 8 | PEN 17,711.90 | 151 bytes | 277 bytes |
| BBVAPROVDOLARES31082026.txt | 1 | USD 3,694.70 | 151 bytes | 277 bytes |

Amounts use integer cents internally, zero-padded to 15 digits. The six-digit payment count and header total are recalculated from details and verified after encoding. Text is space-padded. Unsupported characters, embedded newlines, overflow in identifiers/references, invalid amounts, mismatched currencies, missing beneficiary information, malformed accounts/CCIs, and missing configuration block generation.

## Fields Treasury must confirm

Positions below are **one-based and inclusive**. Labels for ambiguous bytes describe their location rather than claim an official BBVA meaning.

| Record / bytes | Observed value / content | Required confirmation and configuration |
|---|---|---|
| Header 1–3 | `750` | Meaning and required value of `headerPrefix`. |
| Header 4–23 | Different 20-digit values in PEN/USD | Confirm the authorized UMA debit account field for each currency (`debitAccount`), including leading zeros. |
| Header 24–26 | PEN / USD | Currency is derived from the selected batch; confirm debit-account currency. |
| Header 27–41 | Total in cents | Computed, never manually supplied. |
| Header 42–51 | `A` plus nine spaces | Meaning of `headerControl`; whether execution date or processing mode is represented here. No date is inserted by inference. |
| Header 52–76 | `PAGO PROV` plus spaces | Confirm batch label (`headerLabel`). |
| Header 77–82 | Count | Computed, never manually supplied. |
| Header 83–151 | `S`, 18 zeros, 50 spaces | Meaning and required contents of `headerTrailer`; confirm whether any control/checksum must vary per batch. |
| Detail 1–3 | `002` | Meaning and required `detailPrefix`. |
| Detail 4 | R / L | Confirm RUC/DNI mapping (`rucCode`, `dniCode`). Other identifier types are blocked. |
| Detail 5–16 | RUC/DNI with spaces | Source is beneficiary identifier, right-padded to 12 bytes. |
| Detail 17 | P / I | Confirm internal/interbank routing codes (`internalCode`, `interbankCode`). |
| Detail 18–37 | 20-digit destination | Confirm whether BBVA's stored account is 20 digits, or 18 digits with a two-digit prefix. Set `internalAccountLength` and `internalAccountPrefix`; no digits are guessed. Other banks require a 20-digit CCI. |
| Detail 38–77 | Name | Confirm permitted name truncation (`truncateText`, also applies to description). |
| Detail 78–92 | Amount in cents | Computed. |
| Detail 93 | B / F | Meaning and mapping of `documentCodes` to the actual CXP voucher type; configure an explicit default only if Treasury authorizes it, including advances/reimbursements. |
| Detail 94–105 | Reference | Confirm series-number mapping from CXP and handling of references longer than 12 bytes (currently blocked). |
| Detail 106 | N | Meaning and required `descriptionControl`. |
| Detail 107–146 | Description | Uses request description; verify business suitability and truncation policy. |
| Detail 147 | E | Meaning and required `contactControl`. |
| Detail 148–197 | Email or `0` | Confirm who receives the message and whether `0` is permitted. Production uses Treasury-configured `defaultContact`; the sample reader supplies each original value only for reproduction tests. |
| Detail 198–227 | NAYRUT FLORES, padded | Confirm the purpose and responsible person (`orderingContact`); no assumption that the sample person remains responsible. |
| Detail 228–277 | 32 zeros and 18 spaces | Meaning of `detailTrailer`; confirm whether any value is calculated per beneficiary/payment. |
| File encoding/separators | Single-byte accents, LF, no final newline | Confirm `encoding: latin1`, `lineEnding: LF/CRLF`, `finalNewline` and accepted character repertoire with BBVA. Windows-1252-only punctuation is rejected rather than misencoded. |

The sample cannot prove account ownership, bank acceptance, CCI check-digit algorithms, or the meaning of the control bytes. Account checks here are structural, in addition to existing verified-beneficiary controls. Bank-side validation/certification remains necessary. If a control is dynamic rather than constant, Treasury must provide the official rule before using that configuration; do not set a sample literal for a field that needs calculation.

## Configuration and deployment

No historical migration is required. Added optional fields are `BankFormatConfiguration.bbva`, `PaymentBatch.paymentCount`, `PaymentBatch.formatSnapshot`, and the `FIXED_WIDTH` mode. No production configuration was activated.

Admin can edit Configuration → Bank Formats for separate BBVA/PEN and BBVA/USD records. Enter the reviewed JSON in the BBVA configuration field, choose FIXED_WIDTH and a version, then set `bbva.confirmed: true` and activate. The saved configuration is included in each generated batch. The existing master-data audit records the change. Sample-derived JSON templates in `data/reports/bbva-structure-tests` are inactive/unconfirmed and omit document mappings. They are review aids, not ready production settings.

The payment date stays in the batch/audit; neither sample contains an identifiable execution-date field. Treasury must confirm whether the date is selected when uploading in BBVA or represented by one of the ambiguous controls. Do not assume the date in the filename schedules execution.

Each file records batch ID/number, currency, count, total, generation date/user, SHA-256 and format version in batch/generated-file/audit records. Disk writes are exclusive. Repeat generation is blocked after the CXP enters a batch; downloads serve existing bytes without regenerating. Atomic CXP claims prevent concurrent double generation even on standalone MongoDB. A process crash can leave a claim in `bbvapaymentgenerationclaims`; review the linked batch number and CXP before clearing an abandoned claim. Full multi-document transaction guarantees still require a MongoDB replica set.

## Validation and generated examples

Run `node backend/scripts/verifyBbvaSamples.js` from the project root. This only writes local test artifacts; it neither accesses the production database nor submits anything to BBVA. Test files reproduce the original payment instructions and are labeled TEST-ONLY: do not upload them to the bank.

Backend tests cover both samples, byte lengths, counts/totals, invalid accounts/CCI/amounts, mixed currencies, non-BBVA rejection, absent configuration, concurrent/repeated generation, audit evidence, TXT without payment confirmation, and the existing payment/reconciliation lifecycle. Frontend tests and production build are also run.

Final verification: `npm test --workspace backend` passed all 216 tests; `npm test --workspace frontend` passed; `npm run build --workspace frontend` passed (2.82 seconds). `node backend/scripts/verifyBbvaSamples.js` confirmed exact byte equality for PEN and USD. The comparison JSON records SHA-256 values and reconciled totals. No operational database or bank was used to generate these example artifacts.

## Files changed

| File | Purpose |
|---|---|
| backend/src/integrations/banks/BbvaBankFileAdapter.js | Fixed-width validation, rendering and reconciliation. |
| backend/src/integrations/banks/index.js | BBVA-only new file generation; removes demo adapter dispatch. |
| backend/src/models/BankFormatConfiguration.js | Additive confirmed field configuration and fixed-width mode. |
| backend/src/models/PaymentBatch.js | Count/configuration snapshot and fixed-width mode. |
| backend/src/services/treasuryService.js | Configured generation, interbank selection, claims, audit and source-bank accounting. |
| backend/src/services/paymentDestinationService.js | Currency validation when source bank does not restrict beneficiary bank. |
| backend/src/controllers/treasuryController.js | Updated generation response without JSON-encoded binary content. |
| backend/src/controllers/masterDataController.js | Permit audited BBVA configuration updates. |
| frontend/src/pages/TreasuryQueue.jsx | BBVA source only; retains interbank beneficiaries and payment confirmation. |
| frontend/src/pages/MasterConfiguration.jsx | BBVA configuration editor. |
| frontend/src/context/LanguageContext.jsx | Spanish text for new Treasury/configuration messages. |
| backend/test/bbvaFixtures.js | Supplied-sample fixtures and isolated test configuration. |
| backend/test/bbvaFormat.test.js | Structural, reconciliation and rejection regressions. |
| backend/test/financialLifecycle.test.js | Real BBVA generation, concurrency, repeated audit and payment separation. |
| backend/test/workflowStatus.test.js | BBVA source and configuration for existing workflow regressions. |
| backend/test/run.js | Register BBVA tests. |
| backend/scripts/verifyBbvaSamples.js | Produce PEN/USD examples, inactive templates and byte comparison report. |
| docs/BBVA_IMPLEMENTATION.md | Field confirmation, deployment and change documentation. |
