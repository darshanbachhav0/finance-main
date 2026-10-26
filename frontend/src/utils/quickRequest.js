// The simple "New request": three questions (what, how much, the quote or invoice) and the track
// follows from the answers, so nobody has to know what A1, B or C means.

// "Who gets the money?" x "how is it paid?" -> the track and the request type. A1 and B both take
// the supplier's quote, its invoice, or both (at least one); they differ in the purchase order.
//   supplier + purchase order -> A1 (standard purchase: approval, then Procurement orders it)
//   supplier + direct payment -> B (no order: paid once approved and its invoice is checked)
//   employee + advance        -> C, advance to render
//   employee + no receipt     -> C, undocumented reimbursement
export function quickTrack({ payee = "supplier", route = "order", employeeNeed = "advance", capex = false } = {}) {
  if (payee === "employee") return { flowType: "C", requestType: employeeNeed === "reimbursement" ? "REEMBOLSO_SIN_SUSTENTO" : "ENTREGA_RENDIR" };
  return { flowType: route === "direct" ? "B" : "A1", requestType: capex ? "CAPEX" : "OPEX" };
}

// Plain words for the track the answers chose (shown under the questions).
export const QUICK_TRACK_TEXT = Object.freeze({
  A1: "Standard purchase: it goes to approval, then Procurement places the order and the invoice is registered.",
  B: "Direct payment: it goes to approval and is paid once its invoice is checked. Only a quote now? Upload the invoice when it arrives.",
  ENTREGA_RENDIR: "Advance: UMA pays you first and you present the receipts afterwards.",
  REEMBOLSO_SIN_SUSTENTO: "Reimbursement without receipt: after approval you sign a declaration and Treasury pays you.",
  D: "Transfer between UMA's own accounts: the Head of Treasury and the GAF approve it, then Treasury makes it at the bank and reconciles it."
});

export function quickTrackText({ flowType, requestType }) {
  return QUICK_TRACK_TEXT[flowType === "C" ? requestType : flowType] || "";
}

// The first line of the description, as the request title (same rule as the server's).
export function titleFromDescription(description) {
  const line = String(description || "").split(/\r?\n/).map((item) => item.trim()).find(Boolean) || "";
  return line.length > 120 ? `${line.slice(0, 117).trimEnd()}...` : line;
}

// The request month: this month when its accounting period is open, else the nearest open month
// after it, else the latest open one. "" when no period is open.
export function defaultOpenPeriod(periods = [], month) {
  const open = periods.filter((item) => item.status === "OPEN").map((item) => item.period).sort();
  if (open.includes(month)) return month;
  return open.find((period) => period > month) || open.at(-1) || "";
}

// Show the CAPEX planning fields (project, asset category, useful life, NPV, payback) only for
// large purchases, or when something was already filled in; below the threshold Budget or
// Accounting complete them.
export function showCapexDetails({ total = 0, threshold = 50000, capex = {} } = {}) {
  const filled = ["projectId", "projectPep", "assetCategory", "usefulLifeYears", "npvAmount", "paybackValue"].some((key) => String(capex[key] ?? "").trim() !== "");
  return filled || Number(total) >= Number(threshold);
}
