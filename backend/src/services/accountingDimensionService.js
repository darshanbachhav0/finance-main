import CostCenter from "../models/CostCenter.js";
import ExpenseType from "../models/ExpenseType.js";
import { AppError } from "../utils/AppError.js";
import {
  ERROR_CODES,
  LEGACY_EXPENSE_NATURE_MAP,
  LEGACY_REQUEST_TYPE_MAP,
  REQUEST_TYPE,
  ROLES
} from "../utils/constants.js";
import { canUseCostCenter } from "../utils/permissions.js";

function canonicalRequestType(value) {
  return LEGACY_REQUEST_TYPE_MAP[value] || value;
}

function canonicalExpenseNature(value) {
  return LEGACY_EXPENSE_NATURE_MAP[value] || value;
}

function ids(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value?._id || value)))];
}

export async function validateAccountingDimensions({ requestType, expenseNature, lines, user }) {
  const canonicalType = canonicalRequestType(requestType);
  const canonicalNature = canonicalExpenseNature(expenseNature);
  const costCenterIds = ids(lines.map((line) => line.costCenter));
  const expenseTypeIds = ids(lines.map((line) => line.expenseType));
  const [costCenters, expenseTypes] = await Promise.all([
    CostCenter.find({ _id: { $in: costCenterIds } }),
    ExpenseType.find({ _id: { $in: expenseTypeIds } })
  ]);
  const costCenterMap = new Map(costCenters.map((item) => [String(item._id), item]));
  const expenseTypeMap = new Map(expenseTypes.map((item) => [String(item._id), item]));

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const center = costCenterMap.get(String(line.costCenter?._id || line.costCenter || ""));
    const expense = expenseTypeMap.get(String(line.expenseType?._id || line.expenseType || ""));
    if (!center?.active) {
      throw new AppError(
        422,
        `Line ${lineNumber} must use an active Cost Center.`,
        { line: lineNumber, costCenter: line.costCenter },
        ERROR_CODES.INVALID_COST_CENTER_LINE
      );
    }
    if (!expense?.active) {
      throw new AppError(422, `Line ${lineNumber} must use an active expense account/type.`, { line: lineNumber }, ERROR_CODES.VALIDATION_ERROR);
    }
    if (user?.role === ROLES.SOLICITOR && !canUseCostCenter(user, center._id)) {
      throw new AppError(
        403,
        `Line ${lineNumber} uses CECO ${center.code} - ${center.name}. This Cost Center is not assigned to the current requester.`,
        { line: lineNumber, costCenter: center._id, code: center.code, name: center.name, area: center.area },
        ERROR_CODES.INVALID_COST_CENTER_LINE
      );
    }

    if (canonicalType === REQUEST_TYPE.CAPEX && (expense.category !== "CAPEX" || expense.accountingClass !== "CLASS_3")) {
      throw new AppError(422, `Line ${lineNumber} must use a configured CAPEX / Class 3 mapping.`, { line: lineNumber }, ERROR_CODES.VALIDATION_ERROR);
    }
    if (canonicalType === REQUEST_TYPE.OPEX && (expense.category !== "OPEX" || expense.accountingClass !== "CLASS_6")) {
      throw new AppError(422, `Line ${lineNumber} must use a configured OPEX / Class 6 mapping.`, { line: lineNumber }, ERROR_CODES.VALIDATION_ERROR);
    }
    if (canonicalType === REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO && (expense.category !== "NON_DEDUCTIBLE" || expense.deductible !== false)) {
      throw new AppError(422, `Line ${lineNumber} must use a configured non-deductible mapping.`, { line: lineNumber }, ERROR_CODES.VALIDATION_ERROR);
    }
    if (expense.permittedRequestTypes?.length && !expense.permittedRequestTypes.includes(canonicalType)) {
      throw new AppError(422, `Line ${lineNumber} account is not permitted for this request type.`, { line: lineNumber, requestType: canonicalType }, ERROR_CODES.VALIDATION_ERROR);
    }
    if (expense.permittedExpenseNatures?.length && !expense.permittedExpenseNatures.includes(canonicalNature)) {
      throw new AppError(422, `Line ${lineNumber} account is not permitted for this expense nature.`, { line: lineNumber, expenseNature: canonicalNature }, ERROR_CODES.VALIDATION_ERROR);
    }

    line.costCenterSnapshot = { code: center.code, name: center.name, area: center.area };
    line.expenseTypeSnapshot = {
      code: expense.code,
      name: expense.name,
      category: expense.category,
      accountingClass: expense.accountingClass,
      accountNumber: expense.accountNumber,
      deductible: expense.deductible
    };
  }
  return { costCenters, expenseTypes };
}
