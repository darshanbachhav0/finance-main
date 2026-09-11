// Shared by the quotation editor and API so validation and calculations agree.
export const PAYMENT_CONDITIONS = Object.freeze({
  "100%_ADVANCE": "100% advance",
  "100%_ON_DELIVERY": "100% on delivery",
  ADVANCE_AND_BALANCE: "Advance + balance",
  CREDIT: "Credit",
  PARTIAL_PAYMENTS: "Partial payments",
  OTHER: "Other"
});

export const BALANCE_TIMINGS = Object.freeze({
  ON_DELIVERY: "On delivery",
  ON_CONFORMITY: "On conformity",
  SERVICE_COMPLETION: "At service completion",
  AFTER_INVOICE: "After invoice",
  OTHER: "Other"
});

export const CREDIT_STARTS = Object.freeze({ INVOICE: "Invoice", CONFORMITY: "Conformity" });
const blank = (value) => value === undefined || value === null || value === "";
const text = (value) => typeof value === "string" ? value.trim() : "";
const number = (value) => blank(value) ? null : Number(value);
const numeric = (value) => (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) && Number.isFinite(Number(value));
const has = (options, value) => Object.hasOwn(options, value);

export function validatePaymentTerms(value = {}, { requireComplete = true } = {}) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });
  const condition = value.paymentCondition;
  if (!blank(condition) && !has(PAYMENT_CONDITIONS, condition)) add("paymentCondition", "Select a valid payment condition.");
  const checkText = (field, required = false) => {
    if (!blank(value[field]) && (typeof value[field] !== "string" || value[field].length > 4000)) add(field, "Enter text of at most 4000 characters.");
    else if (required && requireComplete && !text(value[field])) add(field, "This field is required.");
  };
  checkText("paymentConditions");
  checkText("paymentNotes", ["PARTIAL_PAYMENTS", "OTHER"].includes(condition));
  const checkNumber = (field, valid, message) => {
    if (blank(value[field])) { if (requireComplete) add(field, message); }
    else if (!numeric(value[field]) || !valid(Number(value[field]))) add(field, message);
  };
  if (condition === "ADVANCE_AND_BALANCE") {
    checkNumber("advancePercentage", (n) => n > 0 && n < 100 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-8, "Enter an advance greater than 0 and less than 100, with at most two decimal places.");
    if ((!blank(value.balanceTiming) || requireComplete) && !has(BALANCE_TIMINGS, value.balanceTiming)) add("balanceTiming", "Select when the balance is payable.");
    if (value.balanceTiming === "OTHER") checkText("balanceTimingNotes", true);
  }
  if (condition === "CREDIT") {
    checkNumber("creditDays", (n) => Number.isSafeInteger(n) && n > 0, "Enter a positive whole number of credit days.");
    if ((!blank(value.creditStart) || requireComplete) && !has(CREDIT_STARTS, value.creditStart)) add("creditStart", "Select when the credit period starts.");
  }
  if (condition === "PARTIAL_PAYMENTS") checkNumber("partialPaymentCount", (n) => Number.isSafeInteger(n) && n >= 2, "Enter at least two payments as a whole number.");
  return errors;
}

// Never trust a client-supplied balance percentage or retain inactive fields.
export function normalizePaymentTerms(value = {}) {
  const condition = value.paymentCondition || null;
  const split = condition === "ADVANCE_AND_BALANCE";
  const advance = condition === "100%_ADVANCE" ? 100 : condition === "100%_ON_DELIVERY" ? 0 : split ? number(value.advancePercentage) : null;
  return {
    paymentCondition: condition,
    paymentConditions: condition ? "" : text(value.paymentConditions),
    advancePercentage: advance,
    balancePercentage: advance === null ? null : Number((100 - advance).toFixed(2)),
    balanceTiming: split ? value.balanceTiming || null : null,
    balanceTimingNotes: split && value.balanceTiming === "OTHER" ? text(value.balanceTimingNotes) : "",
    creditDays: condition === "CREDIT" ? number(value.creditDays) : null,
    creditStart: condition === "CREDIT" ? value.creditStart || null : null,
    partialPaymentCount: condition === "PARTIAL_PAYMENTS" ? number(value.partialPaymentCount) : null,
    paymentNotes: text(value.paymentNotes)
  };
}

export function paymentBreakdown(value = {}, amount = value.amount) {
  if (!["100%_ADVANCE", "100%_ON_DELIVERY", "ADVANCE_AND_BALANCE"].includes(value.paymentCondition) || blank(amount) || !numeric(amount) || Number(amount) < 0) return null;
  if (validatePaymentTerms(value, { requireComplete: false }).some((error) => error.field === "advancePercentage")) return null;
  const { advancePercentage, balancePercentage } = normalizePaymentTerms(value);
  if (advancePercentage === null) return null;
  // Round once to cents, then subtract the advance so both amounts sum exactly.
  const match = String(amount).match(/^(\d+)(?:\.(\d*))?$/);
  if (!match) return null;
  const fraction = `${match[2] || ""}000`;
  const cents = BigInt(match[1]) * 100n + BigInt(fraction.slice(0, 2)) + (Number(fraction[2]) >= 5 ? 1n : 0n);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const basisPoints = BigInt(Math.round(advancePercentage * 100));
  const advanceCents = (cents * basisPoints + 5000n) / 10000n;
  return {
    advancePercentage,
    balancePercentage,
    advanceAmount: Number(advanceCents) / 100,
    balanceAmount: Number(cents - advanceCents) / 100
  };
}

export function paymentTermsSummary(value = {}, t = (label) => label) {
  const condition = value.paymentCondition;
  if (!condition && !text(value.paymentConditions) && !text(value.paymentNotes) && value.option) {
    const days = value.option === "CREDIT_45" ? 45 : value.option === "CREDIT_30" ? 30 : Number(value.days || 0);
    return `${t(value.option)} · ${days} ${t("days")}`;
  }
  if (!condition) return text(value.paymentConditions) || text(value.paymentNotes) || t("Not specified");
  const label = t(PAYMENT_CONDITIONS[condition] || "Other");
  if (validatePaymentTerms(value).length) return `${label} (${t("Details pending")})`;
  if (condition === "100%_ADVANCE") return t("100% before starting");
  if (condition === "100%_ON_DELIVERY") return t("100% after delivery / conformity");
  if (condition === "ADVANCE_AND_BALANCE") {
    const timing = value.balanceTiming === "OTHER" ? text(value.balanceTimingNotes) : t(BALANCE_TIMINGS[value.balanceTiming]);
    return t("{advance}% advance + {balance}% balance ({timing})")
      .replace("{advance}", String(Number(value.advancePercentage)))
      .replace("{balance}", String(Number((100 - Number(value.advancePercentage)).toFixed(2))))
      .replace("{timing}", timing);
  }
  if (condition === "CREDIT") return t("100% payable {days} days after {start}").replace("{days}", String(Number(value.creditDays))).replace("{start}", t(CREDIT_STARTS[value.creditStart]));
  if (condition === "PARTIAL_PAYMENTS") return `${t("{count} payments").replace("{count}", String(Number(value.partialPaymentCount)))}: ${text(value.paymentNotes)}`;
  return text(value.paymentNotes) || label;
}
