import AccountingMapping from "../models/AccountingMapping.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";

function specificity(mapping, request, options) {
  return [
    mapping.requestType === request.requestType,
    mapping.expenseNature === request.expenseNature,
    mapping.bank === options.bank,
    mapping.currency === (options.currency || request.currency)
  ].filter(Boolean).length;
}

export async function resolveAccountingMapping(purpose, request, options = {}) {
  const bank = String(options.bank || "*").toUpperCase();
  const currency = options.currency || request.currency || "PEN";
  const mappings = await AccountingMapping.find({
    active: true,
    purpose,
    requestType: { $in: ["*", request.requestType] },
    expenseNature: { $in: ["*", request.expenseNature] },
    bank: { $in: ["*", bank] },
    currency: { $in: ["*", currency] }
  });
  return mappings.sort((left, right) => specificity(right, request, { bank, currency }) - specificity(left, request, { bank, currency }))[0] || null;
}

export async function requireAccountingMapping(purpose, request, options = {}) {
  const mapping = await resolveAccountingMapping(purpose, request, options);
  if (!mapping) {
    throw new AppError(
      422,
      `Accounting mapping ${purpose} is not configured for this transaction.`,
      { purpose, requestType: request.requestType, expenseNature: request.expenseNature, currency: options.currency || request.currency, bank: options.bank },
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  return mapping;
}

