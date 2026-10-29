# UMA Finance — Accounting CXP invoice-prefill and validation fix

## Scope and reference

Addresses the Accounting > To post > Review fiscal data drawer shown for request `SOL-2026-00144`. According to Doc 1 (pages 3–5) and Doc 2 (pages 5–9, 13–14), supplier invoice/acta validation and accounting posting precede Treasury programming and bank-batch approval. The Pagos UMA HTML is used as a workflow reference, not as production code.

## Cause

`frontend/src/pages/AccountingEntries.jsx` opened a pending request with an empty invoice series and number, and used the request creation date as a fallback for the invoice date. Autosaved drafts could restore older manually entered fiscal values. This explains why a drawer can show numbers that do not match the request's captured invoice. The production database has not been inspected, so it is not possible to certify the true invoice identity for SOL-2026-00144 from screenshots alone.

## Files modified or added (exact repository-relative paths)

- `frontend/src/pages/AccountingEntries.jsx` — fetch fresh request before opening Accounting; prefill stored invoice identity/date; avoid silently restoring previous fiscal drafts; show original-invoice source, request link and conflict messages; require separate correlative; disable misleading action if no original identity or if validated evidence conflicts.
- `backend/src/services/accountingService.js` — reject a combined series+correlative entered as the correlative; reject series/date/type that differ from the validated original before creating any CXP.
- `shared/accountingInvoicePrefill.mjs` (new) — shared, dependency-free source-of-truth extraction and validated evidence comparison.
- `backend/test/accountingInvoicePrefill.test.mjs` (new) — five focused regression tests.

## Expected results

For a request with a saved original invoice `FF01-3041` issued 2026-10-01, the Accounting drawer starts with series `FF01`, correlative `3041`, document date `2026-10-01` and **today** as the Accounting date. If verified XML/PDF says something else, it wins over manual request text. A prior draft does not automatically replace these fields. If original evidence is missing, the user is directed to the request documents; missing data is not fabricated. If data is inconsistent, Accounting is blocked from posting until it is corrected and validated.

The due date override remains blank intentionally: the backend derives contractual due dates from the supplier/OC payment terms, avoiding a different user-entered date overriding those terms. Other existing accounting, budget, signed-acta, SUNAT, SPOT, CXP, Treasury, and reconciliation controls remain in place. No database migration is necessary for this patch.

## Verification

- `node --test backend/test/accountingInvoicePrefill.test.mjs backend/test/umaManualFlowUnit.test.js`: **10 passed, 0 failed**.
- `node --check backend/src/services/accountingService.js`: passed.
- TypeScript JSX parser for `frontend/src/pages/AccountingEntries.jsx`: zero parser diagnostics.

**Not verified**: live MongoDB, third-party SUNAT, full frontend production build and browser E2E. The sandbox does not have the npm dependencies or the deployed database. Deploy to staging first, run `npm ci`, `npm run test:backend`, `npm run test:frontend`, `npm run build`, and manually process a test invoice through Accounting and Treasury. Never run destructive migrations against production as part of this fix.

## Testing in the UI

1. Open `/accounting`, select a budget-committed B request with attached validated invoice.
2. Click **Review fiscal data**: verify series, number, issue date are taken from the saved invoice, not an old draft or request date.
3. Confirm expense account and SPOT, signed acta for credit, and an open accounting period.
4. Click **Validate and create CXP** on staging. Confirm exactly one payable, balanced posting, and entry into Treasury when other prerequisites are met.
5. Reopen the request and confirm no duplicate posting. Test a mismatched number (should be rejected) and a missing invoice file (should prompt re-upload).
