import { readAsset } from "./durableAssetService.js";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { XMLParser } from "fast-xml-parser";
import XmlValidationAttempt from "../models/XmlValidationAttempt.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { moneyEquals } from "../utils/money.js";
import { canonicalSeriesNumber, canonicalVoucherType } from "../utils/voucherIdentity.js";
import { isPdfBuffer, parseInvoicePdf } from "./invoicePdfService.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
    parseTagValue: false,
  trimValues: true,
  processEntities: false,
  allowBooleanAttributes: false
});

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function localValue(value) {
  if (value && typeof value === "object" && "#text" in value) return value["#text"];
  return value;
}

function findSection(node, name) {
  if (!node || typeof node !== "object") return null;
  for (const [key, value] of Object.entries(node)) {
    if (key === name) return value;
    for (const child of asArray(value)) {
      const found = findSection(child, name);
      if (found) return found;
    }
  }
  return null;
}

function findAllValues(node, name, values = []) {
  if (!node || typeof node !== "object") return values;
  for (const [key, value] of Object.entries(node)) {
    if (key === name) for (const item of asArray(value)) values.push(localValue(item));
    for (const child of asArray(value)) if (child && typeof child === "object") findAllValues(child, name, values);
  }
  return values;
}

function findFirstValue(node, names) {
  for (const name of names) {
    const value = findAllValues(node, name).find((item) => item !== undefined && item !== null && item !== "");
    if (value !== undefined) return value;
  }
  return undefined;
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeIdentifier(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeVoucher(value) {
  return String(value || "").trim().toUpperCase().replace(/\s/g, "");
}

function dateOnly(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || "").slice(0, 10) : date.toISOString().slice(0, 10);
}

// An uploaded file recorded on the request but gone from the server's disk (for example storage
// that was not persistent across a redeploy) is a clear, fixable condition for the user - not a
// server error. Re-uploading the same document restores it.
async function readStoredFile(filePath, encoding) {
  try {
    return await readAsset(filePath, encoding);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new AppError(
      422,
      "The invoice file (XML or factura PDF) saved for this request is no longer available on the server. Upload it again in Documents, then retry.",
      { file: path.basename(String(filePath || "")) },
      ERROR_CODES.STORED_FILE_MISSING
    );
  }
}

export async function fileChecksum(filePath) {
  const content = await readStoredFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

export async function parseInvoiceXml(filePath) {
  return parseInvoiceXmlText(await readStoredFile(filePath, "utf8"));
}

function parseInvoiceXmlText(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new AppError(422, "XML document type/entity declarations are not allowed.", undefined, ERROR_CODES.XML_VALIDATION_FAILED);
  }
  let parsed;
  try {
    parsed = parser.parse(xml);
  } catch {
    throw new AppError(422, "The uploaded XML could not be parsed safely.", undefined, ERROR_CODES.XML_VALIDATION_FAILED);
  }
  const rootName = parsed.Invoice ? "Invoice" : parsed.CreditNote ? "CreditNote" : parsed.DebitNote ? "DebitNote" : "";
  const root = parsed.Invoice || parsed.CreditNote || parsed.DebitNote || parsed;
  const supplierParty = findSection(root, "AccountingSupplierParty") || findSection(root, "SupplierParty") || {};
  // UBL debit notes carry their totals in RequestedMonetaryTotal instead of LegalMonetaryTotal.
  const legalTotal = findSection(root, "LegalMonetaryTotal") || findSection(root, "RequestedMonetaryTotal") || root;
  const taxTotal = findSection(root, "TaxTotal") || root;
  const taxSubtotal = findSection(root, "TaxSubtotal") || root;
  // SUNAT Tabla 10: Invoice carries InvoiceTypeCode (01 factura, 03 boleta); credit/debit notes are 07/08.
  const invoiceTypeCode = String(localValue(root.InvoiceTypeCode) ?? "").trim();
  const documentTypeCode = rootName === "CreditNote" ? "07" : rootName === "DebitNote" ? "08" : invoiceTypeCode || (rootName === "Invoice" ? "01" : "");
  const billingReference = findSection(root, "BillingReference");
  const referencedDocument = billingReference ? (findSection(billingReference, "InvoiceDocumentReference") || billingReference) : null;
  const reference = referencedDocument ? {
    seriesNumber: canonicalSeriesNumber(normalizeVoucher(findFirstValue(referencedDocument, ["ID"]))),
    documentTypeCode: String(findFirstValue(referencedDocument, ["DocumentTypeCode"]) || "").trim(),
    voucherType: canonicalVoucherType(findFirstValue(referencedDocument, ["DocumentTypeCode"]) || "01")
  } : undefined;
  // The document's own ID is a direct child of the root; searching the whole tree first could pick
  // up the ID of a BillingReference or signature block.
  const ownId = localValue(root.ID);
  return {
    ruc: normalizeIdentifier(findFirstValue(supplierParty, ["CompanyID", "ID"])),
    supplierName: String(findFirstValue(supplierParty, ["RegistrationName", "Name"]) || "").trim(),
    invoiceNumber: normalizeVoucher(ownId),
    documentTypeCode,
    voucherType: canonicalVoucherType(documentTypeCode || "01"),
    reference: reference?.seriesNumber ? reference : undefined,
    issueDate: dateOnly(findFirstValue(root, ["IssueDate"])),
    currency: String(findFirstValue(root, ["DocumentCurrencyCode"]) || "").trim().toUpperCase(),
    netAmount: toNumber(findFirstValue(legalTotal, ["LineExtensionAmount", "TaxExclusiveAmount"])) ?? toNumber(findFirstValue(taxSubtotal, ["TaxableAmount"])),
    igvAmount: toNumber(findFirstValue(taxTotal, ["TaxAmount"])),
    totalAmount: toNumber(findFirstValue(legalTotal, ["PayableAmount", "TaxInclusiveAmount"]))
  };
}

const round2 = (value) => Math.round(Number(value) * 100) / 100;

// The item lines of a UBL invoice (InvoiceLine / CreditNoteLine / DebitNoteLine), so a request can
// be filled line by line from the factura: description, quantity, unit and the line's net, IGV and
// total. A line without a readable net amount is skipped; nothing is invented.
export function invoiceXmlLines(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return [];
  let parsed;
  try { parsed = parser.parse(xml); } catch { return []; }
  const root = parsed.Invoice || parsed.CreditNote || parsed.DebitNote;
  if (!root) return [];
  const rows = asArray(root.InvoiceLine || root.CreditNoteLine || root.DebitNoteLine);
  return rows.map((row) => {
    const quantityNode = row.InvoicedQuantity ?? row.CreditedQuantity ?? row.DebitedQuantity;
    const quantity = toNumber(localValue(quantityNode)) ?? 1;
    const netAmount = toNumber(localValue(row.LineExtensionAmount));
    const igvAmount = toNumber(findFirstValue(row.TaxTotal || {}, ["TaxAmount"])) ?? 0;
    const description = String(findFirstValue(row.Item || {}, ["Description", "Name"]) || "").trim();
    if (netAmount === undefined || !(quantity > 0)) return null;
    return {
      description,
      quantity,
      unitCode: typeof quantityNode === "object" ? String(quantityNode.unitCode || "").trim() : "",
      netAmount: round2(netAmount),
      igvAmount: round2(igvAmount),
      totalAmount: round2(netAmount + igvAmount)
    };
  }).filter(Boolean);
}

export async function readInvoiceXmlLines(filePath) {
  const content = await readStoredFile(filePath);
  return isPdfBuffer(content) ? [] : invoiceXmlLines(content.toString("utf8"));
}

// An invoice is evidenced by its XML or by its factura PDF (the printed representation): an XML is
// read as UBL, a PDF through its text (invoicePdfService). The file's own bytes decide, not its
// name, so a mislabelled upload is still read correctly.
export const INVOICE_EVIDENCE_KINDS = Object.freeze(["XML", "PDF", "FEE_RECEIPT"]);

export function latestInvoiceEvidence(attachments = []) {
  const latest = (kind) => [...attachments].reverse().find((attachment) => attachment.kind === kind);
  return latest("XML") || latest("PDF") || latest("FEE_RECEIPT") || null;
}

export async function parseInvoiceEvidence(filePath, { expectedRuc, buyerRuc = String(process.env.SIRE_TAXPAYER_RUC || "").replace(/\D/g, "") || undefined } = {}) {
  const content = await readStoredFile(filePath);
  if (isPdfBuffer(content)) return { source: "PDF", data: await parseInvoicePdf(content, { expectedRuc, buyerRuc }) };
  return { source: "XML", data: parseInvoiceXmlText(content.toString("utf8")) };
}

// XML and PDF may accompany the same invoice, but an older XML must never silently
// replace the identity of a newly uploaded PDF. Scans can still accompany a valid XML.
export async function assertInvoiceEvidencePair(xmlPath, pdfPath, options = {}) {
  if (!xmlPath || !pdfPath) return;
  const xml = (await parseInvoiceEvidence(xmlPath, options)).data;
  let pdf;
  try { pdf = (await parseInvoiceEvidence(pdfPath, options)).data; }
  catch (error) { if (error.code === ERROR_CODES.INVOICE_PDF_UNREADABLE) return; throw error; }
  const mismatches = [
    ["supplier", xml.ruc, pdf.ruc],
    ["documentNumber", canonicalSeriesNumber(xml.invoiceNumber), canonicalSeriesNumber(pdf.invoiceNumber)],
    ["documentType", xml.documentTypeCode, pdf.documentTypeCode]
  ].filter(([, expected, found]) => expected && found && expected !== found)
    .map(([field, expected, found]) => ({ field, expected, found }));
  if (mismatches.length) throw new AppError(422, "The XML and PDF belong to different invoices. Remove the old file or upload matching invoice files.", { mismatches }, ERROR_CODES.XML_VALIDATION_FAILED);
}

// A voucher registered from a factura PDF must show its own identity and total: SUNAT is consulted
// with them and they become the payable. Anything the PDF does not show is named, never guessed.
export function assertReadableVoucher(data, source) {
  if (source !== "PDF") return data;
  const missing = [
    !data.ruc && "supplier RUC",
    !data.invoiceNumber && "series and number",
    !data.issueDate && "issue date",
    !data.currency && "currency",
    data.totalAmount === undefined && "total amount"
  ].filter(Boolean);
  if (missing.length) {
    throw new AppError(422, `The factura PDF does not show its ${missing.join(", ")}. Upload the invoice XML, or the original PDF sent by the supplier.`, { missing }, ERROR_CODES.INVOICE_PDF_UNREADABLE);
  }
  return data;
}

export async function buildInvoiceValidationResult(filePath, requestData) {
  const errors = [];
  const expectedIdentifier = normalizeIdentifier(requestData.supplier?.normalizedIdentifier || requestData.supplier?.rucDni);
  const { source, data } = await parseInvoiceEvidence(filePath, { expectedRuc: expectedIdentifier });
  const file = source === "PDF" ? "factura PDF" : "XML";
  const expectedDocument = normalizeVoucher(requestData.documentNumber || requestData.fiscalData?.documentNumber || requestData.fiscalData?.number);
  // The request's own date is never compared: an invoice is often dated some days before or after
  // the request, and it is booked with its own date. Only a voucher's document date, which is the
  // invoice's own date carried on the voucher (SUNAT is consulted with it), must match the file.
  const expectedDate = requestData.documentDate;
  const comparisons = {
    currencyMatch: Boolean(data.currency && data.currency === requestData.currency),
    supplierMatch: Boolean(expectedIdentifier && data.ruc && expectedIdentifier === data.ruc),
    // F001-00001234 and F001-1234 are the same SUNAT correlative.
    documentNumberMatch: expectedDocument ? Boolean(data.invoiceNumber && canonicalSeriesNumber(expectedDocument) === canonicalSeriesNumber(data.invoiceNumber)) : null,
    dateMatch: expectedDate ? Boolean(data.issueDate && dateOnly(expectedDate) === data.issueDate) : null,
    netMatch: data.netAmount !== undefined && moneyEquals(data.netAmount, requestData.totalNet ?? requestData.netAmount),
    igvMatch: data.igvAmount !== undefined && moneyEquals(data.igvAmount, requestData.totalIGV ?? requestData.igvAmount),
    totalMatch: data.totalAmount !== undefined && moneyEquals(data.totalAmount, requestData.totalAmount)
  };

  // Each problem is also returned as { field, expected, found } (found null: the file does not show
  // it), so the screen can list every difference in the user's language. One entry per field.
  const mismatches = [];
  const report = (field, message, expected, found) => {
    errors.push(message);
    if (!mismatches.some((item) => item.field === field)) mismatches.push({ field, expected: expected ?? null, found: found ?? null });
  };
  const expectedNet = requestData.totalNet ?? requestData.netAmount;
  const expectedIgv = requestData.totalIGV ?? requestData.igvAmount;
  if (!comparisons.currencyMatch) report("currency", `Currency does not match the ${file}. Form ${requestData.currency}, ${file} ${data.currency || "missing"}.`, requestData.currency, data.currency);
  if (!data.ruc) report("supplier", `The ${file} does not include the supplier RUC/DNI.`, expectedIdentifier, null);
  else if (!comparisons.supplierMatch) report("supplier", `Supplier RUC/DNI does not match the ${file}. Expected ${expectedIdentifier}, ${file} ${data.ruc}.`, expectedIdentifier, data.ruc);
  // A PDF must show the voucher's identity itself: SUNAT is consulted with it later.
  if (expectedDocument && !comparisons.documentNumberMatch) report("documentNumber", `Voucher number does not match the ${file}. Expected ${expectedDocument}, ${file} ${data.invoiceNumber || "missing"}.`, expectedDocument, data.invoiceNumber);
  if (source === "PDF" && !data.invoiceNumber) report("documentNumber", "The factura PDF does not show the voucher series and number.", expectedDocument, null);
  if (expectedDate && !comparisons.dateMatch) report("issueDate", `Issue date does not match the ${file}. Expected ${dateOnly(expectedDate)}, ${file} ${data.issueDate || "missing"}.`, dateOnly(expectedDate), data.issueDate);
  if (source === "PDF" && !data.issueDate) report("issueDate", "The factura PDF does not show the issue date.", expectedDate ? dateOnly(expectedDate) : null, null);
  if (data.netAmount === undefined) report("netAmount", `The ${file} does not include the Net amount.`, expectedNet, null);
  else if (!comparisons.netMatch) report("netAmount", `Net amount does not match the ${file}. Form ${expectedNet}, ${file} ${data.netAmount}.`, expectedNet, data.netAmount);
  if (data.igvAmount === undefined) report("igvAmount", `The ${file} does not include the IGV amount.`, expectedIgv, null);
  else if (!comparisons.igvMatch) report("igvAmount", `IGV amount does not match the ${file}. Form ${expectedIgv}, ${file} ${data.igvAmount}.`, expectedIgv, data.igvAmount);
  if (data.totalAmount === undefined) report("totalAmount", `The ${file} does not include the Total amount.`, requestData.totalAmount, null);
  else if (!comparisons.totalMatch) report("totalAmount", `Total amount does not match the ${file}. Form ${requestData.totalAmount}, ${file} ${data.totalAmount}.`, requestData.totalAmount, data.totalAmount);

  const checksum = await fileChecksum(filePath);
  return {
    status: errors.length ? "INVALID" : "VALID",
    validated: errors.length === 0,
    validatedAt: new Date(),
    provider: source === "PDF" ? "LOCAL_PDF" : "LOCAL_XML",
    source,
    ...comparisons,
    errors,
    errorMessages: errors,
    mismatches,
    rawMetadataReference: checksum,
    data
  };
}

// Compare per-invoice inputs, never the aggregate Purchase Order/request total.
export async function assertVoucherEvidenceMatches(filePath, voucher) {
  if (!filePath) throw new AppError(422, "The invoice XML or factura PDF is required before accounting.", undefined, ERROR_CODES.XML_VALIDATION_FAILED);
  const result = await buildInvoiceValidationResult(filePath, {
    supplier: { normalizedIdentifier: voucher.ruc || voucher.rucIssuer },
    documentNumber: voucher.invoiceNumber || `${voucher.series}-${voucher.number}`,
    documentDate: voucher.issueDate || voucher.documentDate,
    currency: voucher.currency,
    netAmount: voucher.netAmount,
    igvAmount: voucher.igvAmount,
    totalAmount: voucher.totalAmount
  });
  if (!result.validated) throw new AppError(422, `Invoice values disagree with the ${result.source === "PDF" ? "factura PDF" : "XML"}. Resolve the differences before accounting.`, { validation: result }, ERROR_CODES.XML_AMOUNT_MISMATCH);
  return result;
}

export async function validateInvoiceAgainstRequest(filePath, requestData, attempt = {}) {
  const result = await buildInvoiceValidationResult(filePath, requestData);
  await XmlValidationAttempt.create({
    request: attempt.request?._id || attempt.request,
    requestNumber: attempt.requestNumber,
    supplier: attempt.supplier?._id || attempt.supplier || requestData.supplier?._id,
    attemptedBy: attempt.user?._id || attempt.user,
    fileName: attempt.fileName,
    checksum: result.rawMetadataReference,
    status: result.status,
    result
  });
  if (!result.validated) {
    throw new AppError(
      422,
      `The ${result.source === "PDF" ? "factura PDF" : "invoice XML"} does not match the request.`,
      { validation: result },
      ERROR_CODES.XML_AMOUNT_MISMATCH
    );
  }
  return result;
}
