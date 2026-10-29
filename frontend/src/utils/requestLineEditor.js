import { calculateRequestLineAmounts } from "../../../shared/requestLineAmounts.mjs";

// Older PDF imports sometimes selected a zero exempt-operations row as the net.
// Recover only an absent/zero net from the two known invoice amounts; retain
// positive conflicting values so validation still catches a real discrepancy.
export function recoverMissingInvoiceNet(line) {
  const missingNet = line.netAmount == null || line.netAmount === "" || Number(line.netAmount) === 0;
  const total = Math.round(Number(line.totalAmount) * 100);
  const tax = line.igvAmount == null || line.igvAmount === "" ? NaN : Math.round(Number(line.igvAmount) * 100);
  return missingNet && Number.isSafeInteger(total) && Number.isSafeInteger(tax) && tax >= 0 && total > tax
    ? { ...line, netAmount: (total - tax) / 100 }
    : line;
}

export function calculateEditorLine(line) {
  try {
    const amounts = calculateRequestLineAmounts(line);
    return { ...line, ...amounts, unitPrice: line.unitPrice, calculationError: "", legacyAmounts: false };
  } catch (error) {
    return { ...line, subtotal: 0, netAmount: 0, igvAmount: 0, totalAmount: 0, calculationError: error.message, legacyAmounts: false };
  }
}

export function restoreEditorLine(line) {
  line = recoverMissingInvoiceNet(line);
  if (typeof line.priceIncludesIGV === "boolean") return calculateEditorLine(line);
  // Infer a saved price basis only if all saved amounts match exactly.
  for (const priceIncludesIGV of [true, false]) {
    const candidate = calculateEditorLine({ ...line, priceIncludesIGV });
    if (!candidate.calculationError && ["netAmount", "igvAmount", "totalAmount"].every(key => Math.round(Number(line[key]) * 100) === Math.round(candidate[key] * 100))) return candidate;
  }
  // Historical/exempt amounts remain intact until the user changes pricing.
  return { ...line, priceIncludesIGV: undefined, legacyAmounts: true };
}

export function editRequestLine(line, patch) {
  const next = { ...line, ...patch };
  const changesPrice = ["quantity", "unitPrice", "priceIncludesIGV"].some(key => Object.hasOwn(patch, key));
  return changesPrice ? calculateEditorLine({ ...next, priceIncludesIGV: typeof next.priceIncludesIGV === "boolean" ? next.priceIncludesIGV : true }) : next;
}

export function requestLinePayload({ clientId, subtotal, legacyAmounts, calculationError, ...line }) {
  return line;
}
