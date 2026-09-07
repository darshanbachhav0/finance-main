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
