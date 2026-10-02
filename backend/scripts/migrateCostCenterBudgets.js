// One-off, idempotent migration: budget is held per Cost Center, no longer per Cost Center +
// expense type ("tipo de gasto"). Dry run by default; pass --apply to write:
//   node scripts/migrateCostCenterBudgets.js [--apply]
// - Merges the BudgetAllocation rows of one period + Cost Center + project (one per former
//   expense type) into a single row, summing assigned/committed/executed/paid per month, and
//   re-points budget commitments and applied exception increases at the surviving row.
// - Drops the old { period, costCenter, expenseType, project } unique index.
// - Removes expenseType from budget rules, exceptions and commitment lines, and re-keys budget
//   exceptions to the Cost Center dimension.
// - Marks the existing request-line accounts as platform suggestions: Accounting confirms or
//   replaces them when processing the invoice.
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import BudgetAllocation, { LEGACY_DIMENSION_INDEX } from "../src/models/BudgetAllocation.js";
import { roundMoney } from "../src/utils/money.js";

const apply = process.argv.includes("--apply");
const COUNTERS = ["assignedAmount", "committedAmount", "executedAmount", "paidAmount"];
const PLAN_MODES = ["ANNUAL_ONLY", "ANNUAL_MONTHLY"];

const groupKey = (row) => [row.period, String(row.costCenter), row.project || ""].join("|");

// Mixed plans keep the least restrictive control: monthly limits only when every merged plan
// already had them.
function mergedPlanningMode(rows) {
  const modes = rows.map((row) => row.planningMode || "LEGACY");
  const plans = modes.filter((mode) => PLAN_MODES.includes(mode));
  if (!plans.length) return "LEGACY";
  return plans.every((mode) => mode === "ANNUAL_MONTHLY") && plans.length === modes.length ? "ANNUAL_MONTHLY" : "ANNUAL_ONLY";
}

export function mergeAllocations(rows) {
  const ordered = [...rows].sort((left, right) => Number(PLAN_MODES.includes(right.planningMode)) - Number(PLAN_MODES.includes(left.planningMode))
    || new Date(left.createdAt || 0) - new Date(right.createdAt || 0));
  const survivor = ordered[0];
  const planningMode = mergedPlanningMode(rows);
  const set = { planningMode, active: rows.some((row) => row.active !== false) };
  for (const counter of COUNTERS) set[counter] = roundMoney(rows.reduce((sum, row) => sum + Number(row[counter] || 0), 0));
  if (PLAN_MODES.includes(planningMode)) {
    set.months = Array.from({ length: 12 }, (_, index) => {
      const bucket = { month: index + 1 };
      for (const counter of COUNTERS) bucket[counter] = roundMoney(rows.reduce((sum, row) => sum + Number(row.months?.[index]?.[counter] || 0), 0));
      return bucket;
    });
    set.adjustments = rows.flatMap((row) => row.adjustments || []);
  }
  return { survivor, merged: ordered.slice(1), set };
}

// "costCenter|expenseType|budgetItem|project" -> "costCenter|budgetItem|project"
export function costCenterDimensionKey(key) {
  const parts = String(key || "").split("|");
  return parts.length === 4 ? [parts[0], parts[2], parts[3]].join("|") : key;
}

export async function migrateCostCenterBudgets({ apply: write = apply } = {}) {
  const db = mongoose.connection.db;
  const allocations = db.collection("budgetallocations");
  const summary = { mergedGroups: 0, removedAllocations: 0, repointedCommitments: 0, dropIndex: false, rekeyedExceptions: 0, resolvedDuplicateExceptions: 0, unsetExpenseType: {}, duplicateRules: 0, suggestedLines: 0 };

  const groups = new Map();
  for (const row of await allocations.find({}).toArray()) groups.set(groupKey(row), [...(groups.get(groupKey(row)) || []), row]);
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const { survivor, merged, set } = mergeAllocations(rows);
    const mergedIds = merged.map((row) => row._id);
    summary.mergedGroups += 1;
    summary.removedAllocations += mergedIds.length;
    summary.repointedCommitments += await db.collection("budgetcommitments").countDocuments({ "lines.allocation": { $in: mergedIds } });
    if (!write) continue;
    await allocations.updateOne({ _id: survivor._id }, { $set: set, $inc: { __v: 1 } });
    await db.collection("budgetcommitments").updateMany(
      { "lines.allocation": { $in: mergedIds } },
      { $set: { "lines.$[line].allocation": survivor._id } },
      { arrayFilters: [{ "line.allocation": { $in: mergedIds } }] }
    );
    await db.collection("budgetexceptions").updateMany({ "appliedIncrease.allocation": { $in: mergedIds } }, { $set: { "appliedIncrease.allocation": survivor._id } });
    await allocations.deleteMany({ _id: { $in: mergedIds } });
  }

  const indexes = await allocations.indexes().catch(() => []);
  if (indexes.some((index) => index.name === LEGACY_DIMENSION_INDEX)) {
    summary.dropIndex = true;
    if (write) await allocations.dropIndex(LEGACY_DIMENSION_INDEX);
  }

  // Re-key exceptions; two open exceptions of one request that now share a Cost Center keep the
  // newest open and the older one is resolved as superseded.
  const exceptions = await db.collection("budgetexceptions").find({ dimensionKey: /^[^|]*\|[^|]*\|[^|]*\|[^|]*$/ }).sort({ createdAt: -1 }).toArray();
  const openKeys = new Set((await db.collection("budgetexceptions").find({ status: "PENDING", dimensionKey: { $not: /^[^|]*\|[^|]*\|[^|]*\|[^|]*$/ } }).toArray()).map((item) => `${item.request}|${item.dimensionKey}`));
  for (const exception of exceptions) {
    const dimensionKey = costCenterDimensionKey(exception.dimensionKey);
    const openKey = `${exception.request}|${dimensionKey}`;
    const duplicate = exception.status === "PENDING" && openKeys.has(openKey);
    if (exception.status === "PENDING" && !duplicate) openKeys.add(openKey);
    summary.rekeyedExceptions += 1;
    if (duplicate) summary.resolvedDuplicateExceptions += 1;
    if (!write) continue;
    const at = new Date();
    await db.collection("budgetexceptions").updateOne({ _id: exception._id }, duplicate
      ? { $set: { dimensionKey, status: "RESOLVED", resolvedAt: at, resolutionReason: "Merged into the Cost Center budget exception when budgets stopped being split by expense type." }, $push: { history: { action: "AUTO_RESOLVED", at, comments: "Budget is now held per Cost Center." } } }
      : { $set: { dimensionKey } });
  }

  for (const [collection, field] of [["budgetallocations", "expenseType"], ["budgetrules", "expenseType"], ["budgetexceptions", "expenseType"]]) {
    summary.unsetExpenseType[collection] = await db.collection(collection).countDocuments({ [field]: { $exists: true } });
    if (write) await db.collection(collection).updateMany({ [field]: { $exists: true } }, { $unset: { [field]: "" } });
  }
  summary.unsetExpenseType.budgetcommitments = await db.collection("budgetcommitments").countDocuments({ "lines.expenseType": { $exists: true } });
  if (write) await db.collection("budgetcommitments").updateMany({ "lines.expenseType": { $exists: true } }, { $unset: { "lines.$[].expenseType": "" } });

  const rules = await db.collection("budgetrules").find({ active: true }).toArray();
  const ruleKeys = rules.map((rule) => `${rule.costCenter || "*"}|${rule.project || "*"}`);
  summary.duplicateRules = ruleKeys.length - new Set(ruleKeys).size;

  const lineFilter = { lines: { $elemMatch: { expenseType: { $exists: true, $ne: null }, accountSource: { $exists: false } } } };
  summary.suggestedLines = await db.collection("financialrequests").countDocuments(lineFilter);
  if (write) {
    await db.collection("financialrequests").updateMany(lineFilter, { $set: { "lines.$[line].accountSource": "SUGGESTED" } }, { arrayFilters: [{ "line.expenseType": { $exists: true, $ne: null }, "line.accountSource": { $exists: false } }] });
    await BudgetAllocation.createIndexes();
  }
  return summary;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  await connectDB();
  try {
    const summary = await migrateCostCenterBudgets();
    console.log(JSON.stringify({ apply, ...summary }, null, 2));
    if (summary.duplicateRules) console.log(`${summary.duplicateRules} active budget rule(s) now share a Cost Center/project; review them in Master Configuration.`);
  } finally {
    await mongoose.disconnect();
  }
}
