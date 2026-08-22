import AuditLog from "../models/AuditLog.js";
import Supplier from "../models/Supplier.js";
import SupplierBankAccount from "../models/SupplierBankAccount.js";
import { recordAudit } from "./auditService.js";
import { cleanupUploadedFiles, persistUploadedFiles } from "./storageService.js";
import { paginatedPayload, parsePagination, parseSort, escapedRegex } from "./queryService.js";
import { nextSupplierCode } from "./sequenceService.js";
import { sunatService } from "./sunatService.js";
import { runFinancialOperation } from "./transactionService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, ROLES } from "../utils/constants.js";
import { assertValidBankAccountNumber, assertValidCci } from "../utils/bankAccountValidation.js";

const FINANCE_ROLES = Object.freeze([ROLES.ADMIN, ROLES.ACCOUNTING]);
const EDITABLE_PROPOSAL_STATUSES = Object.freeze(["PENDING_VALIDATION", "OBSERVED"]);
const REQUIRED_DOCUMENT_KINDS = Object.freeze(["RUC_FILE", "BANK_CERTIFICATE", "LEGAL_REP_ID"]);

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
  "verifiedBy",
  "verifiedAt",
  "verificationStatus",
  "ownershipResult"
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
    if (payload[field] !== undefined) supplier[field] = payload[field];
  }
  for (const field of structuredProposalFields) {
    const value = parseStructuredValue(payload[field], field);
    if (value !== undefined) supplier[field] = value;
  }
  const declarations = sanitizedDeclarations(payload.declarations, supplier.declarations || {});
  if (declarations) supplier.declarations = declarations;
}

function assertProposalEditable(supplier, user) {
  if (!EDITABLE_PROPOSAL_STATUSES.includes(supplier.homologationStatus)) {
    throw new AppError(
      409,
      "Supplier proposal fields can only be changed while pending validation or observed.",
      { homologationStatus: supplier.homologationStatus },
      ERROR_CODES.INVALID_STATUS_TRANSITION
    );
  }
  if (user.role === ROLES.SOLICITOR && String(idOf(supplier.proposedBy)) !== String(user._id)) {
    throw new AppError(403, "Solicitors may correct only supplier proposals they created.", undefined, ERROR_CODES.FORBIDDEN);
  }
  if (![ROLES.SOLICITOR, ...FINANCE_ROLES].includes(user.role)) {
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

function canViewFullBankData(supplier, user) {
  if ([ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY].includes(user?.role)) return true;
  return user?.role === ROLES.SOLICITOR
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

function serializeSupplierBase(supplier, user) {
  const value = supplier.toObject ? supplier.toObject() : { ...supplier };
  if (canViewFullBankData(supplier, user)) return value;
  return {
    ...value,
    bankAccount: maskBankValue(value.bankAccount),
    cci: maskBankValue(value.cci),
    bankHistory: (value.bankHistory || []).map((item) => ({
      ...item,
      bankAccount: maskBankValue(item.bankAccount),
      cci: maskBankValue(item.cci),
      verificationSource: undefined,
      verificationDocument: undefined
    }))
  };
}

function supplierPermissions(supplier, user) {
  const finance = FINANCE_ROLES.includes(user?.role);
  const editable = EDITABLE_PROPOSAL_STATUSES.includes(supplier.homologationStatus);
  const proposerOwns = String(idOf(supplier.proposedBy)) === String(user?._id || "");
  return {
    canEditProposal: editable && (finance || (user?.role === ROLES.SOLICITOR && proposerOwns)),
    canUploadDocuments: editable && (finance || (user?.role === ROLES.SOLICITOR && proposerOwns)),
    canAddBankAccount: finance || (editable && user?.role === ROLES.SOLICITOR && proposerOwns),
    canReview: finance && supplier.homologationStatus !== "HOMOLOGATED",
    canVerifyBanking: finance,
    canHomologate: finance && supplier.homologationStatus !== "HOMOLOGATED",
    canViewFullBankData: canViewFullBankData(supplier, user)
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
  const accountType = payload.accountType || "CURRENT";
  if (accountType === "DETRACTION" && bank !== "BANCO_NACION") {
    throw new AppError(
      422,
      "Detraction accounts must use Banco de la Nacion.",
      { field: "bank", accountType, requiredBank: "BANCO_NACION" },
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  const accountNumber = assertValidBankAccountNumber(payload.accountNumber || payload.bankAccount);
  const cci = assertValidCci(payload.cci, { required: requireCci });
  const currency = payload.currency || supplier.currency || "PEN";
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
      newValues: { accountId: account._id, bank, currency, accountType, verificationStatus: "PENDING", warnings }
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
      permissions: supplierPermissions(supplier, user)
    }
  };
}

export async function getSupplierDetailPayload(supplierId, user) {
  const supplier = await Supplier.findById(supplierId)
    .populate("proposedBy", "name email role")
    .populate("compliance.validatedBy", "name email role")
    .populate("taxpayerValidation.validatedBy", "name email role")
    .populate("complianceReview.reviewedBy", "name email role")
    .populate("reviewedBy", "name email role")
    .populate("documents.uploadedBy", "name email role");
  if (!supplier) throw new AppError(404, "Supplier not found.", { supplierId }, ERROR_CODES.NOT_FOUND);
  const [accounts, audit] = await Promise.all([
    SupplierBankAccount.find({ supplier: supplier._id })
      .populate("verifiedBy", "name email role")
      .populate("createdBy", "name email role")
      .populate("changedBy", "name email role")
      .sort({ active: -1, preferred: -1, validFrom: -1 }),
    AuditLog.find({ entityType: "Supplier", entityId: supplier._id }).sort({ createdAt: -1 }).limit(100).lean()
  ]);
  const reveal = canViewFullBankData(supplier, user);
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
    ...serializeSupplierBase(supplier, user),
    bankAccounts: accounts.map((account) => serializeBankAccount(account, reveal)),
    auditHistory,
    permissions: supplierPermissions(supplier, user),
    riskyDeclarations: supplierDeclarationWarnings(supplier),
    sunatProvider: sunatService.status()
  };
}

export async function listSuppliersPage(queryParams, user) {
  const query = {};
  if (queryParams.homologationStatus) query.homologationStatus = queryParams.homologationStatus;
  if (queryParams.complianceReviewResult) query["complianceReview.result"] = queryParams.complianceReviewResult;
  if (queryParams.active !== undefined) query.active = queryParams.active === "true";
  if (queryParams.search) {
    const search = new RegExp(escapedRegex(queryParams.search), "i");
    query.$or = [{ supplierCode: search }, { rucDni: search }, { normalizedIdentifier: search }, { name: search }, { commercialName: search }, { legalName: search }];
  }
  const { page, pageSize, skip } = parsePagination(queryParams);
  const sort = parseSort(queryParams, ["supplierCode", "name", "commercialName", "legalName", "rucDni", "createdAt", "homologationStatus"], { legalName: 1, name: 1 });
  const [data, total] = await Promise.all([
    Supplier.find(query)
      .populate("proposedBy", "name email role")
      .populate("complianceReview.reviewedBy", "name email role")
      .sort(sort).skip(skip).limit(pageSize),
    Supplier.countDocuments(query)
  ]);
  const supplierIds = data.map((supplier) => supplier._id);
  const bankAccounts = await SupplierBankAccount.find({ supplier: { $in: supplierIds }, active: true })
    .sort({ preferred: -1, validFrom: -1 });
  const bySupplier = bankAccounts.reduce((map, account) => {
    const key = String(account.supplier);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(account);
    return map;
  }, new Map());
  return paginatedPayload(data.map((supplier) => {
    const accounts = bySupplier.get(String(supplier._id)) || [];
    const reveal = canViewFullBankData(supplier, user);
    return {
      ...serializeSupplierBase(supplier, user),
      bankAccounts: accounts.map((account) => serializeBankAccount(account, reveal)),
      activeBankAccountCount: accounts.length,
      verifiedBankAccountCount: accounts.filter((account) => account.verificationStatus === "VERIFIED").length,
      permissions: supplierPermissions(supplier, user),
      riskyDeclarations: supplierDeclarationWarnings(supplier)
    };
  }), total, page, pageSize);
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
    throw new AppError(
      409,
      "A supplier with this RUC/DNI already exists. Open the existing onboarding record instead.",
      { supplier: duplicate._id, homologationStatus: duplicate.homologationStatus },
      ERROR_CODES.DUPLICATE_SUPPLIER
    );
  }
  const supplier = new Supplier({
    identifierType: identifier.length === 8 ? "DNI" : "RUC",
    rucDni: identifier,
    normalizedIdentifier: identifier,
    legalName: payload.legalName || payload.name,
    commercialName: payload.commercialName || payload.name || payload.legalName,
    name: payload.name || payload.legalName,
    proposedBy: user._id,
    proposedAt: new Date(),
    taxpayerStatus: "PENDING",
    complianceStatus: "PENDING",
    homologationStatus: "PENDING_VALIDATION",
    active: false,
    status: "PENDING_VALIDATION"
  });
  applyProposalFields(supplier, payload);
  let persistedFiles = {};
  try {
    persistedFiles = await persistUploadedFiles(files, { domain: "suppliers", entityId: supplier._id });
    const uploadedDocuments = mapUploadedDocuments(persistedFiles, user._id);
    supplier.documents.push(...uploadedDocuments);
    await supplier.save();
    let bankResult = { warnings: [] };
    if (payload.bankName || payload.bank || payload.bankAccount || payload.accountNumber) {
      bankResult = await createBankAccountRecord({ supplier, payload, user, req });
    }
    await recordAudit({
      entityType: "Supplier",
      entity: supplier,
      action: "CREATED_PENDING_VALIDATION",
      user,
      req,
      module: "SUPPLIERS",
      newValues: { identifier, legalName: supplier.legalName, proposalJustification: supplier.proposalJustification }
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
    return { supplier, warnings: bankResult.warnings || [] };
  } catch (error) {
    await cleanupUploadedFiles(persistedFiles);
    await SupplierBankAccount.deleteMany({ supplier: supplier._id }).catch(() => undefined);
    await Supplier.deleteOne({ _id: supplier._id, homologationStatus: "PENDING_VALIDATION" }).catch(() => undefined);
    throw error;
  }
}

export async function updateSupplierProposal({ supplierId, payload, files = {}, user, req }) {
  if (user.role === ROLES.SOLICITOR) {
    assertFieldsAreNotPresent(payload, protectedSupplierFields, "Solicitors cannot set supplier review, status or PRV fields.");
    assertFieldsAreNotPresent(payload, protectedBankReviewFields, "Solicitors cannot set bank review fields.");
  }
  const supplier = await loadSupplier(supplierId, { includeDocumentPaths: true });
  assertProposalEditable(supplier, user);
  const oldValues = {
    rucDni: supplier.rucDni,
    legalName: supplier.legalName,
    homologationStatus: supplier.homologationStatus,
    complianceReview: supplier.complianceReview?.toObject?.() || supplier.complianceReview
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
  let persistedFiles = {};
  try {
    persistedFiles = await persistUploadedFiles(files, { domain: "suppliers", entityId: supplier._id });
    const uploadedDocuments = mapUploadedDocuments(persistedFiles, user._id);
    supplier.documents.push(...uploadedDocuments);
    if (oldValues.homologationStatus === "OBSERVED") {
      supplier.homologationStatus = "PENDING_VALIDATION";
      supplier.status = "PENDING_VALIDATION";
      supplier.complianceReview.result = "PENDING";
      supplier.complianceReview.reviewedBy = undefined;
      supplier.complianceReview.reviewedAt = undefined;
    }
    await supplier.save();
    await recordAudit({
      entityType: "Supplier",
      entity: supplier,
      action: oldValues.homologationStatus === "OBSERVED" ? "CORRECTION_SUBMITTED" : "PROPOSAL_UPDATED",
      user,
      req,
      module: "SUPPLIERS",
      oldValues,
      newValues: { rucDni: supplier.rucDni, legalName: supplier.legalName, homologationStatus: supplier.homologationStatus }
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
    return { supplier, warnings: [] };
  } catch (error) {
    await cleanupUploadedFiles(persistedFiles);
    throw error;
  }
}

export async function addSupplierBankAccount({ supplierId, payload, user, req }) {
  const supplier = await loadSupplier(supplierId);
  if (user.role === ROLES.SOLICITOR) assertProposalEditable(supplier, user);
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
  const provider = sunatService.status();
  const result = await sunatService.validateTaxpayer(supplier.normalizedIdentifier || supplier.rucDni, {
    authorizedDecision: provider.mode === "MANUAL",
    valid: parseBoolean(payload.valid),
    returnedIdentifier: payload.returnedIdentifier,
    returnedLegalName: payload.returnedLegalName,
    comments: payload.comments,
    user
  });
  const returnedIdentifier = result.returnedIdentifier || result.identifier || result.ruc || "";
  const returnedLegalName = result.returnedLegalName || result.legalName || result.name || "";
  const identifierMatch = matchResult(supplier.normalizedIdentifier || supplier.rucDni, normalizeSupplierIdentifier(returnedIdentifier));
  const legalNameMatch = matchResult(supplier.legalName || supplier.name, returnedLegalName);
  supplier.taxpayerValidation = {
    status: result.valid ? "VALID" : "INVALID",
    providerMode: provider.state,
    providerConfigured: provider.configured,
    source: result.source || provider.state,
    returnedIdentifier,
    returnedLegalName,
    identifierMatch,
    legalNameMatch,
    validatedAt: new Date(),
    validatedBy: user._id,
    comments: String(result.comments || payload.comments || "").trim()
  };
  const authoritative = provider.mode === "MANUAL" || (provider.mode === "PRODUCTION" && provider.configured);
  supplier.taxpayerStatus = result.valid && authoritative
    ? (provider.mode === "MANUAL" ? "MANUALLY_VALIDATED" : "ACTIVE")
    : result.valid ? "PENDING" : "INACTIVE";
  supplier.compliance.taxpayerActive = Boolean(result.valid && authoritative);
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
      identifierMatch,
      legalNameMatch
    }
  });
  return supplier;
}

export async function reviewSupplierCompliance({ supplierId, payload, user, req }) {
  assertFinanceUser(user);
  const supplier = await loadSupplier(supplierId);
  if (["HOMOLOGATED", "REJECTED", "INACTIVE"].includes(supplier.homologationStatus)) {
    throw new AppError(409, "The current supplier status cannot be reopened through the review action.", { homologationStatus: supplier.homologationStatus }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  const result = payload.result;
  if (!["PENDING", "APPROVED", "OBSERVED", "REJECTED"].includes(result)) {
    throw new AppError(422, "A valid Finance compliance-review result is required.", { result }, ERROR_CODES.VALIDATION_ERROR);
  }
  const comments = String(payload.comments || "").trim();
  if (["OBSERVED", "REJECTED"].includes(result) && !comments) {
    throw new AppError(422, "Comments are required when a supplier is observed or rejected.", { field: "comments" }, ERROR_CODES.VALIDATION_ERROR);
  }
  const oldValues = {
    homologationStatus: supplier.homologationStatus,
    complianceReview: supplier.complianceReview?.toObject?.() || supplier.complianceReview
  };
  supplier.complianceReview.result = result;
  supplier.complianceReview.comments = comments;
  supplier.complianceReview.reviewedBy = user._id;
  supplier.complianceReview.reviewedAt = new Date();
  supplier.reviewedBy = user._id;
  supplier.reviewedAt = new Date();
  supplier.reviewComments = comments;
  if (result === "APPROVED") {
    supplier.complianceStatus = "COMPLIANT";
    supplier.compliance.compliant = true;
    supplier.homologationStatus = "PENDING_VALIDATION";
    supplier.status = "PENDING_VALIDATION";
  } else if (result === "OBSERVED") {
    supplier.complianceStatus = "OBSERVED";
    supplier.compliance.compliant = false;
    supplier.homologationStatus = "OBSERVED";
    supplier.status = "OBSERVED";
    supplier.active = false;
  } else if (result === "REJECTED") {
    supplier.complianceStatus = "NON_COMPLIANT";
    supplier.compliance.compliant = false;
    supplier.homologationStatus = "REJECTED";
    supplier.status = "REJECTED";
    supplier.active = false;
  } else {
    supplier.complianceStatus = "PENDING";
    supplier.compliance.compliant = false;
    supplier.homologationStatus = "PENDING_VALIDATION";
    supplier.status = "PENDING_VALIDATION";
    supplier.active = false;
  }
  await supplier.save();
  await recordAudit({
    entityType: "Supplier",
    entity: supplier,
    action: result === "OBSERVED" ? "OBSERVED" : result === "REJECTED" ? "REJECTED" : "COMPLIANCE_REVIEW_RECORDED",
    user,
    req,
    module: "SUPPLIERS",
    comments,
    oldValues,
    newValues: { result, homologationStatus: supplier.homologationStatus }
  });
  return supplier;
}

export function supplierDeclarationWarnings(supplier) {
  const warnings = [];
  if (supplier?.declarations?.stateSanctions?.answer === "YES") {
    warnings.push({
      code: "STATE_SANCTIONS_DECLARED",
      field: "declarations.stateSanctions",
      source: "RCO-FOR-002 A34:G34",
      message: "The supplier declared sanctions or relevant State proceedings. Finance review is required."
    });
  }
  if (supplier?.declarations?.complianceModel?.answer === "NO") {
    warnings.push({
      code: "COMPLIANCE_MODEL_NOT_AVAILABLE",
      field: "declarations.complianceModel",
      source: "RCO-FOR-002 A35:G35",
      message: "The supplier declared that no compliance/prevention model is available. Finance review is required."
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
  const documentKinds = new Set((supplier.documents || []).map((item) => item.kind));
  for (const kind of REQUIRED_DOCUMENT_KINDS) {
    if (!documentKinds.has(kind)) add(`MISSING_${kind}`, "documents", "RCO-FOR-002 A5:G6", `${kind} is required for homologation.`);
  }
  if (supplier.declarations?.stateSanctions?.answer === "NOT_DECLARED" || !supplier.declarations?.stateSanctions?.answer) {
    add("STATE_SANCTIONS_DECLARATION_INCOMPLETE", "declarations.stateSanctions", "RCO-FOR-002 A34:G34", "The State sanctions declaration must be completed.");
  }
  if (supplier.declarations?.complianceModel?.answer === "NOT_DECLARED" || !supplier.declarations?.complianceModel?.answer) {
    add("COMPLIANCE_MODEL_DECLARATION_INCOMPLETE", "declarations.complianceModel", "RCO-FOR-002 A35:G35", "The compliance/prevention-model declaration must be completed.");
  }
  const taxpayerValid = ["ACTIVE", "MANUALLY_VALIDATED"].includes(supplier.taxpayerStatus) || supplier.compliance?.taxpayerActive;
  if (!taxpayerValid) add("TAXPAYER_VALIDATION_REQUIRED", "taxpayerValidation", "Existing supplier taxpayer-validation rule", "Authorized taxpayer validation is required.");
  if (supplier.taxpayerValidation?.identifierMatch === "MISMATCH") add("TAXPAYER_IDENTIFIER_MISMATCH", "taxpayerValidation.identifierMatch", "RCO-FOR-002 B9:G13; PDF p.2", "The validated taxpayer identifier does not match the supplier record.");
  if (supplier.taxpayerValidation?.legalNameMatch === "MISMATCH") add("TAXPAYER_LEGAL_NAME_MISMATCH", "taxpayerValidation.legalNameMatch", "RCO-FOR-002 B9:G13; PDF p.2", "The validated legal name does not match the supplier record.");
  if (supplier.complianceReview?.result !== "APPROVED") add("FINANCE_REVIEW_NOT_APPROVED", "complianceReview.result", "RCO-FOR-002 A37:G43; approved Phase 2 responsibility mapping", "Finance compliance review must be approved.");
  if (["OBSERVED", "REJECTED", "INACTIVE"].includes(supplier.homologationStatus)) add("SUPPLIER_STATUS_BLOCKS_HOMOLOGATION", "homologationStatus", "Approved Phase 2 status policy", "The current supplier status must be resolved before homologation.");

  const acceptableAccounts = accounts.filter((account) => {
    const ownershipAccepted = account.ownershipResult === "MATCH"
      || (account.ownershipResult === "MANUAL_ACCEPTED" && String(account.verificationComments || "").trim());
    return account.verificationStatus === "VERIFIED" && ownershipAccepted && /^\d{20}$/.test(account.cci || "");
  });
  if (!accounts.length) add("ACTIVE_BANK_ACCOUNT_MISSING", "bankAccounts", "RCO-FOR-002 A26:G31", "At least one active supplier payment account is required.");
  else if (!acceptableAccounts.length) add("BANK_ACCOUNT_FINANCE_VERIFICATION_REQUIRED", "bankAccounts", "RCO-FOR-002 A26:G31; approved Phase 2 bank policy", "At least one active account needs acceptable Finance verification and ownership review.");

  return {
    valid: issues.length === 0,
    issues,
    warnings: supplierDeclarationWarnings(supplier),
    summary: {
      requiredDocumentsPresent: REQUIRED_DOCUMENT_KINDS.every((kind) => documentKinds.has(kind)),
      activeBankAccountCount: accounts.length,
      acceptableBankAccountCount: acceptableAccounts.length,
      financeReview: supplier.complianceReview?.result || "PENDING"
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
  if (supplier.homologationStatus === "HOMOLOGATED" && supplier.active) {
    return { valid: true, legacyCompatible: true, issues: [], warnings: supplierDeclarationWarnings(supplier) };
  }
  return evaluateSupplierHomologation(supplier);
}

export async function homologateSupplier({ supplierId, user, req }) {
  assertFinanceUser(user, "Only Accounting or Admin can homologate suppliers.");
  let supplier = await loadSupplier(supplierId);
  if (supplier.homologationStatus === "HOMOLOGATED" && supplier.active) {
    return { supplier, assignedCode: false, readiness: { valid: true, issues: [], warnings: supplierDeclarationWarnings(supplier) } };
  }
  const readiness = await assertSupplierCanBeHomologated(supplier);
  const oldValues = { supplierCode: supplier.supplierCode, homologationStatus: supplier.homologationStatus, active: supplier.active };
  let assignedCode = false;
  if (!supplier.supplierCode) {
    const candidate = await nextSupplierCode();
    const updated = await Supplier.findOneAndUpdate(
      {
        _id: supplier._id,
        homologationStatus: { $ne: "HOMOLOGATED" },
        $or: [{ supplierCode: { $exists: false } }, { supplierCode: null }, { supplierCode: "" }]
      },
      {
        $set: {
          supplierCode: candidate,
          homologationStatus: "HOMOLOGATED",
          status: "ACTIVE",
          active: true,
          reviewedBy: user._id,
          reviewedAt: new Date()
        }
      },
      { new: true, runValidators: true }
    );
    if (updated) {
      supplier = updated;
      assignedCode = true;
    } else {
      supplier = await loadSupplier(supplierId);
      if (supplier.homologationStatus !== "HOMOLOGATED" || !supplier.supplierCode) {
        throw new AppError(409, "Supplier homologation changed concurrently. Refresh and try again.", undefined, ERROR_CODES.CONFLICT);
      }
    }
  } else {
    supplier.homologationStatus = "HOMOLOGATED";
    supplier.status = "ACTIVE";
    supplier.active = true;
    supplier.reviewedBy = user._id;
    supplier.reviewedAt = new Date();
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
    action: "HOMOLOGATED",
    user,
    req,
    module: "SUPPLIERS",
    oldValues,
    newValues: { supplierCode: supplier.supplierCode, homologationStatus: supplier.homologationStatus, active: supplier.active }
  });
  return { supplier, assignedCode, readiness };
}

export function isSupplierUsable(supplier) {
  return Boolean(supplier && supplier.active && supplier.homologationStatus === "HOMOLOGATED");
}

export function assertSupplierUsable(supplier) {
  if (!isSupplierUsable(supplier)) {
    throw new AppError(422, "An active homologated supplier is required.", { supplier: supplier?._id }, ERROR_CODES.SUPPLIER_NOT_HOMOLOGATED);
  }
}

export function assertSupplierEligibleForRequestReview(supplier) {
  if (!supplier) {
    throw new AppError(404, "Supplier not found.", undefined, ERROR_CODES.NOT_FOUND);
  }
  const status = supplier.homologationStatus || supplier.status || "PENDING_VALIDATION";
  if (status === "REJECTED") {
    throw new AppError(
      422,
      "The recommended supplier is rejected. Select another eligible supplier before submission.",
      { supplier: supplier._id, homologationStatus: status },
      ERROR_CODES.SUPPLIER_REJECTED
    );
  }
  if (status === "INACTIVE" || (supplier.active === false && status === "HOMOLOGATED")) {
    throw new AppError(
      422,
      "The recommended supplier is inactive. Select another eligible supplier before submission.",
      { supplier: supplier._id, homologationStatus: status },
      ERROR_CODES.SUPPLIER_INACTIVE
    );
  }
  return supplier;
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

export async function addVerifiedSupplierBankAccount({ supplier, payload, user, req }) {
  assertFinanceUser(user, "Only Accounting or Admin can verify supplier bank accounts.");
  const added = await addSupplierBankAccount({ supplierId: supplier._id, payload: {
    bank: payload.bank || payload.bankName,
    currency: payload.currency,
    accountType: payload.accountType,
    accountHolderName: payload.accountHolderName,
    accountNumber: payload.accountNumber || payload.bankAccount,
    cci: payload.cci
  }, user, req });
  const account = await verifySupplierBankAccount({
    supplierId: supplier._id,
    accountId: added.account._id,
    payload: {
      verificationStatus: "VERIFIED",
      ownershipResult: payload.ownershipResult,
      comments: payload.verificationComments,
      verificationDocument: payload.verificationDocument
    },
    user,
    req
  });
  if (parseBoolean(payload.preferred)) {
    await setPreferredSupplierBankAccount({ supplierId: supplier._id, accountId: account._id, user, req });
  }
  return { account, warnings: added.warnings };
}

export async function updateAndReviewSupplier({ supplierId, payload, files = {}, user, req }) {
  assertFinanceUser(user);
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
  const requestedStatus = payload.homologationStatus || payload.status;
  const explicitReview = parseStructuredValue(payload.complianceReview, "complianceReview") || {};
  if (payload.complianceReviewResult || explicitReview.result) {
    await reviewSupplierCompliance({
      supplierId,
      payload: { result: payload.complianceReviewResult || explicitReview.result, comments: explicitReview.comments || payload.complianceComments || payload.reviewComments },
      user,
      req
    });
  } else if (requestedStatus === "OBSERVED" || requestedStatus === "REJECTED") {
    await reviewSupplierCompliance({ supplierId, payload: { result: requestedStatus, comments: payload.reviewComments || payload.complianceComments }, user, req });
  }
  if (requestedStatus === "HOMOLOGATED" || requestedStatus === "ACTIVE") {
    await homologateSupplier({ supplierId, user, req });
  } else if (requestedStatus === "INACTIVE") {
    await deactivateSupplier({ supplierId, user, req });
  }
  return { supplier: await loadSupplier(supplierId), warnings };
}

export async function deactivateSupplier({ supplierId, user, req }) {
  assertFinanceUser(user, "Only Accounting or Admin can deactivate suppliers.");
  const supplier = await loadSupplier(supplierId);
  supplier.homologationStatus = "INACTIVE";
  supplier.active = false;
  supplier.status = "INACTIVE";
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
  return supplier;
}
