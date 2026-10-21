import BankFormatConfiguration from "../models/BankFormatConfiguration.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";

// The BBVA payment file writes a BBVA beneficiary by its account number (other banks by CCI), with
// exactly the length the BBVA format configuration sets (internalAccountLength, 20 by default).
// Checking it when an account is saved catches a number the file cannot use there, instead of
// when Treasury generates the file.
const DEFAULT_BBVA_ACCOUNT_LENGTH = 20;

export async function bbvaAccountNumberLength(currency = "PEN") {
  const configuration = await BankFormatConfiguration.findOne({ bank: "BBVA", currency, active: true }).select("bbva.internalAccountLength").lean();
  const length = Number(configuration?.bbva?.internalAccountLength);
  return Number.isInteger(length) && length > 0 ? length : DEFAULT_BBVA_ACCOUNT_LENGTH;
}

export async function assertBankFileAccountNumber({ bank, currency = "PEN", accountNumber, accountType = "CURRENT" }) {
  // Current and savings accounts at BBVA are both written by their 20-digit number.
  if (String(bank || "").toUpperCase() !== "BBVA" || !["CURRENT", "SAVINGS"].includes(accountType)) return;
  const required = await bbvaAccountNumberLength(currency);
  const digits = String(accountNumber || "");
  if (digits.length !== required || /^0+$/.test(digits)) {
    throw new AppError(422, `A BBVA account number must contain exactly ${required} digits.`, { field: "accountNumber", length: digits.length, required }, ERROR_CODES.VALIDATION_ERROR);
  }
}
