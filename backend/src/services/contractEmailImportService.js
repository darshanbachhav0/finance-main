import path from "node:path";
import ExcelJS from "exceljs";
import User from "../models/User.js";
import { recordAudit } from "./auditService.js";
import { emailDomain, isValidEmail } from "./notificationEmailService.js";
import { normalizeDni } from "./cecoImportService.js";

// Import of each person's institutional email from the HR contracts master
// (MAESTRO_CONTRATOS_<date>.xlsx, sheet "Maestro"), so notification emails reach them.
// People are matched by their document number (DNI, as in the CeCo import); the address is the
// "CORREO INSTITUCIONAL" column. Rows that cannot be applied safely are reported, never guessed.

export const DEFAULT_ALLOWED_DOMAINS = Object.freeze(["uma.edu.pe"]);
const CEASED = "CESADO";

function text(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) return value.richText.map((item) => item.text || "").join("").trim();
    if (value.text !== undefined) return text(value.text);
    if (value.result !== undefined) return String(value.result).trim();
    if (value.hyperlink !== undefined) return String(value.hyperlink).replace(/^mailto:/i, "").trim();
  }
  return String(value).trim();
}

const headerKey = (value) => text(value).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]/gi, "").toUpperCase();

function normalizedName(value) {
  return text(value).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9 ]/gi, " ").replace(/\s+/g, " ").trim().toUpperCase();
}

// DNI keeps the CeCo import's rule (8 digits, the zero Excel drops restored); other documents
// (carné de extranjería) are compared as written.
export function documentKey(documentType, documentNumber) {
  const type = headerKey(documentType);
  if (!type || type === "DNI") return normalizeDni(documentNumber);
  return text(documentNumber).replace(/\s+/g, "").toUpperCase();
}

const COLUMNS = {
  documentNumber: ["NDOCUMENTO", "NRODOCUMENTO", "DOCUMENTO", "DNI"],
  documentType: ["TIPODOC", "TIPODOCUMENTO"],
  employeeName: ["APELLIDOSYNOMBRES", "NOMBRES"],
  status: ["ESTADO"],
  email: ["CORREOINSTITUCIONAL", "CORREO", "EMAIL"]
};

function findHeader(worksheet) {
  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 10); rowNumber++) {
    const keys = new Map();
    worksheet.getRow(rowNumber).eachCell((cell, column) => keys.set(headerKey(cell.value), column));
    const columns = Object.fromEntries(Object.entries(COLUMNS).map(([field, names]) => [field, names.map((name) => keys.get(name)).find(Boolean)]));
    if (columns.documentNumber && columns.email) return { rowNumber, columns };
  }
  throw new Error("The contracts master has no header row with \"N° DOCUMENTO\" and \"CORREO INSTITUCIONAL\" columns.");
}

export async function readContractsWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet("Maestro") || workbook.worksheets[0];
  if (!worksheet) throw new Error("The contracts master has no worksheet.");
  const { rowNumber: headerRow, columns } = findHeader(worksheet);
  const cell = (row, column) => (column ? text(row.getCell(column).value) : "");
  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return;
    const parsed = {
      sourceRow: rowNumber,
      documentType: cell(row, columns.documentType) || "DNI",
      documentNumber: cell(row, columns.documentNumber),
      employeeName: cell(row, columns.employeeName),
      status: cell(row, columns.status).toUpperCase(),
      email: cell(row, columns.email)
    };
    if (parsed.documentNumber || parsed.employeeName || parsed.email) rows.push(parsed);
  });
  return { rows, sheetName: worksheet.name, source: path.basename(filePath) };
}

const idOf = (value) => String(value?._id || value || "");
const groupBy = (items, key) => items.reduce((map, item) => map.set(key(item), [...(map.get(key(item)) || []), item]), new Map());

export function createContractEmailImportPlan({ rows, users = [], allowedDomains = DEFAULT_ALLOWED_DOMAINS, source = "MAESTRO_CONTRATOS.xlsx", sheetName = "Maestro" }) {
  const domains = (allowedDomains || []).map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  const validation = {
    invalidRows: [], ceasedEmployees: [], missingEmails: [], invalidEmails: [], otherDomainEmails: [],
    duplicateEmails: [], conflictingRows: [], unmatchedEmployees: [], ambiguousEmployees: [], emailsUsedByOtherUsers: [], nameDifferences: []
  };
  const candidates = [];
  for (const row of rows) {
    const key = documentKey(row.documentType, row.documentNumber);
    const email = row.email.trim().toLowerCase();
    const base = { sourceRow: row.sourceRow, document: key || row.documentNumber, employeeName: row.employeeName };
    if (!key) { validation.invalidRows.push({ ...base, reason: "The document number is missing or not a valid DNI." }); continue; }
    if (row.status === CEASED) { validation.ceasedEmployees.push(base); continue; }
    if (!email) { validation.missingEmails.push(base); continue; }
    // e.g. a program name ("enfermería") typed in the email column.
    if (!isValidEmail(email)) { validation.invalidEmails.push({ ...base, value: row.email }); continue; }
    if (domains.length && !domains.includes(emailDomain(email))) { validation.otherDomainEmails.push({ ...base, email }); continue; }
    candidates.push({ ...row, ...base, key, email });
  }

  // The same address on several people, or one person listed with different addresses, cannot be
  // applied safely: those rows are reported for HR to correct.
  const byEmail = groupBy(candidates, (row) => row.email);
  const sharedEmails = new Set([...byEmail].filter(([, group]) => new Set(group.map((row) => row.key)).size > 1).map(([email]) => email));
  for (const email of sharedEmails) validation.duplicateEmails.push({ email, rows: byEmail.get(email).map((row) => row.sourceRow), documents: [...new Set(byEmail.get(email).map((row) => row.document))] });
  const byDocument = groupBy(candidates.filter((row) => !sharedEmails.has(row.email)), (row) => row.key);

  const usersByKey = new Map();
  for (const user of users) {
    for (const key of new Set([normalizeDni(user.dni), normalizeDni(user.employeeCode), text(user.dni).toUpperCase()].filter(Boolean))) {
      usersByKey.set(key, [...(usersByKey.get(key) || []), user]);
    }
  }
  const usersByEmail = new Map(users.filter((user) => user.email).map((user) => [String(user.email).toLowerCase(), user]));
  const updates = [];
  let unchanged = 0;
  for (const [key, group] of byDocument) {
    const emails = [...new Set(group.map((row) => row.email))];
    if (emails.length > 1) { validation.conflictingRows.push({ document: group[0].document, employeeName: group[0].employeeName, emails, rows: group.map((row) => row.sourceRow) }); continue; }
    const row = group[0];
    const matches = [...new Map((usersByKey.get(key) || []).map((user) => [idOf(user), user])).values()];
    if (!matches.length) { validation.unmatchedEmployees.push({ sourceRow: row.sourceRow, document: row.document, employeeName: row.employeeName, email: row.email }); continue; }
    if (matches.length > 1) { validation.ambiguousEmployees.push({ sourceRow: row.sourceRow, document: row.document, employeeName: row.employeeName, userIds: matches.map(idOf) }); continue; }
    const user = matches[0];
    const holder = usersByEmail.get(row.email);
    if (holder && idOf(holder) !== idOf(user)) { validation.emailsUsedByOtherUsers.push({ sourceRow: row.sourceRow, document: row.document, email: row.email, userId: idOf(user), heldByUserId: idOf(holder), heldByName: holder.name }); continue; }
    if (row.employeeName && normalizedName(user.name) !== normalizedName(row.employeeName)) validation.nameDifferences.push({ sourceRow: row.sourceRow, document: row.document, employeeName: row.employeeName, existingUserName: user.name });
    if (String(user.email || "").toLowerCase() === row.email) { unchanged += 1; continue; }
    updates.push({ userId: user._id, document: row.document, name: user.name, sourceRow: row.sourceRow, previousEmail: user.email || null, email: row.email });
  }
  return { source, sheetName, rowsRead: rows.length, allowedDomains: domains, updates, unchanged, validation };
}

export async function prepareContractEmailImport(filePath, { allowedDomains = DEFAULT_ALLOWED_DOMAINS } = {}) {
  const [{ rows, sheetName, source }, users] = await Promise.all([
    readContractsWorkbook(filePath),
    User.find({}).select("_id dni employeeCode name email").lean()
  ]);
  return createContractEmailImportPlan({ rows, users, allowedDomains, source, sheetName });
}

// The address is the person's notification (and secondary sign-in) address, so every change is
// audited with the previous value.
export async function applyContractEmailImport(plan, importedAt = new Date()) {
  const applied = [];
  const failed = [];
  for (const update of plan.updates) {
    try {
      const result = await User.updateOne(
        { _id: update.userId },
        { $set: { email: update.email, emailImport: { source: plan.source, sourceRow: update.sourceRow, importedAt } } },
        { runValidators: true }
      );
      if (!result.matchedCount) { failed.push({ ...update, reason: "The user no longer exists." }); continue; }
      await recordAudit({
        entityType: "User", entity: update.userId, action: "EMAIL_IMPORTED", module: "USER_ADMIN",
        message: `Email set from ${plan.source} row ${update.sourceRow}.`,
        oldValues: { email: update.previousEmail }, newValues: { email: update.email }
      });
      applied.push(update);
    } catch (error) {
      if (error?.code !== 11000) throw error;
      failed.push({ ...update, reason: "Another user took this email meanwhile." });
    }
  }
  return { emailsSet: applied.filter((item) => !item.previousEmail).length, emailsReplaced: applied.filter((item) => item.previousEmail).length, failed };
}

export function contractEmailImportSummary(plan, mode = "DRY_RUN") {
  const { validation } = plan;
  return {
    mode,
    source: plan.source,
    worksheet: plan.sheetName,
    allowedDomains: plan.allowedDomains.length ? plan.allowedDomains : "any",
    rowsRead: plan.rowsRead,
    emailsToSet: plan.updates.filter((item) => !item.previousEmail).length,
    emailsToReplace: plan.updates.filter((item) => item.previousEmail).length,
    alreadyUpToDate: plan.unchanged,
    ceasedEmployeesSkipped: validation.ceasedEmployees.length,
    rowsWithoutEmail: validation.missingEmails.length,
    rowsWithInvalidEmail: validation.invalidEmails.length,
    rowsWithOtherDomainEmail: validation.otherDomainEmails.length,
    emailsSharedByDifferentPeople: validation.duplicateEmails.length,
    peopleWithConflictingRows: validation.conflictingRows.length,
    unmatchedEmployees: validation.unmatchedEmployees.length,
    ambiguousEmployees: validation.ambiguousEmployees.length,
    emailsUsedByOtherUsers: validation.emailsUsedByOtherUsers.length,
    employeeNameDifferences: validation.nameDifferences.length,
    invalidRows: validation.invalidRows.length
  };
}
