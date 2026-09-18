import path from "node:path";
import ExcelJS from "exceljs";
import CostCenter from "../models/CostCenter.js";
import User from "../models/User.js";

const SOURCE_NAME = "Centro de Costo - Tesoreria.xlsx";
const HIGHLIGHTED_CODES = new Set(["30004", "40020", "50103", "20007", "20002"]);

function text(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) return value.richText.map((item) => item.text || "").join("").trim();
    if (value.text !== undefined) return String(value.text).trim();
    if (value.result !== undefined) return String(value.result).trim();
  }
  return String(value).trim();
}

export function normalizeCode(value) {
  return text(value).replace(/\.0+$/, "");
}

export function normalizeDni(value) {
  const digits = text(value).replace(/\D/g, "");
  if (!digits || digits.length > 8) return "";
  return digits.padStart(8, "0");
}

function normalizedName(value) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/[^A-Z0-9 ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function metadataKey(row) {
  return [row.area, row.organizationalUnit, row.organizationalUnitCode].map((item) => text(item).toUpperCase()).join("|");
}

function isQuestionableRectorado(row) {
  return row.cecoCode === "20002" && /RECTORADO/i.test(row.area) && row.organizationalUnitCode && row.organizationalUnitCode !== "20002";
}

export async function readCecoWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("The CeCo workbook has no worksheet.");
  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const parsed = {
      sourceRow: rowNumber,
      dni: normalizeDni(row.getCell(2).value),
      employeeName: text(row.getCell(3).value),
      cecoCode: normalizeCode(row.getCell(4).value),
      area: text(row.getCell(5).value),
      organizationalUnit: text(row.getCell(6).value),
      organizationalUnitCode: normalizeCode(row.getCell(7).value)
    };
    if (Object.values(parsed).some(Boolean)) rows.push(parsed);
  });
  return { rows, sheetName: worksheet.name, source: path.basename(filePath) };
}

function uniqueBy(items, key) {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}

export function createCecoImportPlan({ rows, users = [], existingCenters = [], source = SOURCE_NAME, sheetName = "Hoja1" }) {
  const usableRows = rows.filter((row) => row.cecoCode && row.dni && row.employeeName && row.area);
  const invalidRows = rows.filter((row) => !row.cecoCode || !row.dni || !row.employeeName || !row.area).map((row) => ({ ...row, reason: "Required CeCo, DNI, employee name or area is missing." }));
  const cecoGroups = Map.groupBy ? Map.groupBy(usableRows, (row) => row.cecoCode) : usableRows.reduce((map, row) => map.set(row.cecoCode, [...(map.get(row.cecoCode) || []), row]), new Map());
  const cecoConflicts = [];
  const cecoRecords = [];

  for (const [code, group] of cecoGroups) {
    const variants = uniqueBy(group, metadataKey);
    const rectoradoIssue = group.some(isQuestionableRectorado);
    if (variants.length > 1 || rectoradoIssue) {
      cecoConflicts.push({
        code,
        highlighted: HIGHLIGHTED_CODES.has(code),
        reason: rectoradoIssue ? "RECTORADO is mapped to a different organizational-unit code in the source." : "The same CeCo has conflicting area or organizational-unit values.",
        rows: group.map((row) => row.sourceRow),
        variants: variants.map((row) => ({ area: row.area, organizationalUnit: row.organizationalUnit, organizationalUnitCode: row.organizationalUnitCode }))
      });
      continue;
    }
    const row = variants[0];
    cecoRecords.push({
      code,
      name: row.area,
      area: row.area,
      organizationalUnit: row.organizationalUnit,
      organizationalUnitCode: row.organizationalUnitCode,
      sourceRows: group.map((item) => item.sourceRow).sort((a, b) => a - b),
      active: true
    });
  }

  const blockedCodes = new Set(cecoConflicts.map((item) => item.code));
  const dniGroups = usableRows.reduce((map, row) => map.set(row.dni, [...(map.get(row.dni) || []), row]), new Map());
  const assignments = [];
  const unmatchedEmployees = [];
  const ambiguousEmployees = [];

  for (const [dni, group] of dniGroups) {
    const cecoCodes = [...new Set(group.map((row) => row.cecoCode))];
    const sourceNames = [...new Set(group.map((row) => normalizedName(row.employeeName)))];
    if (cecoCodes.length !== 1 || sourceNames.length !== 1 || blockedCodes.has(cecoCodes[0])) {
      ambiguousEmployees.push({ dni, employeeName: group[0].employeeName, cecoCodes, sourceRows: group.map((row) => row.sourceRow), reason: blockedCodes.has(cecoCodes[0]) ? "CeCo requires manual confirmation." : "DNI has conflicting source rows." });
      continue;
    }
    const matches = uniqueBy(users.filter((user) => normalizeDni(user.dni) === dni || normalizeDni(user.employeeCode) === dni), (user) => String(user._id));
    if (!matches.length) {
      unmatchedEmployees.push({ dni, employeeName: group[0].employeeName, cecoCode: cecoCodes[0], sourceRow: group[0].sourceRow, reason: "No user has this DNI or DNI-form employee code." });
      continue;
    }
    if (matches.length > 1) {
      ambiguousEmployees.push({ dni, employeeName: group[0].employeeName, cecoCodes, sourceRows: group.map((row) => row.sourceRow), userIds: matches.map((user) => String(user._id)), reason: "More than one user matches this DNI." });
      continue;
    }
    const user = matches[0];
    if (normalizedName(user.name) !== sourceNames[0]) {
      ambiguousEmployees.push({ dni, employeeName: group[0].employeeName, cecoCodes, sourceRows: group.map((row) => row.sourceRow), userIds: [String(user._id)], existingUserName: user.name, reason: "DNI matches, but the employee name differs and requires confirmation." });
      continue;
    }
    assignments.push({ userId: user._id, dni, cecoCode: cecoCodes[0], sourceRow: group[0].sourceRow, matchedBy: normalizeDni(user.dni) === dni ? "DNI" : "EMPLOYEE_CODE" });
  }

  const sourceCodes = new Set(cecoGroups.keys());
  const demoCentersToDeactivate = existingCenters.filter((center) => center.active !== false && !sourceCodes.has(center.code) && (/^CC-/i.test(center.code) || /\(Demo\)|Demo/i.test(center.name || ""))).map((center) => ({ _id: center._id, code: center.code, name: center.name }));
  const existingByCode = new Map(existingCenters.map((center) => [center.code, center]));
  const centersToInsert = cecoRecords.filter((center) => !existingByCode.has(center.code));
  const centersToUpdate = cecoRecords.filter((center) => {
    const old = existingByCode.get(center.code);
    return old && ["name", "area", "organizationalUnit", "organizationalUnitCode"].some((field) => text(old[field]) !== text(center[field])) || old?.active === false;
  });

  return {
    source,
    sheetName,
    rowsRead: rows.length,
    validRows: usableRows.length,
    uniqueCecoCodes: cecoGroups.size,
    cecoRecords,
    centersToInsert,
    centersToUpdate,
    demoCentersToDeactivate,
    assignments,
    validation: {
      invalidRows,
      duplicateCecoCodes: [...cecoGroups.entries()].filter(([, group]) => group.length > 1).map(([code, group]) => ({ code, rows: group.map((row) => row.sourceRow), count: group.length, conflict: blockedCodes.has(code) })),
      cecoConflicts,
      unmatchedEmployees,
      ambiguousEmployees,
      encodingWarnings: usableRows.filter((row) => [row.employeeName, row.area, row.organizationalUnit].some((value) => value.includes("�"))).map((row) => ({ sourceRow: row.sourceRow, dni: row.dni, cecoCode: row.cecoCode }))
    }
  };
}

export async function prepareCecoImport(filePath) {
  const [{ rows, sheetName, source }, users, existingCenters] = await Promise.all([
    readCecoWorkbook(filePath),
    User.find({}).select("_id dni employeeCode name costCenter authorizedCostCenters").lean(),
    CostCenter.find({}).lean()
  ]);
  return createCecoImportPlan({ rows, users, existingCenters, source, sheetName });
}

export async function applyCecoImport(plan, importedAt = new Date()) {
  if (plan.validation.invalidRows.length) throw new Error("Apply blocked: the workbook contains rows missing required identifiers.");
  const source = plan.source || SOURCE_NAME;
  for (const center of plan.cecoRecords) {
    await CostCenter.updateOne(
      { code: center.code },
      {
        $set: {
          name: center.name,
          area: center.area,
          organizationalUnit: center.organizationalUnit,
          organizationalUnitCode: center.organizationalUnitCode,
          sourceRows: center.sourceRows,
          active: true,
          importProvenance: { source, importedAt, sourceSheet: plan.sheetName, status: "ACTIVE" }
        },
        $setOnInsert: { annualBudget: 0, committedAmount: 0, executedAmount: 0, paidAmount: 0, budgetMode: "TRANSITIONAL" }
      },
      { upsert: true, runValidators: true }
    );
  }
  if (plan.demoCentersToDeactivate.length) {
    await CostCenter.updateMany(
      { _id: { $in: plan.demoCentersToDeactivate.map((center) => center._id) } },
      { $set: { active: false, "importProvenance.source": source, "importProvenance.sourceSheet": plan.sheetName, "importProvenance.status": "INACTIVE", "importProvenance.importedAt": importedAt } }
    );
  }
  const centers = await CostCenter.find({ code: { $in: plan.assignments.map((item) => item.cecoCode) } }).select("_id code").lean();
  const centerIds = new Map(centers.map((center) => [center.code, center._id]));
  for (const assignment of plan.assignments) {
    const costCenter = centerIds.get(assignment.cecoCode);
    if (!costCenter) continue;
    await User.updateOne(
      { _id: assignment.userId },
      {
        $set: {
          dni: assignment.dni,
          costCenter,
          costCenterAssignment: { source, sourceRow: assignment.sourceRow, assignedAt: importedAt, matchedBy: assignment.matchedBy }
        }
      },
      { runValidators: true }
    );
  }
  return {
    costCentersUpserted: plan.cecoRecords.length,
    demoCentersDeactivated: plan.demoCentersToDeactivate.length,
    employeesAssigned: plan.assignments.length,
    recordsRequiringManualConfirmation: plan.validation.cecoConflicts.length + plan.validation.unmatchedEmployees.length + plan.validation.ambiguousEmployees.length
  };
}

export function cecoImportSummary(plan, mode = "DRY_RUN") {
  return {
    mode,
    source: plan.source,
    worksheet: plan.sheetName,
    rowsRead: plan.rowsRead,
    validRows: plan.validRows,
    uniqueCecoCodes: plan.uniqueCecoCodes,
    costCentersReady: plan.cecoRecords.length,
    costCentersToInsert: plan.centersToInsert.length,
    costCentersToUpdate: plan.centersToUpdate.length,
    conflictingCostCenters: plan.validation.cecoConflicts.length,
    duplicateCecoGroups: plan.validation.duplicateCecoCodes.length,
    demoCentersToDeactivate: plan.demoCentersToDeactivate.length,
    employeesReadyForAssignment: plan.assignments.length,
    unmatchedEmployees: plan.validation.unmatchedEmployees.length,
    ambiguousEmployees: plan.validation.ambiguousEmployees.length,
    invalidRows: plan.validation.invalidRows.length,
    sourceEncodingWarnings: plan.validation.encodingWarnings.length,
    highlightedManualReview: plan.validation.cecoConflicts.filter((item) => item.highlighted).map((item) => item.code)
  };
}
