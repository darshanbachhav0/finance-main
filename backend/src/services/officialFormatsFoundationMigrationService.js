import { FINANCE_CONFIGURATION_KEYS } from "../utils/constants.js";
import { normalizeBankAccountNumber, normalizeCci } from "../utils/bankAccountValidation.js";

export const OFFICIAL_FORMATS_FOUNDATION_MIGRATION_KEY = "2026-08-official-uma-formats-foundation-v1";

function supplierCodeNumber(value) {
  const match = /^PRV-(\d+)$/.exec(String(value || ""));
  return match ? Number(match[1]) : null;
}

function renditionNumberParts(value) {
  const match = /^RG-(\d{4})-(\d+)$/.exec(String(value || ""));
  return match ? { year: Number(match[1]), sequence: Number(match[2]) } : null;
}

function yearOf(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().getUTCFullYear() : date.getUTCFullYear();
}

async function atomicSequence(db, key, year) {
  const result = await db.collection("counters").findOneAndUpdate(
    { key, year },
    {
      $inc: { sequence: 1 },
      $setOnInsert: { key, year, createdAt: new Date() },
      $set: { updatedAt: new Date() }
    },
    { upsert: true, returnDocument: "after" }
  );
  const counter = result?.value || result;
  return counter.sequence;
}

async function synchronizeCounters(db, suppliers, requests) {
  const supplierMaximum = Math.max(0, ...suppliers.map((item) => supplierCodeNumber(item.supplierCode)).filter(Number.isFinite));
  await db.collection("counters").updateOne(
    { key: "supplier", year: 0 },
    { $max: { sequence: supplierMaximum }, $setOnInsert: { key: "supplier", year: 0, createdAt: new Date() }, $set: { updatedAt: new Date() } },
    { upsert: true }
  );

  const byYear = new Map();
  for (const request of requests) {
    const parts = renditionNumberParts(request.rendition?.number);
    if (parts) byYear.set(parts.year, Math.max(byYear.get(parts.year) || 0, parts.sequence));
  }
  for (const [year, sequence] of byYear) {
    await db.collection("counters").updateOne(
      { key: "rendition", year },
      { $max: { sequence }, $setOnInsert: { key: "rendition", year, createdAt: new Date() }, $set: { updatedAt: new Date() } },
      { upsert: true }
    );
  }
}

function legacyComplianceReview(supplier, report) {
  if (supplier.complianceReview?.result) return null;
  if (supplier.complianceStatus === "COMPLIANT" || supplier.compliance?.compliant === true) {
    return {
      result: "APPROVED",
      reviewedBy: supplier.reviewedBy || supplier.compliance?.validatedBy,
      reviewedAt: supplier.reviewedAt || supplier.compliance?.validatedAt,
      comments: supplier.reviewComments || supplier.compliance?.comments || "Migrated from legacy Finance compliance review."
    };
  }
  if (supplier.complianceStatus === "OBSERVED") {
    return {
      result: "OBSERVED",
      reviewedBy: supplier.reviewedBy || supplier.compliance?.validatedBy,
      reviewedAt: supplier.reviewedAt || supplier.compliance?.validatedAt,
      comments: supplier.reviewComments || supplier.compliance?.comments || "Migrated from legacy observed compliance review."
    };
  }
  if (supplier.complianceStatus === "NON_COMPLIANT") {
    report.manualReview.push({
      entity: "Supplier",
      id: String(supplier._id),
      reason: "Legacy NON_COMPLIANT is not automatically reinterpreted as the new genuine REJECTED outcome."
    });
    report.summary.manualReview += 1;
  }
  return { result: "PENDING", comments: "Legacy declarations and Finance review could not be separated automatically." };
}

function normalizedLegacyBankValues(account) {
  try {
    const accountNumber = normalizeBankAccountNumber(account.accountNumber);
    const cci = normalizeCci(account.cci);
    if (cci && cci.length !== 20) return { valid: false };
    return { valid: Boolean(accountNumber), accountNumber, cci };
  } catch {
    return { valid: false };
  }
}

export async function runOfficialFormatsFoundationMigration({ db, apply = false, now = new Date(), recordRun = true }) {
  const existingRun = await db.collection("migrationruns").findOne({ key: OFFICIAL_FORMATS_FOUNDATION_MIGRATION_KEY });
  if (existingRun && apply) {
    return {
      migration: OFFICIAL_FORMATS_FOUNDATION_MIGRATION_KEY,
      mode: "APPLY",
      alreadyApplied: true,
      appliedAt: existingRun.appliedAt,
      summary: existingRun.summary,
      manualReview: [],
      changes: []
    };
  }

  const report = {
    migration: OFFICIAL_FORMATS_FOUNDATION_MIGRATION_KEY,
    mode: apply ? "APPLY" : "DRY_RUN",
    generatedAt: now.toISOString(),
    alreadyApplied: false,
    summary: {
      suppliersScanned: 0,
      suppliersChanged: 0,
      supplierCodesAssigned: 0,
      requestsScanned: 0,
      requestsChanged: 0,
      renditionNumbersAssigned: 0,
      bankAccountsScanned: 0,
      bankAccountsChanged: 0,
      documentRulesChanged: 0,
      financeConfigurationsCreated: 0,
      manualReview: 0
    },
    manualReview: [],
    changes: []
  };

  const suppliers = await db.collection("suppliers").find({}).sort({ _id: 1 }).toArray();
  const requests = await db.collection("financialrequests").find({}).sort({ _id: 1 }).toArray();
  report.summary.suppliersScanned = suppliers.length;
  report.summary.requestsScanned = requests.length;
  if (apply) await synchronizeCounters(db, suppliers, requests);

  for (const supplier of suppliers) {
    const set = {};
    if (!supplier.commercialName && (supplier.name || supplier.legalName)) set.commercialName = supplier.name || supplier.legalName;
    const complianceReview = legacyComplianceReview(supplier, report);
    if (complianceReview) set.complianceReview = complianceReview;
    const homologated = supplier.homologationStatus === "HOMOLOGATED" || supplier.status === "ACTIVE";
    const rejected = supplier.homologationStatus === "REJECTED" || supplier.status === "REJECTED";
    if (homologated && !rejected && !supplier.supplierCode) {
      report.summary.supplierCodesAssigned += 1;
      set.supplierCode = apply
        ? `PRV-${String(await atomicSequence(db, "supplier", 0)).padStart(4, "0")}`
        : "PRV-<next atomic sequence>";
    }
    if (Object.keys(set).length) {
      report.summary.suppliersChanged += 1;
      report.changes.push({ entity: "Supplier", id: String(supplier._id), set });
      if (apply) await db.collection("suppliers").updateOne({ _id: supplier._id }, { $set: set });
    }
  }

  for (const request of requests) {
    const set = {};
    if (!request.title && request.description) set.title = String(request.description).trim().slice(0, 120);
    if (!request.detailedDescription && request.description) set.detailedDescription = request.description;
    const renditionStatus = request.rendition?.status;
    if (["SUBMITTED", "OBSERVED", "VALIDATED"].includes(renditionStatus) && !request.rendition?.number) {
      const date = request.rendition?.submittedAt || request.issueDate || request.createdAt || now;
      const year = yearOf(date);
      report.summary.renditionNumbersAssigned += 1;
      set["rendition.number"] = apply
        ? `RG-${year}-${String(await atomicSequence(db, "rendition", year)).padStart(5, "0")}`
        : `RG-${year}-<next atomic sequence>`;
    }
    if (Object.keys(set).length) {
      report.summary.requestsChanged += 1;
      report.changes.push({ entity: "FinancialRequest", id: String(request._id), set });
      if (apply) await db.collection("financialrequests").updateOne({ _id: request._id }, { $set: set });
    }
  }

  const bankAccounts = await db.collection("supplierbankaccounts").find({}).sort({ supplier: 1, validFrom: -1 }).toArray();
  report.summary.bankAccountsScanned = bankAccounts.length;
  const activeCounts = bankAccounts.reduce((map, account) => {
    if (account.active) map.set(String(account.supplier), (map.get(String(account.supplier)) || 0) + 1);
    return map;
  }, new Map());
  for (const account of bankAccounts) {
    const set = {};
    if (!account.accountType) set.accountType = "CURRENT";
    if (!account.verificationStatus) set.verificationStatus = "LEGACY_ACCEPTED";
    if (!account.ownershipResult) set.ownershipResult = "NOT_REVIEWED";
    if (account.legacyImported !== true) set.legacyImported = true;
    if (account.active && activeCounts.get(String(account.supplier)) === 1 && account.preferred !== true) set.preferred = true;
    if (!account.active && account.preferred === true) set.preferred = false;
    const normalized = normalizedLegacyBankValues(account);
    if (normalized.valid) {
      if (normalized.accountNumber !== account.accountNumber) set.accountNumber = normalized.accountNumber;
      if (normalized.cci !== (account.cci || "")) set.cci = normalized.cci;
    } else {
      report.manualReview.push({
        entity: "SupplierBankAccount",
        id: String(account._id),
        reason: "Legacy account/CCI could not be safely normalized; original value was retained."
      });
      report.summary.manualReview += 1;
    }
    if (Object.keys(set).length) {
      report.summary.bankAccountsChanged += 1;
      report.changes.push({ entity: "SupplierBankAccount", id: String(account._id), set });
      if (apply) await db.collection("supplierbankaccounts").updateOne({ _id: account._id }, { $set: set });
    }
  }

  const documentRules = await db.collection("documentrules").find({ "requirements.kind": "QUOTATION" }).toArray();
  for (const rule of documentRules) {
    if (rule.quotationPolicy?.enabled === true) continue;
    const minimumCount = Math.max(3, ...rule.requirements.filter((item) => item.kind === "QUOTATION").map((item) => Number(item.minCount || 1)));
    const quotationPolicy = { enabled: true, minimumCount, allowAuthorizedException: true, exceptionReasonRequired: true };
    report.summary.documentRulesChanged += 1;
    report.changes.push({ entity: "DocumentRule", id: String(rule._id), set: { quotationPolicy } });
    if (apply) await db.collection("documentrules").updateOne({ _id: rule._id }, { $set: { quotationPolicy } });
  }

  const mobilityEffectiveFrom = new Date(Date.UTC(2026, 0, 1));
  const existingMobilityConfiguration = await db.collection("financeconfigurations").findOne({
    key: FINANCE_CONFIGURATION_KEYS.LOCAL_MOBILITY_DAILY_LIMIT,
    active: true,
    effectiveFrom: { $lte: mobilityEffectiveFrom },
    $or: [
      { effectiveTo: { $exists: false } },
      { effectiveTo: null },
      { effectiveTo: { $gte: mobilityEffectiveFrom } }
    ]
  });
  if (!existingMobilityConfiguration) {
    report.summary.financeConfigurationsCreated += 1;
    const configuration = {
      key: FINANCE_CONFIGURATION_KEYS.LOCAL_MOBILITY_DAILY_LIMIT,
      numericValue: 41,
      currency: "PEN",
      behavior: "WARNING",
      effectiveFrom: mobilityEffectiveFrom,
      effectiveTo: null,
      active: true,
      description: "Official UMA local mobility daily limit; warning only in Phase 1.",
      source: "Formato_Rendicion_Gastos_UMA.xlsx, Rendición de Gastos, A12:E12",
      createdAt: now,
      updatedAt: now
    };
    report.changes.push({ entity: "FinanceConfiguration", id: null, insert: configuration });
    if (apply) await db.collection("financeconfigurations").insertOne(configuration);
  }

  if (apply && recordRun) {
    await db.collection("migrationruns").updateOne(
      { key: OFFICIAL_FORMATS_FOUNDATION_MIGRATION_KEY },
      {
        $setOnInsert: {
          key: OFFICIAL_FORMATS_FOUNDATION_MIGRATION_KEY,
          appliedAt: now,
          summary: report.summary,
          createdAt: now,
          updatedAt: now
        }
      },
      { upsert: true }
    );
  }
  return report;
}
