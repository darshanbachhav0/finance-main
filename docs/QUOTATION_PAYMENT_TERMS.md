# Quotation payment terms

In Track A1, open **Create/Edit request → Items and quotations → Supplier quotations**. Each quotation has three selectable payment cards. Labels follow the application's English/Spanish language setting.

| Payment card | Automatic split |
| --- | --- |
| 100% Advance / 100% Adelanto | Advance 100%, balance 0% |
| 100% On Delivery / 100% Contra entrega | Advance 0%, balance 100% |
| Advance + Balance / Adelanto + Saldo | Default advance 30%, balance 70%; choose another percentage |

Advance + Balance provides a synchronized slider and numeric percentage input, plus **20%**, **30%**, **50%**, and **Custom** buttons. Custom focuses the percentage input. Both controls accept percentages from 0.01 through 99.99 in steps of 0.01; use the fixed cards for a 0% or 100% advance. Radio cards and the slider also support keyboard navigation. The split bar and read-only amounts update immediately when the percentage or quotation amount changes. Invalid or empty inputs do not retain stale amount previews.

For **PEN 3,540** with a **30%** advance, the preview shows **PEN 1,062** advance and **PEN 2,478** balance. Amounts are rounded to cents; the balance is calculated by subtraction so the split always equals the quoted total. The same shared calculation now shows amounts for both fixed payment options, including historical fixed terms whose numeric percentage fields are empty.

Number of payments and Payment details inputs are removed. Advance + Balance uses the existing `ADVANCE_AND_BALANCE` backend condition, automatically supplies `balanceTiming: ON_DELIVERY`, and needs no payment-count field. The collapsed **Additional terms (optional)** section retains optional payment notes and alternate balance timing (conformity, service completion, invoice, or a custom description). Existing non-default timing remains visible in the summary. These fields open automatically when validation identifies an error.

The comparison beneath the quotation cards and the final review show each supplier's price, delivery period, and payment terms. Request Detail shows the same terms to approvers, including advance/balance amounts and notes. Selecting a different recommendation selects that quotation's terms.

## Saving and compatibility

New quotations start with no card selected until the user chooses an agreement. Existing credit, partial-payment, custom, and free-text agreements appear as read-only summaries and retain their stored fields until the user chooses one of the three cards. Selecting a card carries existing text into payment notes. Existing quotations without terms remain valid; no data migration is required. The backend still accepts all six historical payment conditions.

Drafts can retain incomplete details. Once a structured condition is selected, submission and procurement readiness require its applicable details. Existing validation for percentages, credit days, supported conditions, and payment counts remains in place. Switching cards clears irrelevant numeric and timing fields while preserving notes. The API derives both fixed splits (100/0 and 0/100) and split balances instead of trusting submitted derived values. These percentages survive request and order save/reload. Local autosave also retains the selected card and percentage.

## Purchase / Service Orders

Newly issued orders copy the recommended quotation's terms into `paymentTermsSnapshot`. The snapshot contains the source quotation ID, quoted amount/currency, and applicable term fields. The selected quotation must match the order supplier. An issued order keeps this snapshot, including on repeated issuance requests or subsequent quotation changes. Historical orders are not retroactively rewritten.

The snapshot appears as **Order payment terms / Condición de pago de la orden** in Request Detail and is recorded in the issuance audit. Issuing an order does not itself create Accounts Payable records, a payment schedule, or Treasury instructions.

## Supplier form and accounting alignment

The supplier create/edit form no longer asks for payment terms, custom credit days, or payment comments. Users enter purchase-specific terms once in each quotation. The form does not submit a hidden default or overwrite existing supplier terms. Historical supplier terms remain visible as a labeled fallback in Supplier Detail; the backend fields remain compatible with older records and clients.

When a new payable is created, the server selects terms in this order:

1. The issued Purchase/Service Order snapshot, when the order has terms.
2. The recommended quotation matching the supplier, when there is no issued order.
3. Existing supplier payment defaults, when neither applicable source has terms.

An older issued order with no terms is not reinterpreted using a quotation edited after issuance. Existing payables are returned on voucher retries with their original terms and due date. No historical records are rewritten. Newly created snapshots retain the agreement's condition, percentages, timing, notes, credit fields, source quotation, quoted amount/currency, and source type.

Accounts Payable, Request Detail and the Treasury queue display the captured terms read-only. Invoice-date credit calculates the due date from the invoice date plus the agreed credit days. A 100% advance uses the invoice issue date as the payable's due date. Accounting can explicitly override the date. For delivery/conformity milestones, split payments, or free-text/custom agreements, the system does not invent a date or apply unrelated supplier credit days: the payable remains without an automatic due date until a date is specified in the existing accounting/payment workflow. A document upload date is not treated as a confirmed delivery date.

Without quotation/order terms, the existing supplier credit rules remain in effect (30 days, 45 days, or custom days; the existing 30-day fallback when no defaults exist). Track B/C without such terms retain their immediate invoice-date behavior. Accounting's optional due-date field starts empty so it does not silently override calculated terms with the invoice date.

This change does not create or settle advance/balance installments automatically. It preserves the existing invoice-level payable and Treasury payment workflow; the displayed percentage split is the agreed contract condition, not evidence that an advance was paid.

Management reports group quotation/order payables without a due date under **Date pending**. They remain pending rather than overdue and are excluded from the dated Treasury forecast until a date is known. Existing legacy-report fallback behavior is retained for older payables without quotation/order snapshots.

Validation includes 44 focused backend tests, supplier and quotation browser suites, frontend contracts, and the production frontend build. The broader `financialLifecycle.test.js` fixture fails at submission with `QUOTATION_MINIMUM_NOT_MET` because it supplies no three-quotation comparison; downstream failures in that fixture occur before these accounting changes can be exercised.

Restart the backend and reload the frontend after updating. No database migration is required.

## Implementation and verification

- `shared/paymentTerms.mjs`: common options, validation, normalization, summaries, and cent-based split calculation.
- Quotation fields live in the existing `FinancialRequest.quotations` schema. `paymentConditions` retains legacy free text; `paymentCondition` identifies the structured choice. The server derives `balancePercentage` and ignores submitted split amounts.
- `backend/test/quotationPaymentTerms.test.js`: parsing, fixed splits, invalid inputs, rounding, legacy terms, schema validation, and supplier selection.
- `backend/test/workflowPhase5.test.js`: database persistence of split and fixed terms, issued order snapshots, unchanged snapshots on repeat issuance, legacy copying, and absence of automatic CXP creation. Uses a disposable MongoDB database.
- `npm run test:payment-terms-ui --workspace frontend`: Chromium test of the real wizard against isolated API fixtures using the actual quotation parser. Covers all three cards, keyboard/pointer slider interaction, numeric synchronization, presets, validation, amount updates, draft save/reopen, autosave, legacy credit/partial terms, review, Spanish, and 768/390/320px viewports. Screenshots go to `.tmp/payment-terms-ui`.

Verification for the simplified cards: all seven payment-term tests, all 18 workflow integration checks, frontend contract tests, the quotation browser regression, and the frontend production build passed. The original payment-terms implementation recorded 14 unrelated failures in the full backend suite; that full-suite baseline was not rerun for this UI update.
