import { AppError } from "../../utils/AppError.js";
import { ERROR_CODES } from "../../utils/constants.js";
import { SunatProvider } from "./SunatProvider.js";

export class ManualSunatProvider extends SunatProvider {
  constructor() {
    super({ mode: "MANUAL", configured: true });
  }

  async validateTaxpayer(identifier, context = {}) {
    if (!context.authorizedDecision) {
      throw new AppError(422, "Authorized manual taxpayer validation is required.", { identifier, provider: "MANUAL" }, ERROR_CODES.INTEGRATION_NOT_CONFIGURED);
    }
    return {
      valid: Boolean(context.valid),
      source: "MANUAL",
      returnedIdentifier: context.returnedIdentifier,
      returnedLegalName: context.returnedLegalName,
      comments: context.comments,
      validatedBy: context.user?._id
    };
  }

  async validateVoucher(voucher, context = {}) {
    if (!context.authorizedDecision) {
      throw new AppError(422, "Authorized manual voucher validation is required.", { voucher, provider: "MANUAL" }, ERROR_CODES.INTEGRATION_NOT_CONFIGURED);
    }
    return { valid: Boolean(context.valid), source: "MANUAL", comments: context.comments, validatedBy: context.user?._id };
  }

  async getSellingExchangeRate({ date }) {
    throw new AppError(
      422,
      "A stored authorized manual SUNAT selling rate is required for this date.",
      { date, provider: "MANUAL" },
      ERROR_CODES.EXCHANGE_RATE_MISSING
    );
  }
}
