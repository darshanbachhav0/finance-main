export class SunatProvider {
  constructor({ mode, configured = false } = {}) {
    this.mode = mode;
    this.configured = configured;
  }

  async validateTaxpayer() {
    throw new Error("validateTaxpayer() must be implemented by the configured provider.");
  }

  async validateVoucher() {
    throw new Error("validateVoucher() must be implemented by the configured provider.");
  }

  async getSellingExchangeRate() {
    throw new Error("getSellingExchangeRate() must be implemented by the configured provider.");
  }
}

