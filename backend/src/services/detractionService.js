// SPOT (detracciones) support for Treasury. UMA is NOT an IGV withholding agent, so no IGV
// retention is ever computed here; the only deduction is the detraccion deposit, owed when the
// purchased good or service belongs to a SPOT category (R.S. 183-2004/SUNAT and its annexes)
// and the operation exceeds the category's minimum amount.
import SpotCategory from "../models/SpotCategory.js";
import Supplier from "../models/Supplier.js";
import SupplierBankAccount from "../models/SupplierBankAccount.js";
import AccountsPayable from "../models/AccountsPayable.js";
import FinancialRequest from "../models/FinancialRequest.js";
import { notificationText, notifyRoles, resolveNotification } from "./notificationService.js";
import { recordAudit } from "./auditService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, FLOW_TYPE, LEGACY_EXPENSE_NATURE_MAP, REQUEST_TYPE, ROLES } from "../utils/constants.js";
import { multiplyMoney, roundMoney } from "../utils/money.js";
import { SPOT_DEFAULT_CATEGORIES, SPOT_DEFAULT_EFFECTIVE_FROM, detractionAmountPen, suggestedSpotCategoryCode } from "../../../shared/spotCategories.mjs";

const NON_SPOT_REQUEST_TYPES = new Set([REQUEST_TYPE.ENTREGA_RENDIR, REQUEST_TYPE.REEMBOLSO_CON_SUSTENTO, REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO]);
// Receipts for independent work (4th category), advances and internal receipts are outside SPOT.
const NON_SPOT_VOUCHER_TYPES = new Set(["ANTICIPO", "RECIBO", "RECIBO_HONORARIOS", "RHE", "RECIBO_POR_HONORARIOS"]);
const SPOT_ADMIN_ROLES = [ROLES.ACCOUNTING];

export async function ensureSpotCategories({ session } = {}) {
  if (await SpotCategory.countDocuments().session(session || null)) return;
  const effectiveFrom = new Date(`${SPOT_DEFAULT_EFFECTIVE_FROM}T00:00:00.000Z`);
  await SpotCategory.bulkWrite(SPOT_DEFAULT_CATEGORIES.map((item) => ({
    updateOne: {
      filter: { code: item.code, effectiveFrom },
      update: { $setOnInsert: { ...item, effectiveFrom, effectiveTo: null, active: true, sourceReference: "R.S. 183-2004/SUNAT (anexos 1-3), mod. R.S. 071-2018/SUNAT" } },
      upsert: true
    }
  })), session ? { session } : undefined);
}

export async function findSpotCategory(code, at = new Date(), { session } = {}) {
  if (!code) return null;
  await ensureSpotCategories({ session });
  const date = new Date(at);
  return SpotCategory.findOne({
    code,
    active: true,
    effectiveFrom: { $lte: date },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: date } }]
  }).sort({ effectiveFrom: -1 }).session(session || null).lean();
}

export async function listSpotCategories({ at, includeHistory = false } = {}) {
  await ensureSpotCategories();
  const query = includeHistory ? {} : { active: true, $or: [{ effectiveTo: null }, { effectiveTo: { $gte: at ? new Date(at) : new Date() } }] };
  if (!includeHistory) query.effectiveFrom = { $lte: at ? new Date(at) : new Date() };
  return SpotCategory.find(query).sort({ code: 1, effectiveFrom: -1 }).lean();
}

// A rate change never overwrites history: the current row is closed the day before the new one.
export async function updateSpotCategory({ code, payload = {}, user, req }) {
  if (!SPOT_ADMIN_ROLES.includes(user?.role)) throw new AppError(403, "Only Accounting can maintain the SPOT table.", undefined, ERROR_CODES.FORBIDDEN);
  await ensureSpotCategories();
  const effectiveFrom = new Date(payload.effectiveFrom || Date.now());
  if (Number.isNaN(effectiveFrom.getTime())) throw new AppError(422, "A valid effective-from date is required.", { field: "effectiveFrom" }, ERROR_CODES.VALIDATION_ERROR);
  const current = await findSpotCategory(code, effectiveFrom);
  const rate = payload.rate !== undefined ? Number(payload.rate) : current?.rate;
  const minimumAmount = payload.minimumAmount !== undefined ? Number(payload.minimumAmount) : current?.minimumAmount ?? 700;
  const description = String(payload.description || current?.description || "").trim();
  if (!/^\d{3}$/.test(String(code || ""))) throw new AppError(422, "A three-digit SPOT code is required.", { field: "code" }, ERROR_CODES.VALIDATION_ERROR);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new AppError(422, "A rate between 0 and 100 is required.", { field: "rate" }, ERROR_CODES.VALIDATION_ERROR);
  if (!Number.isFinite(minimumAmount) || minimumAmount < 0) throw new AppError(422, "A non-negative minimum amount is required.", { field: "minimumAmount" }, ERROR_CODES.VALIDATION_ERROR);
  if (!description) throw new AppError(422, "A description is required.", { field: "description" }, ERROR_CODES.VALIDATION_ERROR);
  if (current && current.effectiveFrom.getTime() >= effectiveFrom.getTime()) {
    throw new AppError(409, "The new rate must start after the current row's effective date.", { currentEffectiveFrom: current.effectiveFrom }, ERROR_CODES.CONFLICT);
  }
  if (current) await SpotCategory.updateOne({ _id: current._id }, { $set: { effectiveTo: new Date(effectiveFrom.getTime() - 1), updatedBy: user._id } });
  const created = await SpotCategory.create({
    code, annex: payload.annex ?? current?.annex ?? "", description, rate, minimumAmount, effectiveFrom, effectiveTo: null,
    active: payload.active === undefined ? true : Boolean(payload.active),
    sourceReference: String(payload.sourceReference || current?.sourceReference || "R.S. 183-2004/SUNAT").trim(), updatedBy: user._id
  });
  await recordAudit({ entityType: "SpotCategory", entity: created, action: "SPOT_CATEGORY_UPDATED", user, req, module: "ACCOUNTING",
    oldValues: current ? { rate: current.rate, minimumAmount: current.minimumAmount, effectiveFrom: current.effectiveFrom } : undefined,
    newValues: { code, rate, minimumAmount, effectiveFrom } });
  return created;
}

export function pendingDetractionAmount(accountsPayable) {
  return accountsPayable?.detraction?.status === "PENDING" ? roundMoney(accountsPayable.detraction.amount || 0) : 0;
}

// The SPOT category of an invoice: the one Accounting confirmed when processing it (an empty
// confirmed code means "not subject to SPOT"), otherwise the suggestion for the request's
// expense nature.
export function spotCategoryCodeFor({ request, accountsPayable }) {
  const treatment = accountsPayable?.accountingTreatment;
  if (treatment?.spotConfirmed) return treatment.spotCategoryCode || "";
  if (request?.fiscalData?.spotConfirmed) return request.fiscalData.spotCategoryCode || "";
  return suggestedSpotCategoryCode(LEGACY_EXPENSE_NATURE_MAP[request?.expenseNature] || request?.expenseNature);
}

// Works out whether a CXP is subject to SPOT, from the category above.
export async function determineDetraction({ request, accountsPayable, session }) {
  const notApplicable = { status: "NOT_APPLICABLE", determinedAt: new Date() };
  if (!accountsPayable?.supplier || accountsPayable.flowType === FLOW_TYPE.C || NON_SPOT_REQUEST_TYPES.has(request?.requestType)) return notApplicable;
  if (NON_SPOT_VOUCHER_TYPES.has(String(accountsPayable.voucher?.voucherType || "").toUpperCase())) return notApplicable;
  const code = spotCategoryCodeFor({ request, accountsPayable });
  if (!code) return notApplicable;
  const at = accountsPayable.voucher?.documentDate || request.issueDate || new Date();
  const category = await findSpotCategory(code, at, { session });
  if (!category) throw new AppError(422, "No effective SPOT category is configured for this invoice date.", { code, at }, ERROR_CODES.VALIDATION_ERROR);
  const exchangeRate = Number(accountsPayable.exchangeRate || 1);
  const baseAmountPen = roundMoney(accountsPayable.penEquivalent ?? multiplyMoney(accountsPayable.originalAmount, exchangeRate));
  const shared = {
    categoryCode: category.code, categoryDescription: category.description, rate: category.rate,
    minimumAmount: category.minimumAmount, baseAmountPen, categoryEffectiveFrom: category.effectiveFrom, determinedAt: new Date()
  };
  // SPOT applies to operations EXCEEDING the threshold.
  if (baseAmountPen <= category.minimumAmount) return { ...shared, status: "NOT_APPLICABLE", amount: 0, amountPen: 0 };
  const amountPen = detractionAmountPen(baseAmountPen, category.rate);
  const amount = accountsPayable.currency === "PEN" ? amountPen : roundMoney(amountPen / exchangeRate);
  return { ...shared, status: amountPen > 0 ? "PENDING" : "NOT_APPLICABLE", amount, amountPen };
}

// Sets accountsPayable.detraction the first time Treasury handles the CXP (in memory only; the
// caller persists it with its own save). Already-determined CXPs keep their frozen result.
export async function ensureDetraction({ request, accountsPayable, session }) {
  if (accountsPayable.detraction?.status && accountsPayable.detraction.confirmedAt) return accountsPayable.detraction;
  // Employee advances and internal reimbursements retain their existing exempt treatment.
  const exempt = !accountsPayable.supplier || accountsPayable.flowType === FLOW_TYPE.C || NON_SPOT_REQUEST_TYPES.has(request?.requestType) || NON_SPOT_VOUCHER_TYPES.has(String(accountsPayable.voucher?.voucherType || "").toUpperCase());
  if (!exempt) throw new AppError(422, "Accounting must confirm the invoice's SPOT treatment and net payable before Treasury prepares payment.", { accountsPayable: accountsPayable._id }, "ACCOUNTING_DETRACTION_REQUIRED");
  accountsPayable.detraction = { status: "NOT_APPLICABLE", determinedAt: new Date() };
  return accountsPayable.detraction;
}

export async function prepareAccountingDetraction({ request, accountsPayable, user, session }) {
  if (!SPOT_ADMIN_ROLES.includes(user?.role)) return;
  if (accountsPayable.detraction?.confirmedAt) return;
  if (!accountsPayable.accountingTreatment?.spotConfirmed) return;
  const calculated = await determineDetraction({ request, accountsPayable, session });
  const account = calculated.status === "PENDING" ? await resolveSupplierDetractionAccount(accountsPayable.supplier, { session }) : "";
  if (calculated.status === "PENDING" && !account) return; // existing CXP screen completes preparation
  accountsPayable.detraction = { ...calculated, beneficiaryAccountNumber: account,
    confirmedBy: user?._id || user, confirmedAt: new Date() };
  await recordAudit({ entityType: "AccountsPayable", entity: accountsPayable, requestId: request._id,
    action: "DETRACTION_CONFIRMED", module: "ACCOUNTING", user, session,
    newValues: { ...calculated, accountLast4: account.slice(-4), confirmedBy: user?._id || user } });
}

export async function previewAccountingDetraction({ id, categoryCode }) {
  const payable = await AccountsPayable.findById(id);
  if (!payable) throw new AppError(404, "Accounts Payable record not found.");
  const request = await FinancialRequest.findById(payable.request);
  if (categoryCode !== undefined) {
    if (!/^(\d{3})?$/.test(String(categoryCode))) throw new AppError(422, "Select a configured SPOT category.");
    payable.accountingTreatment = { ...payable.accountingTreatment?.toObject?.(), spotConfirmed: true, spotCategoryCode: String(categoryCode) };
  }
  const calculation = await determineDetraction({ request, accountsPayable: payable });
  if (payable.status === "PARTIALLY_PAID" && payable.detraction?.status === "DEPOSITED") {
    if (categoryCode !== payable.detraction.categoryCode) throw new AppError(409, "The deposited detraction and its original category must be preserved.");
    return { calculation: payable.detraction.toObject(), netAmount: payable.outstandingAmount, bankAccountRegistered: true,
      bankAccountLast4: String(payable.detraction.beneficiaryAccountNumber || "").slice(-4), suggestionOnly: true };
  }
  const account = await resolveSupplierDetractionAccount(payable.supplier);
  return { calculation, netAmount: roundMoney(Number(payable.outstandingAmount) - (calculation.status === "PENDING" ? calculation.amount : 0)),
    bankAccountRegistered: Boolean(account), bankAccountLast4: account.slice(-4), suggestionOnly: true };
}

export async function confirmAccountingDetraction({ id, categoryCode, user, req }) {
  if (!SPOT_ADMIN_ROLES.includes(user?.role)) throw new AppError(403, "Only Accounting can confirm SPOT treatment.");
  if (categoryCode === undefined) throw new AppError(422, "Confirm the SPOT category or explicitly select not subject to SPOT.");
  const claims = AccountsPayable.db.collection("bbvapaymentgenerationclaims");
  const payable = await AccountsPayable.findById(id);
  if (!payable) throw new AppError(404, "Accounts Payable record not found.");
  try { await claims.insertOne({ _id: payable._id, accountingReview: true, claimedAt: new Date() }); }
  catch (error) { if (error.code === 11000) throw new AppError(409, "This CXP is being prepared for payment. Refresh before changing its treatment."); throw error; }
  try {
    const current = await AccountsPayable.findById(id);
    const legacyPartial = current.status === "PARTIALLY_PAID" && !current.detraction?.confirmedAt;
    if ((!legacyPartial && (!["OPEN", "SCHEDULED"].includes(current.status) || current.paymentBatch || current.outstandingAmount !== current.originalAmount)) || (current.detraction?.status === "DEPOSITED" && !legacyPartial)) throw new AppError(409, "SPOT treatment is frozen once a payment instruction or payment exists.");
    const preview = await previewAccountingDetraction({ id, categoryCode });
    if (legacyPartial && current.detraction?.status) {
      if (current.detraction.status !== preview.calculation.status || current.detraction.categoryCode !== preview.calculation.categoryCode || Number(current.detraction.amount || 0) !== Number(preview.calculation.amount || 0) || Number(current.detraction.amountPen || 0) !== Number(preview.calculation.amountPen || 0)) throw new AppError(409, "Accounting must preserve the original detraction of a partially paid invoice.");
      preview.calculation = current.detraction.toObject();
    }
    if (preview.calculation.status === "PENDING" && !preview.bankAccountRegistered) throw new AppError(422, "Register the supplier's Banco de la Nacion detracciones account in its profile first.");
    if (preview.netAmount < 0) throw new AppError(422, "Detraction cannot exceed the outstanding amount.");
    const previous = current.detraction?.toObject?.() || current.detraction;
    const confirmedAt = new Date();
    current.accountingTreatment = { ...current.accountingTreatment?.toObject?.(), spotConfirmed: true, spotCategoryCode: String(categoryCode), confirmedBy: user._id, confirmedAt };
    current.detraction = { ...preview.calculation, confirmedBy: user._id, confirmedAt,
      beneficiaryAccountNumber: preview.calculation.status === "DEPOSITED" ? preview.calculation.beneficiaryAccountNumber : preview.calculation.status === "PENDING" ? await resolveSupplierDetractionAccount(current.supplier) : "" };
    current.history.push({ status: current.status, by: user._id, comments: `Accounting confirmed SPOT ${categoryCode || "not applicable"}; net ${current.currency} ${preview.netAmount.toFixed(2)}.` });
    await current.save();
    await recordAudit({ entityType: "AccountsPayable", entity: current, requestId: current.request, action: "DETRACTION_CONFIRMED", module: "ACCOUNTING", user, req, oldValues: previous, newValues: current.detraction.toObject() });
    await resolveNotification(`payable:${id}:detraction-review`);
    const request = await FinancialRequest.findById(current.request).select("requestNumber").lean();
    await notifyRoles({ roles: [ROLES.TREASURY], eventKey: `request:${current.request}:treasury`, type: "TREASURY_PAYABLE",
      title: notificationText("Payable item ready"),
      message: notificationText("{requestNumber} has an open CXP ready for Treasury scheduling.", { requestNumber: request?.requestNumber || "" }),
      path: `/treasury?record=${current._id}`, entityType: "AccountsPayable", entityId: current._id });
    return current.populate("detraction.confirmedBy", "name");
  } finally { await claims.deleteOne({ _id: payable._id, accountingReview: true }); }
}

function normalizeDetractionAccount(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!/^\d{8,20}$/.test(digits)) throw new AppError(422, "A valid Banco de la Nacion detracciones account number is required.", { field: "accountNumber" }, ERROR_CODES.VALIDATION_ERROR);
  return digits;
}

export async function resolveSupplierDetractionAccount(supplierId, { session } = {}) {
  if (!supplierId) return "";
  const supplier = await Supplier.findById(supplierId).select("detractionAccount").session(session || null).lean();
  if (supplier?.detractionAccount?.accountNumber) return supplier.detractionAccount.accountNumber;
  // Compatibility: a DETRACTION-typed bank account registered through the bank-account screen.
  const legacy = await SupplierBankAccount.findOne({ supplier: supplierId, accountType: "DETRACTION", bank: "BANCO_NACION", active: true }).sort({ preferred: -1, validFrom: -1 }).session(session || null).lean();
  return legacy?.accountNumber || "";
}

export async function setSupplierDetractionAccount({ supplierId, accountNumber, user, req }) {
  if (!SPOT_ADMIN_ROLES.includes(user?.role)) throw new AppError(403, "Only Accounting can maintain the supplier detracciones account.", undefined, ERROR_CODES.FORBIDDEN);
  const supplier = await Supplier.findById(supplierId);
  if (!supplier) throw new AppError(404, "Supplier not found.", { supplierId }, ERROR_CODES.NOT_FOUND);
  const normalized = normalizeDetractionAccount(accountNumber);
  const previous = supplier.detractionAccount?.accountNumber || "";
  supplier.detractionAccount = { accountNumber: normalized, updatedAt: new Date(), updatedBy: user._id };
  await supplier.save();
  await recordAudit({ entityType: "Supplier", entity: supplier, action: "DETRACTION_ACCOUNT_UPDATED", user, req, module: "SUPPLIERS",
    oldValues: { accountLast4: previous.slice(-4) }, newValues: { bank: "BANCO_NACION", accountLast4: normalized.slice(-4) } });
  return supplier;
}
