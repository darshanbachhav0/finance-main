// Shared by the request editor and backend. Round money at line level, in cents.
export const REQUEST_IGV_PERCENT = 18;
const QUANTITY_SCALE = 100000000n;
const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

function scaledDecimal(value, scale, field) {
  let text = String(value ?? "").trim();
  // Mongoose/JSON may express valid small decimal quantities as 1e-8.
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && text.includes("e")) {
    const [coefficient, exponent] = text.split("e");
    const [whole, fraction = ""] = coefficient.split(".");
    const digits = whole + fraction;
    const point = whole.length + Number(exponent);
    text = point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length ? digits + "0".repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(text) || text.length > 40) throw new Error(`Enter a valid ${field}.`);
  const [whole = "0", fraction = ""] = text.split(".");
  if (field === "quantity" && fraction.length > scale) throw new Error("Quantity supports up to 8 decimal places.");
  const digits = fraction.padEnd(scale + 1, "0");
  return BigInt(whole || "0") * 10n ** BigInt(scale) + BigInt(digits.slice(0, scale) || "0") + (Number(digits[scale]) >= 5 ? 1n : 0n);
}

const divideRounded = (value, divisor) => (value + divisor / 2n) / divisor;
const money = cents => Number(cents) / 100;

export function calculateRequestLineAmounts({ quantity, unitPrice, priceIncludesIGV }) {
  if (typeof priceIncludesIGV !== "boolean") throw new Error("Choose whether the unit price includes IGV.");
  const quantityUnits = scaledDecimal(quantity, 8, "quantity");
  const priceCents = scaledDecimal(unitPrice, 2, "unit price");
  const subtotal = divideRounded(quantityUnits * priceCents, QUANTITY_SCALE);
  const net = priceIncludesIGV ? divideRounded(subtotal * 100n, 118n) : subtotal;
  const igv = priceIncludesIGV ? subtotal - net : divideRounded(subtotal * 18n, 100n);
  const total = net + igv;
  if (priceCents > MAX_CENTS || total > MAX_CENTS) throw new Error("The item amount is too large.");
  return { unitPrice: money(priceCents), subtotal: money(subtotal), netAmount: money(net), igvAmount: money(igv), totalAmount: money(total) };
}
