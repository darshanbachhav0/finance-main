import fs from "node:fs/promises";
import CostCenter from "../models/CostCenter.js";
import { COST_CENTER_LINES } from "../utils/constants.js";

// Loads the Motor de Ingresos cascade (data/ceco-cascade.json: code, name, level, parentCode, line)
// onto the cost centers that already exist, matched by code. It never renames or deactivates a cost
// center and never touches budgets or responsibles: those stay the Admin's. With createMissing, the
// CECOs of the cascade that do not exist yet are added (named and with their area as in the file).

export async function readCascadeFile(filePath) {
  const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  const rows = Array.isArray(parsed) ? parsed : parsed.costCenters;
  if (!Array.isArray(rows)) throw new Error("The cascade file must list costCenters.");
  return rows.map((row) => ({
    code: String(row.code || "").trim(),
    name: String(row.name || "").trim(),
    level: Number(row.level) || undefined,
    parentCode: row.parentCode ? String(row.parentCode).trim() : null,
    line: COST_CENTER_LINES.includes(row.line) ? row.line : undefined
  })).filter((row) => row.code);
}

export async function planCascadeImport(rows) {
  const existing = await CostCenter.find({ code: { $in: rows.map((row) => row.code) } }).select("code name parentCode level line").lean();
  const byCode = new Map(existing.map((center) => [center.code, center]));
  const updates = [];
  const missing = [];
  for (const row of rows) {
    const center = byCode.get(row.code);
    if (!center) { missing.push({ code: row.code, name: row.name }); continue; }
    const changes = {};
    for (const field of ["parentCode", "level", "line"]) {
      if (row[field] !== undefined && (center[field] ?? null) !== (row[field] ?? null)) changes[field] = row[field];
    }
    if (Object.keys(changes).length) updates.push({ code: row.code, name: center.name, changes });
  }
  const parentsMissing = rows.filter((row) => row.parentCode && !rows.some((other) => other.code === row.parentCode)).map((row) => row.code);
  return { total: rows.length, matched: rows.length - missing.length, updates, missing, parentsMissing };
}

export async function applyCascadeImport(plan, rows = [], { createMissing = false } = {}) {
  for (const update of plan.updates) await CostCenter.updateOne({ code: update.code }, { $set: update.changes });
  let created = 0;
  if (createMissing) {
    for (const missing of plan.missing) {
      const row = rows.find((item) => item.code === missing.code);
      if (!row?.name) continue;
      await CostCenter.create({ code: row.code, name: row.name, area: row.name, parentCode: row.parentCode, level: row.level, line: row.line,
        importProvenance: { source: "ceco-cascade.json", importedAt: new Date(), status: "ACTIVE" } });
      created += 1;
    }
  }
  return { updated: plan.updates.length, created };
}
