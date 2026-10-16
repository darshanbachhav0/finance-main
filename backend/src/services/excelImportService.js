import ExcelJS from "exceljs";
import AccountsPayable from "../models/AccountsPayable.js";
import BudgetAllocation from "../models/BudgetAllocation.js";
import CostCenter from "../models/CostCenter.js";
import FinancialRequest from "../models/FinancialRequest.js";
import Supplier from "../models/Supplier.js";
import { recordAudit } from "./auditService.js";
import { createBudgetPlan } from "./budgetPlanService.js";
import { assertSupplierIdentifier, createSupplierProposal } from "./supplierService.js";
import { AppError } from "../utils/AppError.js";
import { AP_STATUS, ERROR_CODES, ROLES } from "../utils/constants.js";
import { limaDateKey } from "../../../shared/businessCalendar.mjs";

// "Import from Excel": the sheets Finance and Treasury keep today become platform records, through
// the same services the screens use (so every rule, audit and notification still applies).
//   budget-plans      Budget / Admin      a new annual budget plan per Cost Center (and project)
//   suppliers         Admin / Accounting / Procurement   supplier proposals, pending approval
//   payment-schedule  Treasury / Admin    the planned payment date (and priority) of open payables
// Every import is checked first (dryRun): each row says what will happen or what is wrong, and
// nothing is saved until the person confirms. Rows that fail never stop the others.

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// Header text -> a plain key: lower case, no accents, no symbols ("Año" -> "ano", "CECO / Código" -> "cecocodigo").
export const headerKey = (value) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

function cellText(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if (value.richText) return value.richText.map((part) => part.text).join("");
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return cellText(value.result);
    return "";
  }
  return String(value).trim();
}

// The first sheet as [{ __row, <headerKey>: text }], skipping empty rows.
export async function readSheet(buffer) {
  if (!buffer?.length) throw new AppError(422, "Choose an Excel file (.xlsx).", undefined, ERROR_CODES.VALIDATION_ERROR);
  if (buffer.length > MAX_IMPORT_BYTES) throw new AppError(422, "The Excel file is larger than 2 MB.", undefined, ERROR_CODES.VALIDATION_ERROR);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); }
  catch { throw new AppError(422, "The file could not be read as an Excel workbook (.xlsx).", undefined, ERROR_CODES.VALIDATION_ERROR); }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new AppError(422, "The Excel file has no sheets.", undefined, ERROR_CODES.VALIDATION_ERROR);
  const headers = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => { headers[column] = headerKey(cellText(cell.value)); });
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, number) => {
    if (number === 1) return;
    const record = { __row: number };
    row.eachCell({ includeEmpty: true }, (cell, column) => { if (headers[column]) record[headers[column]] = cellText(cell.value); });
    if (Object.entries(record).some(([key, value]) => key !== "__row" && value !== "")) rows.push(record);
  });
  if (!rows.length) throw new AppError(422, "The Excel file has no rows under its header row.", undefined, ERROR_CODES.VALIDATION_ERROR);
  if (rows.length > MAX_IMPORT_ROWS) throw new AppError(422, `Import at most ${MAX_IMPORT_ROWS} rows at a time.`, { rows: rows.length }, ERROR_CODES.VALIDATION_ERROR);
  return rows;
}

const pick = (row, ...keys) => { for (const key of keys) if (row[key] !== undefined && row[key] !== "") return row[key]; return ""; };

// "1,250.50", "1250,50", "S/ 1 250.50" -> 1250.5; "" -> null.
export function parseAmount(value) {
  const text = String(value ?? "").replace(/[^\d.,-]/g, "");
  if (!text) return null;
  const normalized = /,\d{1,2}$/.test(text) && !/\.\d{1,2}$/.test(text) ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : NaN;
}

// "2026-10-15", "15/10/2026" -> "2026-10-15".
export function parseDateKey(value) {
  const text = String(value ?? "").trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return "";
}

// Row messages are English templates with {params}, translated and filled in by the screen.
const fail = (message, params) => { throw new AppError(422, message, params ? { params } : undefined, ERROR_CODES.VALIDATION_ERROR); };

// ---- Budget plans --------------------------------------------------------------------------
async function checkBudgetRow(row) {
  const year = String(pick(row, "ano", "year", "anio")).trim();
  if (!/^\d{4}$/.test(year)) fail("Write the budget year (e.g. 2027).");
  const code = String(pick(row, "ceco", "centrodecostos", "costcenter", "codigoceco", "cecocodigo")).trim();
  if (!code) fail("Write the Cost Center (CECO) code.");
  const center = await CostCenter.findOne({ code }).select("_id code name active").lean();
  if (!center?.active) fail("Cost Center {code} does not exist or is inactive.", { code });
  const project = String(pick(row, "proyecto", "project", "pep")).trim();
  const annual = parseAmount(pick(row, "montoanual", "presupuestoanual", "annualamount", "monto", "amount"));
  if (!(annual > 0)) fail("Write the annual amount (greater than zero).");
  const monthly = MONTHS.map((month, index) => parseAmount(pick(row, month, String(index + 1))));
  const hasMonths = monthly.some((value) => value !== null);
  if (hasMonths && monthly.some((value) => Number.isNaN(value) || value === null)) fail("Fill all twelve months, or leave every month empty.");
  if (hasMonths && Math.round(monthly.reduce((sum, value) => sum + value, 0) * 100) > Math.round(annual * 100)) fail("The months add up to more than the annual amount.");
  const exists = await BudgetAllocation.exists({ costCenter: center._id, project, period: new RegExp(`^${year}(?:-|$)`) });
  if (exists) fail("{code} already has a budget for {year}. Change it in Budget Control.", { code, year });
  return { year: Number(year), center, project, annual, months: hasMonths ? monthly : null, summary: `${code}${project ? ` · ${project}` : ""} · ${year} · PEN ${annual.toFixed(2)}${hasMonths ? " · 12 months" : ""}` };
}

async function applyBudgetRow(checked, { user, req, fileName }) {
  await createBudgetPlan({
    year: checked.year,
    planningMode: checked.months ? "ANNUAL_MONTHLY" : "ANNUAL_ONLY",
    distribution: checked.months ? "CUSTOM" : undefined,
    months: checked.months || undefined,
    costCenter: String(checked.center._id),
    project: checked.project,
    assignedAmount: checked.annual,
    reason: `Imported from Excel (${fileName || "file"}).`
  }, user, req);
}

// ---- Suppliers -----------------------------------------------------------------------------
async function checkSupplierRow(row) {
  const identifier = assertSupplierIdentifier(pick(row, "ruc", "rucdni", "dni", "documento", "identifier"));
  const legalName = String(pick(row, "razonsocial", "nombre", "legalname", "name")).trim();
  if (!legalName) fail("Write the supplier's legal name (razón social).");
  if (await Supplier.exists({ $or: [{ normalizedIdentifier: identifier }, { rucDni: identifier }] })) fail("A supplier with RUC/DNI {identifier} already exists.", { identifier });
  const email = String(pick(row, "correo", "email", "correoelectronico")).trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("The email address is not valid.");
  return {
    payload: {
      rucDni: identifier,
      legalName,
      commercialName: String(pick(row, "nombrecomercial", "commercialname")).trim() || undefined,
      email: email || undefined,
      phone: String(pick(row, "telefono", "phone", "celular")).trim() || undefined,
      contactName: String(pick(row, "contacto", "contactname")).trim() || undefined,
      fiscalAddress: String(pick(row, "direccion", "direccionfiscal", "address")).trim() || undefined,
      goodsServicesProfile: String(pick(row, "bienesoservicios", "rubro", "goodsservices")).trim() || undefined,
      proposalJustification: String(pick(row, "justificacion", "motivo", "justification")).trim() || "Proveedor importado desde la lista de Finanzas (Excel)."
    },
    summary: `${identifier} · ${legalName}`
  };
}

async function applySupplierRow(checked, { user, req }) {
  await createSupplierProposal({ payload: checked.payload, files: {}, user, req });
}

// ---- Payment schedule ------------------------------------------------------------------------
const OPEN_PAYABLE = [AP_STATUS.OPEN, AP_STATUS.PARTIALLY_PAID];
async function checkScheduleRow(row, { now = new Date() } = {}) {
  const requestNumber = String(pick(row, "solicitud", "request", "requestnumber", "nrosolicitud", "numerodesolicitud")).trim().toUpperCase();
  if (!requestNumber) fail("Write the request number (e.g. SOL-2026-00012).");
  const date = parseDateKey(pick(row, "fechadepago", "fechapago", "paymentdate", "fecha", "date"));
  if (!date) fail("Write the payment date as YYYY-MM-DD or DD/MM/YYYY.");
  if (date < limaDateKey(now)) fail("The payment date is in the past.");
  const priorityText = headerKey(pick(row, "prioridad", "priority"));
  const priority = !priorityText ? undefined : ["prioritaria", "priority", "alta", "urgente", "si"].includes(priorityText) ? "PRIORITY" : ["normal", "no"].includes(priorityText) ? "NORMAL" : fail("Priority must be Normal or Prioritaria.");
  const request = await FinancialRequest.findOne({ requestNumber }).select("_id requestNumber").lean();
  if (!request) fail("Request {requestNumber} was not found.", { requestNumber });
  const payables = await AccountsPayable.find({ request: request._id, status: { $in: OPEN_PAYABLE } }).select("_id outstandingAmount currency").lean();
  if (!payables.length) fail("{requestNumber} has no payable waiting for payment (already scheduled or paid).", { requestNumber });
  return { date, priority, payableIds: payables.map((item) => item._id), summary: `${requestNumber} · ${date}${priority === "PRIORITY" ? " · prioritaria" : ""} · ${payables.length} CXP` };
}

async function applyScheduleRow(checked, { user }) {
  const set = { plannedPaymentDate: new Date(`${checked.date}T12:00:00.000Z`), plannedBy: user._id, plannedAt: new Date() };
  if (checked.priority) set.paymentPriority = checked.priority;
  await AccountsPayable.updateMany({ _id: { $in: checked.payableIds }, status: { $in: OPEN_PAYABLE } }, { $set: set });
}

export const IMPORTERS = Object.freeze({
  "budget-plans": { roles: [ROLES.ADMIN, ROLES.BUDGET], module: "BUDGET", check: checkBudgetRow, apply: applyBudgetRow },
  suppliers: { roles: [ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.PROCUREMENT], module: "SUPPLIERS", check: checkSupplierRow, apply: applySupplierRow },
  "payment-schedule": { roles: [ROLES.ADMIN, ROLES.TREASURY], module: "TREASURY", check: checkScheduleRow, apply: applyScheduleRow }
});

export async function runExcelImport({ kind, buffer, fileName, dryRun = true, user, req, now = new Date() }) {
  const importer = IMPORTERS[kind];
  if (!importer) throw new AppError(404, "Unknown import.", { kind }, ERROR_CODES.NOT_FOUND);
  if (!importer.roles.includes(user?.role)) throw new AppError(403, "Your role cannot run this import.", { kind }, ERROR_CODES.FORBIDDEN);
  const rows = await readSheet(buffer);
  const results = [];
  const seen = new Set();
  for (const row of rows) {
    try {
      const checked = await importer.check(row, { now });
      // The same record twice in one file is a mistake, not two records.
      const key = checked.summary.split(" · ").slice(0, 2).join("|");
      if (seen.has(key)) fail("This row repeats an earlier row of the file.");
      seen.add(key);
      if (!dryRun) await importer.apply(checked, { user, req, fileName });
      results.push({ row: row.__row, ok: true, summary: checked.summary });
    } catch (error) {
      results.push({ row: row.__row, ok: false, message: error.message, ...(error.details?.params ? { params: error.details.params } : {}) });
    }
  }
  const summary = { kind, dryRun, total: results.length, ok: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length };
  if (!dryRun) await recordAudit({ entityType: "ExcelImport", entity: null, action: "EXCEL_IMPORTED", user, req, module: importer.module, comments: fileName, newValues: summary });
  return { ...summary, rows: results };
}
