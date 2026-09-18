import { AppError } from "../../utils/AppError.js";
import { BbvaBankFileAdapter } from "./BbvaBankFileAdapter.js";

export function assertBbvaSource(bank) {
  if (String(bank || "").trim().toUpperCase() !== "BBVA") throw new AppError(422, "UMA creates new payment batches only from BBVA.");
}

export function getBankFileAdapter(bank, configuration) {
  assertBbvaSource(bank);
  return new BbvaBankFileAdapter(configuration);
}
