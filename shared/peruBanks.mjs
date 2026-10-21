// The one list of banks a supplier's or employee's account can be held at (the beneficiary bank),
// used by the backend enums and every bank dropdown. Source: SBS bulletin B-2201 (empresas
// bancarias, data as of 31-Aug-2026) plus Banco de la Nación and BTG Pactual Perú (licensed
// Sep-2026). Keep it in step with the SBS register: a bank added here appears everywhere; never
// remove a code still stored on an account (set `retired: true` instead, so old accounts keep their
// name and new ones cannot pick it).
//
// cci: the 3-digit entity code that opens the bank's 20-digit CCI (BCRP / CCE list of entity
// codes). cciConfirmed: confirmed by more than one source; only those are checked against the
// CCI typed. The others are shown as a hint until UMA confirms them with a real CCI or the CCE file.
//
// OTHER ("Otro / No disponible") is for a bank missing from this list: the account then needs the
// bank's name and its CCI, and Accounting verifies it like any other account before it is paid.
export const PERU_BANKS = Object.freeze([
  { code: "BCP", name: "Banco de Crédito del Perú", shortName: "BCP", cci: "002", cciConfirmed: true },
  { code: "BBVA", name: "BBVA Perú", shortName: "BBVA", cci: "011", cciConfirmed: true },
  { code: "INTERBANK", name: "Interbank", shortName: "Interbank", cci: "003", cciConfirmed: true },
  { code: "SCOTIABANK", name: "Scotiabank Perú", shortName: "Scotiabank", cci: "009", cciConfirmed: true },
  { code: "BANCO_NACION", name: "Banco de la Nación", shortName: "Banco de la Nación", cci: "018", cciConfirmed: true },
  { code: "BANBIF", name: "Banco Interamericano de Finanzas", shortName: "BanBif", cci: "038" },
  { code: "PICHINCHA", name: "Banco Pichincha", shortName: "Pichincha", cci: "035" },
  { code: "MIBANCO", name: "Mibanco", shortName: "Mibanco", cci: "049" },
  { code: "BANCO_COMERCIO", name: "Banco de Comercio", shortName: "Bancom", cci: "023" },
  { code: "CITIBANK", name: "Citibank del Perú", shortName: "Citibank", cci: "007" },
  { code: "GNB", name: "Banco GNB Perú", shortName: "GNB", cci: "053" },
  { code: "FALABELLA", name: "Banco Falabella Perú", shortName: "Falabella", cci: "054" },
  { code: "RIPLEY", name: "Banco Ripley", shortName: "Ripley", cci: "055" },
  { code: "SANTANDER", name: "Banco Santander Perú", shortName: "Santander", cci: "056" },
  { code: "ALFIN", name: "Alfin Banco", shortName: "Alfin", cci: "058" },
  { code: "ICBC", name: "ICBC Perú Bank", shortName: "ICBC", cci: "060" },
  { code: "BANK_OF_CHINA", name: "Bank of China (Perú)", shortName: "Bank of China", cci: "062" },
  { code: "BCI", name: "Banco BCI Perú", shortName: "BCI", cci: "063" },
  { code: "COMPARTAMOS", name: "Compartamos Banco", shortName: "Compartamos", cci: "091" },
  { code: "EFECTIVA", name: "Banco Efectiva (Efectibank)", shortName: "Efectibank", cci: "" },
  { code: "SANTANDER_CONSUMER", name: "Santander Consumer Bank", shortName: "Santander Consumer", cci: "" },
  { code: "BTG_PACTUAL", name: "Banco BTG Pactual Perú", shortName: "BTG Pactual", cci: "" },
  { code: "OTHER", name: "Otro / No disponible", shortName: "Otro", cci: "", other: true }
]);

export const PERU_BANK_CODES = Object.freeze(PERU_BANKS.map((bank) => bank.code));
// What a new account may choose (a retired bank stays readable on old accounts only).
export const SELECTABLE_PERU_BANKS = Object.freeze(PERU_BANKS.filter((bank) => !bank.retired));

const byCode = new Map(PERU_BANKS.map((bank) => [bank.code, bank]));

export function peruBank(code) {
  return byCode.get(String(code || "").trim().toUpperCase()) || null;
}

// The name shown for an account: the catalog name, or the name typed for "Otro".
export function bankDisplayName(code, otherName = "") {
  const bank = peruBank(code);
  if (!bank) return String(code || "");
  if (bank.other) return String(otherName || "").trim() || bank.name;
  return bank.name;
}

// "" when the CCI fits the bank (or cannot be checked), otherwise why not. A CCI is the bank's
// 3-digit entity code, the 3-digit office, the account and two check digits: 20 digits.
export function cciBankProblem(code, cci) {
  const digits = String(cci || "").replace(/[\s-]/g, "");
  if (!digits) return "";
  if (!/^\d{20}$/.test(digits)) return "CCI must contain exactly 20 digits.";
  const bank = peruBank(code);
  if (!bank?.cci || !bank.cciConfirmed) return "";
  return digits.slice(0, 3) === bank.cci ? "" : "This CCI belongs to another bank: check the bank or the CCI.";
}
