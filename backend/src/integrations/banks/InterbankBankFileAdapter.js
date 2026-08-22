import { BankFileAdapter } from "./BankFileAdapter.js";

export class InterbankBankFileAdapter extends BankFileAdapter {
  constructor() { super("INTERBANK", ","); }
}

