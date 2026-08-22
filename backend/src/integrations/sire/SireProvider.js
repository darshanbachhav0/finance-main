import { AppError } from "../../utils/AppError.js";
import { ERROR_CODES } from "../../utils/constants.js";

export class SireProvider {
  get mode() { return "NOT_CONFIGURED"; }
  async submit() {
    throw new AppError(
      501,
      "Direct SIRE submission is not configured. The system currently prepares review/export files only.",
      { mode: this.mode },
      ERROR_CODES.INTEGRATION_NOT_CONFIGURED
    );
  }
}

