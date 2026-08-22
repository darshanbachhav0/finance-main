import { AppError } from "../../utils/AppError.js";
import { ERROR_CODES } from "../../utils/constants.js";
import { BbvaBankFileAdapter } from "./BbvaBankFileAdapter.js";
import { BcpBankFileAdapter } from "./BcpBankFileAdapter.js";
import { InterbankBankFileAdapter } from "./InterbankBankFileAdapter.js";
import { ScotiabankBankFileAdapter } from "./ScotiabankBankFileAdapter.js";

const adapters = {
  BCP: () => new BcpBankFileAdapter(),
  BBVA: () => new BbvaBankFileAdapter(),
  INTERBANK: () => new InterbankBankFileAdapter(),
  SCOTIABANK: () => new ScotiabankBankFileAdapter()
};

export function getBankFileAdapter(bank) {
  const normalized = String(bank || "").trim().toUpperCase();
  const factory = adapters[normalized];
  if (!factory) throw new AppError(422, "A supported bank must be selected.", { bank }, ERROR_CODES.VALIDATION_ERROR);
  if (String(process.env.BANK_FILE_MODE || "DEMO").toUpperCase() !== "DEMO") {
    throw new AppError(
      503,
      `${normalized} certified bank specification is not configured.`,
      { bank: normalized, configuredMode: process.env.BANK_FILE_MODE, availableMode: "DEMO" },
      ERROR_CODES.INTEGRATION_NOT_CONFIGURED
    );
  }
  return factory();
}

