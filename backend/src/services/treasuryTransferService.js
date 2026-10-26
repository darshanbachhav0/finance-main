import { limaDateKey } from "../../../shared/businessCalendar.mjs";
import CostCenter from "../models/CostCenter.js";
import FinancialRequest from "../models/FinancialRequest.js";
import Reconciliation from "../models/Reconciliation.js";
import TreasuryBankAccount from "../models/TreasuryBankAccount.js";
import { createTreasuryTransferJournal } from "./accountingService.js";
import { activeApprovalStep, initializeApprovalRoute } from "./approvalRuleService.js";
import { recordAudit } from "./auditService.js";
import { applyExchangeRate } from "./exchangeRateService.js";
import { notifyApprovalStep, resolveNotification } from "./notificationService.js";
import { periodFromDate } from "./periodService.js";
import { paginatedPayload, parsePagination, withDeepLink } from "./queryService.js";
import { requestListPopulate } from "./requestService.js";
import { runFinancialOperation } from "./transactionService.js";
import { transitionRequest } from "./workflowService.js";
import { AppError } from "../utils/AppError.js";
import { moneyEquals, roundMoney, subtractMoney } from "../utils/money.js";
import {
  ERROR_CODES,
  FLOW_TYPE,
  REQUEST_PRIORITIES,
  REQUEST_STATUS,
  REQUEST_TYPE,
  ROLES,
  TREASURY_ACCOUNT_KINDS,
  TREASURY_TRANSFER_PURPOSES
} from "../utils/constants.js";

// Track D (traspaso): Treasury moves money between two of UMA's own accounts in the same
// currency - funding the account a payment run leaves from, or placing money in a deposit or
// fund. A Treasury user other than the requester (the Jefe de Tesorería) and the GAF approve it
// (approvalRuleService); there is no budget, supplier or payable. Treasury then makes the transfer
// at the bank and records it here (journal: debit destination, credit source), and reconciles it.

const TRANSFER_ROLES = [ROLES.ADMIN, ROLES.TREASURY];
const ACCOUNT_FIELDS = ["code", "bank", "currency", "accountNumber", "cci", "ledgerAccount", "kind", "description", "active"];

function invalid(message, details) {
  return new AppError(422, message, details, ERROR_CODES.VALIDATION_ERROR);
}

function assertTransferRole(user) {
  if (!TRANSFER_ROLES.includes(user?.role)) throw new AppError(403, "Only Treasury registers and executes transfers between UMA's accounts.", undefined, ERROR_CODES.FORBIDDEN);
}

export async function listTreasuryAccounts({ includeInactive = false } = {}) {
  return TreasuryBankAccount.find(includeInactive ? {} : { active: true }).sort({ currency: 1, code: 1 }).lean();
}

export async function saveTreasuryAccount({ id, body = {}, user, req }) {
  assertTransferRole(user);
  const values = Object.fromEntries(ACCOUNT_FIELDS.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]));
  if (values.kind && !TREASURY_ACCOUNT_KINDS.includes(values.kind)) throw invalid("Choose an operating or investment account.", { field: "kind" });
  const account = id ? await TreasuryBankAccount.findById(id) : new TreasuryBankAccount({ createdBy: user._id });
  if (!account) throw new AppError(404, "Bank account not found.", { id }, ERROR_CODES.NOT_FOUND);
  const before = account.isNew ? null : account.toObject();
  account.set({ ...values, updatedBy: user._id });
  try {
    await account.save();
  } catch (error) {
    if (error?.code === 11000) throw new AppError(409, "Another UMA account already uses this code.", { field: "code" }, ERROR_CODES.CONFLICT);
    if (error?.name === "ValidationError") throw invalid(Object.values(error.errors)[0]?.message || "Invalid bank account.", { fields: Object.keys(error.errors) });
    throw error;
  }
  await recordAudit({
    entityType: "TreasuryBankAccount", entity: account, action: before ? "TREASURY_ACCOUNT_UPDATED" : "TREASURY_ACCOUNT_CREATED",
    user, req, module: "TREASURY",
    oldValues: before ? Object.fromEntries(ACCOUNT_FIELDS.map((field) => [field, before[field]])) : undefined,
    newValues: Object.fromEntries(ACCOUNT_FIELDS.map((field) => [field, account[field]]))
  });
  return account;
}

function accountSnapshot(account) {
  return {
    account: account._id, code: account.code, bank: account.bank, currency: account.currency,
    accountNumber: account.accountNumber, cci: account.cci, ledgerAccount: account.ledgerAccount, kind: account.kind
  };
}

// The transfer is recorded on the chosen CECO, else the user's own, else their area's first one.
async function transferCostCenter(user, costCenterId) {
  const fields = "code name area organizationalUnit organizationalUnitCode active";
  const id = costCenterId || user.costCenter?._id || user.costCenter;
  const center = id
    ? await CostCenter.findById(id).select(fields).lean().catch(() => null)
    : await CostCenter.findOne({ active: true, area: user.area }).sort({ code: 1 }).select(fields).lean();
  if (!center && !id) throw invalid("Your user has no cost center. Ask the Admin to assign Treasury's cost center to you, or choose one.", { field: "costCenter" });
  if (!center?.active) throw invalid("Choose an active cost center for the transfer.", { field: "costCenter" });
  return center;
}

// Registers the transfer and sends it straight to approval (Jefe de Tesorería, then GAF).
export async function createTreasuryTransfer({ body = {}, user, req }) {
  assertTransferRole(user);
  const amount = roundMoney(Number(body.amount));
  if (!(amount > 0)) throw invalid("Enter the amount to transfer.", { field: "amount" });
  const purpose = body.purpose || "FUNDING";
  if (!TREASURY_TRANSFER_PURPOSES.includes(purpose)) throw invalid("Choose why the money moves: funding or a placement.", { field: "purpose" });
  const description = String(body.description || "").trim();
  if (!description) throw invalid("Describe the transfer (what it funds or which placement).", { field: "description" });
  const priority = String(body.priority || "ALTA").toUpperCase();
  if (!REQUEST_PRIORITIES.includes(priority)) throw invalid("Choose a valid priority.", { field: "priority" });
  if (!body.sourceAccount || !body.destinationAccount) throw invalid("Choose the source and the destination account.", { field: !body.sourceAccount ? "sourceAccount" : "destinationAccount" });
  if (String(body.sourceAccount) === String(body.destinationAccount)) throw invalid("The source and destination must be different accounts.", { field: "destinationAccount" });
  const [source, destination] = await Promise.all([
    TreasuryBankAccount.findById(body.sourceAccount).catch(() => null),
    TreasuryBankAccount.findById(body.destinationAccount).catch(() => null)
  ]);
  if (!source?.active) throw invalid("Choose an active UMA account to transfer from.", { field: "sourceAccount" });
  if (!destination?.active) throw invalid("Choose an active UMA account to transfer to.", { field: "destinationAccount" });
  if (source.currency !== destination.currency) throw invalid("Both accounts must be in the same currency: a transfer never converts currency.", { field: "destinationAccount", source: source.currency, destination: destination.currency });
  const center = await transferCostCenter(user, body.costCenter);
  const today = limaDateKey(new Date());

  const request = new FinancialRequest({
    requestType: REQUEST_TYPE.TRASPASO,
    flowType: FLOW_TYPE.D,
    issueDate: new Date(`${today}T12:00:00-05:00`),
    accountingPeriod: periodFromDate(today),
    requester: user._id,
    solicitor: user._id,
    requesterArea: user.area || center.area,
    requesterCostCenter: center._id,
    requesterCostCenterSnapshot: { code: center.code, name: center.name, area: center.area, organizationalUnit: center.organizationalUnit, organizationalUnitCode: center.organizationalUnitCode },
    priority,
    currency: source.currency,
    title: description.split("\n")[0].slice(0, 120),
    description,
    detailedDescription: description,
    businessJustification: String(body.justification || "").trim(),
    treasuryTransfer: {
      purpose,
      sourceAccount: accountSnapshot(source),
      destinationAccount: accountSnapshot(destination),
      instrument: String(body.instrument || "").trim() || undefined,
      reference: String(body.reference || "").trim() || undefined
    },
    lines: [{
      costCenter: center._id,
      costCenterSnapshot: { code: center.code, name: center.name, area: center.area },
      itemDescription: `${source.code} -> ${destination.code}`,
      netAmount: amount,
      igvAmount: 0,
      totalAmount: amount
    }],
    status: REQUEST_STATUS.DRAFT
  });
  await applyExchangeRate(request);
  await initializeApprovalRoute(request);
  await request.save();
  await recordAudit({ entityType: "FinancialRequest", entity: request, action: "CREATED", user, req, module: "TREASURY",
    newValues: { flowType: FLOW_TYPE.D, amount, currency: request.currency, source: source.code, destination: destination.code, purpose } });
  await transitionRequest({
    request, targetStatus: REQUEST_STATUS.PENDING_APPROVAL, user, req, action: "APPROVAL_REQUESTED",
    comments: "Transfer between UMA accounts submitted for approval.",
    nextApprovalStage: request.approvalStage, dueAt: request.approvalDueAt,
    // Treasury registers Track D; the requester controls of the other tracks do not apply.
    skipRoleCheck: true
  });
  await notifyApprovalStep(request);
  return request;
}

const TRANSFER_STAGES = Object.freeze({
  pending: [REQUEST_STATUS.PENDING_APPROVAL],
  toExecute: [REQUEST_STATUS.APPROVED],
  toReconcile: [REQUEST_STATUS.PAID],
  done: [REQUEST_STATUS.RECONCILED, REQUEST_STATUS.CLOSED],
  stopped: [REQUEST_STATUS.REJECTED, REQUEST_STATUS.VOIDED, REQUEST_STATUS.OBSERVED, REQUEST_STATUS.RETURNED]
});

export async function listTreasuryTransfers(queryParams = {}) {
  const query = { flowType: FLOW_TYPE.D };
  if (TRANSFER_STAGES[queryParams.stage]) query.status = { $in: TRANSFER_STAGES[queryParams.stage] };
  withDeepLink(query, queryParams, { request: "_id" });
  const { page, pageSize, skip } = parsePagination(queryParams);
  const [rows, total, counts] = await Promise.all([
    FinancialRequest.find(query).populate(requestListPopulate).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    FinancialRequest.countDocuments(query),
    FinancialRequest.aggregate([{ $match: { flowType: FLOW_TYPE.D } }, { $group: { _id: "$status", count: { $sum: 1 } } }])
  ]);
  const byStatus = Object.fromEntries(counts.map((row) => [row._id, row.count]));
  const summary = Object.fromEntries(Object.entries(TRANSFER_STAGES).map(([stage, statuses]) => [stage, statuses.reduce((sum, status) => sum + (byStatus[status] || 0), 0)]));
  const data = rows.map((row) => {
    for (const attachment of row.attachments || []) delete attachment.path;
    return { ...row, pendingApproval: activeApprovalStep(row)?.approvalLevel || null };
  });
  return { ...paginatedPayload(data, total, page, pageSize), summary };
}

async function loadTransfer(id) {
  const request = await FinancialRequest.findById(id).catch(() => null);
  if (!request || request.flowType !== FLOW_TYPE.D) throw new AppError(404, "Transfer not found.", { id }, ERROR_CODES.NOT_FOUND);
  return request;
}

function dateFrom(value, field) {
  const key = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw invalid("Enter a valid date.", { field });
  if (key > limaDateKey(new Date())) throw invalid("The date cannot be in the future.", { field });
  return new Date(`${key}T12:00:00-05:00`);
}

// An approver observed or returned the transfer: whoever registered it (or Admin) corrects the
// amount or description and sends it again. The route restarts at the Jefe de Tesorería.
export async function resubmitTreasuryTransfer({ id, body = {}, user, req }) {
  assertTransferRole(user);
  const request = await loadTransfer(id);
  if (![REQUEST_STATUS.OBSERVED, REQUEST_STATUS.RETURNED].includes(request.status)) {
    throw new AppError(409, "Only an observed or returned transfer can be sent again.", { status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  if (user.role !== ROLES.ADMIN && String(request.requester) !== String(user._id)) {
    throw new AppError(403, "Only whoever registered the transfer sends it again.", undefined, ERROR_CODES.FORBIDDEN);
  }
  if (body.amount !== undefined) {
    const amount = roundMoney(Number(body.amount));
    if (!(amount > 0)) throw invalid("Enter the amount to transfer.", { field: "amount" });
    request.lines[0].netAmount = amount;
    request.lines[0].igvAmount = 0;
    request.lines[0].totalAmount = amount;
    await applyExchangeRate(request);
  }
  const description = String(body.description || "").trim();
  if (description) Object.assign(request, { description, detailedDescription: description, title: description.split("\n")[0].slice(0, 120) });
  await request.validate();
  await initializeApprovalRoute(request);
  request.rejectionReason = "";
  await request.save();
  await transitionRequest({
    request, targetStatus: REQUEST_STATUS.PENDING_APPROVAL, user, req, action: "APPROVAL_REQUESTED",
    comments: String(body.comments || "").trim() || "Transfer corrected and sent again.",
    nextApprovalStage: request.approvalStage, dueAt: request.approvalDueAt, skipRoleCheck: true
  });
  await notifyApprovalStep(request);
  return request;
}

// Treasury made the transfer at the bank: record its operation number and date, post the journal
// and mark it paid. Whoever registered it may execute it once both approvals are in.
export async function executeTreasuryTransfer({ id, body = {}, user, req }) {
  assertTransferRole(user);
  const request = await loadTransfer(id);
  if (request.status !== REQUEST_STATUS.APPROVED || activeApprovalStep(request)) {
    throw new AppError(409, "Only an approved transfer can be executed.", { status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  const operationNumber = String(body.operationNumber || "").trim();
  if (!operationNumber) throw invalid("Enter the bank operation number.", { field: "operationNumber" });
  const executedAt = dateFrom(body.executedAt || limaDateKey(new Date()), "executedAt");
  const clash = await FinancialRequest.exists({ _id: { $ne: request._id }, flowType: FLOW_TYPE.D, "treasuryTransfer.operationNumber": operationNumber });
  if (clash) throw new AppError(409, "This operation number is already recorded on another transfer.", { field: "operationNumber" }, ERROR_CODES.CONFLICT);

  await runFinancialOperation(async (session) => {
    const journal = await createTreasuryTransferJournal(request, user._id, { executedAt, operationNumber, session });
    request.treasuryTransfer.executedAt = executedAt;
    request.treasuryTransfer.executedBy = user._id;
    request.treasuryTransfer.operationNumber = operationNumber;
    request.treasuryTransfer.journal = journal._id;
    request.payment = {
      ...(request.payment?.toObject?.() || {}),
      operationNumber, paidAt: executedAt, confirmedAmount: request.totalAmount,
      comments: String(body.comments || "").trim(), confirmedAt: new Date(), confirmedBy: user._id
    };
    await transitionRequest({ request, targetStatus: REQUEST_STATUS.PAID, user, req, action: "TRANSFER_EXECUTED", comments: `Transfer executed, operation ${operationNumber}.`, session });
  });
  await resolveNotification(`request:${request._id}:transfer-execute`);
  return request;
}

// The statement shows the transfer: reconcile it and close the request.
export async function reconcileTreasuryTransfer({ id, body = {}, user, req }) {
  assertTransferRole(user);
  const request = await loadTransfer(id);
  if (request.status !== REQUEST_STATUS.PAID) throw new AppError(409, "Only an executed transfer can be reconciled.", { status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  const bankReference = String(body.bankReference || request.treasuryTransfer?.operationNumber || "").trim();
  if (!bankReference) throw invalid("Enter the statement reference.", { field: "bankReference" });
  const statementAmount = roundMoney(Number(body.statementAmount ?? request.totalAmount));
  if (!(statementAmount >= 0)) throw invalid("Enter the amount on the statement.", { field: "statementAmount" });
  const difference = subtractMoney(statementAmount, request.totalAmount);
  if (!moneyEquals(difference, 0) && !String(body.comments || "").trim()) {
    throw invalid("The statement amount differs from the transfer: explain the difference.", { field: "comments", difference });
  }
  await runFinancialOperation(async (session) => {
    const [reconciliation] = await Reconciliation.create([{
      request: request._id, scope: "REQUEST", reconciledBy: user._id, reconciledAt: new Date(), bankReference,
      currency: request.currency, statementAmount, paidAmount: request.totalAmount, difference, comments: String(body.comments || "").trim()
    }], session ? { session } : undefined);
    request.reconciliation = reconciliation._id;
    await transitionRequest({ request, targetStatus: REQUEST_STATUS.RECONCILED, user, req, action: "TRANSFER_RECONCILED", comments: `Reconciled with ${bankReference}.`, session });
    await transitionRequest({ request, targetStatus: REQUEST_STATUS.CLOSED, user, req, action: "CLOSED", comments: "Transfer reconciled and closed.", session });
  });
  return request;
}
