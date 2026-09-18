import { AppError } from "../../utils/AppError.js";

const fail = message => { throw new AppError(422, `BBVA: ${message}`); };
function field(value, width, label, { exact = false, truncate = false } = {}) {
  if (typeof value !== "string" || /[^\x20-\x7e\xa0-\xff]/.test(value)) fail(`${label} must use printable Latin-1 characters.`);
  if (exact && value.length !== width) fail(`${label} must contain exactly ${width} bytes.`);
  if (value.length > width && !truncate) fail(`${label} exceeds ${width} bytes.`);
  return value.slice(0, width).padEnd(width, " ");
}
function digits(value, width, label) {
  if (typeof value !== "string" || !new RegExp(`^\\d{${width}}$`).test(value) || /^0+$/.test(value)) fail(`${label} must contain ${width} digits and cannot be all zeros.`);
  return value;
}
export function amountCents(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100)) || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) fail("amount must be positive with at most two decimal places.");
  return BigInt(Math.round(amount * 100));
}
function numeric(value, width) {
  const text = String(value);
  if (!/^\d+$/.test(text) || text.length > width) fail(`numeric value exceeds ${width} bytes.`);
  return text.padStart(width, "0");
}
export function inspectBbvaFile(buffer) {
  const lines = buffer.toString("latin1").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length < 2 || lines[0].length !== 151 || lines.slice(1).some(line => line.length !== 277)) fail("invalid header/detail byte lengths.");
  const header = lines[0], currency = header.slice(23,26);
  if (!["PEN","USD"].includes(currency)) fail("unsupported currency.");
  if (!/^\d{6}$/.test(header.slice(76,82)) || !/^\d{15}$/.test(header.slice(26,41))) fail("invalid header count/amount.");
  let total = 0n;
  for (const line of lines.slice(1)) {
    if (!/^\d{15}$/.test(line.slice(77,92))) fail("invalid detail amount.");
    total += BigInt(line.slice(77,92));
  }
  if (Number(header.slice(76,82)) !== lines.length - 1 || BigInt(header.slice(26,41)) !== total) fail("header count/total do not reconcile.");
  return { currency, paymentCount: lines.length - 1, totalCents: String(total), headerBytes: 151, detailBytes: 277 };
}
export class BbvaBankFileAdapter {
  constructor(configuration) {
    if (!configuration?.active || configuration.mode !== "FIXED_WIDTH" || configuration?.bbva?.confirmed !== true || !configuration.specificationVersion || configuration.specificationVersion.includes("DEMO")) fail("Treasury-confirmed BBVA configuration and format version are required.");
    this.config = configuration.bbva;
    this.currency = configuration.currency;
    this.mode = "FIXED_WIDTH";
    this.specificationVersion = configuration.specificationVersion;
    const c = this.config;
    if (c.encoding !== "latin1" || !["LF","CRLF"].includes(c.lineEnding) || typeof c.finalNewline !== "boolean" || typeof c.truncateText !== "boolean") fail("confirm encoding, line endings, final newline and text-overflow policy.");
    digits(c.debitAccount,20,"debit-account field");
    if (![18,20].includes(c.internalAccountLength) || typeof c.internalAccountPrefix !== "string" || c.internalAccountPrefix.length !== 20 - c.internalAccountLength || !/^\d*$/.test(c.internalAccountPrefix)) fail("confirm BBVA account length and prefix; together they must occupy 20 digits.");
    for (const [key,width] of [["headerPrefix",3],["headerControl",10],["headerLabel",25],["headerTrailer",69],["detailPrefix",3],["descriptionControl",1],["contactControl",1],["detailTrailer",50]]) field(c[key],width,key,{exact:true});
    for (const key of ["rucCode","dniCode","internalCode","interbankCode"]) field(c[key],1,key,{exact:true});
    if (!c.defaultContact?.trim() || !c.orderingContact?.trim()) fail("contact fields must be confirmed and populated.");
    field(c.defaultContact,50,"default contact"); field(c.orderingContact,30,"ordering contact");
  }
  validatePayment(item) {
    const c = this.config, account = item.bankAccount;
    if (item.currency !== this.currency || account?.currency !== item.currency) fail("mixed or mismatched currency.");
    if (!/^\d{8}$|^\d{11}$/.test(item.supplierIdentifier || "") || /^0+$/.test(item.supplierIdentifier)) fail("beneficiary requires an 8-digit DNI or 11-digit RUC.");
    if (!item.supplierName?.trim()) fail("beneficiary name is missing.");
    if (!account?.bank) fail("beneficiary bank is missing.");
    if (account.bank === "BBVA") {
      digits(account.accountNumber,c.internalAccountLength,"BBVA beneficiary account");
    } else digits(account.cci,20,"interbank CCI");
    amountCents(item.amount);
  }
  validateBatch(items) {
    if (!items.length || items.length > 999999) fail("invalid payment count.");
    items.forEach(item => this.validatePayment(item));
  }
  getFileName(batchNumber) { return `bbva-${this.currency.toLowerCase()}-${batchNumber.toLowerCase()}.txt`; }
  generateFile({ currency, items }) {
    if (currency !== this.currency) fail("configuration currency differs from batch currency.");
    this.validateBatch(items);
    const c = this.config, truncate = c.truncateText;
    const total = items.reduce((sum,item) => sum + amountCents(item.amount),0n);
    const header = c.headerPrefix + c.debitAccount + currency + numeric(total,15) + c.headerControl + c.headerLabel + numeric(items.length,6) + c.headerTrailer;
    const details = items.map(item => {
      const account = item.bankAccount, voucher = item.accountsPayable?.voucher || {};
      const documentCode = c.documentCodes?.[voucher.voucherType || voucher.documentType] || c.defaultDocumentCode;
      const reference = item.paymentReference ?? [voucher.series,voucher.number].filter(Boolean).join("-");
      const description = item.paymentDescription ?? item.request?.description;
      if (!reference?.trim() || !description?.trim()) fail("payment reference and description are required.");
      return c.detailPrefix + (item.supplierIdentifier.length === 11 ? c.rucCode : c.dniCode) + field(item.supplierIdentifier,12,"identifier")
        + (account.bank === "BBVA" ? c.internalCode : c.interbankCode)
        + (account.bank === "BBVA" ? c.internalAccountPrefix + account.accountNumber : account.cci)
        + field(item.supplierName,40,"beneficiary name",{truncate}) + numeric(amountCents(item.amount),15)
        + field(documentCode,1,"document code",{exact:true}) + field(reference,12,"payment reference")
        + c.descriptionControl + field(description,40,"description",{truncate}) + c.contactControl
        + field(item.paymentContact ?? c.defaultContact,50,"contact") + field(c.orderingContact,30,"ordering contact") + c.detailTrailer;
    });
    const newline = c.lineEnding === "LF" ? "\n" : "\r\n";
    const buffer = Buffer.from([header,...details].join(newline) + (c.finalNewline ? newline : ""),"latin1");
    inspectBbvaFile(buffer);
    return buffer;
  }
}
