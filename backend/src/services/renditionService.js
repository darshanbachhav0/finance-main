import { canonicalRequestStatus } from "../../../shared/workflowStatus.mjs";
import { assertRequestActive, assertPostingAllowed } from "./financialProgressService.js";
import FinancialRequest from "../models/FinancialRequest.js";
import AccountsPayable from "../models/AccountsPayable.js";
import CostCenter from "../models/CostCenter.js";
import EmployeeReimbursementBankAccount from "../models/EmployeeReimbursementBankAccount.js";
import { createRenditionJournal, createRenditionSettlementJournal } from "./accountingService.js";
import { validateAccountingDimensions } from "./accountingDimensionService.js";
import { clientIp, recordAudit, workflowEvent } from "./auditService.js";
import { executeDeferredBudget, assertRenditionBudgetAvailable } from "./budgetService.js";
import { assertConfiguredDocuments } from "./documentRuleService.js";
import { guardAccountingPeriod } from "./periodService.js";
import { notifyRoles, notifyUser, resolveNotification } from "./notificationService.js";
import { parseRequestLines, requestPopulate } from "./requestService.js";
import { assertRequestLines } from "./requestRules.js";
import { cleanupUploadedFiles, persistUploadedFiles } from "./storageService.js";
import { runFinancialOperation } from "./transactionService.js";
import { evaluateConfiguredMobilityLines, getEffectiveFinanceConfiguration } from "./financeConfigurationService.js";
import { getVerifiedEmployeeReimbursementBankAccount } from "./employeeReimbursementBankService.js";
import { nextRenditionNumber } from "./sequenceService.js";
import { AppError } from "../utils/AppError.js";
import { DOCUMENT_PHASE, ERROR_CODES, FINANCE_CONFIGURATION_KEYS, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../utils/constants.js";
import { canUseCostCenter, canViewRequest } from "../utils/permissions.js";
import { moneyEquals, multiplyMoney, roundMoney, subtractMoney, sumMoney, toMinorUnits } from "../utils/money.js";

const APPLICABLE_TYPES = Object.freeze([REQUEST_TYPE.ENTREGA_RENDIR, REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO]);

function renditionAttachments(files, userId) {
  return (files.rendition || []).map((file) => ({
    kind: "RENDITION", originalName: file.originalname, filename: file.filename, path: file.path,
    url: file.url, mimetype: file.mimetype, size: file.size, checksum: file.checksum, uploadedBy: userId
  }));
}

function requestOwnerId(request) {
  return request.requester?._id || request.requester || request.solicitor?._id || request.solicitor;
}

function assertOwner(request, user) {
  if (user.role !== ROLES.ADMIN && String(requestOwnerId(request)) !== String(user._id)) {
    throw new AppError(403, "Only the requester can submit this rendition.", undefined, ERROR_CODES.FORBIDDEN);
  }
}

function parseOptionalArray(value, field) {
  if (value === undefined || value === null || value === "") return [];
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); }
    catch { throw new AppError(422, `${field} must contain valid JSON.`, { field }, ERROR_CODES.VALIDATION_ERROR); }
  }
  if (!Array.isArray(parsed)) throw new AppError(422, `${field} must be an array.`, { field }, ERROR_CODES.VALIDATION_ERROR);
  return parsed;
}

const parseBoolean = (value) => value === true || String(value).toLowerCase() === "true";

function validDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseMobilityLines(value) {
  return parseOptionalArray(value, "mobilityLines").map((source, index) => {
    const date = validDate(source.date);
    if (!date) throw new AppError(422, "A valid mobility date is required.", { field: `mobilityLines.${index}.date`, line: index + 1 }, ERROR_CODES.VALIDATION_ERROR);
    const origin = String(source.origin || "").trim();
    const destination = String(source.destination || "").trim();
    const servicePurpose = String(source.servicePurpose || "").trim();
    if (!origin) throw new AppError(422, "Mobility origin is required.", { field: `mobilityLines.${index}.origin`, line: index + 1 }, ERROR_CODES.MOBILITY_ORIGIN_REQUIRED);
    if (!destination) throw new AppError(422, "Mobility destination is required.", { field: `mobilityLines.${index}.destination`, line: index + 1 }, ERROR_CODES.MOBILITY_DESTINATION_REQUIRED);
    if (!servicePurpose) throw new AppError(422, "Mobility service purpose is required.", { field: `mobilityLines.${index}.servicePurpose`, line: index + 1 }, ERROR_CODES.MOBILITY_PURPOSE_REQUIRED);
    const amount = roundMoney(source.amount);
    if (!(amount > 0)) throw new AppError(422, "Mobility amount must be greater than zero.", { field: `mobilityLines.${index}.amount`, line: index + 1 }, ERROR_CODES.VALIDATION_ERROR);
    return { date, origin, destination, servicePurpose, amount, limitExceeded: false };
  });
}

function parseUnsupportedExpenseLines(value) {
  return parseOptionalArray(value, "unsupportedExpenseLines").map((source, index) => {
    const date = validDate(source.date);
    if (!date) throw new AppError(422, "A valid unsupported-expense date is required.", { field: `unsupportedExpenseLines.${index}.date`, line: index + 1 }, ERROR_CODES.VALIDATION_ERROR);
    const description = String(source.description || "").trim();
    if (!description) throw new AppError(422, "A detailed unsupported-expense description is required.", { field: `unsupportedExpenseLines.${index}.description`, line: index + 1 }, ERROR_CODES.UNSUPPORTED_EXPENSE_DESCRIPTION_REQUIRED);
    const goodsServiceType = String(source.goodsServiceType || "").toUpperCase();
    if (!["GOODS", "SERVICES"].includes(goodsServiceType)) throw new AppError(422, "Select Goods or Services for every unsupported expense.", { field: `unsupportedExpenseLines.${index}.goodsServiceType`, line: index + 1 }, ERROR_CODES.VALIDATION_ERROR);
    const grossAmount = roundMoney(source.grossAmount);
    if (!(grossAmount > 0)) throw new AppError(422, "Gross amount must be greater than zero.", { field: `unsupportedExpenseLines.${index}.grossAmount`, line: index + 1 }, ERROR_CODES.VALIDATION_ERROR);
    return { date, description, goodsServiceType, grossAmount };
  });
}

function assertSubmissionState(request) {
  assertRequestActive(request);
  if (!APPLICABLE_TYPES.includes(request.requestType)) throw new AppError(409, "The official rendition form does not apply to this request type.", { requestType: request.requestType }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  const validStatus = request.requestType === REQUEST_TYPE.ENTREGA_RENDIR
    ? [REQUEST_STATUS.PAID, REQUEST_STATUS.RECONCILED].includes(canonicalRequestStatus(request.status))
    : request.status === REQUEST_STATUS.BUDGET_COMMITTED;
  if (!validStatus || !["PENDING", "OBSERVED", "NOT_REQUIRED"].includes(request.rendition?.status || "NOT_REQUIRED")) {
    throw new AppError(409, "This rendition cannot be submitted at its current lifecycle stage.", { requestType: request.requestType, status: request.status, renditionStatus: request.rendition?.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  if (request.rendition?.financeReview?.result === "REJECTED") throw new AppError(409, "A rejected Finance review cannot be changed through ordinary rendition editing.", undefined, ERROR_CODES.INVALID_STATUS_TRANSITION);
}

async function beneficiarySnapshot(request, user) {
  const costCenter = request.requesterCostCenter ? await CostCenter.findById(request.requesterCostCenter).select("code name") : null;
  if (!costCenter) throw new AppError(422, "The parent request Cost Center / CECO is required.", { field: "requesterCostCenter" }, ERROR_CODES.UNAUTHORIZED_COST_CENTER);
  if (user.role === ROLES.SOLICITOR && !canUseCostCenter(user, costCenter._id)) {
    throw new AppError(403, "The request CECO is not authorized for the current beneficiary.", { costCenter: costCenter._id, code: costCenter.code }, ERROR_CODES.UNAUTHORIZED_COST_CENTER);
  }
  return { user: user._id, employeeCode: user.employeeCode, name: user.name, email: user.email, area: user.area, costCenter: costCenter._id, costCenterCode: costCenter.code, costCenterName: costCenter.name };
}

async function mobilityEvaluation(lines, fallbackDate) {
  if (!lines.length) return null;
  const evaluation = await evaluateConfiguredMobilityLines(lines, lines[0].date || fallbackDate);
  if (evaluation.shouldBlock) throw new AppError(422, "Configured Finance policy blocks mobility above the daily limit.", { dailyTotals: evaluation.dailyTotals, behavior: evaluation.behavior }, ERROR_CODES.VALIDATION_ERROR);
  return evaluation;
}

async function unsupportedLimitEvaluation(lines, fallbackDate) {
  if (!lines.length) return { configured: false, exceeded: false };
  const configuration = await getEffectiveFinanceConfiguration(FINANCE_CONFIGURATION_KEYS.UNSUPPORTED_EXPENSE_LIMIT, lines[0].date || fallbackDate);
  if (!configuration) return { configured: false, exceeded: false };
  const total = sumMoney(lines.map((line) => line.grossAmount));
  const exceeded = toMinorUnits(total) > toMinorUnits(configuration.numericValue);
  if (exceeded && configuration.behavior === "BLOCK") throw new AppError(422, "Configured Finance policy blocks unsupported expenses above the management limit.", { total, configuredValue: configuration.numericValue, behavior: configuration.behavior }, ERROR_CODES.VALIDATION_ERROR);
  return { configured: true, configuration: configuration._id, configuredValue: roundMoney(configuration.numericValue), behavior: configuration.behavior, exceeded };
}

async function reimbursementBankSnapshot(request, payload) {
  if (request.requestType !== REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO) return null;
  const ownerId = requestOwnerId(request);
  const profile = await getVerifiedEmployeeReimbursementBankAccount({ userId: ownerId, profileId: payload.reimbursementBankProfile, currency: "PEN" });
  if (!profile) {
    const pending = await EmployeeReimbursementBankAccount.findOne({ user: ownerId, active: true, preferred: true, currency: "PEN" });
    if (pending) throw new AppError(422, "The preferred reimbursement account is pending Finance verification.", { verificationStatus: pending.verificationStatus }, ERROR_CODES.REIMBURSEMENT_BANK_PENDING_VERIFICATION);
    throw new AppError(422, "A verified PEN reimbursement bank account is required.", undefined, ERROR_CODES.REIMBURSEMENT_BANK_REQUIRED);
  }
  return { profile: profile._id, bank: profile.bank, currency: profile.currency, accountHolderName: profile.accountHolderName, accountNumber: profile.accountNumber, cci: profile.cci, verificationStatus: profile.verificationStatus, capturedAt: new Date() };
}

function limitSnapshot(evaluation) {
  if (!evaluation?.configured) return undefined;
  return { configuration: evaluation.configurationId, key: evaluation.key, configuredValue: evaluation.configuredValue, currency: evaluation.currency, effectiveFrom: evaluation.effectiveFrom, effectiveTo: evaluation.effectiveTo, behavior: evaluation.behavior, evaluatedAt: new Date(), exceededLineCount: evaluation.exceededLineCount };
}

export async function submitRendition({ requestId, payload, files = {}, user, req }) {
  const request = await FinancialRequest.findById(requestId).select("+attachments.path");
  if (!request) throw new AppError(404, "Financial request not found.", { requestId }, ERROR_CODES.NOT_FOUND);
  assertSubmissionState(request);
  assertOwner(request, user);
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "RENDITION", user, req, module: "RENDITION", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });

  const mobilityLines = parseMobilityLines(payload.mobilityLines);
  const unsupportedExpenseLines = parseUnsupportedExpenseLines(payload.unsupportedExpenseLines);
  if (!mobilityLines.length && !unsupportedExpenseLines.length) throw new AppError(422, "Add at least one local mobility or unsupported-expense detail line.", { fields: ["mobilityLines", "unsupportedExpenseLines"] }, ERROR_CODES.VALIDATION_ERROR);
  if (request.requestType === REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO && !unsupportedExpenseLines.length) throw new AppError(422, "Unsupported reimbursement requires at least one unsupported-expense detail line.", { field: "unsupportedExpenseLines" }, ERROR_CODES.UNSUPPORTED_EXPENSE_DESCRIPTION_REQUIRED);
  if (unsupportedExpenseLines.length && !parseBoolean(payload.confirmedExceptionalUse)) throw new AppError(422, "Confirm the exceptional unsupported-document declaration.", { field: "confirmedExceptionalUse" }, ERROR_CODES.UNSUPPORTED_EXPENSE_DECLARATION_REQUIRED);
  if (!parseBoolean(payload.beneficiaryAcknowledged)) throw new AppError(422, "Authenticated beneficiary acknowledgment is required.", { field: "beneficiaryAcknowledged" }, ERROR_CODES.BENEFICIARY_ACKNOWLEDGMENT_REQUIRED);

  let lines;
  let amountRendered;
  let amountReturned;
  let amountAdvanced;
  let balanceOutstanding;
  if (request.requestType === REQUEST_TYPE.ENTREGA_RENDIR) {
    lines = parseRequestLines(payload.lines);
    assertRequestLines(lines);
    await validateAccountingDimensions({ requestType: REQUEST_TYPE.OPEX, expenseNature: request.expenseNature, lines, user });
    amountRendered = sumMoney(lines.map((line) => line.totalAmount));
    amountReturned = roundMoney(payload.amountReturned || 0);
    if (amountReturned < 0) throw new AppError(422, "Returned amount must be zero or greater.", { amountReturned: payload.amountReturned }, ERROR_CODES.VALIDATION_ERROR);
    amountAdvanced = roundMoney(request.rendition.amountAdvanced || request.payment.confirmedAmount || request.totalAmount);
    balanceOutstanding = subtractMoney(subtractMoney(amountAdvanced, amountRendered), amountReturned);
    if (balanceOutstanding < 0) throw new AppError(422, "Rendered plus returned amounts cannot exceed the advance.", { amountAdvanced, amountRendered, amountReturned }, ERROR_CODES.VALIDATION_ERROR);
  } else {
    lines = (request.lines || []).map((line) => ({ costCenter: line.costCenter?._id || line.costCenter, expenseType: line.expenseType?._id || line.expenseType, netAmount: line.netAmount, igvAmount: line.igvAmount, totalAmount: line.totalAmount, subAccount: line.subAccount }));
    amountRendered = roundMoney(request.totalAmount);
    amountReturned = 0;
    amountAdvanced = 0;
    balanceOutstanding = 0;
  }

  const officialTotal = sumMoney([sumMoney(mobilityLines.map((line) => line.amount)), sumMoney(unsupportedExpenseLines.map((line) => line.grossAmount))]);
  if (!moneyEquals(officialTotal, amountRendered)) throw new AppError(422, "Official rendition details must equal the authoritative accounting amount.", { officialTotal, accountingRenderedAmount: amountRendered, difference: subtractMoney(officialTotal, amountRendered) }, ERROR_CODES.RENDITION_TOTAL_MISMATCH);

  const [beneficiary, mobilityResult, unsupportedResult, bankSnapshot] = await Promise.all([
    beneficiarySnapshot(request, user), mobilityEvaluation(mobilityLines, request.issueDate), unsupportedLimitEvaluation(unsupportedExpenseLines, request.issueDate), reimbursementBankSnapshot(request, payload)
  ]);
  let persisted = {};
  let requestSaved = false;
  try {
    persisted = await persistUploadedFiles(files, { domain: "requests", entityId: request._id });
    const attachments = renditionAttachments(persisted, user._id);
    await assertConfiguredDocuments(request, DOCUMENT_PHASE.RENDITION, [...(request.attachments || []), ...attachments]);
    const firstNewAttachment = request.attachments.length;
    request.attachments.push(...attachments);
    request.rendition.lines = lines.map((line) => ({ ...line, currency: request.currency, exchangeRate: request.exchangeRate, penEquivalent: multiplyMoney(line.totalAmount, request.exchangeRate) }));
    request.rendition.documentIds.push(...request.attachments.slice(firstNewAttachment).map((item) => item._id));
    request.rendition.amountAdvanced = amountAdvanced;
    request.rendition.amountRendered = amountRendered;
    request.rendition.amountReturned = amountReturned;
    request.rendition.balanceOutstanding = balanceOutstanding;
    request.rendition.mobilityLines = mobilityLines;
    request.rendition.unsupportedExpenseLines = unsupportedExpenseLines;
    request.rendition.mobilitySubtotal = sumMoney(mobilityLines.map((line) => line.amount));
    request.rendition.unsupportedExpenseSubtotal = sumMoney(unsupportedExpenseLines.map((line) => line.grossAmount));
    request.rendition.reimbursementTotal = officialTotal;
    request.rendition.detailReconciliation = { accountingRenderedAmount: amountRendered, difference: subtractMoney(officialTotal, amountRendered), status: "MATCH" };
    request.rendition.limitEvaluation = limitSnapshot(mobilityResult);
    request.rendition.mobilityLines.forEach((line, index) => { line.limitExceeded = mobilityResult?.lineResults?.[index]?.exceeded || false; });
    request.rendition.unsupportedExpenseDeclaration = unsupportedExpenseLines.length
      ? { confirmedExceptionalUse: true, comments: String(payload.exceptionalUseComments || "").trim(), declaredAt: new Date() }
      : { confirmedExceptionalUse: false, comments: "" };
    if (bankSnapshot) request.rendition.reimbursementBankSnapshot = bankSnapshot;
    request.rendition.number ||= await nextRenditionNumber(request.issueDate || new Date());
    request.rendition.beneficiarySnapshot = beneficiary;
    request.rendition.status = "SUBMITTED";
    request.rendition.financeReview = { result: "PENDING", comments: "" };
    request.rendition.submittedAt = new Date();
    request.rendition.submittedBy = user._id;
    request.rendition.comments = String(payload.comments || "").trim();
    const submissionEvent = workflowEvent({ action: "RENDITION_SUBMITTED", from: request.status, to: request.status, user, req, comments: request.rendition.comments || "Official rendition submitted for Finance review.", request });
    request.rendition.beneficiaryAcknowledgment = { type: "AUTHENTICATED_ELECTRONIC_SIGN_OFF", signer: user._id, signerName: user.name, signedAt: submissionEvent.createdAt, ip: clientIp(req), reference: submissionEvent.signature };
    request.approvalHistory.push(submissionEvent);
    await request.save();
    requestSaved = true;
    await recordAudit({ entityType: "FinancialRequest", entity: request, action: "OFFICIAL_RENDITION_SUBMITTED", user, req, module: "RENDITION", newValues: {
      renditionNumber: request.rendition.number, mobilitySubtotal: request.rendition.mobilitySubtotal, unsupportedExpenseSubtotal: request.rendition.unsupportedExpenseSubtotal,
      reimbursementTotal: officialTotal, detailReconciliation: request.rendition.detailReconciliation,
      mobilityLimit: mobilityResult?.configured ? { behavior: mobilityResult.behavior, configuredValue: mobilityResult.configuredValue, exceededLineCount: mobilityResult.exceededLineCount } : null,
      unsupportedLimit: unsupportedResult, beneficiaryAcknowledgmentReference: submissionEvent.signature, bankSnapshotCaptured: Boolean(bankSnapshot)
    } });
    await resolveNotification(`request:${request._id}:rendition`);
    await notifyRoles({ roles: [ROLES.ACCOUNTING], eventKey: `request:${request._id}:rendition-review`, type: "RENDITION_REVIEW", title: "Rendition ready for review", message: `${request.requestNumber} has submitted official rendition details.`, path: `/requests/${request._id}`, entityType: "FinancialRequest", entityId: request._id });
    await request.populate(requestPopulate);
    return request;
  } catch (error) {
    if (!requestSaved) await cleanupUploadedFiles(persisted);
    throw error;
  }
}

function assertReviewable(request) {
  const correctLifecycle = request.requestType === REQUEST_TYPE.ENTREGA_RENDIR
    ? [REQUEST_STATUS.PAID, REQUEST_STATUS.RECONCILED].includes(canonicalRequestStatus(request.status))
    : request.requestType === REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO && request.status === REQUEST_STATUS.BUDGET_COMMITTED;
  if (!correctLifecycle || request.rendition?.status !== "SUBMITTED" || request.rendition?.financeReview?.result !== "PENDING") {
    throw new AppError(409, "Only a submitted rendition pending Finance review can be reviewed.", { status: request.status, renditionStatus: request.rendition?.status, financeReview: request.rendition?.financeReview?.result }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
}

export async function reviewRendition({ requestId, action, comments, user, req }) {
  const request = await FinancialRequest.findById(requestId).select("+attachments.path");
  if (!request) throw new AppError(404, "Financial request not found.", { requestId }, ERROR_CODES.NOT_FOUND);
  assertReviewable(request);
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "RENDITION", user, req, module: "RENDITION", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  const normalizedAction = action === "VALIDATE" ? "APPROVE" : String(action || "").toUpperCase();
  if (!["APPROVE", "OBSERVE", "REJECT"].includes(normalizedAction)) throw new AppError(422, "Select APPROVE, OBSERVE, or REJECT.", { action }, ERROR_CODES.VALIDATION_ERROR);
  const reviewComments = String(comments || "").trim();
  if (["OBSERVE", "REJECT"].includes(normalizedAction) && !reviewComments) throw new AppError(422, `${normalizedAction === "OBSERVE" ? "Observation" : "Rejection"} comments are required.`, { field: "comments" }, ERROR_CODES.VALIDATION_ERROR);

  if (normalizedAction === "OBSERVE") {
    request.rendition.status = "OBSERVED";
    request.rendition.financeReview = { result: "OBSERVED", reviewer: user._id, reviewedAt: new Date(), comments: reviewComments };
    request.rendition.comments = reviewComments;
    request.approvalHistory.push(workflowEvent({ action: "RENDITION_OBSERVED", from: request.status, to: request.status, user, req, comments: reviewComments, request }));
    await request.save();
    await recordAudit({ entityType: "FinancialRequest", entity: request, action: "RENDITION_FINANCE_OBSERVED", user, req, module: "RENDITION", comments: reviewComments, newValues: { financeReview: "OBSERVED" } });
    await notifyUser({ userId: requestOwnerId(request), eventKey: `request:${request._id}:rendition-observed:${Date.now()}`, type: "RENDITION_OBSERVED", title: "Rendition observed", message: `${request.requestNumber}: ${reviewComments}`, path: `/requests/${request._id}`, entityType: "FinancialRequest", entityId: request._id });
    await request.populate(requestPopulate);
    return request;
  }
  if (normalizedAction === "REJECT") {
    request.rendition.financeReview = { result: "REJECTED", reviewer: user._id, reviewedAt: new Date(), comments: reviewComments };
    request.rendition.comments = reviewComments;
    request.approvalHistory.push(workflowEvent({ action: "RENDITION_REJECTED", from: request.status, to: request.status, user, req, comments: reviewComments, request }));
    await request.save();
    await recordAudit({ entityType: "FinancialRequest", entity: request, action: "RENDITION_FINANCE_REJECTED", user, req, module: "RENDITION", comments: reviewComments, newValues: { financeReview: "REJECTED" } });
    await notifyUser({ userId: requestOwnerId(request), eventKey: `request:${request._id}:rendition-rejected:${Date.now()}`, type: "RENDITION_REJECTED", title: "Rendition rejected", message: `${request.requestNumber}: ${reviewComments}`, path: `/requests/${request._id}`, entityType: "FinancialRequest", entityId: request._id });
    await request.populate(requestPopulate);
    return request;
  }

  if (request.rendition?.detailReconciliation?.status === "MISMATCH") throw new AppError(422, "Official detail and the authoritative accounting amount must match before Finance approval.", { reconciliation: request.rendition?.detailReconciliation }, ERROR_CODES.RENDITION_TOTAL_MISMATCH);
  const hasOfficialDetails = Boolean(request.rendition?.mobilityLines?.length || request.rendition?.unsupportedExpenseLines?.length);
  if (hasOfficialDetails && !request.rendition?.beneficiaryAcknowledgment?.reference) throw new AppError(422, "Authenticated beneficiary acknowledgment is missing.", undefined, ERROR_CODES.BENEFICIARY_ACKNOWLEDGMENT_REQUIRED);
  if (request.requestType === REQUEST_TYPE.ENTREGA_RENDIR) {
    if (!moneyEquals(request.rendition.balanceOutstanding, 0)) throw new AppError(422, "The full advance must be rendered or returned before validation.", { balanceOutstanding: request.rendition.balanceOutstanding }, ERROR_CODES.RENDITION_REQUIRED);
    await assertConfiguredDocuments(request, DOCUMENT_PHASE.RENDITION);
  } else if (!request.rendition?.reimbursementBankSnapshot?.profile || request.rendition?.reimbursementBankSnapshot?.verificationStatus !== "VERIFIED") {
    throw new AppError(422, "A verified reimbursement bank snapshot is required.", undefined, ERROR_CODES.REIMBURSEMENT_BANK_REQUIRED);
  }


  if (request.requestType === REQUEST_TYPE.ENTREGA_RENDIR) await request.populate("rendition.lines.expenseType");
  const nonDeductibleOutstanding = request.requestType === REQUEST_TYPE.ENTREGA_RENDIR
    ? roundMoney(sumMoney((request.rendition.lines || []).filter((line) => line.expenseType?.deductible === false).map((line) => line.totalAmount || 0)))
    : 0;
  const deductibleBudgetLines = request.requestType === REQUEST_TYPE.ENTREGA_RENDIR
    ? (request.rendition.lines || []).filter((line) => line.expenseType?.deductible !== false)
    : [];
  const accountsPayable = request.requestType === REQUEST_TYPE.ENTREGA_RENDIR ? await AccountsPayable.findOne({ request: request._id }) : null;

  try {
    const result = await runFinancialOperation(async (session) => {
      if (request.requestType === REQUEST_TYPE.ENTREGA_RENDIR) {
        await assertPostingAllowed(request, { user, req });
        await assertRenditionBudgetAvailable(request, user._id, deductibleBudgetLines, { session });
      }
      const journal = request.requestType === REQUEST_TYPE.ENTREGA_RENDIR ? await createRenditionJournal(request, accountsPayable, user._id, { session }) : null;
      if (request.requestType === REQUEST_TYPE.ENTREGA_RENDIR) {
        await executeDeferredBudget(request, user._id, { session, lines: deductibleBudgetLines });
        request.rendition.nonDeductibleOutstanding = nonDeductibleOutstanding;
      }
      request.rendition.status = "VALIDATED";
      request.rendition.validatedAt = new Date();
      request.rendition.validator = user._id;
      request.rendition.financeReview = { result: "APPROVED", reviewer: user._id, reviewedAt: new Date(), comments: reviewComments };
      request.rendition.comments = reviewComments || request.rendition.comments;
      request.observation = nonDeductibleOutstanding > 0 ? {
        code: "NON_DEDUCTIBLE_OUTSTANDING",
        detail: `PEN/source-currency balance ${nonDeductibleOutstanding.toFixed(2)} remains in Account 14 until reimbursement or payroll deduction.`,
        observedAt: new Date(),
        observedBy: user._id
      } : {};
      request.approvalHistory.push(workflowEvent({ action: "RENDITION_APPROVED", from: request.status, to: request.status, user, req, comments: reviewComments || (journal ? "Rendition validated and eligible actual expense recognized." : "Official reimbursement detail approved for existing Accounting processing."), request }));
      await request.save({ session });
      await recordAudit({ entityType: "FinancialRequest", entity: request, action: "RENDITION_FINANCE_APPROVED", user, req, module: "RENDITION", newValues: { financeReview: "APPROVED", journal: journal?.entryNumber, amountRendered: request.rendition.amountRendered, reimbursementTotal: request.rendition.reimbursementTotal, nonDeductibleOutstanding }, session });

      await resolveNotification(`request:${request._id}:rendition-review`);
      await request.populate(requestPopulate);
      return { request, journal };
    });
    if (nonDeductibleOutstanding > 0) {
      await notifyRoles({ roles: [ROLES.ACCOUNTING], eventKey: `request:${request._id}:non-deductible`, type: "RENDITION_NON_DEDUCTIBLE", title: "Non-deductible balance pending", message: `${request.requestNumber} keeps ${nonDeductibleOutstanding.toFixed(2)} in Account 14 pending reimbursement or payroll deduction.`, path: `/requests/${request._id}`, entityType: "FinancialRequest", entityId: request._id });
      await notifyUser({ userId: requestOwnerId(request), eventKey: `request:${request._id}:non-deductible-owner`, type: "RENDITION_NON_DEDUCTIBLE", title: "Rendition balance pending", message: `${request.requestNumber} has a non-deductible balance of ${nonDeductibleOutstanding.toFixed(2)} pending regularization.`, path: `/requests/${request._id}`, entityType: "FinancialRequest", entityId: request._id });
    }
    return result;
  } catch (error) {
    if (error.code !== ERROR_CODES.INSUFFICIENT_BUDGET || request.requestType !== REQUEST_TYPE.ENTREGA_RENDIR) throw error;
    const observed = await FinancialRequest.findById(requestId);
    if (observed && observed.status !== REQUEST_STATUS.OBSERVED_BUDGET) {
      observed.observation = { code: ERROR_CODES.INSUFFICIENT_BUDGET, detail: error.message, observedAt: new Date(), observedBy: user._id };
      await observed.save();
      await recordAudit({ entityType: "FinancialRequest", entity: observed, user, req, module: "RENDITION", action: "RENDITION_BUDGET_OBSERVED", comments: error.message });
    }
    await notifyRoles({ roles: [ROLES.BUDGET, ROLES.ADMIN], eventKey: `request:${request._id}:rendition-budget`, type: "BUDGET_EXCEPTION", title: "Rendition budget adjustment required", message: `${request.requestNumber} cannot execute its final expense budget until the budget is adjusted.`, path: "/budget", entityType: "FinancialRequest", entityId: request._id });
    throw new AppError(409, "Rendition observed due to insufficient budget. Adjust the budget and retry approval.", error.details, ERROR_CODES.INSUFFICIENT_BUDGET);
  }
}

export async function settleNonDeductibleRendition({ requestId, amount, method, reference, user, req }) {
  const request = await FinancialRequest.findById(requestId).select("+attachments.path");
  if (!request) throw new AppError(404, "Financial request not found.", { requestId }, ERROR_CODES.NOT_FOUND);
  if (request.requestType !== REQUEST_TYPE.ENTREGA_RENDIR || request.rendition?.status !== "VALIDATED") throw new AppError(409, "Only validated Track C renditions can regularize non-deductible balances.", { status: request.status, renditionStatus: request.rendition?.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  const settlementMethod = String(method || "").toUpperCase();
  if (!["REIMBURSEMENT", "PAYROLL_DEDUCTION"].includes(settlementMethod)) throw new AppError(422, "Settlement method must be REIMBURSEMENT or PAYROLL_DEDUCTION.", { method }, ERROR_CODES.VALIDATION_ERROR);
  const settlementReference = String(reference || "").trim();
  if (!settlementReference) throw new AppError(422, "A reimbursement receipt or payroll reference is required.", { field: "reference" }, ERROR_CODES.VALIDATION_ERROR);
  const settlementAmount = roundMoney(amount);
  const outstanding = roundMoney(request.rendition?.nonDeductibleOutstanding || 0);
  if (!(settlementAmount > 0) || settlementAmount > outstanding) throw new AppError(422, "Settlement amount must be greater than zero and cannot exceed the non-deductible balance.", { settlementAmount, outstanding }, ERROR_CODES.VALIDATION_ERROR);
  const accountsPayable = await AccountsPayable.findOne({ request: request._id }).sort({ createdAt: 1 });
  if (!accountsPayable) throw new AppError(404, "Advance Accounts Payable record not found.", { requestId }, ERROR_CODES.NOT_FOUND);

  const result = await runFinancialOperation(async (session) => {
    const journal = await createRenditionSettlementJournal(request, accountsPayable, { amount: settlementAmount, method: settlementMethod, reference: settlementReference }, user._id, { session });
    request.rendition.nonDeductibleOutstanding = roundMoney(outstanding - settlementAmount);
    request.rendition.nonDeductibleSettlements ||= [];
    request.rendition.nonDeductibleSettlements.push({ method: settlementMethod, amount: settlementAmount, reference: settlementReference, settledAt: new Date(), settledBy: user._id, journal: journal._id });
    if (request.rendition.nonDeductibleOutstanding <= 0) {
      request.observation = {};
    }
    await request.save({ session });
    await recordAudit({ entityType: "FinancialRequest", entity: request, action: "RENDITION_NON_DEDUCTIBLE_SETTLED", user, req, module: "RENDITION", newValues: { method: settlementMethod, amount: settlementAmount, reference: settlementReference, remaining: request.rendition.nonDeductibleOutstanding, journal: journal.entryNumber }, session });
    await request.populate(requestPopulate);
    return { request, journal };
  });
  await resolveNotification(`request:${request._id}:non-deductible`);
  await notifyUser({ userId: requestOwnerId(request), eventKey: `request:${request._id}:non-deductible-settled:${Date.now()}`, type: "RENDITION_SETTLEMENT", title: "Rendition balance updated", message: `${request.requestNumber}: ${settlementAmount.toFixed(2)} regularized; ${result.request.rendition.nonDeductibleOutstanding.toFixed(2)} remains.`, path: `/requests/${request._id}`, entityType: "FinancialRequest", entityId: request._id });
  return result;
}

function configurationPayload(configuration) {
  if (!configuration) return null;
  return { _id: configuration._id, key: configuration.key, numericValue: configuration.numericValue, currency: configuration.currency, behavior: configuration.behavior, effectiveFrom: configuration.effectiveFrom, effectiveTo: configuration.effectiveTo, description: configuration.description };
}

export async function getRenditionPolicy({ requestId, date, user }) {
  const request = await FinancialRequest.findById(requestId);
  if (!request) throw new AppError(404, "Financial request not found.", { requestId }, ERROR_CODES.NOT_FOUND);
  if (!canViewRequest(request, user)) throw new AppError(403, "You do not have permission to view this request.", undefined, ERROR_CODES.FORBIDDEN);
  const effectiveDate = date || request.issueDate || new Date();
  const [mobility, unsupported] = await Promise.all([
    getEffectiveFinanceConfiguration(FINANCE_CONFIGURATION_KEYS.LOCAL_MOBILITY_DAILY_LIMIT, effectiveDate),
    getEffectiveFinanceConfiguration(FINANCE_CONFIGURATION_KEYS.UNSUPPORTED_EXPENSE_LIMIT, effectiveDate)
  ]);
  return { applicable: APPLICABLE_TYPES.includes(request.requestType), requestType: request.requestType, requiresReimbursementBank: request.requestType === REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO, mobility: configurationPayload(mobility), unsupportedExpense: configurationPayload(unsupported) };
}

function mask(value) {
  const normalized = String(value || "");
  return normalized ? `${"*".repeat(Math.max(4, normalized.length - 4))}${normalized.slice(-4)}` : "";
}

export async function getRenditionBankDestination({ requestId, user }) {
  const request = await FinancialRequest.findById(requestId).select("+rendition.reimbursementBankSnapshot.accountHolderName +rendition.reimbursementBankSnapshot.accountNumber +rendition.reimbursementBankSnapshot.cci");
  if (!request) throw new AppError(404, "Financial request not found.", { requestId }, ERROR_CODES.NOT_FOUND);
  if (!canViewRequest(request, user)) throw new AppError(403, "You do not have permission to view this request.", undefined, ERROR_CODES.FORBIDDEN);
  const owner = String(requestOwnerId(request)) === String(user._id);
  if (!owner && ![ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY].includes(user.role)) throw new AppError(403, "Employee reimbursement banking is restricted.", undefined, ERROR_CODES.FORBIDDEN);
  const snapshot = request.rendition?.reimbursementBankSnapshot;
  if (!snapshot?.profile) return null;
  const full = [ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY].includes(user.role);
  return { profile: snapshot.profile, bank: snapshot.bank, currency: snapshot.currency, verificationStatus: snapshot.verificationStatus, capturedAt: snapshot.capturedAt, accountHolderName: full ? snapshot.accountHolderName : undefined, accountNumber: full ? snapshot.accountNumber : undefined, cci: full ? snapshot.cci : undefined, accountNumberMasked: mask(snapshot.accountNumber), cciMasked: mask(snapshot.cci) };
}
