import crypto from "crypto";
import fs from "fs/promises";
import { XMLParser } from "fast-xml-parser";
import XmlValidationAttempt from "../models/XmlValidationAttempt.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { moneyEquals } from "../utils/money.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  parseTagValue: true,
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

export async function fileChecksum(filePath) {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

export async function parseInvoiceXml(filePath) {
  const xml = await fs.readFile(filePath, "utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new AppError(422, "XML document type/entity declarations are not allowed.", undefined, ERROR_CODES.XML_VALIDATION_FAILED);
  }
  let parsed;
  try {
    parsed = parser.parse(xml);
  } catch {
    throw new AppError(422, "The uploaded XML could not be parsed safely.", undefined, ERROR_CODES.XML_VALIDATION_FAILED);
  }
  const root = parsed.Invoice || parsed.CreditNote || parsed.DebitNote || parsed;
  const supplierParty = findSection(root, "AccountingSupplierParty") || findSection(root, "SupplierParty") || root;
  const legalTotal = findSection(root, "LegalMonetaryTotal") || root;
  const taxTotal = findSection(root, "TaxTotal") || root;
  const taxSubtotal = findSection(root, "TaxSubtotal") || root;
  return {
    ruc: normalizeIdentifier(findFirstValue(supplierParty, ["CompanyID", "ID"])),
    supplierName: String(findFirstValue(supplierParty, ["RegistrationName", "Name"]) || "").trim(),
    invoiceNumber: normalizeVoucher(findFirstValue(root, ["ID"])),
    issueDate: dateOnly(findFirstValue(root, ["IssueDate"])),
    currency: String(findFirstValue(root, ["DocumentCurrencyCode"]) || "").trim().toUpperCase(),
    netAmount: toNumber(findFirstValue(legalTotal, ["LineExtensionAmount", "TaxExclusiveAmount"])) ?? toNumber(findFirstValue(taxSubtotal, ["TaxableAmount"])),
    igvAmount: toNumber(findFirstValue(taxTotal, ["TaxAmount"])),
    totalAmount: toNumber(findFirstValue(legalTotal, ["PayableAmount", "TaxInclusiveAmount"]))
  };
}

export async function buildXmlValidationResult(filePath, requestData) {
  const data = await parseInvoiceXml(filePath);
  const errors = [];
  const expectedIdentifier = normalizeIdentifier(requestData.supplier?.normalizedIdentifier || requestData.supplier?.rucDni);
  const expectedDocument = normalizeVoucher(requestData.documentNumber || requestData.fiscalData?.documentNumber || requestData.fiscalData?.number);
  const expectedDate = requestData.documentDate || requestData.issueDate;
  const comparisons = {
    supplierMatch: Boolean(expectedIdentifier && data.ruc && expectedIdentifier === data.ruc),
    documentNumberMatch: expectedDocument ? Boolean(data.invoiceNumber && expectedDocument === data.invoiceNumber) : null,
    dateMatch: expectedDate ? Boolean(data.issueDate && dateOnly(expectedDate) === data.issueDate) : null,
    netMatch: data.netAmount !== undefined && moneyEquals(data.netAmount, requestData.totalNet ?? requestData.netAmount),
    igvMatch: data.igvAmount !== undefined && moneyEquals(data.igvAmount, requestData.totalIGV ?? requestData.igvAmount),
    totalMatch: data.totalAmount !== undefined && moneyEquals(data.totalAmount, requestData.totalAmount)
  };

  if (!data.ruc) errors.push("XML does not include supplier RUC/DNI.");
  else if (!comparisons.supplierMatch) errors.push(`Supplier RUC/DNI does not match XML. Expected ${expectedIdentifier}, XML ${data.ruc}.`);
  if (expectedDocument && !comparisons.documentNumberMatch) errors.push(`Voucher number does not match XML. Expected ${expectedDocument}, XML ${data.invoiceNumber || "missing"}.`);
  if (expectedDate && !comparisons.dateMatch) errors.push(`Issue date does not match XML. Expected ${dateOnly(expectedDate)}, XML ${data.issueDate || "missing"}.`);
  if (data.netAmount === undefined) errors.push("XML does not include Net amount.");
  else if (!comparisons.netMatch) errors.push(`Net amount does not match XML. Form ${requestData.totalNet ?? requestData.netAmount}, XML ${data.netAmount}.`);
  if (data.igvAmount === undefined) errors.push("XML does not include IGV amount.");
  else if (!comparisons.igvMatch) errors.push(`IGV amount does not match XML. Form ${requestData.totalIGV ?? requestData.igvAmount}, XML ${data.igvAmount}.`);
  if (data.totalAmount === undefined) errors.push("XML does not include Total amount.");
  else if (!comparisons.totalMatch) errors.push(`Total amount does not match XML. Form ${requestData.totalAmount}, XML ${data.totalAmount}.`);

  const checksum = await fileChecksum(filePath);
  return {
    status: errors.length ? "INVALID" : "VALID",
    validated: errors.length === 0,
    validatedAt: new Date(),
    provider: "LOCAL_XML",
    ...comparisons,
    errors,
    errorMessages: errors,
    rawMetadataReference: checksum,
    data
  };
}

export async function validateXmlAgainstRequest(filePath, requestData, attempt = {}) {
  const result = await buildXmlValidationResult(filePath, requestData);
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
      "XML fiscal consistency validation failed.",
      { validation: result },
      ERROR_CODES.XML_AMOUNT_MISMATCH
    );
  }
  return result;
}
