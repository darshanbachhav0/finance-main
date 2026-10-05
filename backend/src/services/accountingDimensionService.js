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
import { actsAsRequester, canUseCostCenter } from "../utils/permissions.js";

function canonicalRequestType(value) {
  return LEGACY_REQUEST_TYPE_MAP[value] || value;
}

function canonicalExpenseNature(value) {
  return LEGACY_EXPENSE_NATURE_MAP[value] || value;
}

function ids(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value?._id || value)))];
}

// The account category each request type books to. Track C advances and other types without a
// fixed class book OPEX (Class 6) expenses.
function categoryFor(requestType) {
  if (requestType === REQUEST_TYPE.CAPEX) return { category: "CAPEX", accountingClass: "CLASS_3" };
  if (requestType === REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO) return { category: "NON_DEDUCTIBLE", accountingClass: "NON_DEDUCTIBLE" };
  return { category: "OPEX", accountingClass: "CLASS_6" };
}

function accountFits(expense, requestType) {
  const expected = categoryFor(requestType);
  if (requestType === REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO) return expense.category === "NON_DEDUCTIBLE" && expense.deductible === false;
  if ([REQUEST_TYPE.CAPEX, REQUEST_TYPE.OPEX].includes(requestType)) return expense.category === expected.category && expense.accountingClass === expected.accountingClass;
  return expense.category !== "CAPEX" || requestType === REQUEST_TYPE.CAPEX;
}

// Accounts Accounting may pick for a request of this type, best suggestion first: an account
// that names both the request type and the expense nature beats one that names only the nature,
// which beats a generic account of the right category. Lower account numbers break ties.
export function rankAccountingAccounts(accounts, { requestType, expenseNature }) {
  const canonicalType = canonicalRequestType(requestType);
  const canonicalNature = canonicalExpenseNature(expenseNature);
  const score = (expense) => {
    const types = expense.permittedRequestTypes || [];
    const natures = expense.permittedExpenseNatures || [];
    if (types.length && !types.includes(canonicalType)) return -1;
    let value = 0;
    if (natures.includes(canonicalNature)) value += 4;
    else if (natures.length) value -= 2;
    if (types.includes(canonicalType)) value += 2;
    return value;
  };
  return accounts
    .filter((expense) => expense.active !== false && accountFits(expense, canonicalType) && score(expense) >= -2)
    .map((expense) => ({ expense, score: score(expense) }))
    .sort((left, right) => right.score - left.score || String(left.expense.accountNumber).localeCompare(String(right.expense.accountNumber)))
    .map(({ expense }) => expense);
}

export async function suggestAccountingAccount({ requestType, expenseNature }) {
  const accounts = await ExpenseType.find({ active: true, category: categoryFor(canonicalRequestType(requestType)).category });
  return rankAccountingAccounts(accounts, { requestType, expenseNature })[0] || null;
}

function accountSnapshot(expense) {
  return {
    code: expense.code,
    name: expense.name,
    category: expense.category,
    accountingClass: expense.accountingClass,
    accountNumber: expense.accountNumber,
    deductible: expense.deductible
  };
}

// Validates Cost Centers and the accounting account of every line. Requesters never choose an
// account: a line without one (or with a platform suggestion that no longer fits) receives the
// suggestion for the request type and expense nature. A line Accounting assigned keeps it.
// requireAccount: Accounting is about to post, so every line must end up with an account.
export async function validateAccountingDimensions({ requestType, expenseNature, lines, user, requireAccount = false }) {
  const canonicalType = canonicalRequestType(requestType);
  const costCenterIds = ids(lines.map((line) => line.costCenter));
  const expenseTypeIds = ids(lines.map((line) => line.expenseType));
  const [costCenters, expenseTypes] = await Promise.all([
    CostCenter.find({ _id: { $in: costCenterIds } }),
    ExpenseType.find({ _id: { $in: expenseTypeIds } })
  ]);
  const costCenterMap = new Map(costCenters.map((item) => [String(item._id), item]));
  const expenseTypeMap = new Map(expenseTypes.map((item) => [String(item._id), item]));
  let suggestion;
  const suggested = async () => {
    if (suggestion === undefined) suggestion = await suggestAccountingAccount({ requestType: canonicalType, expenseNature });
    return suggestion;
  };

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const center = costCenterMap.get(String(line.costCenter?._id || line.costCenter || ""));
    if (!center?.active) {
      throw new AppError(
        422,
        `Line ${lineNumber} must use an active Cost Center.`,
        { line: lineNumber, costCenter: line.costCenter },
        ERROR_CODES.INVALID_COST_CENTER_LINE
      );
    }
    if (actsAsRequester(user) && user.role !== ROLES.ADMIN && !canUseCostCenter(user, center._id)) {
      throw new AppError(
        403,
        `Line ${lineNumber} uses CECO ${center.code} - ${center.name}. This Cost Center is not assigned to the current requester.`,
        { line: lineNumber, costCenter: center._id, code: center.code, name: center.name, area: center.area },
        ERROR_CODES.INVALID_COST_CENTER_LINE
      );
    }
    line.costCenterSnapshot = {
      code: center.code,
      name: center.name,
      area: center.area,
      organizationalUnit: center.organizationalUnit,
      organizationalUnitCode: center.organizationalUnitCode
    };

    let expense = expenseTypeMap.get(String(line.expenseType?._id || line.expenseType || ""));
    const assignedByAccounting = line.accountSource === "ACCOUNTING" && expense;
    if (assignedByAccounting) {
      if (!expense.active) throw new AppError(422, `Line ${lineNumber} must use an active accounting account.`, { line: lineNumber }, ERROR_CODES.VALIDATION_ERROR);
      if (!accountFits(expense, canonicalType) || (expense.permittedRequestTypes?.length && !expense.permittedRequestTypes.includes(canonicalType))) {
        throw new AppError(422, `Line ${lineNumber} account ${expense.accountNumber} does not fit a ${canonicalType} request.`, { line: lineNumber, requestType: canonicalType }, ERROR_CODES.VALIDATION_ERROR);
      }
    } else {
      // A platform suggestion is refreshed whenever the request type or nature changes.
      expense = await suggested();
      line.expenseType = expense || undefined;
      line.accountSource = expense ? "SUGGESTED" : undefined;
    }
    if (!expense) {
      line.expenseTypeSnapshot = undefined;
      if (requireAccount) {
        throw new AppError(422, `Select the accounting account for line ${lineNumber}; no configured account fits this request type and expense nature.`, { line: lineNumber, requestType: canonicalType }, ERROR_CODES.VALIDATION_ERROR);
      }
      continue;
    }
    line.expenseTypeSnapshot = accountSnapshot(expense);
  }
  return { costCenters, expenseTypes };
}
