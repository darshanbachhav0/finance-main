import { assertPostingAllowed, syncFinancialProgress } from "./financialProgressService.js";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { XMLParser } from "fast-xml-parser";
import FinancialRequest from "../models/FinancialRequest.js";
import InvoiceObservation from "../models/InvoiceObservation.js";
import MassUploadBatch from "../models/MassUploadBatch.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import SunatVoucher from "../models/SunatVoucher.js";
import User from "../models/User.js";
import { createAccountsPayableFromVoucher } from "./accountingService.js";
import { recordAudit } from "./auditService.js";
import { configuredDocumentRequirements, validateDocumentRequirements } from "./documentRuleService.js";
import { executeBudgetAmount } from "./budgetService.js";
import { notifyRoles } from "./notificationService.js";
import { assertPurchaseOrderInvoiceFits, consumePurchaseOrderBalance, restorePurchaseOrderBalance } from "./purchaseOrderMatchingService.js";
import { escapedRegex, paginatedPayload, parsePagination } from "./queryService.js";
import { nextMassUploadBatchNumber } from "./sequenceService.js";
import { cleanupUploadedFiles, persistUploadedFiles, uploadRoot } from "./storageService.js";
import { createSunatVoucher, findDuplicateVoucher, splitVoucherNumber, validateVoucherWithSunat, voucherIdentity } from "./sunatVoucherService.js";
import { runFinancialOperation } from "./transactionService.js";
import { parseInvoiceXml, assertVoucherXmlMatches } from "./xmlValidationService.js";
import { transitionRequest } from "./workflowService.js";
import { configureBatchInvoiceRunner, enqueueBatch } from "../queues/batchInvoiceQueue.js";
import { AppError } from "../utils/AppError.js";
import { readZipFile } from "../utils/zipReader.js";
import { DOCUMENT_PHASE, ERROR_CODES, FLOW_TYPE, REQUEST_STATUS, ROLES } from "../utils/constants.js";

const OBSERVED_STATUSES = new Set(["OBSERVED_SUNAT", "OBSERVED_DUPLICATE", "OBSERVED_AMOUNT_EXCEEDED", "OBSERVED_BATCH"]);
const RETRYABLE_OBSERVATION_STATUSES = new Set([...OBSERVED_STATUSES, "FAILED"]);
const ZIP_ENTRY_LIMIT = Math.max(1, Number(process.env.BATCH_MAX_ENTRIES || process.env.BATCH_ZIP_MAX_ENTRIES || 500));
const ZIP_ENTRY_BYTES = Math.max(1024, Number(process.env.BATCH_MAX_ENTRY_BYTES || process.env.BATCH_ZIP_MAX_ENTRY_BYTES || 10 * 1024 * 1024));
const ZIP_TOTAL_BYTES = Math.max(ZIP_ENTRY_BYTES, Number(process.env.BATCH_MAX_UNCOMPRESSED_BYTES || process.env.BATCH_ZIP_MAX_TOTAL_BYTES || 100 * 1024 * 1024));
const ZIP_COMPRESSION_RATIO = Math.max(1, Number(process.env.BATCH_MAX_COMPRESSION_RATIO || process.env.BATCH_ZIP_MAX_COMPRESSION_RATIO || 100));
const EXCEL_ROW_LIMIT = Math.max(1, Number(process.env.BATCH_MAX_EXCEL_ROWS || process.env.BATCH_EXCEL_MAX_ROWS || 5000));

function safeName(name) {
  return path.basename(String(name || "")).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function stem(name) {
  return path.basename(name, path.extname(name)).toUpperCase();
}

function checksum(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function rowValue(row, names) {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [String(key).trim().toLowerCase().replace(/[ _-]/g, ""), value]));
  for (const name of names) {
    const key = String(name).toLowerCase().replace(/[ _-]/g, "");
    if (normalized[key] !== undefined && normalized[key] !== null && normalized[key] !== "") return normalized[key];
  }
  return undefined;
}

function numberValue(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = typeof value === "number" ? value : String(value).replace(/\s/g, "").replace(/,(?=\d{1,2}$)/, ".").replace(/,/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
}

function dateValue(value) {
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const serial = Number(value);
    if (Number.isFinite(serial) && serial > 0) return new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86_400_000));
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const spreadsheetXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  parseTagValue: false,
  trimValues: false
});

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function xmlText(value) {
  if (value === undefined || value === null) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return value.map(xmlText).join("");
  if (typeof value === "object") {
    if (value["#text"] !== undefined) return String(value["#text"]);
    return Object.entries(value).filter(([key]) => !key.startsWith("@")).map(([, child]) => xmlText(child)).join("");
  }
  return "";
}

function columnIndex(cellReference) {
  const letters = String(cellReference || "").match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function workbookSheetPath(entryMap) {
  const workbookBuffer = entryMap.get("xl/workbook.xml")?.getData(ZIP_ENTRY_BYTES);
  const relationshipsBuffer = entryMap.get("xl/_rels/workbook.xml.rels")?.getData(ZIP_ENTRY_BYTES);
  if (!workbookBuffer || !relationshipsBuffer) return "xl/worksheets/sheet1.xml";
  const workbook = spreadsheetXmlParser.parse(workbookBuffer.toString("utf8"));
  const relationships = spreadsheetXmlParser.parse(relationshipsBuffer.toString("utf8"));
  const firstSheet = asArray(workbook?.workbook?.sheets?.sheet)[0];
  const relationshipId = firstSheet?.["@r:id"] || firstSheet?.["@id"];
  const relationship = asArray(relationships?.Relationships?.Relationship).find((item) => item?.["@Id"] === relationshipId);
  const target = String(relationship?.["@Target"] || "worksheets/sheet1.xml").replace(/^\/+/, "");
  return target.startsWith("xl/") ? path.posix.normalize(target) : path.posix.normalize(path.posix.join("xl", target));
}

function xlsxRows(entries) {
  const entryMap = new Map(entries.map((entry) => [entry.entryName, entry]));
  const sharedStringsEntry = entryMap.get("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsEntry
    ? asArray(spreadsheetXmlParser.parse(sharedStringsEntry.getData(ZIP_ENTRY_BYTES).toString("utf8"))?.sst?.si).map(xmlText)
    : [];
  const sheetPath = workbookSheetPath(entryMap);
  const sheetEntry = entryMap.get(sheetPath) || entryMap.get("xl/worksheets/sheet1.xml");
  if (!sheetEntry) throw new AppError(422, "The Excel workbook has no readable worksheet.", undefined, ERROR_CODES.BATCH_UPLOAD_INVALID);
  const worksheet = spreadsheetXmlParser.parse(sheetEntry.getData(ZIP_ENTRY_BYTES).toString("utf8"));
  const sourceRows = asArray(worksheet?.worksheet?.sheetData?.row);
  if (!sourceRows.length) return [];
  const matrix = sourceRows.map((row) => {
    const values = [];
    for (const cell of asArray(row?.c)) {
      const index = columnIndex(cell?.["@r"]);
      const type = cell?.["@t"];
      const raw = type === "inlineStr" ? xmlText(cell?.is) : xmlText(cell?.v);
      values[index] = type === "s" ? sharedStrings[Number(raw)] ?? "" : raw;
    }
    return values;
  });
  const headers = (matrix[0] || []).map((value, index) => String(value || `column_${index + 1}`).trim());
  return matrix.slice(1).filter((row) => row.some((value) => String(value || "").trim())).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function normalizeVoucher(candidate = {}) {
  const voucher = { ...(candidate.voucher || {}) };
  const split = splitVoucherNumber(voucher.invoiceNumber || `${voucher.series || ""}-${voucher.number || ""}`);
  voucher.ruc = String(voucher.ruc || "").replace(/\D/g, "");
  voucher.voucherType = String(voucher.voucherType || "FACTURA").trim().toUpperCase();
  voucher.series = String(voucher.series || split.series || "").trim().toUpperCase();
  voucher.number = String(voucher.number || split.number || "").trim().toUpperCase();
  voucher.issueDate = voucher.issueDate ? dateValue(voucher.issueDate) || voucher.issueDate : undefined;
  voucher.currency = String(voucher.currency || "PEN").trim().toUpperCase();
  voucher.netAmount = numberValue(voucher.netAmount);
  voucher.igvAmount = numberValue(voucher.igvAmount) ?? 0;
  voucher.totalAmount = numberValue(voucher.totalAmount);
  return voucher;
}

function itemIdentity(voucher = {}) {
  const identity = voucherIdentity(voucher);
  return { ...identity, seriesNumber: identity.series && identity.number ? `${identity.series}-${identity.number}` : "" };
}

function applyVoucherToItem(item, voucher = {}) {
  const identity = itemIdentity(voucher);
  item.rucIssuer = identity.rucIssuer;
  item.voucherType = identity.voucherType;
  item.series = identity.series;
  item.number = identity.number;
  item.seriesNumber = identity.seriesNumber;
  item.issueDate = voucher.issueDate;
  item.currency = voucher.currency;
  item.netAmount = voucher.netAmount;
  item.igvAmount = voucher.igvAmount;
  item.totalAmount = voucher.totalAmount;
}

function candidateDocument(candidate, kind) {
  return kind === "pdf" ? candidate.pdfFile : candidate.xmlFile;
}

function observationPayload({ batch, item, request, purchaseOrder, candidate, voucher, status, errorCode, detail, duplicateVoucher, storedVoucher, user }) {
  const identity = itemIdentity(voucher);
  return {
    request: request._id,
    purchaseOrder: purchaseOrder._id,
    batch: batch._id,
    batchItemId: item._id,
    supplier: request.supplier?._id || request.supplier,
    flowType: FLOW_TYPE.A2,
    sourceType: batch.inputType,
    sourceName: candidate.sourceName || item.sourceName,
    ...identity,
    issueDate: voucher.issueDate,
    currency: voucher.currency,
    netAmount: voucher.netAmount,
    igvAmount: voucher.igvAmount,
    totalAmount: voucher.totalAmount,
    status,
    errorCode,
    errorDetail: detail,
    duplicateVoucher: duplicateVoucher?._id || duplicateVoucher,
    voucher: storedVoucher?._id || storedVoucher,
    xmlPath: candidateDocument(candidate, "xml")?.path,
    xmlUrl: candidateDocument(candidate, "xml")?.url,
    xmlChecksum: candidateDocument(candidate, "xml")?.checksum,
    pdfPath: candidateDocument(candidate, "pdf")?.path,
    pdfUrl: candidateDocument(candidate, "pdf")?.url,
    resolutionStatus: "OPEN",
    lastAttemptAt: new Date(),
    resolvedAt: undefined,
    resolvedBy: undefined,
    resolutionComments: undefined,
    attempt: { at: new Date(), by: user?._id || user, status, errorCode, detail, xmlChecksum: candidateDocument(candidate, "xml")?.checksum }
  };
}

async function createOrUpdateObservation(args) {
  const payload = observationPayload(args);
  const existing = await InvoiceObservation.findOne({ batch: payload.batch, batchItemId: payload.batchItemId }).select("+xmlPath +pdfPath");
  if (!existing) {
    const { attempt, ...createPayload } = payload;
    const observation = await InvoiceObservation.create({ ...createPayload, attemptCount: 1, attempts: [attempt] });
    args.item.observation = observation._id;
    return observation;
  }
  const { attempt, ...updates } = payload;
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) existing.set(key, value);
  }
  existing.attemptCount = Number(existing.attemptCount || 0) + 1;
  existing.attempts.push(attempt);
  await existing.save();
  args.item.observation = existing._id;
  return existing;
}

async function markCandidateObserved(args) {
  const { item, status, errorCode, detail, storedVoucher } = args;
  item.status = status;
  item.errorCode = errorCode;
  item.errorDetail = detail;
  item.voucher = storedVoucher?._id || storedVoucher || undefined;
  item.accountsPayable = undefined;
  item.processedAt = new Date();
  const observation = await createOrUpdateObservation(args);
  item.observation = observation._id;
  return observation;
}

function zipEntrySizes(entry) {
  const uncompressed = Number(entry.header?.size || 0);
  const compressed = Number(entry.header?.compressedSize || 0);
  return { uncompressed, compressed, ratio: compressed > 0 ? uncompressed / compressed : uncompressed > 0 ? Infinity : 1 };
}

function assertSafeZipEntries(entries) {
  if (entries.length > ZIP_ENTRY_LIMIT) {
    throw new AppError(422, "ZIP contains too many files.", { count: entries.length, limit: ZIP_ENTRY_LIMIT }, ERROR_CODES.BATCH_UPLOAD_INVALID);
  }
  let total = 0;
  for (const entry of entries) {
    const extension = path.extname(entry.entryName).toLowerCase();
    if (![".xml", ".pdf"].includes(extension)) {
      throw new AppError(422, "ZIP may contain only XML and PDF files.", { file: entry.entryName }, ERROR_CODES.BATCH_UPLOAD_INVALID);
    }
    if (entry.header?.flags & 1) {
      throw new AppError(422, "Encrypted ZIP entries are not supported.", { file: entry.entryName }, ERROR_CODES.BATCH_UPLOAD_INVALID);
    }
    const { uncompressed, ratio } = zipEntrySizes(entry);
    if (uncompressed > ZIP_ENTRY_BYTES) {
      throw new AppError(422, "ZIP entry exceeds the allowed size.", { file: entry.entryName, size: uncompressed, limit: ZIP_ENTRY_BYTES }, ERROR_CODES.BATCH_UPLOAD_INVALID);
    }
    if (ratio > ZIP_COMPRESSION_RATIO) {
      throw new AppError(422, "ZIP entry has a suspicious compression ratio.", { file: entry.entryName, ratio }, ERROR_CODES.BATCH_UPLOAD_INVALID);
    }
    total += uncompressed;
    if (total > ZIP_TOTAL_BYTES) {
      throw new AppError(422, "ZIP uncompressed content exceeds the allowed total size.", { total, limit: ZIP_TOTAL_BYTES }, ERROR_CODES.BATCH_UPLOAD_INVALID);
    }
  }
}

function assertSafeSpreadsheetEntries(entries) {
  const files = entries.filter((entry) => !entry.isDirectory);
  if (!files.length || !files.some((entry) => entry.entryName === "[Content_Types].xml") || !files.some((entry) => entry.entryName === "xl/workbook.xml")) {
    throw new AppError(422, "The uploaded file is not a valid XLSX workbook.", undefined, ERROR_CODES.BATCH_UPLOAD_INVALID);
  }
  if (files.length > ZIP_ENTRY_LIMIT) {
    throw new AppError(422, "Excel workbook contains too many package entries.", { count: files.length, limit: ZIP_ENTRY_LIMIT }, ERROR_CODES.BATCH_UPLOAD_INVALID);
  }
  let total = 0;
  for (const entry of files) {
    if (entry.header?.flags & 1) {
      throw new AppError(422, "Encrypted Excel workbooks are not supported.", { file: entry.entryName }, ERROR_CODES.BATCH_UPLOAD_INVALID);
    }
    const { uncompressed, ratio } = zipEntrySizes(entry);
    if (uncompressed > ZIP_ENTRY_BYTES) {
      throw new AppError(422, "Excel package entry exceeds the allowed size.", { file: entry.entryName, size: uncompressed, limit: ZIP_ENTRY_BYTES }, ERROR_CODES.BATCH_UPLOAD_INVALID);
    }
    if (ratio > ZIP_COMPRESSION_RATIO) {
      throw new AppError(422, "Excel package entry has a suspicious compression ratio.", { file: entry.entryName, ratio }, ERROR_CODES.BATCH_UPLOAD_INVALID);
    }
    total += uncompressed;
    if (total > ZIP_TOTAL_BYTES) {
      throw new AppError(422, "Excel workbook exceeds the allowed uncompressed size.", { total, limit: ZIP_TOTAL_BYTES }, ERROR_CODES.BATCH_UPLOAD_INVALID);
    }
  }
  return files;
}

async function zipCandidates(batch) {
  const directory = path.join(uploadRoot, "requests", String(batch.request), `batch-${batch._id}`);
  await fs.mkdir(directory, { recursive: true });
  let entries;
  try {
    entries = (await readZipFile(batch.inputFile.path)).filter((entry) => !entry.isDirectory && !entry.entryName.startsWith("__MACOSX/") && !entry.entryName.endsWith(".DS_Store"));
  } catch (error) {
    throw new AppError(422, "The uploaded ZIP cannot be opened.", { reason: error.message }, ERROR_CODES.BATCH_UPLOAD_INVALID);
  }
  assertSafeZipEntries(entries);
  const pdfByStem = new Map();
  for (const entry of entries.filter((value) => path.extname(value.entryName).toLowerCase() === ".pdf")) {
    if (!pdfByStem.has(stem(entry.entryName))) pdfByStem.set(stem(entry.entryName), entry);
  }
  const candidates = [];
  for (const entry of entries.filter((value) => path.extname(value.entryName).toLowerCase() === ".xml")) {
    const xmlName = safeName(entry.entryName);
    const xmlBuffer = entry.getData(ZIP_ENTRY_BYTES);
    const xmlPath = path.join(directory, `${crypto.randomUUID()}-${xmlName}`);
    await fs.writeFile(xmlPath, xmlBuffer);
    const xmlFile = {
      originalname: xmlName,
      filename: path.basename(xmlPath),
      path: xmlPath,
      url: `/uploads/requests/${batch.request}/batch-${batch._id}/${path.basename(xmlPath)}`,
      mimetype: "application/xml",
      size: xmlBuffer.length,
      checksum: checksum(xmlBuffer)
    };
    const matchingPdf = pdfByStem.get(stem(entry.entryName));
    let pdfFile;
    if (matchingPdf) {
      const pdfName = safeName(matchingPdf.entryName);
      const pdfBuffer = matchingPdf.getData(ZIP_ENTRY_BYTES);
      const pdfPath = path.join(directory, `${crypto.randomUUID()}-${pdfName}`);
      await fs.writeFile(pdfPath, pdfBuffer);
      pdfFile = {
        originalname: pdfName,
        filename: path.basename(pdfPath),
        path: pdfPath,
        url: `/uploads/requests/${batch.request}/batch-${batch._id}/${path.basename(pdfPath)}`,
        mimetype: "application/pdf",
        size: pdfBuffer.length,
        checksum: checksum(pdfBuffer)
      };
    }
    let voucher;
    let parseError;
    try {
      voucher = await parseInvoiceXml(xmlPath);
    } catch (error) {
      parseError = error;
    }
    candidates.push({ sourceName: xmlName, xmlFile, pdfFile, voucher, parseError });
  }
  return { candidates, totalFiles: entries.length };
}

async function excelCandidates(batch) {
  let rows;
  try {
    const entries = assertSafeSpreadsheetEntries(await readZipFile(batch.inputFile.path));
    rows = xlsxRows(entries);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, "The uploaded Excel workbook cannot be opened.", { reason: error.message }, ERROR_CODES.BATCH_UPLOAD_INVALID);
  }
  if (rows.length > EXCEL_ROW_LIMIT) {
    throw new AppError(422, "Excel batch contains too many invoice rows.", { count: rows.length, limit: EXCEL_ROW_LIMIT }, ERROR_CODES.BATCH_UPLOAD_INVALID);
  }
  return {
    totalFiles: 1,
    candidates: rows.map((row, index) => {
      const invoiceNumber = rowValue(row, ["serie_numero", "serie numero", "comprobante", "numero_comprobante"]);
      const split = splitVoucherNumber(invoiceNumber);
      return {
        sourceName: `Excel row ${index + 2}`,
        voucher: {
          ruc: String(rowValue(row, ["ruc_emisor", "ruc", "ruc proveedor"]) || "").replace(/\D/g, ""),
          voucherType: String(rowValue(row, ["tipo_comprobante", "tipo", "document type"]) || "FACTURA").toUpperCase(),
          series: String(rowValue(row, ["serie"]) || split.series || "").toUpperCase(),
          number: String(rowValue(row, ["numero", "número"]) || split.number || "").toUpperCase(),
          issueDate: dateValue(rowValue(row, ["fecha_emision", "fecha", "issue date"])),
          currency: String(rowValue(row, ["moneda", "currency"]) || "PEN").toUpperCase(),
          netAmount: numberValue(rowValue(row, ["monto_neto", "neto", "net amount"])),
          igvAmount: numberValue(rowValue(row, ["monto_igv", "igv", "tax"])) || 0,
          totalAmount: numberValue(rowValue(row, ["monto_total", "total", "importe_total"]))
        }
      };
    })
  };
}

async function loadCandidates(batch) {
  return batch.inputType === "ZIP" ? zipCandidates(batch) : excelCandidates(batch);
}

function itemFor(batch, candidate) {
  let item = batch.items.find((value) => value.sourceName === candidate.sourceName);
  if (!item) {
    batch.items.push({
      sourceName: candidate.sourceName,
      xmlFileName: candidate.xmlFile?.originalname,
      pdfFileName: candidate.pdfFile?.originalname,
      status: "QUEUED"
    });
    item = batch.items.at(-1);
  }
  item.xmlFileName ||= candidate.xmlFile?.originalname;
  item.pdfFileName ||= candidate.pdfFile?.originalname;
  return item;
}

async function getOrCreateObservedVoucher({ request, purchaseOrder, batch, candidate, voucher, status, detail, sunatResult, user, existingVoucher }) {
  if (existingVoucher) {
    existingVoucher.validationStatus = status;
    existingVoucher.observationDetail = detail;
    existingVoucher.sunatStatus = sunatResult?.status || sunatResult?.fiscal?.status;
    existingVoucher.taxpayerStatus = sunatResult?.taxpayer?.condition || sunatResult?.taxpayer?.status;
    existingVoucher.sunatProvider = sunatResult?.fiscal?.source || sunatResult?.taxpayer?.source;
    existingVoucher.validatedAt = new Date();
    existingVoucher.validatedBy = user?._id || user;
    if (candidate.xmlFile) {
      existingVoucher.xmlPath = candidate.xmlFile.path;
      existingVoucher.xmlUrl = candidate.xmlFile.url;
      existingVoucher.xmlChecksum = candidate.xmlFile.checksum;
    }
    if (candidate.pdfFile) {
      existingVoucher.pdfPath = candidate.pdfFile.path;
      existingVoucher.pdfUrl = candidate.pdfFile.url;
    }
    await existingVoucher.save();
    return existingVoucher;
  }
  return createSunatVoucher({
    request,
    purchaseOrder,
    batch,
    supplier: request.supplier,
    voucher,
    flowType: FLOW_TYPE.A2,
    validationStatus: status,
    observationDetail: detail,
    sunatResult,
    xmlFile: candidate.xmlFile,
    pdfFile: candidate.pdfFile,
    user
  });
}

async function provisionCandidate({ request, purchaseOrder, batch, item, candidate, voucher, sunatResult, existingVoucher, user }) {
  let consumedWithoutTransaction = false;
  let createdVoucherId;
  try {
    const result = await runFinancialOperation(async (session) => {
      await assertPostingAllowed(request, { user });
      await assertPurchaseOrderInvoiceFits(purchaseOrder._id, voucher.totalAmount, { currency: voucher.currency, session });
      await consumePurchaseOrderBalance(purchaseOrder._id, voucher.totalAmount, { session });
      if (!session) consumedWithoutTransaction = true;

      let storedVoucher = existingVoucher ? await SunatVoucher.findById(existingVoucher._id).session(session || null) : null;
      if (storedVoucher) {
        const identity = itemIdentity(voucher);
        storedVoucher.rucIssuer = identity.rucIssuer;
        storedVoucher.voucherType = identity.voucherType;
        storedVoucher.series = identity.series;
        storedVoucher.number = identity.number;
        storedVoucher.seriesNumber = identity.seriesNumber;
        storedVoucher.issueDate = voucher.issueDate;
        storedVoucher.currency = voucher.currency || request.currency;
        storedVoucher.netAmount = voucher.netAmount;
        storedVoucher.igvAmount = voucher.igvAmount;
        storedVoucher.xmlAmount = voucher.totalAmount;
        storedVoucher.validationStatus = "VALID";
        storedVoucher.observationDetail = "";
        storedVoucher.sunatStatus = sunatResult?.status || sunatResult?.fiscal?.status;
        storedVoucher.taxpayerStatus = sunatResult?.taxpayer?.condition || sunatResult?.taxpayer?.status;
        storedVoucher.sunatProvider = sunatResult?.fiscal?.source || sunatResult?.taxpayer?.source;
        storedVoucher.validatedAt = new Date();
        storedVoucher.validatedBy = user?._id || user;
        if (candidate.xmlFile) {
          storedVoucher.xmlPath = candidate.xmlFile.path;
          storedVoucher.xmlUrl = candidate.xmlFile.url;
          storedVoucher.xmlChecksum = candidate.xmlFile.checksum;
        }
        if (candidate.pdfFile) {
          storedVoucher.pdfPath = candidate.pdfFile.path;
          storedVoucher.pdfUrl = candidate.pdfFile.url;
        }
        await storedVoucher.save({ session });
      } else {
        storedVoucher = await createSunatVoucher({
          request,
          purchaseOrder,
          batch,
          supplier: request.supplier,
          voucher,
          flowType: FLOW_TYPE.A2,
          validationStatus: "VALID",
          observationDetail: "",
          sunatResult,
          xmlFile: candidate.xmlFile,
          pdfFile: candidate.pdfFile,
          user,
          session
        });
        createdVoucherId = storedVoucher._id;
      }

      const accountsPayable = await createAccountsPayableFromVoucher({
        request,
        supplier: request.supplier,
        voucher,
        purchaseOrder,
        sunatVoucher: storedVoucher,
        sourceBatch: batch,
        user,
        flowType: FLOW_TYPE.A2,
        session
      });
      storedVoucher.accountsPayable = accountsPayable._id;
      storedVoucher.provisionedAt = new Date();
      await storedVoucher.save({ session });
      if (!accountsPayable.budgetExecutedAt) {
        await executeBudgetAmount(request, user._id, accountsPayable.penEquivalent, {
          session,
          comments: `Track A2 batch invoice ${storedVoucher.seriesNumber} provisioned against ${purchaseOrder.poNumber}.`
        });
        accountsPayable.budgetExecutedAt = new Date();
        await accountsPayable.save({ session });
      }
      await request.save({ session });
      if (item?.voucher && String(item.voucher) !== String(storedVoucher._id)) {
        const original = await SunatVoucher.findOne({ _id: item.voucher, request: request._id, accountsPayable: null, supersededBy: null }).session(session || null);
        if (original) {
          original.supersededBy = storedVoucher._id;
          original.supersededAt = new Date();
          original.supersededByUser = user._id;
          await original.save({ session });
          await recordAudit({ entityType: "SunatVoucher", entity: original, requestId: request._id,
            action: "SUPERSEDED_BY_CORRECTED_XML", user, module: "BATCH_INVOICES", session,
            newValues: { supersededBy: storedVoucher._id },
            comments: "Original invoice evidence retained; corrected XML was validated and provisioned." });
        }
      }
      return { storedVoucher, accountsPayable };
    });
    return result;
  } catch (error) {
    if (consumedWithoutTransaction) await restorePurchaseOrderBalance(purchaseOrder._id, voucher.totalAmount).catch(() => undefined);
    if (createdVoucherId) await SunatVoucher.deleteOne({ _id: createdVoucherId, accountsPayable: { $exists: false } }).catch(() => undefined);
    throw error;
  }
}

async function processCandidate({ batch, request, purchaseOrder, candidate, item, user, invoiceRequirements }) {
  item.attemptCount = Number(item.attemptCount || 0) + 1;
  item.status = "PROCESSING";
  item.errorCode = undefined;
  item.errorDetail = undefined;
  item.processedAt = undefined;

  const documentResult = validateDocumentRequirements(request, invoiceRequirements, [
    ...(candidate.xmlFile ? [{ kind: "XML" }] : []),
    ...(candidate.pdfFile ? [{ kind: "PDF" }] : [])
  ]);
  if (!documentResult.valid) {
    const voucher = normalizeVoucher(candidate);
    applyVoucherToItem(item, voucher);
    return markCandidateObserved({ batch, item, request, purchaseOrder, candidate, voucher, status: "OBSERVED_BATCH", errorCode: ERROR_CODES.MISSING_REQUIRED_DOCUMENT, detail: `Missing invoice documents: ${documentResult.missing.map((entry) => entry.kind).join(", ")}.`, user });
  }

  if (candidate.parseError) {
    const voucher = normalizeVoucher({ voucher: {} });
    applyVoucherToItem(item, voucher);
    return markCandidateObserved({ batch, item, request, purchaseOrder, candidate, voucher, status: "OBSERVED_BATCH", errorCode: candidate.parseError.code || ERROR_CODES.XML_VALIDATION_FAILED, detail: candidate.parseError.message, user });
  }
  if (batch.inputType === "ZIP" && !candidate.pdfFile) {
    const voucher = normalizeVoucher(candidate);
    applyVoucherToItem(item, voucher);
    return markCandidateObserved({ batch, item, request, purchaseOrder, candidate, voucher, status: "OBSERVED_BATCH", errorCode: "PDF_MISSING", detail: "The XML has no paired PDF with the same base file name.", user });
  }

  const voucher = normalizeVoucher(candidate);
  candidate.voucher = voucher;
  applyVoucherToItem(item, voucher);
  const identity = itemIdentity(voucher);
  if (!identity.rucIssuer || !identity.series || !identity.number || !(voucher.totalAmount > 0) || !voucher.currency) {
    return markCandidateObserved({ batch, item, request, purchaseOrder, candidate, voucher, status: "OBSERVED_BATCH", errorCode: "INVALID_DATA", detail: "RUC, voucher type, series, number, currency, and a positive total amount are required.", user });
  }

  const supplierRuc = String(request.supplier?.normalizedIdentifier || request.supplier?.rucDni || "").replace(/\D/g, "");
  const itemVoucherId = item.voucher ? String(item.voucher) : "";
  let duplicate = await findDuplicateVoucher(voucher);
  const sameItemVoucher = duplicate && itemVoucherId && String(duplicate._id) === itemVoucherId;
  const reusableObservedVoucher = sameItemVoucher && duplicate.validationStatus !== "VALID" && !duplicate.accountsPayable ? duplicate : null;

  if (supplierRuc && identity.rucIssuer !== supplierRuc) {
    let observedVoucher;
    if (!duplicate || reusableObservedVoucher) {
      observedVoucher = await getOrCreateObservedVoucher({ request, purchaseOrder, batch, candidate, voucher, status: "OBSERVED_SUNAT", detail: "Invoice issuer does not match the Purchase Order supplier.", user, existingVoucher: reusableObservedVoucher });
    }
    return markCandidateObserved({ batch, item, request, purchaseOrder, candidate, voucher, status: "OBSERVED_SUNAT", errorCode: "RUC_MISMATCH", detail: "Invoice issuer does not match the Purchase Order supplier.", duplicateVoucher: duplicate && !sameItemVoucher ? duplicate : undefined, storedVoucher: observedVoucher, user });
  }

  if (duplicate && !reusableObservedVoucher) {
    return markCandidateObserved({ batch, item, request, purchaseOrder, candidate, voucher, status: "OBSERVED_DUPLICATE", errorCode: ERROR_CODES.DUPLICATE_VOUCHER, detail: "RUC + voucher type + series + number already exists in the system.", duplicateVoucher: duplicate, user });
  }

  let sunatResult;
  try {
    sunatResult = await validateVoucherWithSunat(voucher, { request, user });
  } catch (error) {
    const detail = error.code === ERROR_CODES.INTEGRATION_NOT_CONFIGURED
      ? "Automated SUNAT validation is not configured. Configure the production gateway or use MOCK mode only in development."
      : error.message;
    const observedVoucher = await getOrCreateObservedVoucher({ request, purchaseOrder, batch, candidate, voucher, status: "OBSERVED_SUNAT", detail, user, existingVoucher: reusableObservedVoucher });
    return markCandidateObserved({ batch, item, request, purchaseOrder, candidate, voucher, status: "OBSERVED_SUNAT", errorCode: error.code || ERROR_CODES.XML_VALIDATION_FAILED, detail, storedVoucher: observedVoucher, user });
  }
  if (!sunatResult.valid) {
    const detail = sunatResult.detail || "SUNAT validation failed or the voucher is not ACEPTADO.";
    const observedVoucher = await getOrCreateObservedVoucher({ request, purchaseOrder, batch, candidate, voucher, status: "OBSERVED_SUNAT", detail, sunatResult, user, existingVoucher: reusableObservedVoucher });
    return markCandidateObserved({ batch, item, request, purchaseOrder, candidate, voucher, status: "OBSERVED_SUNAT", errorCode: sunatResult.status || ERROR_CODES.XML_VALIDATION_FAILED, detail, storedVoucher: observedVoucher, user });
  }

  try {
    await assertPurchaseOrderInvoiceFits(purchaseOrder._id, voucher.totalAmount, { currency: voucher.currency });
  } catch (error) {
    const status = error.code === ERROR_CODES.PURCHASE_ORDER_AMOUNT_EXCEEDED || error.code === ERROR_CODES.PURCHASE_ORDER_EXHAUSTED
      ? "OBSERVED_AMOUNT_EXCEEDED"
      : "OBSERVED_BATCH";
    const observedVoucher = await getOrCreateObservedVoucher({ request, purchaseOrder, batch, candidate, voucher, status, detail: error.message, sunatResult, user, existingVoucher: reusableObservedVoucher });
    return markCandidateObserved({ batch, item, request, purchaseOrder, candidate, voucher, status, errorCode: error.code || ERROR_CODES.PURCHASE_ORDER_AMOUNT_EXCEEDED, detail: error.message, storedVoucher: observedVoucher, user });
  }

  try {
    const result = await provisionCandidate({ request, purchaseOrder, batch, item, candidate, voucher, sunatResult, existingVoucher: reusableObservedVoucher, user });
    item.status = "PROVISIONED";
    item.voucher = result.storedVoucher._id;
    item.accountsPayable = result.accountsPayable._id;
    item.observation = undefined;
    item.errorCode = undefined;
    item.errorDetail = undefined;
    item.processedAt = new Date();
    if (reusableObservedVoucher) {
      await InvoiceObservation.updateOne(
        { batch: batch._id, batchItemId: item._id },
        { $set: { resolutionStatus: "RESOLVED", resolvedAt: new Date(), resolvedBy: user?._id || user, resolutionComments: "Automatically resolved during batch reprocessing.", voucher: result.storedVoucher._id, accountsPayable: result.accountsPayable._id } }
      );
    }
    return result;
  } catch (error) {
    return markCandidateObserved({ batch, item, request, purchaseOrder, candidate, voucher, status: "FAILED", errorCode: error.code || ERROR_CODES.BATCH_PROCESSING_FAILED, detail: error.message, storedVoucher: reusableObservedVoucher, user });
  }
}

async function refreshBatchCounters(batch) {
  batch.processedSuccess = batch.items.filter((item) => item.status === "PROVISIONED").length;
  batch.observed = batch.items.filter((item) => OBSERVED_STATUSES.has(item.status)).length;
  batch.failed = batch.items.filter((item) => item.status === "FAILED").length;
  batch.status = batch.observed || batch.failed ? "COMPLETED_WITH_OBSERVATIONS" : "COMPLETED";
  batch.completedAt = new Date();
  await batch.save();
}

async function updateRequestAfterBatch({ request, batch, user }) {
  await assertPostingAllowed(request, { user });
  if (batch.processedSuccess > 0) {
    request.observation = undefined;
    await syncFinancialProgress({ request, user, action: "A2_BATCH_PROVISIONED" });
  } else if ((batch.observed || batch.failed) && request.status === REQUEST_STATUS.BUDGET_COMMITTED) {
    request.observation = { code: REQUEST_STATUS.OBSERVED_BATCH, detail: `${batch.batchCode} has no valid invoices.`, observedAt: new Date(), observedBy: user?._id || user };
    await transitionRequest({ request, targetStatus: REQUEST_STATUS.OBSERVED_BATCH, user, action: "A2_BATCH_OBSERVED", comments: request.observation.detail, skipControls: true });
  }
}

export async function createMassUploadBatch({ purchaseOrderId, files, user, req }) {
  const batchFile = files?.batchFile?.[0];
  if (!batchFile) throw new AppError(422, "Upload a ZIP or XLSX batch file.", { field: "batchFile" }, ERROR_CODES.BATCH_UPLOAD_INVALID);
  const extension = path.extname(batchFile.originalname).toLowerCase();
  if (![".zip", ".xlsx"].includes(extension)) throw new AppError(422, "Batch file must be ZIP or XLSX.", { extension }, ERROR_CODES.BATCH_UPLOAD_INVALID);
  const purchaseOrder = await PurchaseOrder.findById(purchaseOrderId).populate({ path: "request", populate: "supplier" });
  if (!purchaseOrder) throw new AppError(404, "Purchase Order not found.", { purchaseOrderId }, ERROR_CODES.NOT_FOUND);
  if (!["ISSUED", "PARTIALLY_LIQUIDATED"].includes(purchaseOrder.status) || Number(purchaseOrder.remainingAmount ?? purchaseOrder.amount) <= 0) {
    throw new AppError(409, "Purchase Order has no available balance for batch liquidation.", { status: purchaseOrder.status, remainingAmount: purchaseOrder.remainingAmount }, ERROR_CODES.PURCHASE_ORDER_EXHAUSTED);
  }
  const request = purchaseOrder.request;
  await assertPostingAllowed(request, { user, req });
  const ownerId = request.requester?._id || request.requester || request.solicitor?._id || request.solicitor;
  if (user.role === ROLES.SOLICITOR && String(ownerId) !== String(user._id)) {
    throw new AppError(403, "Solicitors can upload invoice batches only for their own Purchase Orders.", { purchaseOrderId }, ERROR_CODES.FORBIDDEN);
  }
  if (request.flowType !== FLOW_TYPE.A1) {
    throw new AppError(422, "Track A2 batch liquidation is available only for Purchase Orders issued from Track A1 requests.", { flowType: request.flowType }, ERROR_CODES.VALIDATION_ERROR);
  }
  let persisted;
  try {
    persisted = await persistUploadedFiles({ batchFile: [batchFile] }, { domain: "requests", entityId: request._id });
    const file = persisted.batchFile[0];
    const batchCode = await nextMassUploadBatchNumber(new Date());
    const batch = await MassUploadBatch.create({
      batchCode,
      request: request._id,
      purchaseOrder: purchaseOrder._id,
      uploadedBy: user._id,
      inputType: extension === ".zip" ? "ZIP" : "EXCEL",
      inputFile: { originalName: file.originalname, filename: file.filename, path: file.path, url: file.url, mimetype: file.mimetype, size: file.size, checksum: file.checksum },
      status: "QUEUED"
    });
    request.massUploadBatches ||= [];
    if (!request.massUploadBatches.some((id) => String(id) === String(batch._id))) request.massUploadBatches.push(batch._id);
    await request.save();
    await recordAudit({ entityType: "MassUploadBatch", entity: batch, requestId: request._id, action: "QUEUED", user, req, module: "BATCH_INVOICES", newValues: { batchCode, purchaseOrder: purchaseOrder.poNumber, inputType: batch.inputType } });
    enqueueBatch(batch._id);
    return batch;
  } catch (error) {
    if (persisted) await cleanupUploadedFiles(persisted).catch(() => undefined);
    throw error;
  }
}

export async function processMassUploadBatch(batchId) {
  const batch = await MassUploadBatch.findOneAndUpdate(
    { _id: batchId, status: "QUEUED" },
    { $set: { status: "PROCESSING", startedAt: new Date() }, $unset: { errorMessage: 1 } },
    { new: true }
  ).select("+inputFile.path");
  if (!batch) return MassUploadBatch.findById(batchId);
  try {
    let request = await FinancialRequest.findById(batch.request).populate("supplier");
    const purchaseOrder = await PurchaseOrder.findById(batch.purchaseOrder);
    const user = await User.findById(batch.uploadedBy);
    if (!request || !purchaseOrder || !user) throw new AppError(404, "Batch request, Purchase Order, or uploader no longer exists.", undefined, ERROR_CODES.NOT_FOUND);
    await assertPostingAllowed(request, { user });
    const { candidates, totalFiles } = await loadCandidates(batch);
    const invoiceRequirements = await configuredDocumentRequirements({ requestType: request.requestType, expenseNature: request.expenseNature, flowType: FLOW_TYPE.A2 }, DOCUMENT_PHASE.INVOICE_REGISTRATION);
    batch.totalFiles = totalFiles;
    batch.totalVouchers = candidates.length;
    if (!candidates.length) throw new AppError(422, "The batch contains no invoice XML/data rows.", undefined, ERROR_CODES.BATCH_UPLOAD_INVALID);

    for (const candidate of candidates) {
      const item = itemFor(batch, candidate);
      if (item.status === "PROVISIONED") continue;
      await batch.save();
      await processCandidate({ batch, request, purchaseOrder, candidate, item, user, invoiceRequirements });
      await batch.save();
      request = await FinancialRequest.findById(batch.request).populate("supplier");
    }

    await refreshBatchCounters(batch);
    request = await FinancialRequest.findById(batch.request).populate("supplier");
    await updateRequestAfterBatch({ request, batch, user });
    await recordAudit({
      entityType: "MassUploadBatch",
      entity: batch,
      requestId: request._id,
      action: "COMPLETED",
      user,
      module: "BATCH_INVOICES",
      newValues: { processedSuccess: batch.processedSuccess, observed: batch.observed, failed: batch.failed, status: batch.status }
    });
    await notifyRoles({
      roles: [ROLES.ACCOUNTING],
      eventKey: `batch:${batch._id}:complete:${batch.updatedAt?.getTime?.() || Date.now()}`,
      type: "BATCH_COMPLETE",
      title: "Batch invoice processing complete",
      message: `${batch.batchCode}: ${batch.processedSuccess} provisioned, ${batch.observed + batch.failed} observed/failed.`,
      path: "/accounting/invoice-observations",
      entityType: "MassUploadBatch",
      entityId: batch._id
    });
    return batch;
  } catch (error) {
    batch.status = "FAILED";
    batch.errorMessage = error.message;
    batch.completedAt = new Date();
    await batch.save();
    throw error;
  }
}

configureBatchInvoiceRunner(processMassUploadBatch);

export async function retryMassUploadBatch(batchId, user) {
  const batch = await MassUploadBatch.findById(batchId);
  if (!batch) throw new AppError(404, "Mass upload batch not found.", { batchId }, ERROR_CODES.NOT_FOUND);
  if (user?.role === ROLES.SOLICITOR && String(batch.uploadedBy) !== String(user._id)) {
    throw new AppError(403, "You cannot retry another user's invoice batch.", undefined, ERROR_CODES.FORBIDDEN);
  }
  if (batch.status === "PROCESSING") return batch;
  if (batch.items.length && batch.items.every((item) => item.status === "PROVISIONED")) {
    throw new AppError(409, "Every invoice in this batch is already provisioned.", { batchId }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  const request = await FinancialRequest.findById(batch.request);
  if (!request) throw new AppError(404, "Financial request not found.");
  await assertPostingAllowed(request, { user });
  batch.status = "QUEUED";
  batch.completedAt = undefined;
  batch.errorMessage = undefined;
  await batch.save();
  enqueueBatch(batch._id);
  return batch;
}

export async function listMassUploadBatches(query = {}, user) {
  const filter = {};
  if (user?.role === ROLES.SOLICITOR) filter.uploadedBy = user._id;
  if (query.status) filter.status = query.status;
  if (query.purchaseOrder) filter.purchaseOrder = query.purchaseOrder;
  const { page, pageSize, skip } = parsePagination(query);
  const [data, total] = await Promise.all([
    MassUploadBatch.find(filter).select("-inputFile.path").populate("purchaseOrder", "poNumber amount remainingAmount currency status").populate("request", "requestNumber status").sort({ createdAt: -1 }).skip(skip).limit(pageSize),
    MassUploadBatch.countDocuments(filter)
  ]);
  return paginatedPayload(data, total, page, pageSize);
}

export async function getMassUploadBatch(batchId, user) {
  const batch = await MassUploadBatch.findById(batchId)
    .select("-inputFile.path")
    .populate("purchaseOrder", "poNumber amount originalAmount consumedAmount remainingAmount currency status")
    .populate("request", "requestNumber status requester solicitor")
    .populate("items.voucher")
    .populate("items.observation")
    .populate("items.accountsPayable");
  if (!batch) throw new AppError(404, "Mass upload batch not found.", { batchId }, ERROR_CODES.NOT_FOUND);
  if (user?.role === ROLES.SOLICITOR) {
    const ownerId = batch.request?.requester || batch.request?.solicitor;
    if (String(batch.uploadedBy) !== String(user._id) && String(ownerId) !== String(user._id)) {
      throw new AppError(403, "You do not have access to this invoice batch.", undefined, ERROR_CODES.FORBIDDEN);
    }
  }
  return batch;
}

function publicObservation(observation) {
  const value = observation.toObject ? observation.toObject({ virtuals: true }) : { ...observation };
  return {
    ...value,
    validationStatus: value.status,
    observationDetail: value.errorDetail,
    xmlAmount: value.totalAmount
  };
}

export async function listInvoiceObservations(query = {}) {
  const filter = { resolutionStatus: query.resolutionStatus || "OPEN" };
  if (query.status) filter.status = query.status;
  if (query.batch) filter.batch = query.batch;
  if (query.purchaseOrder) filter.purchaseOrder = query.purchaseOrder;
  if (query.search) {
    const search = new RegExp(escapedRegex(query.search), "i");
    filter.$or = [{ rucIssuer: search }, { seriesNumber: search }, { errorDetail: search }, { sourceName: search }];
  }
  const { page, pageSize, skip } = parsePagination(query);
  const [records, total] = await Promise.all([
    InvoiceObservation.find(filter)
      .select("-xmlPath -pdfPath")
      .populate("request", "requestNumber status")
      .populate("purchaseOrder", "poNumber remainingAmount currency")
      .populate("batch", "batchCode status")
      .populate("supplier", "supplierCode legalName name rucDni")
      .populate("duplicateVoucher", "rucIssuer voucherType seriesNumber validationStatus request batch")
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(pageSize),
    InvoiceObservation.countDocuments(filter)
  ]);
  return paginatedPayload(records.map(publicObservation), total, page, pageSize);
}

export async function listEligiblePurchaseOrders(query = {}, user) {
  const filter = { status: { $in: ["ISSUED", "PARTIALLY_LIQUIDATED"] }, remainingAmount: { $gt: 0 } };
  if (user?.role === ROLES.SOLICITOR) {
    const ownedRequests = await FinancialRequest.distinct("_id", { $or: [{ requester: user._id }, { solicitor: user._id }] });
    filter.request = { $in: ownedRequests };
  }
  if (query.search) {
    const search = new RegExp(escapedRegex(query.search), "i");
    const requests = await FinancialRequest.distinct("_id", { $or: [{ requestNumber: search }, { title: search }] });
    filter.$or = [{ poNumber: search }, { request: { $in: requests } }];
  }
  return PurchaseOrder.find(filter)
    .populate("request", "requestNumber title status flowType")
    .populate("supplier", "supplierCode legalName name rucDni")
    .sort({ issueDate: -1 })
    .limit(100);
}

export async function getObservationDocument(observationId, kind) {
  const observation = await InvoiceObservation.findById(observationId).select("+xmlPath +pdfPath");
  if (!observation) {
    const voucher = await SunatVoucher.findById(observationId).select("+xmlPath +pdfPath");
    if (!voucher) throw new AppError(404, "Invoice observation or voucher not found.", { observationId }, ERROR_CODES.NOT_FOUND);
    return kind === "pdf" ? voucher.pdfPath : voucher.xmlPath;
  }
  return kind === "pdf" ? observation.pdfPath : observation.xmlPath;
}

function candidateFromObservation(observation, persisted, replacementVoucher) {
  const xmlFile = persisted?.xml?.[0] || (observation.xmlPath ? { path: observation.xmlPath, url: observation.xmlUrl, checksum: observation.xmlChecksum, originalname: path.basename(observation.xmlPath) } : undefined);
  const pdfFile = persisted?.pdf?.[0] || (observation.pdfPath ? { path: observation.pdfPath, url: observation.pdfUrl, originalname: path.basename(observation.pdfPath) } : undefined);
  return { sourceName: observation.sourceName, xmlFile, pdfFile, voucher: replacementVoucher };
}

async function updateObservationFailure({ observation, candidate, voucher, status, errorCode, detail, user, duplicateVoucher, storedVoucher }) {
  const identity = itemIdentity(voucher);
  observation.set({
    ...identity,
    issueDate: voucher.issueDate,
    currency: voucher.currency,
    netAmount: voucher.netAmount,
    igvAmount: voucher.igvAmount,
    totalAmount: voucher.totalAmount,
    status,
    errorCode,
    errorDetail: detail,
    duplicateVoucher: duplicateVoucher?._id || duplicateVoucher,
    voucher: storedVoucher?._id || storedVoucher || observation.voucher,
    xmlPath: candidate.xmlFile?.path || observation.xmlPath,
    xmlUrl: candidate.xmlFile?.url || observation.xmlUrl,
    xmlChecksum: candidate.xmlFile?.checksum || observation.xmlChecksum,
    pdfPath: candidate.pdfFile?.path || observation.pdfPath,
    pdfUrl: candidate.pdfFile?.url || observation.pdfUrl,
    resolutionStatus: "OPEN",
    lastAttemptAt: new Date(),
    resolvedAt: undefined,
    resolvedBy: undefined,
    resolutionComments: undefined
  });
  observation.attemptCount = Number(observation.attemptCount || 0) + 1;
  observation.attempts.push({ at: new Date(), by: user._id, status, errorCode, detail, xmlChecksum: candidate.xmlFile?.checksum || observation.xmlChecksum });
  await observation.save();
  await MassUploadBatch.updateOne(
    { _id: observation.batch, "items._id": observation.batchItemId },
    { $set: {
      "items.$.status": status,
      "items.$.errorCode": errorCode,
      "items.$.errorDetail": detail,
      "items.$.voucher": storedVoucher?._id || storedVoucher || observation.voucher,
      "items.$.observation": observation._id,
      "items.$.processedAt": new Date()
    }, $inc: { "items.$.attemptCount": 1 } }
  );
}

export async function retryInvoiceObservation({ observationId, files = {}, acceptXmlValues = false, user, req }) {
  let observation = await InvoiceObservation.findById(observationId).select("+xmlPath +pdfPath");
  if (!observation) observation = await InvoiceObservation.findOne({ voucher: observationId, resolutionStatus: "OPEN" }).select("+xmlPath +pdfPath");
  if (!observation) throw new AppError(404, "Invoice observation not found.", { observationId }, ERROR_CODES.NOT_FOUND);
  if (!RETRYABLE_OBSERVATION_STATUSES.has(observation.status) || observation.resolutionStatus !== "OPEN") {
    throw new AppError(409, "Only an open invoice observation can be revalidated.", { status: observation.status, resolutionStatus: observation.resolutionStatus }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  const request = await FinancialRequest.findById(observation.request).populate("supplier");
  const purchaseOrder = await PurchaseOrder.findById(observation.purchaseOrder);
  const batch = await MassUploadBatch.findById(observation.batch);
  if (!request || !purchaseOrder || !batch) throw new AppError(404, "Observation request, Purchase Order, or batch no longer exists.", undefined, ERROR_CODES.NOT_FOUND);

  await assertPostingAllowed(request, { user, req });
  let persisted;
  try {
    persisted = await persistUploadedFiles(files, { domain: "requests", entityId: request._id });
    let voucher = {
      ruc: observation.rucIssuer,
      voucherType: observation.voucherType,
      series: observation.series,
      number: observation.number,
      issueDate: observation.issueDate,
      currency: observation.currency || request.currency,
      netAmount: observation.netAmount,
      igvAmount: observation.igvAmount,
      totalAmount: observation.totalAmount
    };
    const evidenceCandidate = candidateFromObservation(observation, persisted, voucher);
    if (evidenceCandidate.xmlFile?.path) {
      const parsed = await parseInvoiceXml(evidenceCandidate.xmlFile.path);
      try {
        await assertVoucherXmlMatches(evidenceCandidate.xmlFile.path, acceptXmlValues ? { ...parsed, voucherType: voucher.voucherType } : voucher);
      } catch (error) {
        await updateObservationFailure({ observation, candidate: evidenceCandidate, voucher, status: "OBSERVED_BATCH", errorCode: error.code, detail: error.message, user });
        throw error;
      }
      if (acceptXmlValues) await recordAudit({ entityType: "InvoiceObservation", entity: observation, requestId: request._id, action: "XML_VALUES_CORRECTED", user, req, module: "BATCH_INVOICES", oldValues: voucher, newValues: { ...parsed, xmlChecksum: evidenceCandidate.xmlFile.checksum }, comments: "Accounting explicitly accepted the replacement XML values; all fiscal, duplicate, budget and period checks still apply." });
      voucher = { ...parsed, voucherType: voucher.voucherType };
    }
    voucher = normalizeVoucher({ voucher });
    const candidate = candidateFromObservation(observation, persisted, voucher);
    const invoiceRequirements = await configuredDocumentRequirements({ requestType: request.requestType, expenseNature: request.expenseNature, flowType: FLOW_TYPE.A2 }, DOCUMENT_PHASE.INVOICE_REGISTRATION);
    const documentResult = validateDocumentRequirements(request, invoiceRequirements, [
      ...(candidate.xmlFile ? [{ kind: "XML" }] : []),
      ...(candidate.pdfFile ? [{ kind: "PDF" }] : [])
    ]);
    if (!documentResult.valid) {
      const detail = `Missing invoice documents: ${documentResult.missing.map((entry) => entry.kind).join(", ")}.`;
      await updateObservationFailure({ observation, candidate, voucher, status: "OBSERVED_BATCH", errorCode: ERROR_CODES.MISSING_REQUIRED_DOCUMENT, detail, user });
      throw new AppError(422, detail, undefined, ERROR_CODES.MISSING_REQUIRED_DOCUMENT);
    }
    const identity = itemIdentity(voucher);
    if (!identity.rucIssuer || !identity.series || !identity.number || !(voucher.totalAmount > 0)) {
      const detail = "Replacement data must include RUC, series, number, and a positive total amount.";
      await updateObservationFailure({ observation, candidate, voucher, status: "OBSERVED_BATCH", errorCode: "INVALID_DATA", detail, user });
      throw new AppError(422, detail, undefined, ERROR_CODES.BATCH_UPLOAD_INVALID);
    }
    const supplierRuc = String(request.supplier?.normalizedIdentifier || request.supplier?.rucDni || "").replace(/\D/g, "");
    if (supplierRuc && identity.rucIssuer !== supplierRuc) {
      const detail = "Replacement invoice issuer does not match the Purchase Order supplier.";
      await updateObservationFailure({ observation, candidate, voucher, status: "OBSERVED_SUNAT", errorCode: "RUC_MISMATCH", detail, user });
      throw new AppError(422, detail, undefined, ERROR_CODES.XML_VALIDATION_FAILED);
    }

    const currentVoucherId = observation.voucher ? String(observation.voucher) : "";
    const duplicate = await findDuplicateVoucher(voucher);
    if (duplicate && String(duplicate._id) !== currentVoucherId) {
      const detail = "Replacement voucher already exists in the system.";
      await updateObservationFailure({ observation, candidate, voucher, status: "OBSERVED_DUPLICATE", errorCode: ERROR_CODES.DUPLICATE_VOUCHER, detail, duplicateVoucher: duplicate, user });
      throw new AppError(409, detail, { voucher: duplicate._id }, ERROR_CODES.DUPLICATE_VOUCHER);
    }

    let sunatResult;
    try {
      sunatResult = await validateVoucherWithSunat(voucher, { request, user });
    } catch (error) {
      const detail = error.code === ERROR_CODES.INTEGRATION_NOT_CONFIGURED
        ? "Automated SUNAT validation is not configured. Configure the production gateway or use MOCK mode only in development."
        : error.message;
      await updateObservationFailure({ observation, candidate, voucher, status: "OBSERVED_SUNAT", errorCode: error.code || ERROR_CODES.XML_VALIDATION_FAILED, detail, storedVoucher: duplicate, user });
      throw error;
    }
    if (!sunatResult.valid) {
      const detail = sunatResult.detail || "SUNAT validation failed.";
      await updateObservationFailure({ observation, candidate, voucher, status: "OBSERVED_SUNAT", errorCode: sunatResult.status || ERROR_CODES.XML_VALIDATION_FAILED, detail, storedVoucher: duplicate, user });
      throw new AppError(422, detail, { status: sunatResult.status }, ERROR_CODES.XML_VALIDATION_FAILED);
    }
    try {
      await assertPurchaseOrderInvoiceFits(purchaseOrder._id, voucher.totalAmount, { currency: voucher.currency });
    } catch (error) {
      const status = error.code === ERROR_CODES.PURCHASE_ORDER_AMOUNT_EXCEEDED || error.code === ERROR_CODES.PURCHASE_ORDER_EXHAUSTED ? "OBSERVED_AMOUNT_EXCEEDED" : "OBSERVED_BATCH";
      await updateObservationFailure({ observation, candidate, voucher, status, errorCode: error.code || ERROR_CODES.PURCHASE_ORDER_AMOUNT_EXCEEDED, detail: error.message, storedVoucher: duplicate, user });
      throw error;
    }

    const result = await provisionCandidate({ request, purchaseOrder, batch, item: { voucher: observation.voucher }, candidate, voucher, sunatResult, existingVoucher: duplicate, user });
    observation.set({
      ...itemIdentity(voucher),
      issueDate: voucher.issueDate,
      currency: voucher.currency,
      netAmount: voucher.netAmount,
      igvAmount: voucher.igvAmount,
      totalAmount: voucher.totalAmount,
      status: observation.status,
      errorCode: undefined,
      errorDetail: "Resolved and provisioned.",
      voucher: result.storedVoucher._id,
      accountsPayable: result.accountsPayable._id,
      xmlPath: candidate.xmlFile?.path || observation.xmlPath,
      xmlUrl: candidate.xmlFile?.url || observation.xmlUrl,
      xmlChecksum: candidate.xmlFile?.checksum || observation.xmlChecksum,
      pdfPath: candidate.pdfFile?.path || observation.pdfPath,
      pdfUrl: candidate.pdfFile?.url || observation.pdfUrl,
      resolutionStatus: "RESOLVED",
      resolvedAt: new Date(),
      resolvedBy: user._id,
      resolutionComments: "Validated with SUNAT, matched against the Purchase Order, and provisioned to CXP.",
      lastAttemptAt: new Date()
    });
    observation.attemptCount = Number(observation.attemptCount || 0) + 1;
    observation.attempts.push({ at: new Date(), by: user._id, status: observation.status, detail: "Resolved and provisioned.", xmlChecksum: candidate.xmlFile?.checksum || observation.xmlChecksum });
    await observation.save();
    await MassUploadBatch.updateOne(
      { _id: batch._id, "items._id": observation.batchItemId },
      { $set: {
        "items.$.status": "PROVISIONED",
        "items.$.voucher": result.storedVoucher._id,
        "items.$.observation": observation._id,
        "items.$.accountsPayable": result.accountsPayable._id,
        "items.$.errorCode": "",
        "items.$.errorDetail": "",
        "items.$.processedAt": new Date(),
        "items.$.rucIssuer": identity.rucIssuer,
        "items.$.voucherType": identity.voucherType,
        "items.$.series": identity.series,
        "items.$.number": identity.number,
        "items.$.seriesNumber": identity.seriesNumber,
        "items.$.issueDate": voucher.issueDate,
        "items.$.currency": voucher.currency,
        "items.$.netAmount": voucher.netAmount,
        "items.$.igvAmount": voucher.igvAmount,
        "items.$.totalAmount": voucher.totalAmount
      }, $inc: { "items.$.attemptCount": 1 } }
    );
    const refreshedBatch = await MassUploadBatch.findById(batch._id);
    await refreshBatchCounters(refreshedBatch);
    const refreshedRequest = await FinancialRequest.findById(request._id).populate("supplier");
    await updateRequestAfterBatch({ request: refreshedRequest, batch: refreshedBatch, user });
    await recordAudit({ entityType: "InvoiceObservation", entity: observation, requestId: request._id, action: "RESOLVED", user, req, module: "BATCH_INVOICES", newValues: { voucher: result.storedVoucher._id, accountsPayable: result.accountsPayable._id } });
    return { observation: publicObservation(observation), voucher: result.storedVoucher, accountsPayable: result.accountsPayable, request: refreshedRequest };
  } catch (error) {
    // Persisted replacement evidence is intentionally retained and linked to the observation
    // by updateObservationFailure so Accounting can retry without asking for the same file again.
    if (persisted && !Object.values(persisted).flat().length) await cleanupUploadedFiles(persisted).catch(() => undefined);
    throw error;
  }
}

// Backward-compatible name used by existing controller imports.
export const retryObservedVoucher = ({ voucherId, ...rest }) => retryInvoiceObservation({ observationId: voucherId, ...rest });
export const getVoucherDocument = getObservationDocument;
