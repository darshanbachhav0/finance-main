import { AppError } from "../../utils/AppError.js";
import { ERROR_CODES } from "../../utils/constants.js";
import { SunatProvider } from "./SunatProvider.js";

export class NotConfiguredSunatProvider extends SunatProvider {
  constructor() {
    super({ mode: "PRODUCTION", configured: false });
  }

  unavailable() {
    throw new AppError(503, "SUNAT integration is not configured.", { provider: "PRODUCTION" }, ERROR_CODES.INTEGRATION_NOT_CONFIGURED);
  }

  async validateTaxpayer() { return this.unavailable(); }
  async validateVoucher() { return this.unavailable(); }
  async getSellingExchangeRate() { return this.unavailable(); }
}

