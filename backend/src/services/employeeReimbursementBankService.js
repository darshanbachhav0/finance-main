import EmployeeReimbursementBankAccount from "../models/EmployeeReimbursementBankAccount.js";
import User from "../models/User.js";
import { recordAudit } from "./auditService.js";
import { runFinancialOperation } from "./transactionService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, ROLES } from "../utils/constants.js";
import { assertValidBankAccountNumber, assertValidCci } from "../utils/bankAccountValidation.js";

const OWNER_ROLES = Object.freeze([ROLES.ADMIN, ROLES.SOLICITOR]);
const REVIEW_ROLES = Object.freeze([ROLES.ADMIN, ROLES.ACCOUNTING]);
const READ_ROLES = Object.freeze([ROLES.ADMIN, ROLES.SOLICITOR, ROLES.ACCOUNTING, ROLES.TREASURY]);
const PROTECTED_FIELDS = Object.freeze([
  "verificationStatus",
  "verifiedBy",
  "verifiedAt",
  "verificationSource",
  "verificationDocument",
  "active",
  "validFrom",
  "validTo",
  "createdBy",
  "changedBy",
  "user"
]);

function assertRole(user, roles, message) {
  if (!roles.includes(user?.role)) throw new AppError(403, message, undefined, ERROR_CODES.FORBIDDEN);
}

function assertNoProtectedFields(payload) {
  const attempted = PROTECTED_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(payload || {}, field));
  if (attempted.length) {
    throw new AppError(403, "Verification and lifecycle fields are controlled by Finance.", { fields: attempted }, ERROR_CODES.FORBIDDEN);
  }
}

function mask(value, visible = 4) {
  const normalized = String(value || "");
  if (!normalized) return "";
  return `${"*".repeat(Math.max(4, normalized.length - visible))}${normalized.slice(-visible)}`;
}

function bankPayload(account, user) {
  const value = account?.toObject ? account.toObject() : structuredClone(account);
  const owns = String(value.user?._id || value.user) === String(user?._id);
  const canReadFull = owns || [ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY].includes(user?.role);
  value.accountNumberMasked = mask(value.accountNumber);
  value.cciMasked = mask(value.cci);
  if (!canReadFull) {
    delete value.accountHolderName;
    delete value.accountNumber;
    delete value.cci;
  }
  return value;
}

function accountSelector() {
  return "+accountHolderName +accountNumber +cci";
}

function assertOwner(account, user) {
  if (user.role !== ROLES.ADMIN && String(account.user?._id || account.user) !== String(user._id)) {
    throw new AppError(403, "You can manage only your own reimbursement bank profiles.", undefined, ERROR_CODES.FORBIDDEN);
  }
}

function normalizedFacts(payload) {
  return {
    bank: String(payload.bank || "").trim().toUpperCase(),
    currency: String(payload.currency || "PEN").trim().toUpperCase(),
    accountHolderName: String(payload.accountHolderName || "").trim(),
    accountNumber: assertValidBankAccountNumber(payload.accountNumber),
    cci: assertValidCci(payload.cci, { required: true })
  };
}

export async function listEmployeeReimbursementBankAccounts({ query = {}, user }) {
  assertRole(user, READ_ROLES, "You do not have access to employee reimbursement banking.");
  const filter = {};
  if (user.role === ROLES.SOLICITOR) filter.user = user._id;
  else if (query.user) filter.user = query.user;
  if (query.active !== undefined && query.active !== "") filter.active = String(query.active) === "true";
  if (query.verificationStatus) filter.verificationStatus = query.verificationStatus;
  const accounts = await EmployeeReimbursementBankAccount.find(filter)
    .select(accountSelector())
    .populate("user", "employeeCode name email area")
    .populate("verifiedBy", "name email role")
    .sort({ active: -1, preferred: -1, createdAt: -1 });
  return accounts.map((account) => bankPayload(account, user));
}

export async function createEmployeeReimbursementBankAccount({ payload, user, req }) {
  assertRole(user, OWNER_ROLES, "Only an employee or Admin can add an employee reimbursement bank profile.");
  assertNoProtectedFields(payload);
  const ownerId = user.role === ROLES.ADMIN && payload.ownerId ? payload.ownerId : user._id;
  const owner = await User.findById(ownerId).select("name role");
  if (!owner) throw new AppError(404, "Employee was not found.", { ownerId }, ERROR_CODES.NOT_FOUND);
  const facts = normalizedFacts(payload);
  const preferred = payload.preferred === true || String(payload.preferred) === "true";
  const result = await runFinancialOperation(async (session) => {
    if (preferred) {
      await EmployeeReimbursementBankAccount.updateMany(
        { user: owner._id, active: true, preferred: true },
        { $set: { preferred: false, changedBy: user._id } },
        { session: session || undefined }
      );
    }
    const [account] = await EmployeeReimbursementBankAccount.create([{
      user: owner._id,
      ...facts,
      active: true,
      preferred,
      verificationStatus: "PENDING",
      validFrom: new Date(),
      createdBy: user._id,
      changedBy: user._id
    }], session ? { session } : undefined);
    await recordAudit({
      entityType: "EmployeeReimbursementBankAccount",
      entity: account,
      action: "EMPLOYEE_BANK_PROFILE_CREATED",
      user,
      req,
      module: "EMPLOYEE_BANKING",
      newValues: { user: owner._id, bank: facts.bank, currency: facts.currency, preferred, verificationStatus: "PENDING" },
      session
    });
    return account;
  });
  const account = await EmployeeReimbursementBankAccount.findById(result._id).select(accountSelector()).populate("user", "employeeCode name email area");
  return bankPayload(account, user);
}

export async function updateEmployeeReimbursementBankAccount({ accountId, payload, user, req }) {
  assertRole(user, OWNER_ROLES, "Only an employee or Admin can update an employee reimbursement bank profile.");
  assertNoProtectedFields(payload);
  const current = await EmployeeReimbursementBankAccount.findById(accountId).select(accountSelector());
  if (!current) throw new AppError(404, "Employee bank profile was not found.", { accountId }, ERROR_CODES.NOT_FOUND);
  assertOwner(current, user);
  if (!current.active) throw new AppError(409, "Inactive employee bank profiles cannot be edited.", undefined, ERROR_CODES.CONFLICT);
  const facts = normalizedFacts({
    bank: payload.bank ?? current.bank,
    currency: payload.currency ?? current.currency,
    accountHolderName: payload.accountHolderName ?? current.accountHolderName,
    accountNumber: payload.accountNumber ?? current.accountNumber,
    cci: payload.cci ?? current.cci
  });
  const changed = ["bank", "currency", "accountHolderName", "accountNumber", "cci"].some((field) => String(current[field] || "") !== String(facts[field] || ""));
  if (!changed) return bankPayload(current, user);

  const replacement = await runFinancialOperation(async (session) => {
    const wasPreferred = current.preferred;
    current.active = false;
    current.preferred = false;
    current.validTo = new Date();
    current.changedBy = user._id;
    await current.save({ session });
    const [next] = await EmployeeReimbursementBankAccount.create([{
      user: current.user,
      ...facts,
      active: true,
      preferred: wasPreferred,
      verificationStatus: "PENDING",
      validFrom: new Date(),
      createdBy: user._id,
      changedBy: user._id
    }], session ? { session } : undefined);
    await recordAudit({
      entityType: "EmployeeReimbursementBankAccount",
      entity: next,
      action: "EMPLOYEE_BANK_PROFILE_REPLACED",
      user,
      req,
      module: "EMPLOYEE_BANKING",
      oldValues: { profile: current._id, bank: current.bank, currency: current.currency, active: false },
      newValues: { profile: next._id, bank: next.bank, currency: next.currency, verificationStatus: next.verificationStatus },
      session
    });
    return next;
  });
  const account = await EmployeeReimbursementBankAccount.findById(replacement._id).select(accountSelector()).populate("user", "employeeCode name email area");
  return bankPayload(account, user);
}

export async function setPreferredEmployeeReimbursementBankAccount({ accountId, user, req }) {
  assertRole(user, OWNER_ROLES, "Only an employee or Admin can select a preferred reimbursement account.");
  const account = await EmployeeReimbursementBankAccount.findById(accountId).select(accountSelector());
  if (!account) throw new AppError(404, "Employee bank profile was not found.", { accountId }, ERROR_CODES.NOT_FOUND);
  assertOwner(account, user);
  if (!account.active) throw new AppError(409, "An inactive account cannot be preferred.", undefined, ERROR_CODES.CONFLICT);
  await runFinancialOperation(async (session) => {
    await EmployeeReimbursementBankAccount.updateMany(
      { user: account.user, active: true, preferred: true, _id: { $ne: account._id } },
      { $set: { preferred: false, changedBy: user._id } },
      { session: session || undefined }
    );
    account.preferred = true;
    account.changedBy = user._id;
    await account.save({ session });
    await recordAudit({ entityType: "EmployeeReimbursementBankAccount", entity: account, action: "EMPLOYEE_BANK_PREFERRED", user, req, module: "EMPLOYEE_BANKING", newValues: { preferred: true }, session });
  });
  return bankPayload(account, user);
}

export async function deactivateEmployeeReimbursementBankAccount({ accountId, user, req }) {
  assertRole(user, OWNER_ROLES, "Only an employee or Admin can deactivate an employee reimbursement account.");
  const account = await EmployeeReimbursementBankAccount.findById(accountId).select(accountSelector());
  if (!account) throw new AppError(404, "Employee bank profile was not found.", { accountId }, ERROR_CODES.NOT_FOUND);
  assertOwner(account, user);
  account.active = false;
  account.preferred = false;
  account.validTo = new Date();
  account.changedBy = user._id;
  await account.save();
  await recordAudit({ entityType: "EmployeeReimbursementBankAccount", entity: account, action: "EMPLOYEE_BANK_PROFILE_DEACTIVATED", user, req, module: "EMPLOYEE_BANKING", newValues: { active: false, preferred: false } });
  return bankPayload(account, user);
}

export async function reviewEmployeeReimbursementBankAccount({ accountId, payload, user, req }) {
  assertRole(user, REVIEW_ROLES, "Only Accounting or Admin can review employee reimbursement banking.");
  const account = await EmployeeReimbursementBankAccount.findById(accountId).select(accountSelector());
  if (!account) throw new AppError(404, "Employee bank profile was not found.", { accountId }, ERROR_CODES.NOT_FOUND);
  if (!account.active) throw new AppError(409, "Inactive accounts cannot be verified.", undefined, ERROR_CODES.CONFLICT);
  const result = String(payload.result || "").toUpperCase();
  if (!["VERIFIED", "OBSERVED", "REJECTED"].includes(result)) {
    throw new AppError(422, "Select VERIFIED, OBSERVED, or REJECTED.", { result }, ERROR_CODES.VALIDATION_ERROR);
  }
  const comments = String(payload.comments || "").trim();
  if (result !== "VERIFIED" && !comments) throw new AppError(422, "Review comments are required.", { field: "comments" }, ERROR_CODES.VALIDATION_ERROR);
  account.verificationStatus = result;
  account.verifiedBy = user._id;
  account.verifiedAt = new Date();
  account.verificationSource = "UMA_MANUAL_FINANCE_REVIEW";
  account.changedBy = user._id;
  await account.save();
  await recordAudit({
    entityType: "EmployeeReimbursementBankAccount",
    entity: account,
    action: `EMPLOYEE_BANK_${result}`,
    user,
    req,
    module: "EMPLOYEE_BANKING",
    comments,
    newValues: { verificationStatus: result, verificationSource: account.verificationSource }
  });
  return bankPayload(account, user);
}

export async function getVerifiedEmployeeReimbursementBankAccount({ userId, profileId, currency = "PEN", session } = {}) {
  const query = { user: userId, active: true, verificationStatus: "VERIFIED", currency };
  if (profileId) query._id = profileId;
  else query.preferred = true;
  return EmployeeReimbursementBankAccount.findOne(query).select(accountSelector()).session(session || null);
}

export function publicEmployeeBankPayload(account, user) {
  return bankPayload(account, user);
}
