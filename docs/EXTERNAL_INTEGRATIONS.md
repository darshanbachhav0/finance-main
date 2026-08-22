# External Integrations and Certification Limits

Date: 2026-08-10

This document states what the application actually integrates with today. It is deliberately conservative: a development adapter, manually entered decision, or export file is never represented as a certified external transaction.

## Capability Matrix

| Integration | Current capability | Runtime mode | Production status | Configuration or specification still required |
|---|---|---|---|---|
| SUNAT taxpayer validation | Provider abstraction supports mock validation, authorized manual validation, and a clear not-configured response. | `MOCK`, `MANUAL`, or unconfigured production placeholder | Not connected to a production SUNAT service | UMA-approved endpoint, authentication, request/response contract, availability/error policy, and credentials |
| SUNAT voucher validation | Same provider boundary as taxpayer validation. XML consistency is validated locally and is not represented as a SUNAT response. | `MOCK`, `MANUAL`, or not configured | No production voucher API configured | Official API/service contract and credentials |
| SUNAT selling exchange rate | Interface exists through `SunatProvider.getSellingExchangeRate()`. Exact dated USD records are required in the ERP. | Manual unless a real provider is configured | No authoritative online SUNAT rate is configured | Official source, credentials if applicable, historical-date behavior, and approved fallback policy |
| BCRP exchange-rate lookup | Retrieves a current published USD/PEN reference for an Accounting/Admin user to review and edit before saving. | Optional online reference | Useful reference only; not authoritative SUNAT data | UMA policy deciding whether and when BCRP may be used as fallback |
| SIRE/RCE | Validates eligible records, previews exclusions/warnings, exports CSV, and retains export history. | Preparation/export | No direct SUNAT submission | Official submission API/specification, credentials, receipt/retry/error contract |
| BCP bank file | Validates payment items, produces a persisted text batch, checksum, item snapshots, and history. | `DEMO` | **DEMO / NOT CERTIFIED** | BCP-approved field layout, encoding, control totals, validation examples, and version |
| BBVA bank file | Same adapter contract and controls. | `DEMO` | **DEMO / NOT CERTIFIED** | BBVA-approved specification and test certification |
| Interbank bank file | Same adapter contract and controls. | `DEMO` | **DEMO / NOT CERTIFIED** | Interbank-approved specification and test certification |
| Scotiabank bank file | Same adapter contract and controls. | `DEMO` | **DEMO / NOT CERTIFIED** | Scotiabank-approved specification and test certification |
| Bank execution response | Treasury manually records operation number, payment date, confirmed amount, and comments after external execution. | Manual | No automated bank-response integration | Bank response/API/file format and matching rules |
| Bank reconciliation | Authorized Treasury/Admin users manually reconcile a confirmed payment to a bank reference. | Manual | Operational manual control | Bank-statement feed/API if automation is required |
| Electronic sign-off | Stores authenticated user, role, decision, timestamp, IP, unique reference, SLA result, and request snapshot hash. | Internal authenticated sign-off | Not a certified legal digital signature | Certified signature provider, identity assurance, certificate policy, and legal approval if required |

## SUNAT Provider Configuration

Set `SUNAT_PROVIDER_MODE` in `backend/.env`:

- `MANUAL`: default operational fallback. Authorized staff records the result; the UI and audit identify it as manual.
- `MOCK`: deterministic development/testing behavior only.
- Any production-oriented value without an implemented provider returns `INTEGRATION_NOT_CONFIGURED` and the message `SUNAT integration not configured`.

Implementation boundary:

- `backend/src/integrations/sunat/SunatProvider.js`
- `backend/src/integrations/sunat/ManualSunatProvider.js`
- `backend/src/integrations/sunat/MockSunatProvider.js`
- `backend/src/integrations/sunat/NotConfiguredSunatProvider.js`
- `backend/src/services/sunatService.js`

Local XML parsing remains a separate fiscal consistency control. It extracts supported metadata and compares identifier, voucher, date, Net, IGV, and Total. A successful local XML comparison does not mean SUNAT accepted or validated the voucher.

## Exchange Rates

PEN always uses an exchange rate of `1`. USD requests require a rate for the request issue date; the backend does not silently substitute the latest available date. The request and each accounting line retain the rate, date, source, original amount, and PEN equivalent as historical snapshots.

`FX_ALLOW_BCRP_FALLBACK` controls whether the optional BCRP reference lookup is exposed as a fallback. Even when enabled, the returned value is editable and is labelled as BCRP reference data, not an authoritative SUNAT selling rate. Accounting/Admin users remain responsible for the saved record and source label.

## SIRE/RCE

The SIRE module currently performs:

1. Period-based eligibility selection.
2. Required fiscal-field and XML checks.
3. Preview with row-level warnings/errors.
4. CSV export to `backend/generated/reports`.
5. MongoDB export-history persistence.

It does not authenticate to SUNAT, upload an official file, receive a submission ticket, or poll acceptance results. UI/export metadata explicitly states `directSubmission: false`.

## Bank Files

The common adapter contract is in `backend/src/integrations/banks/BankFileAdapter.js`; bank-specific adapters are under the same folder. Active format configuration is stored in `BankFormatConfiguration` and seeded as:

- Mode: `DEMO`
- Specification version: `UMA-DEMO-1`
- Certified: `false`

`BANK_FILE_MODE` defaults to `DEMO`. The system persists the batch number, bank, currency, payment date, AP items, bank-account snapshots, total, physical file path, SHA-256 checksum, generator, timestamp, and status.

Generating or downloading a TXT never confirms payment. Actual confirmation is a separate, idempotent Treasury action that settles Accounts Payable, creates the balanced payment journal, updates budget figures, and moves the request to `PAGADO`.

## Production Readiness Checklist for an External Adapter

Before any adapter is labelled production-ready, UMA should provide and approve:

1. Official specification and version.
2. Credentials and secret-management process.
3. Certified request/response or file examples.
4. Test environment and acceptance evidence.
5. Error, retry, timeout, duplicate, and reconciliation behavior.
6. Responsible business owner and change-control procedure.
7. Security/privacy review and retention policy.
8. Monitoring and incident-response expectations.

Until that checklist is complete, the current manual/development mode remains explicit and auditable.
