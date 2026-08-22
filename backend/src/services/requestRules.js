import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { assertLineTotal } from "../utils/money.js";
import { defaultDocumentRequirements, validateDocumentRequirements } from "./documentRuleService.js";

export function hasAttachment(request, kind) {
  return request.attachments?.some((attachment) => attachment.kind === kind);
}

export function requiredDocumentsFor(request) {
  return defaultDocumentRequirements(request).map((requirement) => ({
    kind: requirement.kind,
    min: requirement.minCount,
    label: requirement.labelKey
  }));
}

export function assertMandatoryDocuments(request) {
  const requirements = defaultDocumentRequirements(request);
  const result = validateDocumentRequirements(request, requirements);
  if (!result.valid) {
    throw new AppError(
      422,
      `Mandatory attachment(s) missing: ${result.missing.map((item) => item.label).join(", ")}.`,
      { missing: result.missing, requirements },
      ERROR_CODES.MISSING_REQUIRED_DOCUMENT
    );
  }
  return result;
}

export function assertRequestLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new AppError(422, "At least one request line is required.", { field: "lines" }, ERROR_CODES.VALIDATION_ERROR);
  }
  for (const [index, line] of lines.entries()) {
    if (!line.costCenter || !line.expenseType) {
      throw new AppError(
        422,
        `Line ${index + 1} must include Cost Center and Expense Type / Accounting Account.`,
        { index, missing: [!line.costCenter ? "costCenter" : null, !line.expenseType ? "expenseType" : null].filter(Boolean) },
        ERROR_CODES.VALIDATION_ERROR
      );
    }
    assertLineTotal(line, index);
  }
}
