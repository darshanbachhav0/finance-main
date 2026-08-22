# UMA Triple-Track Financial Workflow Implementation

This implementation extends the existing ERP in place with the consolidated UMA A1/A2/B/C operating model.

## Tracks

- **A1 — Formal purchase:** three quotations and controlled approval, budget reservation, immutable Purchase Order, conformity, XML/PDF registration, SUNAT validation, PO ceiling matching, invoice-level CXP, Treasury payment, reconciliation, and close.
- **A2 — Batch invoices against PO:** ZIP (same-name XML/PDF pairs) or XLSX ingestion, background processing, SUNAT validation, global anti-duplicate identity, remaining-PO matching, automatic provisioning of valid invoices, and isolation of invalid invoices in the Accounting observation inbox.
- **B — Direct invoice / advance payment:** mandatory XML/PDF, real-time fiscal preflight, express approval, automatic budget execution and priority CXP provisioning without a Purchase Order.
- **C — Advance / petty cash:** Account 14 advance, ten-day rendition deadline, overdue-advance blocking, evidence review, final expense execution, and regularization of non-deductible balances by reimbursement or payroll deduction.

## New domain objects

- `MassUploadBatch`: upload lifecycle and per-file processing result.
- `SunatVoucher`: canonical fiscal voucher registry with unique `(RUC, type, series, number)` identity.
- `InvoiceObservation`: isolated fiscal, duplicate, document, or PO-ceiling exception with immutable attempt history.
- `AccountsPayable`: now invoice-level and many-to-one with a request/Purchase Order.

## New routes

- `GET/POST /api/batch-invoices`
- `GET /api/batch-invoices/purchase-orders`
- `GET /api/batch-invoices/observations`
- `GET /api/batch-invoices/observations/:id/:kind`
- `POST /api/batch-invoices/observations/:id/resolve`
- `POST /api/requests/:id/invoice`
- `POST /api/requests/:id/rendition/settle-non-deductible`
- `GET /api/treasury/bounced-payments`
- `POST /api/treasury/payables/:id/confirm-payment`
- `POST /api/treasury/payables/:id/bounce`
- `POST /api/treasury/payables/:id/reprogram`

## Background processing

The default queue is a persistent MongoDB-backed job claim loop and does not require Redis. Run a dedicated worker in production:

```bash
npm run worker:batch
```

The API process can also claim jobs when configured for inline development processing. ZIP archives are parsed with the repository's safe built-in reader; XLSX workbooks use their XML package contents. Legacy binary `.xls` is intentionally rejected.

## Migration

Back up the database, run the dry report, and then apply:

```bash
npm run backup
npm run migrate:triple-track
npm run migrate:triple-track:apply
```

The migration removes the historical one-CXP-per-request unique index, backfills track/status fields, initializes Purchase Order balances, and creates the new voucher/batch indexes. It does not fabricate fiscal facts.

## SUNAT boundary

`ProductionSunatProvider` is configurable through environment variables. Production credentials, provider endpoint, certificate, and UMA-approved contract must be supplied externally. When no production provider is configured, invoices are isolated as SUNAT observations instead of being silently accepted.

## Bounced-payment recovery

A signed CCI letter is required before a bounced payable can be reprogrammed. The reprogram action reopens the payable and preserves the incident in its audit history. Treasury must first update and verify the replacement bank account through the existing Supplier Banking workflow; the uploaded letter is evidence and is not treated as machine-readable authorization to overwrite supplier master data.

## Canonical exception states

`OBSERVADO_PRESUPUESTO`, `OBSERVADO_SUNAT`, `OBSERVADO_MONTO_EXCEDIDO`, `OBSERVADO_CARGA_MASIVA`, `PAGO_REBOTADO`, and final `PAGADO_CERRADO` are represented in the backend state machine, audit trail, UI badges, filters, and Spanish dictionary.

## Verification

The repository includes source-contract tests for all four tracks, batch isolation, invoice-level CXP, bounced payment reprogramming, the ten-day rendition rule, Account 14 settlement, routes, and responsive UI. Run:

```bash
npm test
npm run build
```
