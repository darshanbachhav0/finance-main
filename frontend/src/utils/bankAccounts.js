import { cciBankProblem, peruBank } from "../../../shared/peruBanks.mjs";
import { abaError, ibanError, swiftError } from "../../../shared/supplierRegistration.mjs";

// Bank accounts as the forms handle them (components/suppliers/BankAccountFields.jsx): the
// options, an empty account, the checks the server also makes, the API payload and a short label.

export const ACCOUNT_TYPE_OPTIONS = Object.freeze([
  { value: "SAVINGS", label: "Savings account" },
  { value: "CURRENT", label: "Current account" }
]);

export const ACCOUNT_CURRENCY_OPTIONS = Object.freeze([
  { value: "PEN", label: "Soles (PEN)" },
  { value: "USD", label: "Dollars (USD)" }
]);

export const emptyBankAccount = (holder = "", currency = "PEN") => ({
  clientId: `${Date.now()}-${Math.random()}`,
  bank: "",
  bankOtherName: "",
  accountType: "SAVINGS",
  accountCurrency: currency,
  accountNumber: "",
  cci: "",
  accountHolderName: holder
});

const digits = (value) => String(value || "").replace(/[\s-]/g, "");

export function bankOptionLabel(bank) {
  return bank.other ? bank.name : bank.shortName && bank.shortName !== bank.name ? `${bank.shortName} - ${bank.name}` : bank.name;
}

// "BCP · Cuenta de ahorros · PEN · ****1234" for an account the platform already has.
export function bankAccountLabel(account, t = (text) => text) {
  const bank = peruBank(account?.bank);
  const abroad = account?.scope === "FOREIGN" || account?.bank === "FOREIGN";
  const name = abroad ? [account?.bankOtherName, account?.foreign?.swift || account?.swift].filter(Boolean).join(" ") : bank?.other ? account?.bankOtherName || bank.name : bank?.shortName || account?.bank || "";
  const type = account?.accountType === "SAVINGS" ? t("Savings account") : account?.accountType === "CURRENT" ? t("Current account") : account?.accountType ? t(account.accountType) : "";
  const last = String(account?.accountNumber || account?.accountLast4 || account?.cci || "").replace(/\*/g, "").slice(-4);
  return [name, type, account?.currency || account?.accountCurrency, last && `****${last}`].filter(Boolean).join(" · ");
}

// What the server will refuse, checked as the account is typed: { field: message }.
export function bankAccountProblems(account, { required = true } = {}) {
  const problems = {};
  const anything = ["bank", "accountNumber", "cci"].some((key) => String(account?.[key] || "").trim());
  if (!required && !anything) return problems;
  if (!account.bank) problems.bank = "Select the bank.";
  if (account.bank === "OTHER" && !String(account.bankOtherName || "").trim()) problems.bankOtherName = "Enter the name of the bank.";
  if (!["SAVINGS", "CURRENT"].includes(account.accountType)) problems.accountType = "Choose a savings account or a current account.";
  if (!["PEN", "USD"].includes(account.accountCurrency)) problems.accountCurrency = "Choose soles or dollars.";
  const number = digits(account.accountNumber);
  if (!number) problems.accountNumber = "Enter the account number.";
  else if (!/^\d+$/.test(number)) problems.accountNumber = "Account number must contain digits only.";
  const cci = digits(account.cci);
  if (!cci) problems.cci = "Enter the 20-digit CCI.";
  else {
    const cciProblem = cciBankProblem(account.bank, cci);
    if (cciProblem) problems.cci = cciProblem;
  }
  if (!String(account.accountHolderName || "").trim()) problems.accountHolderName = "Enter the account holder.";
  return problems;
}

// The payload the supplier API takes for one account.
export function bankAccountPayload(account) {
  return {
    bank: account.bank,
    bankOtherName: account.bank === "OTHER" ? String(account.bankOtherName || "").trim() : "",
    accountType: account.accountType,
    accountCurrency: account.accountCurrency,
    currency: account.accountCurrency,
    accountNumber: digits(account.accountNumber),
    cci: digits(account.cci),
    accountHolderName: String(account.accountHolderName || "").trim()
  };
}

// An account abroad (supplier "del exterior"): paid in dollars by SWIFT transfer. The server makes
// the same checks (shared/supplierRegistration.mjs).
export const emptyForeignBankAccount = (holder = "", country = "") => ({
  clientId: `${Date.now()}-${Math.random()}`,
  scope: "FOREIGN",
  bankOtherName: "",
  bankCountry: country,
  bankCity: "",
  bankAddress: "",
  swift: "",
  iban: "",
  accountNumber: "",
  aba: "",
  intermediaryBank: "",
  intermediarySwift: "",
  accountCurrency: "USD",
  accountHolderName: holder
});

const compact = (value) => String(value || "").replace(/\s+/g, "").toUpperCase();

export function foreignBankAccountProblems(account, { required = true } = {}) {
  const problems = {};
  const anything = ["bankOtherName", "swift", "iban", "accountNumber"].some((key) => String(account?.[key] || "").trim());
  if (!required && !anything) return problems;
  if (!String(account.bankOtherName || "").trim()) problems.bankOtherName = "Enter the name of the bank.";
  if (!String(account.bankCountry || "").trim()) problems.bankCountry = "Enter the bank's country.";
  const swift = swiftError(account.swift);
  if (swift) problems.swift = swift;
  const iban = ibanError(account.iban);
  if (iban) problems.iban = iban;
  if (!compact(account.iban) && !compact(account.accountNumber)) problems.accountNumber = "Enter the IBAN or the account number.";
  const aba = abaError(account.aba, account.bankCountry);
  if (aba) problems.aba = aba;
  if (String(account.intermediarySwift || "").trim()) {
    const intermediary = swiftError(account.intermediarySwift);
    if (intermediary) problems.intermediarySwift = intermediary;
  }
  if (!String(account.accountHolderName || "").trim()) problems.accountHolderName = "Enter the account holder.";
  return problems;
}

export function foreignBankAccountPayload(account) {
  const text = (value) => String(value || "").trim();
  return {
    scope: "FOREIGN",
    bankOtherName: text(account.bankOtherName),
    bankCountry: text(account.bankCountry),
    bankCity: text(account.bankCity),
    bankAddress: text(account.bankAddress),
    swift: compact(account.swift),
    iban: compact(account.iban),
    accountNumber: compact(account.accountNumber) || compact(account.iban),
    aba: compact(account.aba),
    intermediaryBank: text(account.intermediaryBank),
    intermediarySwift: compact(account.intermediarySwift),
    accountCurrency: "USD",
    currency: "USD",
    accountHolderName: text(account.accountHolderName)
  };
}
