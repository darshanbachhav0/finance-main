import { BankFileAdapter } from "./BankFileAdapter.js";

export class ScotiabankBankFileAdapter extends BankFileAdapter {
  constructor() { super("SCOTIABANK", "\t"); }
}

