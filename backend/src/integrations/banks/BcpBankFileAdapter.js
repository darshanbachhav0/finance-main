import { BankFileAdapter } from "./BankFileAdapter.js";

export class BcpBankFileAdapter extends BankFileAdapter {
  constructor() { super("BCP", "|"); }
}

