# Current UI: compact remaining budget

The request form now shows annual/monthly remaining amounts after the actual request, with small horizontal bars. The percentage slider, hypothetical month, presets and reset controls have been removed at the user's request. Amounts update with request edits, and Refresh balances retrieves current availability. The server preview remains read-only. The UMA appearance settings are unchanged.

The original implementation notes below describe the earlier simulator UI and are retained as history.

# Budget simulator and UMA appearance

## Where to use them

In Create Request (or an editable draft), open **Items and quotations**. The **If this is approved…** panel replaces the old budget preview. Choose a percentage from 1 to 300 using the synchronized slider and input, or select a preset. Change the budget month to compare a different period. Reset restores the original request scenario; Refresh balances fetches current availability.

The panel shows the original request and hypothetical amount in PEN, annual and monthly balances, remaining amounts and shortfalls. Shared allocations appear once. Annual-only plans explicitly have no monthly limit. Transitional balances are labelled informational. For Track C, the panel explains that expense-budget commitment occurs at rendition, not approval.

Scenarios call the existing protected budget preview endpoint. Cost-center permissions and accounting dimensions are validated on the server. USD uses the stored exchange rate for the request's issue date; moving the hypothetical budget month does not invent a future exchange rate. Missing rates prevent a usable forecast. A scenario never changes the request, allocates funds, saves a budget plan or creates a commitment. Actual availability is checked again at commitment.

Choose **Appearance** in the account menu or on the login screen: Light, Dark or System. The setting persists on the device and follows OS changes in System mode. The initial setting is applied before React renders to avoid a light-screen flash. UMA rays appear subtly in navigation branding and loading states. Forms, tables, menus, drawers, financial charts and status indicators use theme-aware colors. CSS motion and chart animations respect reduced-motion preferences; print styling remains light.

## Removed and why

- The old request-budget number grid: replaced by the simulator, which includes the same underlying balances and adds annual/monthly comparisons.
- The old technical budget-preview explanation: replaced by a concise explanation of what the user can compare and the fact that no funds are reserved.
- The repeated UMA/product footer on the login panel: the official logo and product name already identify the platform.
- A separate route-loading skeleton and obsolete brand/footer CSS selectors: replaced by the shared UMA loading component and current brand styles.
- Notification refreshes triggered by read-only budget-preview POSTs: simulations no longer cause unnecessary dashboard and bell requests.

Financial forms, approvals, permissions, audit history, demo-role access and document requirements remain available.

## Verification

- `backend: node test/budgetSimulator.test.js`: real isolated database; monthly/annual-only/zero allocations, duplicate-source totals, percentage and month validation, CECO permissions, stored USD rate, rounding, unchanged request payload and no financial writes.
- `backend: node test/requestPhase3.test.js` and `node test/annualMonthlyBudget.test.js`: request and budget lifecycle regression coverage.
- `frontend: npm test`, `npm run test:budget-experience-ui`, `npm run build`.
- Browser coverage includes desktop/mobile simulation, synchronized controls, alternate months, annual-only messaging, retries, saved theme, System mode, reduced motion, dark tables/drawers and login. Screenshots are kept under `.tmp/budget-experience` for local QA.
