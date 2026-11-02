import ExcelJS from "exceljs";
import { AppError } from "../../utils/AppError.js";
import { ERROR_CODES } from "../../utils/constants.js";

// Transfers abroad (pilot "Transferencias al exterior"): suppliers paid in dollars by SWIFT from
// UMA's BBVA account. The bank's fixed-width TXT has no place for SWIFT, IBAN or ABA, so these
// payments go in their own Excel file, "<lote>_transferencias_exterior.xlsx": a "Resumen" sheet
// with one row per payment and one sheet per payment with the bank's transfer form fields. Charges
// are shared (SHA) by default. The file then follows the same path as a TXT: GAF verifies it,
// Treasury downloads it, sends the transfers and confirms each payment with its operation number.
export const FOREIGN_TRANSFER_FORMAT = "FOREIGN_TRANSFER";
const REFERENCE_LENGTH = 140;
const SUMMARY_COLUMNS = ["N.°", "Requerimiento", "Beneficiario", "País", "Banco", "SWIFT / ABA", "Cuenta / IBAN", "Moneda", "Importe", "Gastos", "Referencia"];

const fail = (message, details) => { throw new AppError(422, message, details, ERROR_CODES.VALIDATION_ERROR); };
const text = (value) => String(value ?? "").trim();

export function foreignTransferReference(item) {
  const voucher = [item.accountsPayable?.voucher?.series, item.accountsPayable?.voucher?.number].filter(Boolean).join("-");
  return [item.requestNumber, voucher && `Factura ${voucher}`].filter(Boolean).join(" ").slice(0, REFERENCE_LENGTH);
}

export class ForeignTransferFileAdapter {
  constructor({ charges = "SHA" } = {}) {
    this.mode = "SWIFT_EXCEL";
    this.specificationVersion = "UMA-PILOTO-EXTERIOR-1";
    this.charges = ["SHA", "OUR", "BEN"].includes(charges) ? charges : "SHA";
  }

  validatePayment(item) {
    const account = item.bankAccount || {};
    const label = item.requestNumber || "Payment";
    if (account.scope !== "FOREIGN") fail(`${label}: the supplier's account is in Peru; it goes in the BBVA TXT, not in the transfers abroad.`);
    if (item.currency !== "USD") fail(`${label}: transfers abroad are paid in dollars (USD).`);
    if (!text(account.foreign?.swift)) fail(`${label}: the account abroad has no SWIFT/BIC code.`);
    if (!text(account.accountNumber) && !text(account.foreign?.iban)) fail(`${label}: the account abroad has no IBAN or account number.`);
    if (!(Number(item.amount) > 0)) fail(`${label}: the amount must be greater than zero.`);
  }

  validateBatch(items) {
    if (!items.length) fail("Select at least one payment abroad.");
    items.forEach((item) => this.validatePayment(item));
  }

  getFileName(batchNumber) { return `${String(batchNumber).toLowerCase()}_transferencias_exterior.xlsx`; }

  async generateFile({ batchNumber = "", paymentDate, items }) {
    this.validateBatch(items);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "UMA · Gestión Financiera";
    const summary = workbook.addWorksheet("Resumen");
    summary.addRow([`Transferencias al exterior · ${batchNumber}${paymentDate ? ` · ${new Date(paymentDate).toISOString().slice(0, 10)}` : ""}`]).font = { bold: true };
    summary.addRow([]);
    summary.addRow(SUMMARY_COLUMNS).font = { bold: true };
    items.forEach((item, index) => {
      const account = item.bankAccount;
      const foreign = account.foreign || {};
      summary.addRow([
        index + 1,
        item.requestNumber,
        item.supplierName,
        foreign.bankCountry || item.request?.supplier?.country || "",
        account.bankOtherName || "",
        [foreign.swift, foreign.aba].filter(Boolean).join(" / "),
        foreign.iban || account.accountNumber,
        item.currency,
        Number(item.amount),
        this.charges,
        foreignTransferReference(item)
      ]);
    });
    summary.getColumn(9).numFmt = "#,##0.00";
    summary.columns.forEach((column, index) => { column.width = [6, 16, 34, 14, 26, 22, 30, 8, 14, 8, 40][index]; });

    items.forEach((item, index) => {
      const account = item.bankAccount;
      const foreign = account.foreign || {};
      const supplier = item.request?.supplier || {};
      const sheet = workbook.addWorksheet(`Pago ${index + 1}`);
      const rows = [
        ["Cuenta del Beneficiario", foreign.iban || account.accountNumber],
        ["Nombre", account.accountHolderName || item.supplierName],
        ["Dirección", supplier.fiscalAddress || supplier.taxAddress || ""],
        ["Moneda / Importe", `${item.currency} ${Number(item.amount).toFixed(2)}`],
        ["Nro. de requerimiento", item.requestNumber],
        ["Gastos", this.charges],
        ["Referencia", foreignTransferReference(item)],
        ["Código Swift / ABA", [foreign.swift, foreign.aba].filter(Boolean).join(" / ")],
        ["Banco", account.bankOtherName || ""],
        ["Dirección del banco", foreign.bankAddress || ""],
        ["Ciudad / País", [foreign.bankCity, foreign.bankCountry].filter(Boolean).join(" / ")],
        ["Banco intermediario", [foreign.intermediaryBank, foreign.intermediarySwift].filter(Boolean).join(" · ")]
      ];
      sheet.addRow([`Transferencia al exterior ${index + 1} · ${item.requestNumber}`]).font = { bold: true };
      sheet.addRow([]);
      for (const row of rows) sheet.addRow(row).getCell(1).font = { bold: true };
      sheet.getColumn(1).width = 26;
      sheet.getColumn(2).width = 60;
    });
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
