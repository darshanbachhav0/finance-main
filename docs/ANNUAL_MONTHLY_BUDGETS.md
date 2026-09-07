# Annual and monthly budgets

Budget Control supports a yearly plan for each Cost Center (CECO), expense account, and optional project. Amounts are in PEN; request usage follows the existing PEN equivalent conversion.

## Create and review a plan

1. Sign in as **Budget** or **Admin** and open **Budget Control → Create annual budget**.
2. Select the year, Cost Center, expense account, and optional project.
3. Choose **Annual only** to control the year's total while tracking activity by month, or **Annual + monthly control** to enforce both limits.
4. Enter the annual amount. For monthly control, distribute it equally or enter twelve custom allocations. Equal distribution preserves every cent. The sum cannot exceed the annual amount; any remainder appears as **Pending allocation**.
5. Enter the reason or approval reference and save.

Use **Annual view** for the year's totals and **Monthly view** for a selected month's allocation and activity. Each linked row has a **View annual plan** action containing all twelve months and the adjustment history. Annual-only plans show monthly activity without inventing monthly limits.

Budget, Admin, Approver, Accounting, and Management can read plans through the existing Budget Control permissions. Only Budget and Admin can create plans and record adjustments.

## Control and accounting behavior

- Available budget is assigned minus committed minus executed. Paid is reported separately and is not deducted a second time.
- A request under monthly control must fit both its annual available amount and its month's available amount. A month with zero allocation remains blocked even when the year has unused funds.
- The request's accounting period determines the budget month. The saved commitment retains that period through execution, payment, and release.
- Normal procurement reserves its full PEN purchase amount. A quotation's advance percentage, credit days, or installments do not split the budget commitment across payment months.
- Execution converts committed amounts into executed amounts. Payments update paid amounts. Cancellation releases only the unexecuted commitment.
- Track C advances keep their existing deferred budget behavior: the eligible expense impacts the budget when the rendition is validated. Cancelling an unrendered advance does not release money that was never reserved.
- A linked plan enforces its limits even if the Cost Center was previously transitional. Existing extraordinary-approval rules still require an explicitly approved exception before an overrun. A budget-increase exception requires enough actual allocation before retrying commitment.
- Annual totals use the annual counters once. They do not add the twelve monthly allocations or usage counters to those annual amounts again.

## Audited adjustments

Open a plan and select **Adjust budget**:

| Action | Effect |
| --- | --- |
| Transfer between months | Moves available money from one month to another in the same plan. Committed and executed amounts cannot be transferred. The annual total stays the same. |
| Allocate annual reserve | Assigns part of Pending allocation to a selected month. |
| Record approved annual increase | Raises the annual total. In monthly mode, the increase enters Pending allocation until assigned to a month. |

Every change requires a reason or approval reference and records its amount, actor, timestamp, and affected months in the plan's history. An annual increase records an already approved decision; it does not introduce a separate approval workflow. Unused funds do not roll into another month automatically.

Concurrent adjustments use revision checks and stable retry identifiers. Reservation checks update annual and monthly counters together in one MongoDB document, including on standalone MongoDB. Lifecycle services compensate completed counter updates when a later write throws; operations already running inside a transaction rely on transaction rollback.

## Existing budgets

Existing allocations remain available under **Legacy allocations** and continue using their existing reservation behavior. New linked plans cannot overlap an existing allocation or recorded commitment for the same year and dimension. Historical allocations are not automatically converted: start with an unused dimension/year. Plan mode and dimensions are fixed after creation, and generic configuration edits cannot alter a linked plan or erase its adjustment history.

For legacy annual and monthly allocations in the same dimension, the annual report counts the assigned annual amount once and sums recorded usage. A legacy annual fallback cannot provide reliable monthly usage, so those monthly cells remain blank. Cost Center balances without a budget year are identified as undated and excluded from selected-period totals.

## API and verification

- `POST /api/budget/plans` creates a plan.
- `GET /api/budget/plans/:id` reads a plan and its history.
- `POST /api/budget/plans/:id/adjustments` records an adjustment, with `operationId` and `revision`.
- Existing budget overview, allocation, commitment, and exception endpoints accept `period=YYYY` or `period=YYYY-MM`.

From the repository root, with local MongoDB running:

```powershell
node backend/test/annualMonthlyBudget.test.js
npm run test:budget-planning-ui --workspace frontend
npm run test:frontend
npm run build
```

The budget integration suite covers creation, exact distribution, limits, competing reservations, failed-write compensation, deferred rendition, adjustments, idempotency, reporting, and legacy compatibility. The browser test uses real budget controller/service persistence in a disposable database and checks creation, adjustments, monthly reports, Spanish labels, and mobile layout. It requires Playwright Chromium and uses local ports 5188 and 5189. Both budget suites remove only their own temporary test database.
