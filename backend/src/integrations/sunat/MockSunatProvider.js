import { SunatProvider } from "./SunatProvider.js";

export class MockSunatProvider extends SunatProvider {
  constructor() {
    super({ mode: "MOCK", configured: true });
  }

  async validateTaxpayer(identifier) {
    return { valid: /^(\d{8}|\d{11})$/.test(String(identifier || "")), source: "MOCK", message: "Development-only simulated validation." };
  }

  async validateVoucher(voucher) {
    return { valid: Boolean(voucher?.series && voucher?.number), source: "MOCK", message: "Development-only simulated validation." };
  }

  async getSellingExchangeRate({ date }) {
    return { rate: 3.5, date, source: "MOCK", authoritative: false, message: "Development-only simulated exchange rate." };
  }
}

