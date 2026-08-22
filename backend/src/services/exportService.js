export function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value) => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}

export function flattenConsolidationRow(row, costCenter, expenseType) {
  return {
    period: row.period,
    costCenterCode: costCenter?.code || "",
    costCenterName: costCenter?.name || "",
    expenseAccount: row.accountNumber || expenseType?.accountNumber || "",
    expenseTypeName: expenseType?.name || "",
    currency: row.currency,
    netAmount: row.netAmount,
    igvAmount: row.igvAmount,
    totalAmount: row.totalAmount,
    penEquivalent: row.penEquivalent,
    debit: row.debit || 0,
    credit: row.credit || 0,
    requestCount: row.requestCount
  };
}

export async function persistReportFile(fileName, content) {
  await fs.mkdir(reportsDir, { recursive: true });
  await fs.writeFile(path.join(reportsDir, fileName), content, "utf8");
  return `/generated/reports/${fileName}`;
}
import fs from "fs/promises";
import path from "path";
import { generatedRoot } from "./storageService.js";

const reportsDir = path.join(generatedRoot, "reports");
