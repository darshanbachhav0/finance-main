export const BUDGET_PLANNING_MODES = { ANNUAL_ONLY: "Annual only", ANNUAL_MONTHLY: "Annual + monthly control" };
export const BUDGET_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const validBudgetYear = (value) => /^\d{4}$/.test(String(value)) && Number(value) >= 2000 && Number(value) <= 2199;
export const validBudgetPeriod = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value)) && validBudgetYear(String(value).slice(0, 4));

export function budgetCents(value) {
  if (!["string", "number"].includes(typeof value)) throw new Error("Enter a valid budget amount with at most two decimal places.");
  const match = String(value).trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error("Enter a valid budget amount with at most two decimal places.");
  const cents = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 999999999999) throw new Error("The budget amount is too large.");
  return cents;
}

export function distributeAnnualBudget(amount) {
  const cents = budgetCents(amount);
  const each = Math.floor(cents / 12);
  return BUDGET_MONTHS.map((_, index) => (each + (index < cents % 12 ? 1 : 0)) / 100);
}

// An equal monthly split that respects what each month already used (`floors`, its committed plus
// executed amounts): a month never gets less than that, and the rest is shared equally among the
// others. With `fromMonth`, earlier months keep only what they used and the rest of the year is
// split equally from that month to December. The months add up to the annual budget.
export function splitAnnualBudget(amount, { floors = [], fromMonth = 1 } = {}) {
  const total = budgetCents(amount);
  const floor = BUDGET_MONTHS.map((_, index) => Math.max(0, Math.round(Number(floors[index] || 0) * 100)));
  const start = Math.min(12, Math.max(1, Math.trunc(Number(fromMonth) || 1))) - 1;
  const result = floor.slice();
  let open = BUDGET_MONTHS.map((_, index) => index).filter((index) => index >= start);
  let remaining = total - floor.slice(0, start).reduce((sum, value) => sum + value, 0);
  if (remaining < open.reduce((sum, index) => sum + floor[index], 0)) throw new Error("The months have already used more than the annual budget.");
  // A month whose usage is above the equal share keeps its usage; the share is then recomputed.
  for (;;) {
    const share = Math.floor(remaining / open.length);
    const above = open.filter((index) => floor[index] > share);
    if (!above.length) break;
    above.forEach((index) => { remaining -= floor[index]; });
    open = open.filter((index) => !above.includes(index));
  }
  const each = Math.floor(remaining / open.length);
  open.forEach((index, position) => { result[index] = each + (position < remaining - each * open.length ? 1 : 0); });
  return result.map((cents) => cents / 100);
}
