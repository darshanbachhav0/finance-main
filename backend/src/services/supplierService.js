import { supplierVerificationCurrent } from "../../../shared/supplierVerification.mjs";
import AuditLog from "../models/AuditLog.js";
import Notification from "../models/Notification.js";
import { assertBankFileAccountNumber } from "./bankFileAccountRules.js";
import { resolveSupplierBankReview } from "./bankNotificationService.js";
import Supplier from "../models/Supplier.js";
import SupplierBankAccount from "../models/SupplierBankAccount.js";
import User from "../models/User.js";
import { recordAudit } from "./auditService.js";
import { notificationText, notifyRoles, notifyUser, resolveNotification } from "./notificationService.js";
import { cleanupUploadedFiles, persistUploadedFiles } from "./storageService.js";
import { paginatedPayload, parsePagination, parseSort, escapedRegex } from "./queryService.js";
import { nextSupplierCode } from "./sequenceService.js";
import { sunatService } from "./sunatService.js";
import { getSupplierAutomaticPrefill } from "./supplierPadronLookupService.js";
import { cachedSunatLegalRepresentatives, lookupSunatLegalRepresentatives } from "./sunatConsultaRucRepresentativesService.js";
import { representativeDocumentType, sunatCalendarDate } from "../../../shared/supplierSunat.mjs";
import { runFinancialOperation } from "./transactionService.js";
import { getEffectiveFinanceConfiguration } from "./financeConfigurationService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, PERMISSIONS, ROLES } from "../utils/constants.js";
import { actsAsSupplierProposer, hasPermission } from "../utils/permissions.js";
import { assertValidBankAccountNumber, assertValidCci } from "../utils/bankAccountValidation.js";
import { bankDisplayName, cciBankProblem, peruBank } from "../../../shared/peruBanks.mjs";
import {
  assertCanOpenSupplier,
  canSeeSupplier,
  isDepartmentScoped,
  normalizeDepartment,
  sanitizeDepartments,
  supplierVisibilityQuery,
  userDepartment
} from "./supplierVisibilityService.js";

const FINANCE_ROLES = Object.freeze([ROLES.ADMIN, ROLES.ACCOUNTING]);
const EDITABLE_PROPOSAL_STATUSES = Object.freeze(["PENDING_VALIDATION", "OBSERVED"]);
// The RUC file, legal representative ID and bank certificate are optional supporting documents:
// the proposal form no longer asks for them, so they no longer hold back the jefe's approval.
const SUPPORTING_DOCUMENT_KINDS = Object.freeze(["RUC_FILE", "BANK_CERTIFICATE", "LEGAL_REP_ID"]);
const NEW_ACCOUNT_TYPES = Object.freeze(["CURRENT", "SAVINGS", "DETRACTION"]);

// NOTE: backend/src/utils/constants.js is locked to a concurrent change in this worktree, so this key
// cannot yet be registered in FINANCE_CONFIGURATION_KEYS (and backend/src/seed/seed.js cannot yet seed a
// default FinanceConfiguration document for it). getEffectiveFinanceConfiguration() below still works with
// this literal key today (Mongoose only enforces the `key` enum on save, not on a query filter) and will
// start honoring an admin-managed override the moment a FinanceConfiguration document with this key can be
// created — until then it safely falls back to DEFAULT_SUPPLIER_HOMOLOGATION_VALIDITY_MONTHS below.
// Follow-up: add SUPPLIER_HOMOLOGATION_VALIDITY_MONTHS to FINANCE_CONFIGURATION_KEYS and seed a default of
// 12 next to the other FinanceConfiguration seed entries.
const SUPPLIER_HOMOLOGATION_VALIDITY_MONTHS_KEY = "SUPPLIER_HOMOLOGATION_VALIDITY_MONTHS";
const DEFAULT_SUPPLIER_HOMOLOGATION_VALIDITY_MONTHS = 12;

// Material fiscal/legal fields: changing any of these on an already-homologated supplier invalidates the
// jefe's approval, so homologation is reset back to PENDING_VALIDATION for a fresh decision.
const MATERIAL_SUPPLIER_FIELDS = Object.freeze(["rucDni", "legalName", "personType"]);

// Simple, dependency-free similarity threshold for the advisory duplicate-name warning (Fix 1). This is
// intentionally conservative (near-exact matches only) since it is a manual-review signal, not a block.
const SIMILAR_NAME_THRESHOLD = 0.88;

function normalizeNameForSimilarity(value) {
  // NFD-decompose (e.g. "n" + combining tilde), then drop the combining marks (Unicode block
  // U+0300-U+036F) so accented characters compare equal to their unaccented form.
  const stripped = Array.from(String(value || "").normalize("NFD"))
    .filter((char) => {
      const code = char.codePointAt(0);
      return code < 0x0300 || code > 0x036f;
    })
    .join("");
  return stripped
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function nameSimilarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (!maxLen) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

async function findSimilarNameSupplier(legalName, { excludeId } = {}) {
  const normalizedCandidate = normalizeNameForSimilarity(legalName);
  if (!normalizedCandidate) return null;
  const query = excludeId ? { _id: { $ne: excludeId } } : {};
  const others = await Supplier.find(query, { legalName: 1, name: 1, rucDni: 1 }).lean();
  let best = null;
  for (const other of others) {
    const otherName = normalizeNameForSimilarity(other.legalName || other.name);
    if (!otherName) continue;
    const score = nameSimilarity(normalizedCandidate, otherName);
    if (score >= SIMILAR_NAME_THRESHOLD && (!best || score > best.score)) {
      best = { score, supplier: other };
    }
  }
  if (!best) return null;
  return {
    possibleDuplicateOf: best.supplier._id,
    matchedLegalName: best.supplier.legalName || best.supplier.name,
    similarityScore: Math.round(best.score * 100) / 100,
    detectedAt: new Date()
  };
}

function addMonthsUtc(date, months) {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

async function computeHomologationValidUntil(date = new Date()) {
  const configuration = await getEffectiveFinanceConfiguration(SUPPLIER_HOMOLOGATION_VALIDITY_MONTHS_KEY, date);
  const validityMonths = configuration?.numericValue > 0 ? configuration.numericValue : DEFAULT_SUPPLIER_HOMOLOGATION_VALIDITY_MONTHS;
  return addMonthsUtc(date, validityMonths);
}

const supplierDocumentKinds = Object.freeze({
  rucFile: "RUC_FILE",
  bankCertificate: "BANK_CERTIFICATE",
  legalRepId: "LEGAL_REP_ID"
});

const protectedSupplierFields = Object.freeze([
  "supplierCode",
  "complianceReview",
  "complianceReviewResult",
  "homologationStatus",
  "status",
  "active",
  "reviewedBy",
  "reviewedAt",
  "taxpayerValidation",
  "sunatRepresentatives",
  "verifiedBy",
  "verifiedAt",
  "verificationStatus",
  "ownershipResult",
  "similarNameWarning",
  "homologationValidUntil",
  "jefeApproval"
]);

const protectedBankReviewFields = Object.freeze([
  "active",
  "preferred",
  "verificationStatus",
  "ownershipResult",
  "verifiedBy",
  "verifiedAt",
  "verificationSource",
  "verificationComments"
]);

const proposalScalarFields = Object.freeze([
  "personType",
  "legalName",
  "commercialName",
  "name",
  "taxAddress",
  "fiscalAddress",
  "website",
  "legalRepresentative",
  "email",
  "phone",
  "contactName",
  "supplierType",
  "goodsServicesProfile",
  "currency",
  "proposalJustification"
]);

const structuredProposalFields = Object.freeze([
  "location",
  "legalRepresentativeDocument",
  "commercialContact",
  "operationsContact",
  "paymentTerms",
  "delivery"
]);

export function normalizeSupplierIdentifier(value) {
  return String(value || "").replace(/\D/g, "");
}

export function assertSupplierIdentifier(value) {
  const normalized = normalizeSupplierIdentifier(value);
  if (!/^(\d{8}|\d{11})$/.test(normalized)) {
    throw new AppError(422, "RUC must contain 11 digits or DNI must contain 8 digits.", { identifier: value }, ERROR_CODES.VALIDATION_ERROR);
  }
  return normalized;
}

function assertFinanceUser(user, message = "Only Accounting or Admin can perform this supplier review action.") {
  if (!FINANCE_ROLES.includes(user?.role)) {
    throw new AppError(403, message, undefined, ERROR_CODES.FORBIDDEN);
  }
}

function assertFieldsAreNotPresent(payload, fields, message) {
  const attemptedFields = fields.filter((field) => Object.prototype.hasOwnProperty.call(payload || {}, field));
  if (attemptedFields.length) {
    throw new AppError(403, message, { attemptedFields }, ERROR_CODES.FORBIDDEN);
  }
}

function parseStructuredValue(value, field) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new AppError(422, `${field} must contain valid JSON.`, { field }, ERROR_CODES.VALIDATION_ERROR);
  }
}

function parseBoolean(value) {
  return value === true || value === "true";
}

function mapUploadedDocuments(files, userId) {
  return Object.entries(supplierDocumentKinds).flatMap(([field, kind]) =>
    (files[field] || []).map((file) => ({
      kind,
      originalName: file.originalname,
      filename: file.filename,
      path: file.path,
      url: file.url,
      mimetype: file.mimetype,
      size: file.size,
      checksum: file.checksum,
      uploadedBy: userId
    }))
  );
}

function normalizeComparable(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function matchResult(actual, returned) {
  if (!String(returned || "").trim()) return "NOT_VERIFIED";
  return normalizeComparable(actual) === normalizeComparable(returned) ? "MATCH" : "MISMATCH";
}

function sanitizedDeclarations(value, current = {}) {
  const parsed = parseStructuredValue(value, "declarations");
  if (!parsed) return undefined;
  const now = new Date();
  const sanitize = (next = {}, previous = {}) => {
    const answer = ["YES", "NO", "NOT_DECLARED"].includes(next.answer) ? next.answer : previous.answer || "NOT_DECLARED";
    return {
      answer,
      comments: String(next.comments ?? previous.comments ?? "").trim(),
      declaredAt: answer === "NOT_DECLARED" ? undefined : now
    };
  };
  return {
    stateSanctions: sanitize(parsed.stateSanctions, current.stateSanctions),
    complianceModel: sanitize(parsed.complianceModel, current.complianceModel)
  };
}

function applyProposalFields(supplier, payload) {
  for (const field of proposalScalarFields) {
    if (payload[field] !== undefined) {
      // Person type is checked during homologation; an unfinished proposal may omit it.
      supplier[field] = field === "personType" && payload[field] === "" ? undefined : payload[field];
    }
  }
  for (const field of structuredProposalFields) {
    const value = parseStructuredValue(payload[field], field);
    if (value !== undefined) supplier[field] = value;
  }
  const declarations = sanitizedDeclarations(payload.declarations, supplier.declarations || {});
  if (declarations) supplier.declarations = declarations;
}

function assertProposalEditable(supplier, user) {
  // Finance may still correct a homologated supplier's data (e.g. a fiscal update); doing so resets
  // homologation back to PENDING_VALIDATION (see updateSupplierProposal) so it is re-reviewed.
  const financeMayCorrectHomologated = FINANCE_ROLES.includes(user?.role) && supplier.homologationStatus === "HOMOLOGATED";
  if (!EDITABLE_PROPOSAL_STATUSES.includes(supplier.homologationStatus) && !financeMayCorrectHomologated) {
    throw new AppError(
      409,
      "Supplier proposal fields can only be changed while pending validation, observed, or (for Accounting/Admin) homologated.",
      { homologationStatus: supplier.homologationStatus },
      ERROR_CODES.INVALID_STATUS_TRANSITION
    );
  }
  if (actsAsSupplierProposer(user) && String(idOf(supplier.proposedBy)) !== String(user._id)) {
    throw new AppError(403, "You may correct only supplier proposals you created.", undefined, ERROR_CODES.FORBIDDEN);
  }
  if (!FINANCE_ROLES.includes(user.role) && !actsAsSupplierProposer(user)) {
    throw new AppError(403, "You do not have permission to edit supplier proposals.", undefined, ERROR_CODES.FORBIDDEN);
  }
}

function maskBankValue(value) {
  const text = String(value || "");
  if (!text) return "";
  return `${"*".repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
}

function idOf(value) {
  return value?._id || value || "";
}

// Provider review belongs to Finance. Historical jefe decisions remain in the record.
export async function supplierApproverFor() {
  return { approver: null, coveringFor: null, adminFallback: false, financeReview: true };
}

// Waiting for a decision: a new or corrected proposal, or a homologation whose validity lapsed.
function awaitsApproval(supplier) {
  return supplier?.homologationStatus === "PENDING_VALIDATION"
    || (supplier?.homologationStatus === "HOMOLOGATED" && isHomologationExpired(supplier));
}

function awaitingApprovalQuery(now = new Date()) {
  return { $or: [{ homologationStatus: "PENDING_VALIDATION" }, { homologationStatus: "HOMOLOGATED", homologationValidUntil: { $lt: now } }] };
}

function decidesSupplierApproval(supplier, user) {
  return Boolean(user?._id && FINANCE_ROLES.includes(user.role) && awaitsApproval(supplier)
    && String(idOf(supplier.proposedBy)) !== String(user._id));
}

// Reuse the Finance review context for the suppliers on a page.
async function approvalContexts(suppliers) {
  const byProposer = new Map();
  const contexts = new Map();
  for (const supplier of suppliers) {
    if (!awaitsApproval(supplier)) continue;
    const proposer = String(idOf(supplier.proposedBy) || "");
    if (!byProposer.has(proposer)) byProposer.set(proposer, await supplierApproverFor(proposer));
    contexts.set(String(supplier._id), byProposer.get(proposer));
  }
  return contexts;
}

// Only Finance receives provider review tasks. Request approval remains independent.
export async function suppliersAwaitingApprovalBy(user) {
  if (!user?._id || !FINANCE_ROLES.includes(user.role)) return [];
  const waiting = await Supplier.find(awaitingApprovalQuery()).select("proposedBy homologationStatus homologationValidUntil").sort({ updatedAt: 1 }).lean();
  const contexts = await approvalContexts(waiting);
  return waiting.filter((supplier) => decidesSupplierApproval(supplier, user, contexts.get(String(supplier._id))));
}

// Whoever decides on this supplier now (used to open its documents to them).
export async function isCurrentSupplierApprover(supplier, user) {
  if (!awaitsApproval(supplier)) return false;
  return decidesSupplierApproval(supplier, user, await supplierApproverFor(supplier.proposedBy));
}

function supplierName(supplier) {
  return supplier.legalName || supplier.name || supplier.rucDni;
}

async function notifySupplierApprover(supplier, { once = false } = {}) {
  await resolveNotification(`supplier:${supplier._id}:approval`);
  return notifyRoles({ once, roles: FINANCE_ROLES, excludeUserId: idOf(supplier.proposedBy),
    eventKey: `supplier:${supplier._id}:finance-review`, type: "SUPPLIER_REVIEW_PENDING",
    title: notificationText("Provider review pending"),
    message: notificationText("{supplier} requires Accounting review.", { supplier: supplierName(supplier) }),
    path: `/suppliers/${supplier._id}`, entityType: "Supplier", entityId: supplier._id });
}

// Reminds whoever holds each waiting proposal now: a proposal made before an approver went on leave
// (or before this approval step existed) reaches the person who can decide it. Sent once per person.
export async function remindSupplierApprovers() {
  let reminded = 0;
  for await (const supplier of Supplier.find({ homologationStatus: "PENDING_VALIDATION" }).populate("proposedBy", "name").cursor()) {
    await notifySupplierApprover(supplier, { once: true });
    reminded += 1;
  }
  return { reminded };
}

function canViewFullBankData(supplier, user, approval = null) {
  if (hasPermission(user, PERMISSIONS.SUPPLIER_BANK_VIEW)) return true;
  if (decidesSupplierApproval(supplier, user, approval)) return true;
  return actsAsSupplierProposer(user)
    && String(idOf(supplier.proposedBy)) === String(user._id)
    && EDITABLE_PROPOSAL_STATUSES.includes(supplier.homologationStatus);
}

function serializeBankAccount(account, reveal) {
  const value = account.toObject ? account.toObject() : { ...account };
  if (reveal) return value;
  return {
    ...value,
    accountNumber: maskBankValue(value.accountNumber),
    cci: maskBankValue(value.cci),
    verificationComments: undefined,
    verificationDocument: undefined
  };
}

function serializeSupplierBase(supplier, user, approval = null) {
  const value = supplier.toObject ? supplier.toObject() : { ...supplier };
  if (canViewFullBankData(supplier, user, approval)) return value;
  return {
    ...value,
    bankAccount: maskBankValue(value.bankAccount),
    cci: maskBankValue(value.cci),
    detractionAccount: value.detractionAccount ? { ...value.detractionAccount, accountNumber: maskBankValue(value.detractionAccount.accountNumber) } : value.detractionAccount,
    bankHistory: (value.bankHistory || []).map((item) => ({
      ...item,
      bankAccount: maskBankValue(item.bankAccount),
      cci: maskBankValue(item.cci),
      verificationSource: undefined,
      verificationDocument: undefined
    }))
  };
}

function supplierPermissions(supplier, user, approval = null) {
  const finance = FINANCE_ROLES.includes(user?.role);
  const editable = EDITABLE_PROPOSAL_STATUSES.includes(supplier.homologationStatus);
  // Finance may correct a homologated supplier's data; the correction resets it to PENDING_VALIDATION.
  const financeMayCorrectHomologated = finance && supplier.homologationStatus === "HOMOLOGATED";
  const proposerOwns = String(idOf(supplier.proposedBy)) === String(user?._id || "");
  return {
    canEditProposal: (editable || financeMayCorrectHomologated) && (finance || (actsAsSupplierProposer(user) && proposerOwns)),
    canUploadDocuments: editable && (finance || (actsAsSupplierProposer(user) && proposerOwns)),
    canAddBankAccount: finance || (editable && actsAsSupplierProposer(user) && proposerOwns),
    // Accounting/Admin keep the SUNAT check, the bank verification Treasury pays against and the
    // power to deactivate and to review the supplier.
    canValidateTaxpayer: finance && !supplierVerificationCurrent(supplier),
    canRevalidateTaxpayer: finance,
    canVerifyBanking: finance,
    canDeactivate: finance && supplier.homologationStatus !== "INACTIVE",
    // Which areas see the supplier in their list.
    canManageDepartments: finance,
    // An expired homologation is decided again even though its status still reads HOMOLOGATED.
    canApprove: decidesSupplierApproval(supplier, user, approval),
    canViewFullBankData: canViewFullBankData(supplier, user, approval)
  };
}

function updateLegacyBankHistory(supplier, account) {
  const existing = [...(supplier.bankHistory || [])].reverse().find((item) =>
    item.bankName === account.bank
    && item.bankAccount === account.accountNumber
    && item.currency === account.currency
    && item.accountType === account.accountType
    && item.status === "ACTIVE"
  );
  if (!existing) return;
  existing.preferred = account.preferred;
  existing.verificationStatus = account.verificationStatus;
  existing.ownershipResult = account.ownershipResult;
  existing.verifiedBy = account.verifiedBy;
  existing.verifiedAt = account.verifiedAt;
  existing.verificationSource = account.verificationSource;
  existing.verificationDocument = account.verificationDocument;
  existing.changedAt = new Date();
  existing.changedBy = account.changedBy;
}

async function loadSupplier(supplierId, options = {}) {
  const query = Supplier.findById(supplierId);
  if (options.includeDocumentPaths) query.select("+documents.path");
  const supplier = await query;
  if (!supplier) throw new AppError(404, "Supplier not found.", { supplierId }, ERROR_CODES.NOT_FOUND);
  return supplier;
}

async function createBankAccountRecord({ supplier, payload, user, req, audit = true, requireCci = true }) {
  assertFieldsAreNotPresent(
    payload,
    protectedBankReviewFields,
    "Bank verification, ownership and preferred-account fields are Finance-controlled."
  );
  const bank = String(payload.bank || payload.bankName || "").trim().toUpperCase();
  const accountType = String(payload.accountType || "CURRENT").trim().toUpperCase();
  if (!NEW_ACCOUNT_TYPES.includes(accountType)) {
    throw new AppError(422, "Choose a savings account or a current account.", { field: "accountType", accountType }, ERROR_CODES.VALIDATION_ERROR);
  }
  if (bank && !peruBank(bank)) {
    throw new AppError(422, "Choose the bank from the list, or Other if it is not there.", { field: "bank", bank }, ERROR_CODES.VALIDATION_ERROR);
  }
  const bankOtherName = bank === "OTHER" ? String(payload.bankOtherName || "").trim() : "";
  if (bank === "OTHER" && !bankOtherName) {
    throw new AppError(422, "Enter the name of the bank.", { field: "bankOtherName" }, ERROR_CODES.VALIDATION_ERROR);
  }
  if (accountType === "DETRACTION" && bank !== "BANCO_NACION") {
    throw new AppError(
      422,
      "Detraction accounts must use Banco de la Nacion.",
      { field: "bank", accountType, requiredBank: "BANCO_NACION" },
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  const accountNumber = assertValidBankAccountNumber(payload.accountNumber || payload.bankAccount);
  // A bank outside the list is paid by CCI, so its CCI is always needed.
  const cci = assertValidCci(payload.cci, { required: requireCci || bank === "OTHER" });
  const cciProblem = cciBankProblem(bank, cci);
  if (cciProblem) throw new AppError(422, cciProblem, { field: "cci", bank }, ERROR_CODES.VALIDATION_ERROR);
  const currency = String(payload.accountCurrency || payload.currency || supplier.currency || "PEN").trim().toUpperCase();
  if (!["PEN", "USD"].includes(currency)) {
    throw new AppError(422, "The account currency must be soles (PEN) or dollars (USD).", { field: "accountCurrency", currency }, ERROR_CODES.VALIDATION_ERROR);
  }
  await assertBankFileAccountNumber({ bank, currency, accountNumber, accountType });
  const accountHolderName = String(payload.accountHolderName || supplier.legalName || supplier.name || "").trim();
  if (!bank || !accountHolderName) {
    throw new AppError(422, "Bank and account-holder name are required.", { bank: Boolean(bank), accountHolderName: Boolean(accountHolderName) }, ERROR_CODES.VALIDATION_ERROR);
  }
  const duplicate = await SupplierBankAccount.findOne({
    supplier: supplier._id,
    bank,
    currency,
    accountType,
    accountNumber,
    active: true
  });
  if (duplicate) {
    throw new AppError(409, "This active supplier bank account already exists.", { accountId: duplicate._id }, ERROR_CODES.CONFLICT);
  }
  const now = new Date();
  const account = await SupplierBankAccount.create({
    supplier: supplier._id,
    bank,
    bankOtherName,
    currency,
    accountType,
    accountHolderName,
    accountNumber,
    cci,
    active: true,
    preferred: false,
    verificationStatus: "PENDING",
    ownershipResult: "NOT_REVIEWED",
    validFrom: now,
    createdBy: user._id,
    changedBy: user._id
  });
  supplier.bankName ||= bank;
  supplier.bankAccount ||= accountNumber;
  supplier.cci ||= cci;
  supplier.bankHistory.push({
    bankName: bank,
    currency,
    accountType,
    accountHolderName,
    bankAccount: accountNumber,
    cci,
    status: "ACTIVE",
    preferred: false,
    verificationStatus: "PENDING",
    ownershipResult: "NOT_REVIEWED",
    validFrom: now,
    createdBy: user._id,
    changedBy: user._id
  });
  await supplier.save();
  const warnings = await reusedBankWarnings({ supplierId: supplier._id, accountNumber, cci });
  if (audit) {
    await recordAudit({
      entityType: "Supplier",
      entity: supplier,
      action: "BANK_ACCOUNT_ADDED",
      user,
      req,
      module: "SUPPLIERS",
      newValues: { accountId: account._id, bank, bankName: bankDisplayName(bank, bankOtherName), currency, accountType, verificationStatus: "PENDING", warnings }
    });
  }
  return { account, warnings };
}

export async function reusedBankWarnings({ supplierId, accountNumber, cci }) {
  const normalizedAccount = accountNumber ? assertValidBankAccountNumber(accountNumber) : "";
  const normalizedCci = cci ? assertValidCci(cci) : "";
  const conditions = [];
  if (normalizedAccount) conditions.push({ accountNumber: normalizedAccount });
  if (normalizedCci) conditions.push({ cci: normalizedCci });
  if (!conditions.length) return [];
  const records = await SupplierBankAccount.find({ supplier: { $ne: supplierId }, $or: conditions })
    .populate("supplier", "rucDni name legalName");
  return records.map((record) => ({
    code: record.cci === normalizedCci ? "CCI_REUSED" : "ACCOUNT_REUSED",
    supplier: record.supplier?._id,
    supplierName: record.supplier?.legalName || record.supplier?.name,
    accountNumber: maskBankValue(record.accountNumber),
    cci: maskBankValue(record.cci)
  }));
}

export async function lookupSupplierByIdentifier(identifier, user) {
  const normalized = assertSupplierIdentifier(identifier);
  const supplier = await Supplier.findOne({ $or: [{ normalizedIdentifier: normalized }, { rucDni: normalized }] })
    .populate("proposedBy", "name email role");
  if (!supplier) return { found: false, normalizedIdentifier: normalized };
  const value = supplier.toObject();
  // Another area's supplier: the requester learns it exists (so it is not proposed twice) and can
  // ask Accounting to share it, without opening its record.
  if (!canSeeSupplier(supplier, user)) {
    return {
      found: true,
      restricted: true,
      normalizedIdentifier: normalized,
      data: { _id: value._id, supplierCode: value.supplierCode, rucDni: value.rucDni, legalName: value.legalName || value.name, homologationStatus: value.homologationStatus, otherDepartment: true }
    };
  }
  const approval = awaitsApproval(supplier) ? await supplierApproverFor(supplier.proposedBy) : null;
  return {
    found: true,
    normalizedIdentifier: normalized,
    data: {
      _id: value._id,
      supplierCode: value.supplierCode,
      rucDni: value.rucDni,
      legalName: value.legalName || value.name,
      commercialName: value.commercialName,
      homologationStatus: value.homologationStatus,
      status: value.status,
      active: value.active,
      proposedBy: value.proposedBy,
      permissions: supplierPermissions(supplier, user, approval)
    }
  };
}

export async function getSupplierDetailPayload(supplierId, user) {
  const supplier = await Supplier.findById(supplierId)
    .populate("proposedBy", "name email role")
    .populate("compliance.validatedBy", "name email role")
    .populate("taxpayerValidation.validatedBy", "name email role")
    .populate("complianceReview.reviewedBy", "name email role")
    .populate("jefeApproval.decidedBy", "name jobTitle role")
    .populate("jefeApproval.coveringFor", "name jobTitle role")
    .populate("reviewedBy", "name email role")
    .populate("documents.uploadedBy", "name email role")
    .populate("similarNameWarning.possibleDuplicateOf", "legalName name rucDni supplierCode");
  if (!supplier) throw new AppError(404, "Supplier not found.", { supplierId }, ERROR_CODES.NOT_FOUND);
  const approval = awaitsApproval(supplier) ? await supplierApproverFor(supplier.proposedBy) : null;
  // The jefe deciding the proposal opens it whatever its area.
  if (!decidesSupplierApproval(supplier, user, approval)) await assertCanOpenSupplier(supplier, user);
  const [accounts, audit] = await Promise.all([
    SupplierBankAccount.find({ supplier: supplier._id })
      .populate("verifiedBy", "name email role")
      .populate("createdBy", "name email role")
      .populate("changedBy", "name email role")
      .sort({ active: -1, preferred: -1, validFrom: -1 }),
    AuditLog.find({ entityType: "Supplier", entityId: supplier._id }).sort({ createdAt: -1 }).limit(100).lean()
  ]);
  const reveal = canViewFullBankData(supplier, user, approval);
  const auditHistory = audit.map((item) => FINANCE_ROLES.includes(user.role)
    ? item
    : {
        _id: item._id,
        actorName: item.actorName,
        role: item.role,
        action: item.action,
        message: item.message,
        createdAt: item.createdAt
      });
  return {
    ...serializeSupplierBase(supplier, user, approval),
    bankAccounts: accounts.map((account) => serializeBankAccount(account, reveal)),
    auditHistory,
    // Who decides now, while the supplier waits for approval.
    approval,
    permissions: supplierPermissions(supplier, user, approval),
    riskyDeclarations: supplierDeclarationWarnings(supplier),
    sunatProvider: sunatService.status()
  };
}

export async function listSuppliersPage(queryParams, user) {
  // A requester's list is their area's suppliers, the shared ones and their own proposals.
  // The proposals a jefe decides are listed whatever their area.
  const query = { $and: [queryParams.awaitingMyApproval === "true" ? {} : supplierVisibilityQuery(user)] };
  if (queryParams.department && !isDepartmentScoped(user)) {
    const department = normalizeDepartment(queryParams.department);
    query.$and.push(department === "__shared" ? { $or: [{ departments: { $exists: false } }, { departments: { $size: 0 } }] } : { departments: new RegExp(`^${escapedRegex(department)}$`, "i") });
  }
  if (queryParams.homologationStatus) query.homologationStatus = queryParams.homologationStatus;
  if (queryParams.jefeApprovalDecision) query["jefeApproval.decision"] = queryParams.jefeApprovalDecision;
  if (queryParams.active !== undefined) query.active = queryParams.active === "true";
  if (queryParams.awaitingMyApproval === "true") query._id = { $in: (await suppliersAwaitingApprovalBy(user)).map((supplier) => supplier._id) };
  if (queryParams.search) {
    const search = new RegExp(escapedRegex(queryParams.search), "i");
    query.$and.push({ $or: [{ supplierCode: search }, { rucDni: search }, { normalizedIdentifier: search }, { name: search }, { commercialName: search }, { legalName: search }] });
  }
  const { page, pageSize, skip } = parsePagination(queryParams);
  const sort = parseSort(queryParams, ["supplierCode", "name", "commercialName", "legalName", "rucDni", "createdAt", "homologationStatus"], { legalName: 1, name: 1 });
  const [data, total] = await Promise.all([
    Supplier.find(query)
      .populate("proposedBy", "name email role")
      .populate("jefeApproval.decidedBy", "name jobTitle role")
      .populate("similarNameWarning.possibleDuplicateOf", "legalName name rucDni supplierCode")
      .sort(sort).skip(skip).limit(pageSize),
    Supplier.countDocuments(query)
  ]);
  const approvals = await approvalContexts(data);
  const supplierIds = data.map((supplier) => supplier._id);
  const bankAccounts = await SupplierBankAccount.find({ supplier: { $in: supplierIds }, active: true })
    .sort({ preferred: -1, validFrom: -1 });
  const bySupplier = bankAccounts.reduce((map, account) => {
    const key = String(account.supplier);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(account);
    return map;
  }, new Map());
  const payload = paginatedPayload(data.map((supplier) => {
    const accounts = bySupplier.get(String(supplier._id)) || [];
    const approval = approvals.get(String(supplier._id)) || null;
    const reveal = canViewFullBankData(supplier, user, approval);
    return {
      ...serializeSupplierBase(supplier, user, approval),
      bankAccounts: accounts.map((account) => serializeBankAccount(account, reveal)),
      activeBankAccountCount: accounts.length,
      verifiedBankAccountCount: accounts.filter((account) => account.verificationStatus === "VERIFIED").length,
      approval,
      permissions: supplierPermissions(supplier, user, approval),
      riskyDeclarations: supplierDeclarationWarnings(supplier)
    };
  }), total, page, pageSize);
  // Which list the requester is looking at: their area's, or only the shared suppliers when their
  // profile has no area yet (an Admin assigns it in Users).
  payload.scope = isDepartmentScoped(user) ? { scoped: true, department: userDepartment(user) } : { scoped: false };
  return payload;
}

export async function createSupplierProposal({ payload, files = {}, user, req }) {
  assertFieldsAreNotPresent(payload, protectedSupplierFields, "Supplier review, status and PRV fields are server-controlled.");
  assertFieldsAreNotPresent(payload, protectedBankReviewFields, "Bank review fields are Finance-controlled.");
  const identifier = assertSupplierIdentifier(payload.rucDni || payload.identifier);
  if (!payload.name && !payload.legalName) {
    throw new AppError(422, "Supplier legal name is required.", { field: "legalName" }, ERROR_CODES.VALIDATION_ERROR);
  }
  if (!String(payload.proposalJustification || "").trim()) {
    throw new AppError(422, "Supplier registration justification is required.", { field: "proposalJustification" }, ERROR_CODES.VALIDATION_ERROR);
  }
  const duplicate = await Supplier.findOne({ $or: [{ normalizedIdentifier: identifier }, { rucDni: identifier }] });
  if (duplicate) {
    const otherDepartment = !canSeeSupplier(duplicate, user);
    throw new AppError(
      409,
      otherDepartment
        ? "This supplier is already registered for another area. Ask Accounting or an Admin to share it with your area."
        : "A supplier with this RUC/DNI already exists. Open the existing onboarding record instead.",
      { supplier: duplicate._id, supplierCode: duplicate.supplierCode, homologationStatus: duplicate.homologationStatus, otherDepartment },
      ERROR_CODES.DUPLICATE_SUPPLIER
    );
  }
  const bankAccounts = parseStructuredValue(payload.bankAccounts, "bankAccounts");
  if (bankAccounts !== undefined && !Array.isArray(bankAccounts)) {
    throw new AppError(422, "bankAccounts must be a list.", { field: "bankAccounts" }, ERROR_CODES.VALIDATION_ERROR);
  }
  // A requester's proposal belongs to their own area; Accounting and Admin choose the areas (none:
  // shared with every area).
  const departments = isDepartmentScoped(user)
    ? [userDepartment(user)].filter(Boolean)
    : payload.departments !== undefined ? sanitizeDepartments(payload.departments) : [];
  const supplier = new Supplier({
    identifierType: identifier.length === 8 ? "DNI" : "RUC",
    rucDni: identifier,
    normalizedIdentifier: identifier,
    legalName: payload.legalName || payload.name,
    commercialName: payload.commercialName || payload.name || payload.legalName,
    name: payload.name || payload.legalName,
    proposedBy: user._id,
    proposedAt: new Date(),
    departments,
    taxpayerStatus: "PENDING",
    complianceStatus: "PENDING",
    homologationStatus: "PENDING_VALIDATION",
    active: false,
    status: "PENDING_VALIDATION"
  });
  applyProposalFields(supplier, payload);
  // RUC/DNI is the hard duplicate key (checked above); a similar-but-not-identical legal name under a
  // different RUC/DNI is only ever an advisory, manual-review signal (Fix 1) - it never blocks creation.
  const similarNameWarning = await findSimilarNameSupplier(supplier.legalName || supplier.name);
  if (similarNameWarning) supplier.similarNameWarning = similarNameWarning;
  let persistedFiles = {};
  try {
    persistedFiles = await persistUploadedFiles(files, { domain: "suppliers", entityId: supplier._id });
    const uploadedDocuments = mapUploadedDocuments(persistedFiles, user._id);
    supplier.documents.push(...uploadedDocuments);
    await supplier.save();
    const bankResult = { warnings: [], accounts: [] };
    // One account from the single-account fields, or several (e.g. one in soles and one in dollars).
    const accountPayloads = bankAccounts?.length
      ? bankAccounts.map((account) => ({ ...account, accountNumber: account.accountNumber || account.bankAccount }))
      : payload.bankName || payload.bank || payload.bankAccount || payload.accountNumber ? [payload] : [];
    for (const accountPayload of accountPayloads) {
      const result = await createBankAccountRecord({ supplier, payload: accountPayload, user, req });
      bankResult.accounts.push(result.account);
      bankResult.warnings.push(...(result.warnings || []));
    }
    // The PRV code is taken once everything above is stored, from the one supplier counter: every
    // registration is numbered in order and a refused proposal never uses a number.
    const supplierCode = await nextSupplierCode();
    await Supplier.updateOne({ _id: supplier._id, $or: [{ supplierCode: { $exists: false } }, { supplierCode: null }] }, { $set: { supplierCode } });
    supplier.supplierCode = supplierCode;
    await recordAudit({
      entityType: "Supplier",
      entity: supplier,
      action: "CREATED_PENDING_VALIDATION",
      user,
      req,
      module: "SUPPLIERS",
      newValues: { identifier, supplierCode, legalName: supplier.legalName, proposalJustification: supplier.proposalJustification, departments }
    });
    await recordAudit({ entityType: "Supplier", entity: supplier, action: "PRV_ASSIGNED", user, req, module: "SUPPLIERS", newValues: { supplierCode } });
    if (similarNameWarning) {
      await recordAudit({
        entityType: "Supplier",
        entity: supplier,
        action: "POSSIBLE_DUPLICATE_NAME_DETECTED",
        user,
        req,
        module: "SUPPLIERS",
        comments: "Advisory only - RUC/DNI differs from the matched supplier. Manual review recommended before homologation.",
        newValues: similarNameWarning
      });
    }
    if (uploadedDocuments.length) {
      await recordAudit({
        entityType: "Supplier",
        entity: supplier,
        action: "REQUIRED_DOCUMENTS_UPLOADED",
        user,
        req,
        module: "SUPPLIERS",
        newValues: { documentKinds: uploadedDocuments.map((item) => item.kind) }
      });
    }
    const warnings = bankResult.warnings || [];
    if (sunatService.status().variant === "PADRON" && identifier.length === 11) {
      try { await validateAutomaticSupplierTaxpayer(supplier, user, req); }
      catch (error) {
        warnings.push({ code: "TAXPAYER_VALIDATION_PENDING", message: "Supplier saved. Automatic SUNAT validation is pending; Accounting can retry it from Taxpayer Validation." });
        console.warn("[SUPPLIER] Automatic taxpayer review pending:", error.code || error.name);
      }
    }
    // Manual integration mode can still preserve the public evidence retrieved by the form.
    if (identifier.length === 11 && (sunatService.status().variant === "PADRON" || cachedSunatLegalRepresentatives(identifier, supplier.legalName))) {
      try { await recordSupplierSunatRepresentatives(supplier, user, req); }
      catch (error) {
        warnings.push({ code: "SUNAT_REPRESENTATIVES_PENDING", message: "Supplier saved. SUNAT legal representatives could not be retrieved; complete the representative manually." });
        console.warn("[SUPPLIER] SUNAT representatives pending:", error.code || error.name);
      }
    }
    // The saved proposal never depends on the notification; the approver also sees it in their tasks.
    try { await notifySupplierApprover(supplier); }
    catch (error) { console.warn("[SUPPLIER] Approver notification failed:", error.message); }
    return { supplier, warnings, bankAccounts: bankResult.accounts.map((account) => serializeBankAccount(account, true)) };
  } catch (error) {
    await cleanupUploadedFiles(persistedFiles);
    await SupplierBankAccount.deleteMany({ supplier: supplier._id }).catch(() => undefined);
    await Supplier.deleteOne({ _id: supplier._id, homologationStatus: "PENDING_VALIDATION" }).catch(() => undefined);
    throw error;
  }
}

export async function updateSupplierProposal({ supplierId, payload, files = {}, user, req }) {
  if (actsAsSupplierProposer(user)) {
    assertFieldsAreNotPresent(payload, protectedSupplierFields, "Solicitors cannot set supplier review, status or PRV fields.");
    assertFieldsAreNotPresent(payload, protectedBankReviewFields, "Solicitors cannot set bank review fields.");
  }
  const supplier = await loadSupplier(supplierId, { includeDocumentPaths: true });
  assertProposalEditable(supplier, user);
  const oldValues = {
    rucDni: supplier.rucDni,
    legalName: supplier.legalName,
    personType: supplier.personType,
    homologationStatus: supplier.homologationStatus,
    jefeApproval: supplier.jefeApproval?.toObject?.() || supplier.jefeApproval
  };
  if (payload.rucDni && normalizeSupplierIdentifier(payload.rucDni) !== supplier.normalizedIdentifier) {
    const identifier = assertSupplierIdentifier(payload.rucDni);
    const duplicate = await Supplier.findOne({ _id: { $ne: supplier._id }, $or: [{ normalizedIdentifier: identifier }, { rucDni: identifier }] });
    if (duplicate) {
      throw new AppError(409, "RUC/DNI must be unique.", { supplier: duplicate._id }, ERROR_CODES.DUPLICATE_SUPPLIER);
    }
    supplier.rucDni = identifier;
    supplier.normalizedIdentifier = identifier;
  }
  applyProposalFields(supplier, payload);
  // Fix 2: a material fiscal/legal change (RUC/DNI, legal name, person type) on an already-homologated
  // supplier invalidates the jefe's approval and the homologation, so it must be approved again.
  const materialFieldsChanged = MATERIAL_SUPPLIER_FIELDS.some((field) => (supplier[field] || "") !== (oldValues[field] || ""));
  if (materialFieldsChanged) {
    oldValues.taxpayerValidation = supplier.taxpayerValidation?.toObject?.() || supplier.taxpayerValidation;
    supplier.taxpayerValidation.status = "NOT_VERIFIED";
    supplier.taxpayerStatus = "PENDING";
    supplier.compliance.taxpayerActive = false;
  }
  const homologationResetForMaterialChange = oldValues.homologationStatus === "HOMOLOGATED" && materialFieldsChanged;
  const backToApproval = oldValues.homologationStatus === "OBSERVED" || homologationResetForMaterialChange;
  let persistedFiles = {};
  try {
    persistedFiles = await persistUploadedFiles(files, { domain: "suppliers", entityId: supplier._id });
    const uploadedDocuments = mapUploadedDocuments(persistedFiles, user._id);
    supplier.documents.push(...uploadedDocuments);
    if (backToApproval) {
      supplier.homologationStatus = "PENDING_VALIDATION";
      supplier.status = "PENDING_VALIDATION";
      supplier.jefeApproval = { decision: "PENDING" };
    }
    if (homologationResetForMaterialChange) {
      supplier.active = false;
      supplier.homologationValidUntil = undefined;
    }
    await supplier.save();
    await recordAudit({
      entityType: "Supplier",
      entity: supplier,
      action: oldValues.homologationStatus === "OBSERVED"
        ? "CORRECTION_SUBMITTED"
        : homologationResetForMaterialChange
          ? "HOMOLOGATION_RESET_MATERIAL_CHANGE"
          : "PROPOSAL_UPDATED",
      user,
      req,
      module: "SUPPLIERS",
      oldValues,
      newValues: { rucDni: supplier.rucDni, legalName: supplier.legalName, personType: supplier.personType, homologationStatus: supplier.homologationStatus }
    });
    if (uploadedDocuments.length) {
      await recordAudit({
        entityType: "Supplier",
        entity: supplier,
        action: "REQUIRED_DOCUMENTS_UPLOADED",
        user,
        req,
        module: "SUPPLIERS",
        newValues: { documentKinds: uploadedDocuments.map((item) => item.kind) }
      });
    }
  } catch (error) {
    await cleanupUploadedFiles(persistedFiles);
    throw error;
  }
  if (backToApproval) {
    try { await notifySupplierApprover(supplier); }
    catch (error) { console.warn("[SUPPLIER] Approver notification failed:", error.message); }
  }
  return { supplier, warnings: [] };
}

export async function addSupplierBankAccount({ supplierId, payload, user, req }) {
  const supplier = await loadSupplier(supplierId);
  if (actsAsSupplierProposer(user)) assertProposalEditable(supplier, user);
  else assertFinanceUser(user, "Only an authorized proposer, Accounting or Admin can add supplier bank accounts.");
  return createBankAccountRecord({ supplier, payload, user, req });
}

export async function verifySupplierBankAccount({ supplierId, accountId, payload, user, req }) {
  assertFinanceUser(user, "Only Accounting or Admin can verify supplier bank accounts.");
  const supplier = await loadSupplier(supplierId);
  const account = await SupplierBankAccount.findOne({ _id: accountId, supplier: supplier._id });
  if (!account) throw new AppError(404, "Supplier bank account not found.", { accountId }, ERROR_CODES.NOT_FOUND);
  const verificationStatus = payload.verificationStatus;
  const ownershipResult = payload.ownershipResult;
  if (!["VERIFIED", "OBSERVED", "REJECTED"].includes(verificationStatus)) {
    throw new AppError(422, "A valid Finance bank-verification decision is required.", { verificationStatus }, ERROR_CODES.VALIDATION_ERROR);
  }
  if (!["NOT_REVIEWED", "MATCH", "MISMATCH", "MANUAL_ACCEPTED"].includes(ownershipResult)) {
    throw new AppError(422, "A valid bank-ownership decision is required.", { ownershipResult }, ERROR_CODES.VALIDATION_ERROR);
  }
  // Segregation of duties: whoever registered the account cannot be the one who verifies it.
  if (verificationStatus === "VERIFIED" && account.createdBy && String(account.createdBy) === String(user._id)) {
    throw new AppError(403, "You registered this bank account, so another authorized user must verify it.", { accountId: account._id }, ERROR_CODES.FORBIDDEN);
  }
  const comments = String(payload.comments || payload.verificationComments || "").trim();
  if ((ownershipResult === "MANUAL_ACCEPTED" || ownershipResult === "MISMATCH" || verificationStatus !== "VERIFIED") && !comments) {
    throw new AppError(422, "Comments are required for manual acceptance, mismatch, observation or rejection.", { field: "comments" }, ERROR_CODES.VALIDATION_ERROR);
  }
  let verificationDocument = payload.verificationDocument;
  if (verificationDocument) {
    const document = supplier.documents.id(verificationDocument);
    if (!document || document.kind !== "BANK_CERTIFICATE") {
      throw new AppError(422, "The verification document must be this supplier's bank certificate.", { verificationDocument }, ERROR_CODES.VALIDATION_ERROR);
    }
  } else {
    verificationDocument = [...supplier.documents].reverse().find((item) => item.kind === "BANK_CERTIFICATE")?._id;
  }
  const oldValues = {
    verificationStatus: account.verificationStatus,
    ownershipResult: account.ownershipResult
  };
  account.verificationStatus = verificationStatus;
  account.ownershipResult = ownershipResult;
  account.verifiedBy = user._id;
  account.verifiedAt = new Date();
  account.verificationSource = "AUTHORIZED_MANUAL_REVIEW";
  account.verificationDocument = verificationDocument;
  account.verificationComments = comments;
  account.changedBy = user._id;
  await account.save();
  updateLegacyBankHistory(supplier, account);
  await supplier.save();
  await recordAudit({
    entityType: "Supplier",
    entity: supplier,
    action: "BANK_ACCOUNT_REVIEWED",
    user,
    req,
    module: "SUPPLIERS",
    comments,
    oldValues,
    newValues: {
      accountId: account._id,
      verificationStatus,
      ownershipResult,
      verificationSource: account.verificationSource,
      verificationDocument
    }
  });
  await resolveSupplierBankReview(account);
  if (!(await SupplierBankAccount.exists({ supplier: supplier._id, active: true, verificationStatus: "PENDING" }))) {
    await resolveNotification(`supplier:${supplier._id}:bank-review`);
  }
  return account;
}

export async function setPreferredSupplierBankAccount({ supplierId, accountId, user, req }) {
  assertFinanceUser(user, "Only Accounting or Admin can select a preferred supplier bank account.");
  const supplier = await loadSupplier(supplierId);
  const result = await runFinancialOperation(async (session) => {
    let accountQuery = SupplierBankAccount.findOne({ _id: accountId, supplier: supplier._id });
    if (session) accountQuery = accountQuery.session(session);
    const account = await accountQuery;
    if (!account) throw new AppError(404, "Supplier bank account not found.", { accountId }, ERROR_CODES.NOT_FOUND);
    if (!account.active) {
      throw new AppError(422, "An inactive bank account cannot be preferred.", { accountId }, ERROR_CODES.VALIDATION_ERROR);
    }
    let previousQuery = SupplierBankAccount.find({
      supplier: supplier._id,
      currency: account.currency,
      accountType: account.accountType,
      active: true,
      preferred: true,
      _id: { $ne: account._id }
    }).select("_id");
    if (session) previousQuery = previousQuery.session(session);
    const previous = await previousQuery;
    let clearQuery = SupplierBankAccount.updateMany(
      {
        supplier: supplier._id,
        currency: account.currency,
        accountType: account.accountType,
        active: true,
        preferred: true,
        _id: { $ne: account._id }
      },
      { $set: { preferred: false, changedBy: user._id } }
    );
    if (session) clearQuery = clearQuery.session(session);
    await clearQuery;
    account.preferred = true;
    account.changedBy = user._id;
    await account.save({ session: session || undefined });
    return { account, previous: previous.map((item) => item._id) };
  });
  for (const history of supplier.bankHistory || []) {
    if (history.currency === result.account.currency && history.accountType === result.account.accountType && history.status === "ACTIVE") {
      history.preferred = history.bankName === result.account.bank && history.bankAccount === result.account.accountNumber;
      history.changedAt = new Date();
      history.changedBy = user._id;
    }
  }
  supplier.bankName = result.account.bank;
  supplier.bankAccount = result.account.accountNumber;
  supplier.cci = result.account.cci;
  await supplier.save();
  await recordAudit({
    entityType: "Supplier",
    entity: supplier,
    action: "PREFERRED_BANK_ACCOUNT_CHANGED",
    user,
    req,
    module: "SUPPLIERS",
    oldValues: { preferredAccountIds: result.previous },
    newValues: { preferredAccountId: result.account._id, currency: result.account.currency, accountType: result.account.accountType }
  });
  return result.account;
}

export async function deactivateSupplierBankAccount({ supplierId, accountId, user, req }) {
  assertFinanceUser(user, "Only Accounting or Admin can deactivate supplier bank accounts.");
  const supplier = await loadSupplier(supplierId);
  const account = await SupplierBankAccount.findOne({ _id: accountId, supplier: supplier._id });
  if (!account) throw new AppError(404, "Supplier bank account not found.", { accountId }, ERROR_CODES.NOT_FOUND);
  if (!account.active) return account;
  account.active = false;
  account.preferred = false;
  account.validTo = new Date();
  account.changedBy = user._id;
  await account.save();
  const history = [...(supplier.bankHistory || [])].reverse().find((item) =>
    item.bankName === account.bank && item.bankAccount === account.accountNumber && item.status === "ACTIVE"
  );
  if (history) {
    history.status = "INACTIVE";
    history.preferred = false;
    history.validTo = account.validTo;
    history.changedAt = account.validTo;
    history.changedBy = user._id;
  }
  await supplier.save();
  await recordAudit({
    entityType: "Supplier",
    entity: supplier,
    action: "BANK_ACCOUNT_DEACTIVATED",
    user,
    req,
    module: "SUPPLIERS",
    oldValues: { accountId, active: true },
    newValues: { accountId, active: false, validTo: account.validTo }
  });
  return account;
}

export async function validateSupplierTaxpayer({ supplierId, payload, user, req }) {
  assertFinanceUser(user, "Only Accounting or Admin can validate supplier taxpayer information.");
  const supplier = await loadSupplier(supplierId);
  if (supplierVerificationCurrent(supplier) && !payload?.revalidationReason) return supplier;
  if (payload?.revalidationReason) {
    const reason = String(payload.revalidationReason).trim();
    if (reason.length < 8) throw new AppError(422, "Document the reason for supplier revalidation.");
    const previous = supplier.taxpayerValidation.toObject();
    supplier.taxpayerValidation.revalidationRequired = true;
    await supplier.save();
    await recordAudit({ entityType: "Supplier", entity: supplier, action: "TAXPAYER_REVALIDATION_REQUESTED", module: "SUPPLIERS", user, req, comments: reason, oldValues: previous });
  }
  const provider = sunatService.status();
  if (provider.variant === "PADRON") return validateAutomaticSupplierTaxpayer(supplier, user, req);
  const result = await sunatService.validateTaxpayer(supplier.normalizedIdentifier || supplier.rucDni, {
    authorizedDecision: provider.mode === "MANUAL",
    valid: parseBoolean(payload.valid),
    returnedIdentifier: payload.returnedIdentifier,
    returnedLegalName: payload.returnedLegalName,
    comments: payload.comments,
    user
  });
  return recordSupplierTaxpayerResult({ supplier, result, provider, user, req, payload });
}

async function recordSupplierTaxpayerResult({ supplier, result, provider, user, req, payload = {} }) {
  const returnedIdentifier = result.returnedIdentifier || result.identifier || result.ruc || "";
  const returnedLegalName = result.returnedLegalName || result.legalName || result.name || "";
  const identifierMatch = matchResult(supplier.normalizedIdentifier || supplier.rucDni, normalizeSupplierIdentifier(returnedIdentifier));
  const legalNameMatch = matchResult(supplier.legalName || supplier.name, returnedLegalName);
  const valid = result.valid && identifierMatch === "MATCH" && legalNameMatch === "MATCH";
  supplier.taxpayerValidation = {
    status: valid ? "VALID" : "INVALID",
    providerMode: provider.state,
    providerConfigured: provider.configured,
    source: result.source || provider.state,
    returnedIdentifier,
    returnedLegalName,
    identifierMatch,
    legalNameMatch,
    sunat: result.sunat,
    validatedAt: new Date(),
    validatedBy: user._id,
    comments: String(result.comments || payload.comments || "").trim()
  };
  const authoritative = provider.mode === "MANUAL" || (provider.mode === "PRODUCTION" && provider.configured);
  supplier.taxpayerStatus = valid && authoritative
    ? (provider.mode === "MANUAL" ? "MANUALLY_VALIDATED" : "ACTIVE")
    : result.valid && !authoritative ? "PENDING" : "INACTIVE";
  supplier.compliance.taxpayerActive = Boolean(valid && authoritative);
  supplier.compliance.validatedAt = new Date();
  supplier.compliance.validatedBy = user._id;
  await supplier.save();
  await recordAudit({
    entityType: "Supplier",
    entity: supplier,
    action: "TAXPAYER_VALIDATION_RECORDED",
    user,
    req,
    module: "SUPPLIERS",
    comments: supplier.taxpayerValidation.comments,
    newValues: {
      status: supplier.taxpayerValidation.status,
      providerMode: supplier.taxpayerValidation.providerMode,
      source: supplier.taxpayerValidation.source,
      sunat: supplier.toObject().taxpayerValidation?.sunat,
      identifierMatch,
      legalNameMatch
    }
  });
  return supplier;
}

// Only server-fetched official taxpayer evidence is accepted here. This never
// validates invoices, bank ownership or the separate Finance compliance review.
export async function validateAutomaticSupplierTaxpayer(supplier, user, req, lookupProfile = getSupplierAutomaticPrefill) {
  const lookup = await lookupProfile(supplier.normalizedIdentifier || supplier.rucDni);
  const result = automaticTaxpayerResult(lookup);
  return recordSupplierTaxpayerResult({ supplier, result,
    provider: { mode: "PRODUCTION", state: "PRODUCTION", configured: true }, user, req });
}

export function automaticTaxpayerResult(lookup) {
  const official = lookup?.officialSource === true && ["SUNAT_CONSULTA_RUC", "SUNAT_PUBLIC_PADRON_RUC"].includes(lookup.source);
  const data = lookup?.data || {};
  if (!official) throw new AppError(503, "Official taxpayer evidence is unavailable. Automatic validation remains pending.");
  return {
    valid: lookup.found === true && data.active === true && data.habido === true,
    returnedIdentifier: data.rucDni || lookup.ruc,
    returnedLegalName: data.legalName || "",
    source: lookup.source,
    sunat: {
      taxpayerStatus: data.taxpayerStatus || "",
      domicileCondition: data.domicileCondition || "",
      registrationDate: sunatCalendarDate(data.registrationDate),
      activityStartDate: sunatCalendarDate(data.activityStartDate),
      deregistrationDate: sunatCalendarDate(data.deregistrationDate),
      queriedAt: lookup.queriedAt || undefined,
      datasetDate: sunatCalendarDate(lookup.datasetDate)
    },
    comments: `Automatic taxpayer review. Source: ${lookup.source}. Status: ${data.taxpayerStatus || "UNKNOWN"}. Condition: ${data.domicileCondition || "UNKNOWN"}. Evidence date: ${lookup.datasetDate || lookup.queriedAt || "unavailable"}.`
  };
}

// Reuses the public lookup cache when the form already retrieved the representatives.
// Never trust browser-submitted source/status/date fields as SUNAT evidence.
export async function recordSupplierSunatRepresentatives(supplier, user, req, lookup = lookupSunatLegalRepresentatives) {
  const ruc = supplier.normalizedIdentifier || supplier.rucDni;
  const result = await lookup(ruc, supplier.legalName || supplier.name);
  if (result?.officialSource !== true || result.source !== "SUNAT_CONSULTA_RUC_BROWSER" || result.ruc !== ruc) {
    throw new AppError(503, "Official SUNAT representative evidence does not match this RUC.");
  }
  const evidence = {
    ruc, legalName: result.legalName, source: result.source, queriedAt: result.queriedAt,
    entries: (result.representatives || []).map(person => ({
      documentType: person.documentType, documentNumber: person.documentNumber,
      fullName: person.fullName, position: person.position, dateFrom: sunatCalendarDate(person.dateFrom)
    }))
  };
  supplier.sunatRepresentatives = evidence;
  if (evidence.entries.length === 1 && !supplier.legalRepresentative && !supplier.legalRepresentativeDocument?.number) {
    const person = evidence.entries[0], type = representativeDocumentType(person.documentType);
    if (type) {
      supplier.legalRepresentative = person.fullName;
      supplier.legalRepresentativeDocument = { type, number: person.documentNumber };
    }
  }
  await supplier.save();
  await recordAudit({ entityType: "Supplier", entity: supplier, action: "SUNAT_REPRESENTATIVES_RECORDED", module: "SUPPLIERS", user, req, newValues: evidence });
  return supplier;
}

export function supplierDeclarationWarnings(supplier) {
  const warnings = [];
  if (supplier?.declarations?.stateSanctions?.answer === "YES") {
    warnings.push({
      code: "STATE_SANCTIONS_DECLARED",
      field: "declarations.stateSanctions",
      source: "RCO-FOR-002 A34:G34",
      message: "The supplier declared sanctions or relevant State proceedings. Review this before approving the supplier."
    });
  }
  if (supplier?.declarations?.complianceModel?.answer === "NO") {
    warnings.push({
      code: "COMPLIANCE_MODEL_NOT_AVAILABLE",
      field: "declarations.complianceModel",
      source: "RCO-FOR-002 A35:G35",
      message: "The supplier declared that no compliance/prevention model is available. Review this before approving the supplier."
    });
  }
  if (supplier?.similarNameWarning?.possibleDuplicateOf) {
    warnings.push({
      code: "POSSIBLE_DUPLICATE_SUPPLIER_NAME",
      field: "legalName",
      source: "Fix 1 - advisory name-similarity check (RUC/DNI is the hard duplicate key)",
      message: `This legal name closely matches an existing supplier (${supplier.similarNameWarning.matchedLegalName}) with a different RUC/DNI. Confirm these are not the same entity before approving.`
    });
  }
  return warnings;
}

export async function evaluateSupplierHomologation(supplierOrId) {
  const supplier = supplierOrId?.constructor?.modelName === "Supplier"
    ? supplierOrId
    : await loadSupplier(supplierOrId);
  const accounts = await SupplierBankAccount.find({ supplier: supplier._id, active: true });
  const issues = [];
  const add = (code, field, source, message) => issues.push({ code, field, source, message });
  const identifier = normalizeSupplierIdentifier(supplier.normalizedIdentifier || supplier.rucDni);
  if (!/^(\d{8}|\d{11})$/.test(identifier)) add("INVALID_SUPPLIER_IDENTIFIER", "rucDni", "Existing Supplier identifier rule", "A valid 11-digit RUC or supported 8-digit DNI is required.");
  if (!supplier.legalName && !supplier.name) add("LEGAL_NAME_MISSING", "legalName", "RCO-FOR-002 B9:D9", "Legal name is required.");
  if (!supplier.personType) add("PERSON_TYPE_MISSING", "personType", "RCO-FOR-002 E10:G10", "Person type is required.");
  if (!supplier.fiscalAddress && !supplier.taxAddress) add("FISCAL_ADDRESS_MISSING", "fiscalAddress", "RCO-FOR-002 A11:G11", "Fiscal address is required.");
  if (!supplier.legalRepresentative) add("LEGAL_REPRESENTATIVE_MISSING", "legalRepresentative", "RCO-FOR-002 A13:D13", "Legal representative is required.");
  if (!supplier.legalRepresentativeDocument?.type || !supplier.legalRepresentativeDocument?.number) {
    add("LEGAL_REPRESENTATIVE_DOCUMENT_MISSING", "legalRepresentativeDocument", "RCO-FOR-002 E13:G13", "Legal representative document type and number are required.");
  }
  // The supporting documents (RUC file, representative ID, bank certificate) and the compliance
  // declarations were taken out of the proposal form, so they no longer block the approval. Ones
  // already on file still show, and a risky declared answer still warns the jefe.
  const documentKinds = new Set((supplier.documents || []).map((item) => item.kind));
  // The jefe's approval needs no Accounting review. A SUNAT check that already ran still counts: an
  // identity that does not match, or a taxpayer SUNAT reports as not active or not habido, blocks it.
  const identifierMismatch = supplier.taxpayerValidation?.identifierMatch === "MISMATCH";
  const legalNameMismatch = supplier.taxpayerValidation?.legalNameMatch === "MISMATCH";
  if (identifierMismatch) add("TAXPAYER_IDENTIFIER_MISMATCH", "taxpayerValidation.identifierMatch", "RCO-FOR-002 B9:G13; PDF p.2", "The validated taxpayer identifier does not match the supplier record.");
  if (legalNameMismatch) add("TAXPAYER_LEGAL_NAME_MISMATCH", "taxpayerValidation.legalNameMatch", "RCO-FOR-002 B9:G13; PDF p.2", "The validated legal name does not match the supplier record.");
  if (supplier.taxpayerStatus === "INACTIVE" && !identifierMismatch && !legalNameMismatch) {
    add("TAXPAYER_NOT_ACTIVE", "taxpayerStatus", "SUNAT taxpayer check", "SUNAT reports this taxpayer as not active or not habido.");
  }
  if (["OBSERVED", "REJECTED", "INACTIVE"].includes(supplier.homologationStatus)) add("SUPPLIER_STATUS_BLOCKS_HOMOLOGATION", "homologationStatus", "Approved Phase 2 status policy", "The current supplier status must be resolved before homologation.");

  // Accounting's verification is what Treasury pays against (paymentDestinationService); approval
  // only needs an account that has not been rejected or found to belong to someone else.
  const acceptableAccounts = accounts.filter((account) => {
    const ownershipAccepted = account.ownershipResult === "MATCH"
      || (account.ownershipResult === "MANUAL_ACCEPTED" && String(account.verificationComments || "").trim());
    return account.verificationStatus === "VERIFIED" && ownershipAccepted && /^\d{20}$/.test(account.cci || "");
  });
  const usableAccounts = accounts.filter((account) => account.verificationStatus !== "REJECTED" && account.ownershipResult !== "MISMATCH");
  if (!accounts.length) add("ACTIVE_BANK_ACCOUNT_MISSING", "bankAccounts", "RCO-FOR-002 A26:G31", "At least one active supplier payment account is required.");
  else if (!usableAccounts.length) add("BANK_ACCOUNT_REJECTED", "bankAccounts", "RCO-FOR-002 A26:G31", "Every active bank account was rejected or does not belong to the supplier. Add a correct account first.");

  return {
    valid: issues.length === 0,
    issues,
    warnings: supplierDeclarationWarnings(supplier),
    summary: {
      supportingDocumentsPresent: SUPPORTING_DOCUMENT_KINDS.filter((kind) => documentKinds.has(kind)),
      activeBankAccountCount: accounts.length,
      acceptableBankAccountCount: acceptableAccounts.length,
      jefeApproval: supplier.jefeApproval?.decision || "PENDING"
    }
  };
}

export async function assertSupplierCanBeHomologated(supplier) {
  const result = await evaluateSupplierHomologation(supplier);
  if (!result.valid) {
    throw new AppError(
      422,
      "Supplier homologation requirements are incomplete.",
      result,
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  return result;
}

export async function getSupplierHomologationReadiness(supplierId) {
  const supplier = await loadSupplier(supplierId);
  if (supplier.homologationStatus === "HOMOLOGATED" && supplier.active && !isHomologationExpired(supplier)) {
    return { valid: true, legacyCompatible: true, issues: [], warnings: supplierDeclarationWarnings(supplier) };
  }
  return evaluateSupplierHomologation(supplier);
}

function isHomologationExpired(supplier) {
  return Boolean(supplier?.homologationValidUntil) && new Date(supplier.homologationValidUntil).getTime() < Date.now();
}

const JEFE_DECISIONS = Object.freeze({ APPROVE: "APPROVED", OBSERVE: "OBSERVED", REJECT: "REJECTED" });

// Accounting or Admin approves, observes or rejects a waiting supplier.
// Approving homologates it: an immutable PRV code, active and usable on any requester's request.
export async function decideSupplierApproval({ supplierId, payload = {}, user, req }) {
  const action = String(payload.decision || "").trim().toUpperCase();
  const decision = JEFE_DECISIONS[action];
  if (!decision) throw new AppError(422, "Choose to approve, observe or reject the supplier.", { decision: payload.decision }, ERROR_CODES.VALIDATION_ERROR);
  const comments = String(payload.comments || "").trim();
  if (decision !== "APPROVED" && !comments) {
    throw new AppError(422, "Comments are required when a supplier is observed or rejected.", { field: "comments" }, ERROR_CODES.VALIDATION_ERROR);
  }
  const supplier = await loadSupplier(supplierId);
  if (!awaitsApproval(supplier)) {
    throw new AppError(409, "This supplier is not waiting for approval.", { homologationStatus: supplier.homologationStatus }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  if (String(idOf(supplier.proposedBy)) === String(user._id)) {
    throw new AppError(403, "Another Accounting or Admin user must review the supplier you proposed.", undefined, ERROR_CODES.FORBIDDEN);
  }
  const approval = await supplierApproverFor(supplier.proposedBy);
  if (!decidesSupplierApproval(supplier, user, approval)) {
    throw new AppError(
      403,
      "Only Accounting or Admin can review this supplier.",
      { approver: approval.approver },
      ERROR_CODES.FORBIDDEN
    );
  }
  const result = decision === "APPROVED"
    ? await approveSupplier({ supplier, user, req, approval, comments })
    : { supplier: await observeOrRejectSupplier({ supplier, decision, user, req, approval, comments }), assignedCode: false };
  await resolveNotification(`supplier:${supplier._id}:approval`);
  // Accounting's earlier "evidence ready for Finance review" alert no longer applies.
  await resolveNotification(`supplier:${supplier._id}:finance-ready`);
  await resolveNotification(`supplier:${supplier._id}:finance-review`);
  try { await notifySupplierDecision(result.supplier, { decision, user, comments }); }
  catch (error) { console.warn("[SUPPLIER] Decision notification failed:", error.message); }
  return result;
}

function jefeDecisionRecord(decision, user, approval, comments) {
  return { decision, decidedBy: user._id, coveringFor: approval.coveringFor?._id, decidedAt: new Date(), comments };
}

async function approveSupplier({ supplier, user, req, approval, comments }) {
  if (!supplierVerificationCurrent(supplier) && sunatService.status().variant === "PADRON") {
    // A fresh official check when SUNAT answers; its being unreachable never blocks the jefe.
    try { supplier = await validateAutomaticSupplierTaxpayer(supplier, user, req); }
    catch (error) { console.warn("[SUPPLIER] Automatic taxpayer check skipped at approval:", error.code || error.name); }
  }
  const readiness = await assertSupplierCanBeHomologated(supplier);
  const oldValues = { supplierCode: supplier.supplierCode, homologationStatus: supplier.homologationStatus, active: supplier.active, homologationValidUntil: supplier.homologationValidUntil };
  // Fix 2: homologation is only valid for a configurable period (default 12 months) from the date it is
  // granted or renewed - see computeHomologationValidUntil()/SUPPLIER_HOMOLOGATION_VALIDITY_MONTHS_KEY.
  const homologationValidUntil = await computeHomologationValidUntil();
  const granted = {
    homologationStatus: "HOMOLOGATED",
    status: "ACTIVE",
    active: true,
    homologationValidUntil,
    jefeApproval: jefeDecisionRecord("APPROVED", user, approval, comments),
    reviewedBy: user._id,
    reviewedAt: new Date(),
    reviewComments: comments
  };
  let assignedCode = false;
  if (!supplier.supplierCode) {
    const candidate = await nextSupplierCode();
    const updated = await Supplier.findOneAndUpdate(
      {
        _id: supplier._id,
        homologationStatus: { $ne: "HOMOLOGATED" },
        $or: [{ supplierCode: { $exists: false } }, { supplierCode: null }, { supplierCode: "" }]
      },
      { $set: { supplierCode: candidate, ...granted } },
      { new: true, runValidators: true }
    );
    if (!updated) {
      throw new AppError(409, "Supplier approval changed concurrently. Refresh and try again.", undefined, ERROR_CODES.CONFLICT);
    }
    supplier = updated;
    assignedCode = true;
  } else {
    supplier.set(granted);
    await supplier.save();
  }
  if (assignedCode) {
    await recordAudit({
      entityType: "Supplier",
      entity: supplier,
      action: "PRV_ASSIGNED",
      user,
      req,
      module: "SUPPLIERS",
      newValues: { supplierCode: supplier.supplierCode }
    });
  }
  await recordAudit({
    entityType: "Supplier",
    entity: supplier,
    action: "APPROVED_BY_ACCOUNTING",
    user,
    req,
    module: "SUPPLIERS",
    comments,
    oldValues,
    newValues: { supplierCode: supplier.supplierCode, homologationStatus: supplier.homologationStatus, active: supplier.active, homologationValidUntil: supplier.homologationValidUntil, coveringFor: approval.coveringFor?._id || null }
  });
  return { supplier, assignedCode, readiness };
}

async function observeOrRejectSupplier({ supplier, decision, user, req, approval, comments }) {
  const oldValues = { homologationStatus: supplier.homologationStatus, active: supplier.active };
  supplier.homologationStatus = decision;
  supplier.status = decision;
  supplier.active = false;
  supplier.homologationValidUntil = undefined;
  supplier.jefeApproval = jefeDecisionRecord(decision, user, approval, comments);
  supplier.reviewedBy = user._id;
  supplier.reviewedAt = new Date();
  supplier.reviewComments = comments;
  await supplier.save();
  await recordAudit({
    entityType: "Supplier",
    entity: supplier,
    action: decision === "OBSERVED" ? "OBSERVED_BY_ACCOUNTING" : "REJECTED_BY_ACCOUNTING",
    user,
    req,
    module: "SUPPLIERS",
    comments,
    oldValues,
    newValues: { homologationStatus: supplier.homologationStatus, coveringFor: approval.coveringFor?._id || null }
  });
  return supplier;
}

async function notifySupplierDecision(supplier, { decision, user, comments }) {
  const reference = { path: `/suppliers/${supplier._id}`, entityType: "Supplier", entityId: supplier._id };
  const name = supplierName(supplier);
  if (supplier.proposedBy) {
    const copy = {
      APPROVED: [notificationText("Supplier approved"), notificationText("{supplier} was approved by {name} and can now be used on requests.", { supplier: name, name: user.name })],
      OBSERVED: [notificationText("Supplier observed"), notificationText("{supplier} was observed by {name}: {comments}", { supplier: name, name: user.name, comments })],
      REJECTED: [notificationText("Supplier rejected"), notificationText("{supplier} was rejected by {name}: {comments}", { supplier: name, name: user.name, comments })]
    }[decision];
    await notifyUser({
      userId: idOf(supplier.proposedBy),
      eventKey: `supplier:${supplier._id}:decision:${Date.now()}`,
      type: "SUPPLIER_APPROVAL_DECISION",
      title: copy[0],
      message: copy[1],
      ...reference
    });
  }
  // Treasury pays only to an account Accounting verified, so an approved supplier's pending
  // account goes to Accounting now.
  if (decision === "APPROVED" && await SupplierBankAccount.exists({ supplier: supplier._id, active: true, verificationStatus: "PENDING" })) {
    await notifyRoles({
      roles: [ROLES.ACCOUNTING, ROLES.ADMIN],
      eventKey: `supplier:${supplier._id}:bank-review`,
      type: "SUPPLIER_BANK_REVIEW",
      title: notificationText("Supplier bank account to verify"),
      message: notificationText("{supplier} was approved for use. Verify its bank account so Treasury can pay it.", { supplier: name }),
      ...reference
    });
  }
}

export function isSupplierUsable(supplier) {
  return Boolean(supplier && supplier.active && supplier.homologationStatus === "HOMOLOGATED" && !isHomologationExpired(supplier));
}

// Finance review gates financial processing; request approval does not homologate a supplier.
export function assertSupplierUsable(supplier) {
  if (isSupplierUsable(supplier)) return;
  const details = { supplier: supplier?._id, homologationStatus: supplier?.homologationStatus };
  if (supplier?.active && supplier.homologationStatus === "HOMOLOGATED" && isHomologationExpired(supplier)) {
    throw new AppError(
      422,
      "The supplier review has expired. Accounting must renew it before financial processing.",
      { ...details, homologationValidUntil: supplier.homologationValidUntil, reason: "HOMOLOGATION_EXPIRED" },
      ERROR_CODES.SUPPLIER_NOT_HOMOLOGATED
    );
  }
  const status = supplier?.homologationStatus || supplier?.status;
  if (status === "REJECTED") throw new AppError(422, "This supplier was rejected and cannot be used. Select another supplier.", details, ERROR_CODES.SUPPLIER_REJECTED);
  if (status === "INACTIVE") throw new AppError(422, "This supplier is inactive and cannot be used. Select another supplier.", details, ERROR_CODES.SUPPLIER_INACTIVE);
  if (status === "PENDING_VALIDATION") {
    throw new AppError(422, "This supplier is waiting for the approval of Accounting before financial processing.", details, ERROR_CODES.SUPPLIER_NOT_HOMOLOGATED);
  }
  if (status === "OBSERVED") {
    throw new AppError(422, "This supplier was observed by Accounting and must be corrected before it can be used.", details, ERROR_CODES.SUPPLIER_NOT_HOMOLOGATED);
  }
  throw new AppError(422, "An active approved supplier is required.", details, ERROR_CODES.SUPPLIER_NOT_HOMOLOGATED);
}

// A request may be submitted while Finance reviews its provider. Rejected, inactive or observed providers still block.
export function assertSupplierSubmittable(supplier) {
  if (awaitsApproval(supplier)) return;
  assertSupplierUsable(supplier);
}

// Where a request's supplier stands for the person deciding the request: null once it is usable (or
// cannot be approved at all), otherwise who approves it, whether that is this user, and what the
// approval still needs.
export async function supplierApprovalForRequest(supplierOrId, user) {
  if (!idOf(supplierOrId)) return null;
  const supplier = await Supplier.findById(idOf(supplierOrId));
  if (!supplier || !awaitsApproval(supplier)) return null;
  const approval = await supplierApproverFor(supplier.proposedBy);
  const readiness = await evaluateSupplierHomologation(supplier);
  return {
    supplier: { _id: supplier._id, name: supplierName(supplier), rucDni: supplier.rucDni },
    yours: decidesSupplierApproval(supplier, user, approval),
    approver: approval.approver ? { _id: approval.approver._id, name: approval.approver.name } : null,
    adminFallback: approval.adminFallback,
    ready: readiness.valid,
    issues: readiness.issues.map(({ code, field, message }) => ({ code, field, message }))
  };
}

export async function getActiveBankAccount(supplierId, { bank, currency } = {}) {
  const query = { supplier: supplierId, active: true };
  if (bank) query.bank = String(bank).toUpperCase();
  if (currency) query.currency = currency;
  return SupplierBankAccount.findOne(query).sort({ preferred: -1, validFrom: -1 });
}

// Compatibility adapter for existing seed/tests: adding a replacement now preserves every active account.
export async function replaceActiveBankAccount(supplier, payload, userId) {
  const bankFieldsProvided = ["bankName", "bankAccount", "cci", "currency", "accountType", "accountHolderName"]
    .some((field) => payload[field] !== undefined);
  const existingActive = await SupplierBankAccount.findOne({ supplier: supplier._id, active: true }).sort({ preferred: -1, validFrom: -1 });
  if (!bankFieldsProvided && existingActive) return { account: existingActive, warnings: [] };
  if (!bankFieldsProvided) return { account: null, warnings: [] };
  const bank = String(payload.bankName || "").trim().toUpperCase();
  const accountNumber = assertValidBankAccountNumber(payload.bankAccount);
  const cci = assertValidCci(payload.cci, { required: false });
  const currency = payload.currency || supplier.currency || "PEN";
  const accountType = payload.accountType || "CURRENT";
  if (accountType === "DETRACTION" && bank !== "BANCO_NACION") {
    throw new AppError(422, "Detraction accounts must use Banco de la Nacion.", { requiredBank: "BANCO_NACION" }, ERROR_CODES.VALIDATION_ERROR);
  }
  const duplicate = await SupplierBankAccount.findOne({ supplier: supplier._id, bank, currency, accountType, accountNumber, active: true });
  if (duplicate) return { account: duplicate, warnings: await reusedBankWarnings({ supplierId: supplier._id, accountNumber, cci }) };
  const preferredExists = await SupplierBankAccount.exists({ supplier: supplier._id, currency, accountType, active: true, preferred: true });
  const now = new Date();
  const account = await SupplierBankAccount.create({
    supplier: supplier._id,
    bank,
    currency,
    accountType,
    accountHolderName: payload.accountHolderName || supplier.legalName || supplier.name,
    accountNumber,
    cci,
    active: true,
    preferred: !preferredExists,
    verificationStatus: "PENDING",
    ownershipResult: "NOT_REVIEWED",
    validFrom: now,
    createdBy: userId,
    changedBy: userId
  });
  supplier.bankName = bank;
  supplier.bankAccount = accountNumber;
  supplier.cci = cci;
  supplier.bankHistory.push({
    bankName: bank,
    currency,
    accountType,
    accountHolderName: account.accountHolderName,
    bankAccount: accountNumber,
    cci,
    status: "ACTIVE",
    preferred: account.preferred,
    verificationStatus: "PENDING",
    ownershipResult: "NOT_REVIEWED",
    validFrom: now,
    createdBy: userId,
    changedBy: userId
  });
  return { account, warnings: await reusedBankWarnings({ supplierId: supplier._id, accountNumber, cci }) };
}

// Accounting/Admin correct supplier data, add accounts, record the SUNAT check, deactivate or reopen.
// Approving, observing or rejecting is the proposer's jefe's decision (decideSupplierApproval).
export async function updateAndReviewSupplier({ supplierId, payload, files = {}, user, req }) {
  assertFinanceUser(user);
  const requestedStatus = payload.homologationStatus || payload.status;
  if (["HOMOLOGATED", "ACTIVE", "OBSERVED", "REJECTED"].includes(requestedStatus) || payload.complianceReviewResult || payload.complianceReview) {
    throw new AppError(403, "Only Accounting or Admin approves, observes or rejects a supplier.", { requestedStatus }, ERROR_CODES.FORBIDDEN);
  }
  let warnings = [];
  const proposalKeys = [...proposalScalarFields, ...structuredProposalFields, "declarations", "rucDni"];
  const hasProposalUpdate = proposalKeys.some((field) => payload[field] !== undefined) || Object.keys(files || {}).length > 0;
  if (hasProposalUpdate) await updateSupplierProposal({ supplierId, payload, files, user, req });
  if (payload.bankName || payload.bankAccount || payload.accountNumber) {
    const bank = await addSupplierBankAccount({ supplierId, payload, user, req });
    warnings = bank.warnings;
  }
  if (payload.taxpayerActive !== undefined || payload.taxpayerStatus) {
    await validateSupplierTaxpayer({
      supplierId,
      payload: {
        valid: parseBoolean(payload.taxpayerActive) || ["ACTIVE", "MANUALLY_VALIDATED"].includes(payload.taxpayerStatus),
        returnedIdentifier: payload.returnedIdentifier,
        returnedLegalName: payload.returnedLegalName,
        comments: payload.complianceComments
      },
      user,
      req
    });
  }
  if (requestedStatus === "INACTIVE") {
    await deactivateSupplier({ supplierId, user, req });
  } else if (requestedStatus === "PENDING_VALIDATION") {
    // Fix 2: the only supported transition out of INACTIVE is a full re-homologation pass. Requesting
    // PENDING_VALIDATION on a currently-inactive supplier reactivates it into that pass; any other current
    // status is already PENDING_VALIDATION or handled by the branches above, so this is a no-op for them.
    const current = await loadSupplier(supplierId);
    if (current.homologationStatus === "INACTIVE") {
      await reactivateSupplier({ supplierId, user, req });
    }
  }
  return { supplier: await loadSupplier(supplierId), warnings };
}

export async function deactivateSupplier({ supplierId, user, req }) {
  assertFinanceUser(user, "Only Accounting or Admin can deactivate suppliers.");
  const supplier = await loadSupplier(supplierId);
  supplier.homologationStatus = "INACTIVE";
  supplier.active = false;
  supplier.status = "INACTIVE";
  supplier.homologationValidUntil = undefined;
  supplier.reviewedBy = user._id;
  supplier.reviewedAt = new Date();
  await supplier.save();
  const now = new Date();
  await SupplierBankAccount.updateMany(
    { supplier: supplier._id, active: true },
    { $set: { active: false, preferred: false, validTo: now, changedBy: user._id } }
  );
  for (const history of supplier.bankHistory || []) {
    if (history.status === "ACTIVE") {
      history.status = "INACTIVE";
      history.preferred = false;
      history.validTo = now;
      history.changedAt = now;
      history.changedBy = user._id;
    }
  }
  await supplier.save();
  await recordAudit({ entityType: "Supplier", entity: supplier, action: "DEACTIVATED", user, req, module: "SUPPLIERS" });
  await resolveNotification(`supplier:${supplier._id}:approval`);
  return supplier;
}

// Fix 2: reactivating a previously inactive supplier requires a fresh approval by the proposer's jefe,
// the same as a material fiscal/legal data change - it does not restore HOMOLOGATED status directly. Bank
// accounts stay deactivated (unrelated to homologation) and must be reverified/re-added as needed.
export async function reactivateSupplier({ supplierId, user, req }) {
  assertFinanceUser(user, "Only Accounting or Admin can reactivate suppliers.");
  const supplier = await loadSupplier(supplierId);
  if (supplier.homologationStatus !== "INACTIVE") {
    throw new AppError(
      409,
      "Only an inactive supplier can be reactivated.",
      { homologationStatus: supplier.homologationStatus },
      ERROR_CODES.INVALID_STATUS_TRANSITION
    );
  }
  const oldValues = { homologationStatus: supplier.homologationStatus, active: supplier.active };
  supplier.homologationStatus = "PENDING_VALIDATION";
  supplier.status = "PENDING_VALIDATION";
  supplier.active = false;
  supplier.homologationValidUntil = undefined;
  supplier.jefeApproval = { decision: "PENDING" };
  supplier.reviewedBy = user._id;
  supplier.reviewedAt = new Date();
  await supplier.save();
  await recordAudit({
    entityType: "Supplier",
    entity: supplier,
    action: "REACTIVATION_REQUIRES_REHOMOLOGATION",
    user,
    req,
    module: "SUPPLIERS",
    oldValues,
    newValues: { homologationStatus: supplier.homologationStatus, active: supplier.active }
  });
  try { await notifySupplierApprover(supplier); }
  catch (error) { console.warn("[SUPPLIER] Approver notification failed:", error.message); }
  return supplier;
}

// ---- Suppliers by area. Accounting and Admin decide which areas see a supplier (none: every area).
export async function updateSupplierDepartments({ supplierId, departments, user, req }) {
  assertFinanceUser(user, "Only Accounting or Admin can choose which areas see a supplier.");
  const supplier = await loadSupplier(supplierId);
  const next = sanitizeDepartments(departments);
  const previous = [...(supplier.departments || [])];
  supplier.departments = next;
  await supplier.save();
  await recordAudit({
    entityType: "Supplier",
    entity: supplier,
    action: "DEPARTMENTS_UPDATED",
    user,
    req,
    module: "SUPPLIERS",
    oldValues: { departments: previous },
    newValues: { departments: next }
  });
  // Requests to share it are answered by this change.
  await Notification.updateMany({ eventKey: { $regex: `^supplier:${supplier._id}:access-request:` }, resolvedAt: null }, { $set: { resolvedAt: new Date() } });
  return supplier;
}

// A requester who needs another area's supplier asks for it: Accounting and Admin get a task to
// share it with the requester's area. Nothing is shared until one of them does it.
export async function requestSupplierAccess({ supplierId, user, req, reason = "" }) {
  const supplier = await loadSupplier(supplierId);
  if (canSeeSupplier(supplier, user)) return { alreadyVisible: true, supplier: { _id: supplier._id, supplierCode: supplier.supplierCode } };
  const area = userDepartment(user);
  await notifyRoles({
    roles: [ROLES.ACCOUNTING, ROLES.ADMIN],
    eventKey: `supplier:${supplier._id}:access-request:${user._id}`,
    type: "SUPPLIER_ACCESS_REQUEST",
    title: notificationText("Share a supplier with an area"),
    message: area
      ? notificationText("{name} ({area}) needs supplier {supplier}. Share it with their area if it is correct.", { name: user.name, area, supplier: `${supplier.supplierCode || ""} ${supplierName(supplier)}`.trim() })
      : notificationText("{name} needs supplier {supplier}, but their profile has no area. Assign their area in Users first.", { name: user.name, supplier: `${supplier.supplierCode || ""} ${supplierName(supplier)}`.trim() }),
    path: `/suppliers/${supplier._id}`,
    entityType: "Supplier",
    entityId: supplier._id
  });
  await recordAudit({
    entityType: "Supplier",
    entity: supplier,
    action: "ACCESS_REQUESTED",
    user,
    req,
    module: "SUPPLIERS",
    comments: String(reason || "").trim().slice(0, 500),
    newValues: { area }
  });
  return { requested: true, supplier: { _id: supplier._id, supplierCode: supplier.supplierCode } };
}
