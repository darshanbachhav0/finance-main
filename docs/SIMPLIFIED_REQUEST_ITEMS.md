# Simplified request items

Create Request and Edit Request now show six essential values for each item: description, quantity, unit of measure, unit price, an IGV checkbox, and a read-only final total. The checkbox is selected for new items. Subtotal and IGV are display values; users cannot enter net, IGV, commercial total, accounting total, or reconciliation amounts.

## Calculation

The configured rate is 18%, as requested, consistent with [SUNAT's IGV guidance](https://emprender.sunat.gob.pe/principales-impuestos/impuesto-general-las-ventas-igv/impuesto-general-las-ventas).

| Quantity | Unit price | Price includes IGV | Net | IGV | Final total |
| --- | --- | --- | --- | --- | --- |
| 3 | PEN 1,000.00 | Yes | PEN 2,542.37 | PEN 457.63 | PEN 3,000.00 |
| 3 | PEN 1,000.00 | No | PEN 3,000.00 | PEN 540.00 | PEN 3,540.00 |

Quantity, unit price, and checkbox changes update the displayed total immediately. Included prices use `total = quantity * unitPrice`, with net extracted by dividing by 1.18. Excluded prices use `net = quantity * unitPrice`, then add 18% IGV. Money is rounded half-up to two decimals at line level. Unit prices use two decimals; fractional quantities support up to eight decimals. Net plus IGV always reconciles with the final line total.

`shared/requestLineAmounts.mjs` provides the same calculation to the browser and backend. The API recomputes automatic amounts instead of trusting submitted totals. Model validation also recomputes amounts, PEN equivalents, and the gross commercial total used by procurement. Purchase order snapshots retain the price basis, net, tax, and final total.

## Budget allocation and existing records

New items inherit the request's cost center. Choose the expense account once under request information; a single eligible account is selected automatically. When several accounts are eligible, the user selects one. An optional collapsed **Adjust budget allocation** section supports different cost centers or expense accounts per item. Existing budget item references remain intact. New items use the system's existing account-based budget matching, including annual/monthly controls and the request's CAPEX project.

Local autosave and saved requests retain the IGV checkbox. Older records without `priceIncludesIGV` retain historical amounts. The editor infers a price basis only when all saved net, IGV, and total values match the new calculation. Otherwise, it shows a notice and preserves the saved amounts until quantity, price, or the checkbox changes. No migration or recalculation of historical database records is required.

Labels are available in English and Spanish. Mobile item cards stack the price and result below quantity/unit; the wizard footer stays in the page flow on small screens so it cannot obscure totals.

## Verification

From the repository root:

```powershell
node backend/test/requestLineAmounts.test.js
node --test backend/test/requestPhase3.test.js
node --test backend/test/officialFormatsFoundation.test.js backend/test/workflowPhase5.test.js
node frontend/test/run.js
npm run test:request-item-ui --workspace frontend
node frontend/test/quotationPaymentTerms.browser.mjs
npm run build
```

The calculation tests cover both examples, fractional quantities, cent rounding, invalid inputs, tampered submitted amounts, and legacy compatibility. Request integration tests use a disposable MongoDB database to verify create/update/reload and budget preview. Browser tests exercise the actual wizard with isolated API fixtures: live totals, multiple items, default allocation, validation, autosave, save/reopen, Spanish, and 768/390/320-pixel layouts. Browser screenshots are written to `.tmp/request-item-ui/`.

After updating an already running installation, restart its backend process and refresh the browser to load the new calculation and built interface.
