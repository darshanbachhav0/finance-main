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
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.csv$/.test(String(fileName || ""))) {
    throw new AppError(400, "Invalid report file name.", undefined, ERROR_CODES.VALIDATION_ERROR);
  }
  await fs.mkdir(reportsDir, { recursive: true });
  const absolutePath = path.resolve(reportsDir, fileName);
  const rootPrefix = `${path.resolve(reportsDir)}${path.sep}`;
  if (!absolutePath.startsWith(rootPrefix)) {
    throw new AppError(400, "Invalid report file name.", undefined, ERROR_CODES.VALIDATION_ERROR);
  }
  await fs.writeFile(absolutePath, content, "utf8");
  return `/generated/reports/${fileName}`;
}
import fs from "fs/promises";
import path from "path";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { generatedRoot } from "./storageService.js";

const reportsDir = path.join(generatedRoot, "reports");
