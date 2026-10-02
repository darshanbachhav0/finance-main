// SPOT (detracciones) support for Treasury. UMA is NOT an IGV withholding agent, so no IGV
// retention is ever computed here; the only deduction is the detraccion deposit, owed when the
// purchased good or service belongs to a SPOT category (R.S. 183-2004/SUNAT and its annexes)
// and the operation exceeds the category's minimum amount.
import SpotCategory from "../models/SpotCategory.js";
import Supplier from "../models/Supplier.js";
import SupplierBankAccount from "../models/SupplierBankAccount.js";
import { recordAudit } from "./auditService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, FLOW_TYPE, LEGACY_EXPENSE_NATURE_MAP, REQUEST_TYPE, ROLES } from "../utils/constants.js";
import { multiplyMoney, roundMoney } from "../utils/money.js";
import { SPOT_DEFAULT_CATEGORIES, SPOT_DEFAULT_EFFECTIVE_FROM, detractionAmountPen, suggestedSpotCategoryCode } from "../../../shared/spotCategories.mjs";

const NON_SPOT_REQUEST_TYPES = new Set([REQUEST_TYPE.ENTREGA_RENDIR, REQUEST_TYPE.REEMBOLSO_CON_SUSTENTO, REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO]);
// Receipts for independent work (4th category), advances and internal receipts are outside SPOT.
const NON_SPOT_VOUCHER_TYPES = new Set(["ANTICIPO", "RECIBO", "RECIBO_HONORARIOS", "RHE", "RECIBO_POR_HONORARIOS"]);
const SPOT_ADMIN_ROLES = [ROLES.ADMIN, ROLES.ACCOUNTING];

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
  return SpotCategory.find(query).sort({ code: 1, effectiveFrom: -1 }).lean();
}

// A rate change never overwrites history: the current row is closed the day before the new one.
export async function updateSpotCategory({ code, payload = {}, user, req }) {
  if (!SPOT_ADMIN_ROLES.includes(user?.role)) throw new AppError(403, "Only Accounting or Admin can maintain the SPOT table.", undefined, ERROR_CODES.FORBIDDEN);
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
  await recordAudit({ entityType: "SpotCategory", entity: created, action: "SPOT_CATEGORY_UPDATED", user, req, module: "TREASURY",
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
  if (!category) return notApplicable;
  const exchangeRate = Number(accountsPayable.exchangeRate || 1);
  const baseAmountPen = roundMoney(accountsPayable.penEquivalent ?? multiplyMoney(accountsPayable.originalAmount, exchangeRate));
  const shared = {
    categoryCode: category.code, categoryDescription: category.description, rate: category.rate,
    minimumAmount: category.minimumAmount, baseAmountPen, determinedAt: new Date()
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
  if (accountsPayable.detraction?.status) return accountsPayable.detraction;
  accountsPayable.detraction = await determineDetraction({ request, accountsPayable, session });
  return accountsPayable.detraction;
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
  if (!SPOT_ADMIN_ROLES.includes(user?.role)) throw new AppError(403, "Only Accounting or Admin can maintain the supplier detracciones account.", undefined, ERROR_CODES.FORBIDDEN);
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
