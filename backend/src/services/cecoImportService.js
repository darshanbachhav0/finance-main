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

// A CeCo number the source gives several area names: the most frequent one names the CeCo (the
// earliest row breaks a tie). Each person still keeps their own row's AREA.
function prevailingVariant(group) {
  const counts = group.reduce((map, row) => map.set(metadataKey(row), (map.get(metadataKey(row)) || 0) + 1), new Map());
  return [...group].sort((a, b) => counts.get(metadataKey(b)) - counts.get(metadataKey(a)) || a.sourceRow - b.sourceRow)[0];
}

const idOf = (value) => String(value?._id || value || "");

export function createCecoImportPlan({ rows, users = [], existingCenters = [], source = SOURCE_NAME, sheetName = "Hoja1" }) {
  const usableRows = rows.filter((row) => row.cecoCode && row.dni && row.employeeName && row.area);
  const invalidRows = rows.filter((row) => !row.cecoCode || !row.dni || !row.employeeName || !row.area).map((row) => ({ ...row, reason: "Required CeCo, DNI, employee name or area is missing." }));
  const cecoGroups = Map.groupBy ? Map.groupBy(usableRows, (row) => row.cecoCode) : usableRows.reduce((map, row) => map.set(row.cecoCode, [...(map.get(row.cecoCode) || []), row]), new Map());
  const cecoConflicts = [];
  const cecoRecords = [];

  // Product decision: a CeCo whose rows disagree is still imported (named by its most frequent
  // area) and every person on it is assigned; the disagreement is reported for review, not blocked.
  for (const [code, group] of cecoGroups) {
    const variants = uniqueBy(group, metadataKey);
    const rectoradoIssue = group.some(isQuestionableRectorado);
    const row = prevailingVariant(group);
    if (variants.length > 1 || rectoradoIssue) {
      cecoConflicts.push({
        code,
        highlighted: HIGHLIGHTED_CODES.has(code),
        reason: rectoradoIssue ? "RECTORADO is mapped to a different organizational-unit code in the source." : "The same CeCo has conflicting area or organizational-unit values.",
        appliedName: row.area,
        rows: group.map((item) => item.sourceRow),
        variants: variants.map((item) => ({ area: item.area, organizationalUnit: item.organizationalUnit, organizationalUnitCode: item.organizationalUnitCode, rows: group.filter((other) => metadataKey(other) === metadataKey(item)).map((other) => other.sourceRow) }))
      });
    }
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

  const dniGroups = usableRows.reduce((map, row) => map.set(row.dni, [...(map.get(row.dni) || []), row]), new Map());
  const assignments = [];
  const unmatchedEmployees = [];
  const ambiguousEmployees = [];
  const nameDifferences = [];

  for (const [dni, group] of dniGroups) {
    const cecoCodes = [...new Set(group.map((row) => row.cecoCode))];
    const sourceNames = [...new Set(group.map((row) => normalizedName(row.employeeName)))];
    if (cecoCodes.length !== 1 || sourceNames.length !== 1) {
      ambiguousEmployees.push({ dni, employeeName: group[0].employeeName, cecoCodes, sourceRows: group.map((row) => row.sourceRow), reason: "DNI has conflicting source rows." });
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
    // The DNI identifies the person; a differently written name is reported, not blocking.
    if (normalizedName(user.name) !== sourceNames[0]) nameDifferences.push({ dni, employeeName: group[0].employeeName, existingUserName: user.name, sourceRow: group[0].sourceRow });
    assignments.push({ userId: user._id, dni, cecoCode: cecoCodes[0], area: group[0].area, sourceRow: group[0].sourceRow, matchedBy: normalizeDni(user.dni) === dni ? "DNI" : "EMPLOYEE_CODE" });
  }

  // Product decision: the workbook is the whole CeCo master. Every active CeCo missing from it is
  // deactivated - never deleted, so requests, budgets and entries that reference it stay intact.
  const sourceCodes = new Set(cecoGroups.keys());
  const centersToDeactivate = existingCenters.filter((center) => center.active !== false && !sourceCodes.has(center.code)).map((center) => ({ _id: center._id, code: center.code, name: center.name }));
  // People outside the workbook who still point at a CeCo being deactivated need a manual decision.
  const deactivatedIds = new Set(centersToDeactivate.map((center) => idOf(center._id)));
  const assignedUsers = new Set(assignments.map((item) => idOf(item.userId)));
  const usersOnDeactivatedCenters = users
    .filter((user) => !assignedUsers.has(idOf(user._id)) && [user.costCenter, ...(user.authorizedCostCenters || [])].some((center) => deactivatedIds.has(idOf(center))))
    .map((user) => ({ userId: user._id, dni: user.dni || "", name: user.name, costCenters: centersToDeactivate.filter((center) => [user.costCenter, ...(user.authorizedCostCenters || [])].some((value) => idOf(value) === idOf(center._id))).map((center) => center.code) }));
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
    centersToDeactivate,
    assignments,
    validation: {
      invalidRows,
      duplicateCecoCodes: [...cecoGroups.entries()].filter(([, group]) => group.length > 1).map(([code, group]) => ({ code, rows: group.map((row) => row.sourceRow), count: group.length, conflict: cecoConflicts.some((item) => item.code === code) })),
      cecoConflicts,
      unmatchedEmployees,
      ambiguousEmployees,
      nameDifferences,
      usersOnDeactivatedCenters,
      encodingWarnings: usableRows.filter((row) => [row.employeeName, row.area, row.organizationalUnit].some((value) => value.includes("�"))).map((row) => ({ sourceRow: row.sourceRow, dni: row.dni, cecoCode: row.cecoCode }))
    }
  };
}

export async function prepareCecoImport(filePath) {
  const [{ rows, sheetName, source }, users, existingCenters] = await Promise.all([
    readCecoWorkbook(filePath),
    User.find({}).select("_id dni employeeCode name area costCenter authorizedCostCenters").lean(),
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
  if (plan.centersToDeactivate.length) {
    await CostCenter.updateMany(
      { _id: { $in: plan.centersToDeactivate.map((center) => center._id) } },
      { $set: { active: false, "importProvenance.source": source, "importProvenance.sourceSheet": plan.sheetName, "importProvenance.status": "INACTIVE", "importProvenance.importedAt": importedAt } }
    );
  }
  const centers = await CostCenter.find({ code: { $in: plan.assignments.map((item) => item.cecoCode) } }).select("_id code").lean();
  const centerIds = new Map(centers.map((center) => [center.code, center._id]));
  // Product decision: each person gets the workbook's CeCo as their default and only CeCo, and
  // their own row's AREA. The stored DNI (the login identifier) is matched, never rewritten.
  for (const assignment of plan.assignments) {
    const costCenter = centerIds.get(assignment.cecoCode);
    if (!costCenter) continue;
    await User.updateOne(
      { _id: assignment.userId },
      {
        $set: {
          costCenter,
          area: assignment.area,
          authorizedCostCenters: [],
          costCenterAssignment: { source, sourceRow: assignment.sourceRow, assignedAt: importedAt, matchedBy: assignment.matchedBy }
        }
      },
      { runValidators: true }
    );
  }
  return {
    costCentersUpserted: plan.cecoRecords.length,
    costCentersDeactivated: plan.centersToDeactivate.length,
    employeesAssigned: plan.assignments.length,
    recordsRequiringManualConfirmation: plan.validation.unmatchedEmployees.length + plan.validation.ambiguousEmployees.length + plan.validation.usersOnDeactivatedCenters.length
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
    costCentersWithSeveralAreas: plan.validation.cecoConflicts.length,
    duplicateCecoGroups: plan.validation.duplicateCecoCodes.length,
    costCentersToDeactivate: plan.centersToDeactivate.length,
    employeesReadyForAssignment: plan.assignments.length,
    unmatchedEmployees: plan.validation.unmatchedEmployees.length,
    ambiguousEmployees: plan.validation.ambiguousEmployees.length,
    employeeNameDifferences: plan.validation.nameDifferences.length,
    usersOnDeactivatedCostCenters: plan.validation.usersOnDeactivatedCenters.length,
    invalidRows: plan.validation.invalidRows.length,
    sourceEncodingWarnings: plan.validation.encodingWarnings.length,
    highlightedManualReview: plan.validation.cecoConflicts.filter((item) => item.highlighted).map((item) => item.code)
  };
}
