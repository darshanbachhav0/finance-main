import { BankFileAdapter } from "./BankFileAdapter.js";

export class BbvaBankFileAdapter extends BankFileAdapter {
  constructor() { super("BBVA", ";"); }
}

