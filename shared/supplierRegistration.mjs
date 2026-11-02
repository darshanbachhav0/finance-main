// Supplier registration rules shared by the form and the API (pilot "Alta de proveedor"): national
// or foreign supplier, goods or services, detraccion, and the bank data each kind of account needs.
// Every function returns an error message (English UI key, translated by the page) or "" when valid.

export const SUPPLIER_ORIGINS = Object.freeze(["NATIONAL", "FOREIGN"]);
export const SUPPLY_TYPES = Object.freeze(["GOODS", "SERVICES"]);
export const BANK_ACCOUNT_SCOPES = Object.freeze(["NATIONAL", "FOREIGN"]);
// Payments abroad are made in dollars (pilot: "Cuenta en el exterior (SWIFT)" - USD).
export const FOREIGN_ACCOUNT_CURRENCIES = Object.freeze(["USD"]);
// Placeholder bank code of an account abroad; its real name is in bankOtherName.
export const FOREIGN_BANK_CODE = "FOREIGN";

const clean = (value) => String(value ?? "").trim();
// Upper case without spaces or accents ("España" -> "ESPANA").
const compact = (value) => clean(value).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "").toUpperCase();

// RUC: 11 digits starting 10, 15, 16, 17 or 20, with the SUNAT check digit (weights 5432765432).
export function isValidRuc(value) {
  const ruc = clean(value).replace(/\D/g, "");
  if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((total, weight, index) => total + weight * Number(ruc[index]), 0);
  return (11 - (sum % 11)) % 10 === Number(ruc[10]);
}

export function rucError(value) {
  const ruc = clean(value).replace(/\D/g, "");
  if (!ruc) return "Enter the RUC.";
  if (!/^\d{11}$/.test(ruc)) return "The RUC has 11 digits.";
  return isValidRuc(ruc) ? "" : "This RUC is not valid: check its digits.";
}

export function isUnitedStates(country) {
  return /^(us|usa|eeuu|ee\.?\s?uu\.?|estados unidos( de am[eé]rica)?|united states( of america)?)$/i.test(clean(country));
}

// SWIFT/BIC: 4 letters (bank) + 2 letters (country) + 2 letters or digits (place) + optional 3 (branch).
export function swiftError(value, { required = true } = {}) {
  const swift = compact(value);
  if (!swift) return required ? "Enter the SWIFT/BIC code." : "";
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(swift) ? "" : "The SWIFT/BIC code has 8 or 11 letters and digits.";
}

// IBAN: country (2 letters) + check digits (2) + 10-30 letters/digits, valid by ISO 13616 mod 97.
export function ibanError(value) {
  const iban = compact(value);
  if (!iban) return "";
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return "The IBAN is not well formed.";
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of rearranged) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1 ? "" : "This IBAN is not valid: check its digits.";
}

// ABA routing number: 9 digits, required for banks in the United States.
export function abaError(value, country) {
  const aba = clean(value).replace(/\s+/g, "");
  if (!aba) return isUnitedStates(country) ? "Banks in the United States need the ABA routing number." : "";
  return /^\d{9}$/.test(aba) ? "" : "The ABA routing number has 9 digits.";
}

// Banco de la Nacion detracciones account: 11 digits.
export function detractionAccountError(value, { required = false } = {}) {
  const account = clean(value).replace(/[\s-]/g, "");
  if (!account) return required ? "A supplier subject to detraccion needs its Banco de la Nacion account." : "";
  return /^\d{11}$/.test(account) ? "" : "The Banco de la Nacion detraccion account has 11 digits.";
}

export function emailError(value, { required = true } = {}) {
  const email = clean(value);
  if (!email) return required ? "Enter the supplier's contact email." : "";
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? "" : "Enter a valid email address.";
}

// The unique key of a supplier abroad: its country and tax identification.
export function foreignSupplierKey(country, taxId) {
  const place = compact(country).replace(/[^A-Z0-9]/g, "").slice(0, 20);
  const id = compact(taxId).replace(/[^A-Z0-9]/g, "");
  return place && id ? `EXT-${place}-${id}` : "";
}

// Problems of a bank account abroad (empty list: valid).
export function foreignAccountProblems(account = {}) {
  const problems = [];
  if (!clean(account.bankOtherName || account.bankName)) problems.push("Enter the name of the bank.");
  if (!clean(account.bankCountry)) problems.push("Enter the bank's country.");
  const swift = swiftError(account.swift);
  if (swift) problems.push(swift);
  const iban = ibanError(account.iban);
  if (iban) problems.push(iban);
  if (!compact(account.iban) && !compact(account.accountNumber)) problems.push("Enter the IBAN or the account number.");
  const aba = abaError(account.aba, account.bankCountry);
  if (aba) problems.push(aba);
  if (clean(account.intermediarySwift)) {
    const intermediary = swiftError(account.intermediarySwift);
    if (intermediary) problems.push(`Intermediary bank: ${intermediary}`);
  }
  const currency = clean(account.currency || "USD").toUpperCase();
  if (!FOREIGN_ACCOUNT_CURRENCIES.includes(currency)) problems.push("Accounts abroad are paid in dollars (USD).");
  return problems;
}
