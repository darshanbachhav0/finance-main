# Quotation payment terms

In Track A1, open **Create/Edit request → Items and quotations → Supplier quotations**. Each quotation has a payment-condition selector. Labels follow the application's English/Spanish language setting.

| Spanish option | Fields |
| --- | --- |
| 100% Adelanto | Optional payment notes |
| 100% Contra entrega | Optional payment notes |
| Adelanto + Saldo | Advance percentage, balance timing, optional notes |
| Crédito | 15/30/45/60 days or a custom positive whole number; period starts after invoice or conformity |
| Pagos parciales | Number of payments (at least two) and a written description |
| Otro | Written payment condition |

For an advance, the balance percentage is calculated automatically. Amounts use the quotation's amount and currency. For PEN 11,800 with a 30% advance, the preview shows PEN 3,540 advance and PEN 8,260 balance. Amounts are rounded to cents; the balance is calculated by subtraction so the split always equals the quoted total.

Balance timing offers delivery, conformity, service completion, invoice, or a custom description. Payment notes and commercial conditions are separate fields. Partial-payment descriptions do not generate milestones or validate the percentages written in prose.

The comparison beneath the quotation cards and the final review show each supplier's price, delivery period, and payment terms. Request Detail shows the same terms to approvers, including advance/balance amounts and notes. Selecting a different recommendation selects that quotation's terms.

## Saving and compatibility

The selector starts at **Not specified / Sin especificar** instead of inventing a supplier agreement. Existing free-text `paymentConditions` remain readable and editable. Selecting a structured condition carries that text into payment notes. Existing quotations without terms remain valid; no data migration is required.

Drafts can retain incomplete details. Once a structured condition is selected, submission and procurement readiness require its applicable details. Invalid provided percentages, fractional credit days, unsupported options, and invalid payment counts are rejected on both the client and API. Advance percentages must be greater than zero and less than 100, with at most two decimal places. Switching conditions clears irrelevant numeric and timing fields while preserving notes.

## Purchase / Service Orders

Newly issued orders copy the recommended quotation's terms into `paymentTermsSnapshot`. The snapshot contains the source quotation ID, quoted amount/currency, and applicable term fields. The selected quotation must match the order supplier. An issued order keeps this snapshot, including on repeated issuance requests or subsequent quotation changes. Historical orders are not retroactively rewritten.

The snapshot appears as **Order payment terms / Condición de pago de la orden** in Request Detail and is recorded in the issuance audit. This feature creates no Accounts Payable records, payment schedule, or Treasury instructions and does not change invoice processing or due-date rules.

## Implementation and verification

- `shared/paymentTerms.mjs`: common options, validation, normalization, summaries, and cent-based split calculation.
- Quotation fields live in the existing `FinancialRequest.quotations` schema. `paymentConditions` retains legacy free text; `paymentCondition` identifies the structured choice. The server derives `balancePercentage` and ignores submitted split amounts.
- `backend/test/quotationPaymentTerms.test.js`: parsing, invalid inputs, rounding, legacy terms, schema validation, and supplier selection.
- `backend/test/workflowPhase5.test.js`: persisted order snapshots, unchanged snapshots on repeat issuance, legacy copying, and absence of automatic CXP creation.
- `npm run test:payment-terms-ui --workspace frontend`: Chromium test of the real wizard against mocked API responses. Covers all six choices, validation, amount updates, draft save/reopen, review, Spanish, and a 390px viewport. Requires the project's Playwright Chromium installation and permission to launch a local browser. Screenshots go to `.tmp/payment-terms-ui`.

Verification during implementation: the unchanged repository backend suite reported 14 failures in legacy document-rule/workflow tests. The updated suite reports the same failures; the payment-term and order integration checks pass. These existing failures are not suppressed by this feature.
