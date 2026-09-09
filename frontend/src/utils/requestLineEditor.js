import { calculateRequestLineAmounts } from "../../../shared/requestLineAmounts.mjs";

export function calculateEditorLine(line) {
  try {
    const amounts = calculateRequestLineAmounts(line);
    return { ...line, ...amounts, unitPrice: line.unitPrice, calculationError: "", legacyAmounts: false };
  } catch (error) {
    return { ...line, subtotal: 0, netAmount: 0, igvAmount: 0, totalAmount: 0, calculationError: error.message, legacyAmounts: false };
  }
}

export function restoreEditorLine(line) {
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
