import { AppError } from "../../utils/AppError.js";
import { ERROR_CODES } from "../../utils/constants.js";

function cleanField(value) {
  return String(value ?? "").replace(/[\r\n|;,\t]/g, " ").trim();
}

export class BankFileAdapter {
  constructor(bank, delimiter = "|") {
    this.bank = bank;
    this.delimiter = delimiter;
    this.mode = "DEMO";
    this.specificationVersion = "UMA-DEMO-1";
  }

  validatePayment(item) {
    const errors = [];
    if (!item.supplierIdentifier) errors.push("supplier identifier is missing");
    if (!item.supplierName) errors.push("supplier name is missing");
    if (!item.bankAccount?.accountNumber && !item.bankAccount?.cci) errors.push("active account/CCI is missing");
    if (item.bankAccount?.bank !== this.bank) errors.push(`bank account does not belong to ${this.bank}`);
    if (item.bankAccount?.currency !== item.currency) errors.push("bank-account currency does not match payment currency");
    if (Number(item.amount) <= 0) errors.push("amount must be greater than zero");
    if (errors.length) {
      throw new AppError(422, `Payment ${item.requestNumber} is invalid for ${this.bank}.`, { errors }, ERROR_CODES.BANK_DETAILS_MISSING);
    }
    return true;
  }

  validateBatch(items) {
    if (!items.length) throw new AppError(422, "The payment batch is empty.", undefined, ERROR_CODES.VALIDATION_ERROR);
    items.forEach((item) => this.validatePayment(item));
    return true;
  }

  getFileName(batchNumber) {
    return `${this.bank.toLowerCase()}-${batchNumber.toLowerCase()}-demo.txt`;
  }

  generateFile({ batchNumber, paymentDate, currency, items }) {
    this.validateBatch(items);
    const line = (values) => values.map(cleanField).join(this.delimiter);
    const header = line([
      "UMA_DEMO_NOT_CERTIFIED",
      this.bank,
      this.specificationVersion,
      batchNumber,
      new Date(paymentDate).toISOString().slice(0, 10),
      currency
    ]);
    const columns = line(["SUPPLIER_ID", "SUPPLIER_NAME", "ACCOUNT_OR_CCI", "AMOUNT", "CURRENCY", "REQUEST"]);
    const rows = items.map((item) => line([
      item.supplierIdentifier,
      item.supplierName,
      item.bankAccount.cci || item.bankAccount.accountNumber,
      Number(item.amount).toFixed(2),
      item.currency,
      item.requestNumber
    ]));
    return [header, columns, ...rows].join("\r\n");
  }
}

