import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import {
  LEGACY_EXPENSE_NATURE_MAP,
  LEGACY_REQUEST_TYPE_MAP,
  LEGACY_STATUS_MAP,
  REQUEST_STATUS
} from "../src/utils/constants.js";

const MIGRATION_KEY = "2026-08-canonical-workflow-v1";
const apply = process.argv.includes("--apply");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportDir = path.resolve(__dirname, "..", "migration-reports");

function normalizedIdentifier(value) {
  return String(value || "").replace(/\D/g, "");
}

function mapExpenseTypeCategory(value) {
  return value === "Non-deductible" ? "NON_DEDUCTIBLE" : value;
}

function mapAccountingClass(value) {
  return ({ "Class 6": "CLASS_6", "Class 3": "CLASS_3", "Account 99": "NON_DEDUCTIBLE" }[value] || value);
}

async function main() {
  await connectDB();
  const db = mongoose.connection.db;
  const existingRun = await db.collection("migrationruns").findOne({ key: MIGRATION_KEY });
  if (existingRun && apply) {
    console.log(`Migration ${MIGRATION_KEY} was already applied at ${existingRun.appliedAt.toISOString()}.`);
    return;
  }

  const report = {
    migration: MIGRATION_KEY,
    mode: apply ? "APPLY" : "DRY_RUN",
    generatedAt: new Date().toISOString(),
    summary: {
      requestsScanned: 0,
      requestsChanged: 0,
      suppliersScanned: 0,
      suppliersChanged: 0,
      bankAccountsImported: 0,
      expenseTypesChanged: 0,
      exchangeRatesChanged: 0,
      periodsChanged: 0,
      usersChanged: 0,
      accountsPayableCreated: 0,
      requestLineSnapshotsAdded: 0,
      manualReview: 0
    },
    manualReview: [],
    changes: []
  };

  const suppliers = await db.collection("suppliers").find({}).toArray();
  const supplierMap = new Map(suppliers.map((supplier) => [String(supplier._id), supplier]));
  report.summary.suppliersScanned = suppliers.length;

  for (const supplier of suppliers) {
    const identifier = normalizedIdentifier(supplier.rucDni || supplier.normalizedIdentifier);
    const statusMap = {
      ACTIVE: { active: true, homologationStatus: "HOMOLOGATED" },
      PENDING_VALIDATION: { active: false, homologationStatus: "PENDING_VALIDATION" },
      OBSERVED: { active: false, homologationStatus: "OBSERVED" },
      INACTIVE: { active: false, homologationStatus: "INACTIVE" }
    };
    const status = statusMap[supplier.status] || { active: Boolean(supplier.active), homologationStatus: supplier.homologationStatus || "PENDING_VALIDATION" };
    const set = {
      identifierType: identifier.length === 8 ? "DNI" : "RUC",
      normalizedIdentifier: identifier,
      legalName: supplier.legalName || supplier.name,
      taxAddress: supplier.taxAddress || supplier.fiscalAddress || "",
      taxpayerStatus: supplier.taxpayerStatus || (supplier.compliance?.taxpayerActive ? "MANUALLY_VALIDATED" : "PENDING"),
      complianceStatus: supplier.complianceStatus || (supplier.compliance?.compliant ? "COMPLIANT" : "PENDING"),
      ...status
    };
    report.summary.suppliersChanged += 1;
    if (apply) await db.collection("suppliers").updateOne({ _id: supplier._id }, { $set: set });

    if (supplier.bankName && supplier.bankAccount) {
      const bankFilter = { supplier: supplier._id, accountNumber: supplier.bankAccount, active: true };
      const existingBank = await db.collection("supplierbankaccounts").findOne(bankFilter);
      if (!existingBank) {
        report.summary.bankAccountsImported += 1;
        if (apply) {
          await db.collection("supplierbankaccounts").insertOne({
            supplier: supplier._id,
            bank: String(supplier.bankName).toUpperCase(),
            currency: supplier.currency || "PEN",
            accountNumber: supplier.bankAccount,
            cci: supplier.cci || "",
            active: true,
            validFrom: supplier.createdAt || new Date(),
            legacyImported: true,
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }
      }
    }
  }

  const [costCentersForSnapshot, expenseTypesForSnapshot] = await Promise.all([
    db.collection("costcenters").find({}).toArray(),
    db.collection("expensetypes").find({}).toArray()
  ]);
  const costCenterMap = new Map(costCentersForSnapshot.map((item) => [String(item._id), item]));
  const expenseTypeMap = new Map(expenseTypesForSnapshot.map((item) => [String(item._id), item]));

  const requests = await db.collection("financialrequests").find({}).toArray();
  for (const request of requests) {
    report.summary.requestsScanned += 1;
    const set = {};
    const reasons = [];
    const originalStatus = request.status;
    let mappedStatus = LEGACY_STATUS_MAP[originalStatus] || originalStatus;

    if (originalStatus === "APROBADO_POR_PAGAR") {
      if (request.fiscalData?.processedAt || request.fiscalData?.accountingDate) mappedStatus = REQUEST_STATUS.ACCOUNTED;
      else reasons.push("Legacy APROBADO_POR_PAGAR has no conclusive accounting evidence; status was not changed.");
    }
    if (originalStatus === "PROCESADO_BANCO") {
      const paymentEntryCount = await db.collection("accountingentries").countDocuments({ request: request._id, type: "PAYMENT" });
      const confirmed = Boolean(request.payment?.confirmedAt && request.payment?.operationNumber);
      if (paymentEntryCount || confirmed) {
        reasons.push("Legacy bank processing may have created payment/budget effects at TXT generation; Accounting and Treasury must review before confirmation.");
      }
    }
    if (mappedStatus !== originalStatus && !(originalStatus === "APROBADO_POR_PAGAR" && reasons.length)) set.status = mappedStatus;

    const mappedType = LEGACY_REQUEST_TYPE_MAP[request.requestType] || request.requestType;
    const mappedNature = LEGACY_EXPENSE_NATURE_MAP[request.expenseNature] || request.expenseNature;
    if (mappedType !== request.requestType) set.requestType = mappedType;
    if (mappedNature !== request.expenseNature) set.expenseNature = mappedNature;
    set.requester = request.requester || request.solicitor;
    set.requesterArea = request.requesterArea || request.requestingArea || "";
    set.totalNet = request.totalNet ?? request.netAmount ?? 0;
    set.totalIGV = request.totalIGV ?? request.igvAmount ?? 0;
    set.totalPENEquivalent = request.totalPENEquivalent ?? request.penEquivalent ?? request.totalAmount ?? 0;
    set.sourceCurrencyAmount = request.sourceCurrencyAmount ?? request.totalAmount ?? 0;
    set.exchangeRateDate = request.exchangeRateDate || request.issueDate;
    set.exchangeRateSource = request.exchangeRateSource || "LEGACY_SNAPSHOT_REQUIRES_REVIEW";
    set.lines = (request.lines || []).map((line) => {
      const center = costCenterMap.get(String(line.costCenter));
      const expense = expenseTypeMap.get(String(line.expenseType));
      report.summary.requestLineSnapshotsAdded += 1;
      return {
        ...line,
        currency: line.currency || request.currency,
        exchangeRate: line.exchangeRate || request.exchangeRate || 1,
        penEquivalent: line.penEquivalent ?? Number((Number(line.totalAmount || 0) * Number(request.exchangeRate || 1)).toFixed(2)),
        costCenterSnapshot: line.costCenterSnapshot || (center ? { code: center.code, name: center.name, area: center.area } : undefined),
        expenseTypeSnapshot: line.expenseTypeSnapshot || (expense ? {
          code: expense.code,
          name: expense.name,
          category: mapExpenseTypeCategory(expense.category),
          accountingClass: mapAccountingClass(expense.accountingClass),
          accountNumber: expense.accountNumber,
          deductible: expense.category !== "Non-deductible" && expense.category !== "NON_DEDUCTIBLE"
        } : undefined)
      };
    });

    const supplier = supplierMap.get(String(request.supplier));
    if (supplier) {
      set.supplierSnapshot = {
        identifierType: normalizedIdentifier(supplier.rucDni).length === 8 ? "DNI" : "RUC",
        identifier: normalizedIdentifier(supplier.rucDni),
        legalName: supplier.legalName || supplier.name,
        homologationStatus: supplier.homologationStatus || (supplier.status === "ACTIVE" ? "HOMOLOGATED" : "PENDING_VALIDATION")
      };
      if (request.fiscalData?.documentType) {
        set["fiscalData.supplierIdentifierNormalized"] = normalizedIdentifier(supplier.rucDni);
        set["fiscalData.voucherType"] = String(request.fiscalData.voucherType || request.fiscalData.documentType).trim().toUpperCase();
        set["fiscalData.series"] = String(request.fiscalData.series || "").trim().toUpperCase();
        set["fiscalData.number"] = String(request.fiscalData.number || "").trim().toUpperCase();
      }
    }

    const hasFiscalIdentity = Boolean(
      supplier &&
      request.fiscalData?.documentType &&
      request.fiscalData?.series &&
      request.fiscalData?.number &&
      request.fiscalData?.processedAt
    );
    const conclusivelyPaid = Boolean(request.payment?.confirmedAt && request.payment?.operationNumber);
    const apEligible = hasFiscalIdentity && (
      mappedStatus === REQUEST_STATUS.ACCOUNTED ||
      (conclusivelyPaid && [REQUEST_STATUS.PAID, REQUEST_STATUS.CLOSED, REQUEST_STATUS.RECONCILED].includes(mappedStatus))
    );
    const existingAp = await db.collection("accountspayables").findOne({ request: request._id });
    if (existingAp) {
      set.accountsPayable = existingAp._id;
    } else if (apEligible) {
      const apId = new mongoose.Types.ObjectId();
      const effectiveId = apId;
      set.accountsPayable = effectiveId;
      report.summary.accountsPayableCreated += 1;
      const paid = conclusivelyPaid;
      if (apply) {
        await db.collection("accountspayables").insertOne({
          _id: effectiveId,
          request: request._id,
          supplier: request.supplier,
          supplierIdentifierSnapshot: normalizedIdentifier(supplier.rucDni),
          voucher: {
            voucherType: String(request.fiscalData.voucherType || request.fiscalData.documentType).trim().toUpperCase().replace(/\s+/g, ""),
            documentType: String(request.fiscalData.documentType).trim().toUpperCase().replace(/\s+/g, ""),
            series: String(request.fiscalData.series).trim().toUpperCase().replace(/\s+/g, ""),
            number: String(request.fiscalData.number).trim().toUpperCase().replace(/\s+/g, ""),
            documentDate: request.fiscalData.documentDate
          },
          originalAmount: request.totalAmount || 0,
          currency: request.currency || "PEN",
          exchangeRate: request.exchangeRate || 1,
          penEquivalent: request.penEquivalent || request.totalPENEquivalent || request.totalAmount || 0,
          outstandingAmount: paid ? 0 : request.totalAmount || 0,
          status: paid ? "PAID" : "OPEN",
          paidDate: paid ? request.payment.paidAt : undefined,
          history: [{ status: paid ? "PAID" : "OPEN", at: new Date(), comments: "Created by conservative canonical migration; journal linkage requires review." }],
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
      reasons.push("Explicit CXP was created from conclusive fiscal evidence; no balanced journal was fabricated from legacy one-sided rows.");
    } else if ([REQUEST_STATUS.ACCOUNTED, REQUEST_STATUS.PAID, REQUEST_STATUS.CLOSED, REQUEST_STATUS.BANK_FILE_GENERATED].includes(mappedStatus)) {
      reasons.push("Historical status suggests Accounting/Treasury processing but evidence is insufficient for automatic CXP creation.");
    }

    if (!/^SOL-\d{4}-\d{5}$/.test(request.requestNumber || "")) {
      reasons.push(`Historical request number ${request.requestNumber || "(missing)"} is retained and will not be rewritten.`);
    }
    if (reasons.length) {
      report.summary.manualReview += 1;
      report.manualReview.push({ id: String(request._id), requestNumber: request.requestNumber, status: originalStatus, reasons });
      set.migrationReview = { required: true, reasons, migratedFromStatus: originalStatus, migratedAt: new Date() };
    } else if (mappedStatus !== originalStatus) {
      set.migrationReview = { required: false, reasons: [], migratedFromStatus: originalStatus, migratedAt: new Date() };
    }

    report.summary.requestsChanged += 1;
    report.changes.push({ entity: "FinancialRequest", id: String(request._id), requestNumber: request.requestNumber, set });
    if (apply) await db.collection("financialrequests").updateOne({ _id: request._id }, { $set: set });
  }

  const expenseTypes = await db.collection("expensetypes").find({}).toArray();
  for (const expenseType of expenseTypes) {
    const set = {
      category: mapExpenseTypeCategory(expenseType.category),
      accountingClass: mapAccountingClass(expenseType.accountingClass),
      deductible: expenseType.category !== "Non-deductible",
      active: expenseType.active !== false
    };
    report.summary.expenseTypesChanged += 1;
    if (apply) await db.collection("expensetypes").updateOne({ _id: expenseType._id }, { $set: set });
  }

  const rates = await db.collection("exchangerates").find({}).toArray();
  for (const rate of rates) {
    const bcrp = /BCRP|SBS/i.test(rate.source || "");
    const sunat = /SUNAT/i.test(rate.source || "");
    const set = {
      currency: "USD",
      quoteCurrency: "PEN",
      providerMode: bcrp ? "BCRP_FALLBACK" : "MANUAL",
      sourceLabel: rate.source || "Authorized manual selling rate",
      source: bcrp ? "BCRP_FALLBACK" : "MANUAL",
      authoritative: false,
      active: rate.active !== false
    };
    if (sunat) {
      set.sourceLabel = `${rate.source} (legacy label; authority requires review)`;
      report.manualReview.push({ entity: "ExchangeRate", id: String(rate._id), reason: "Legacy source claimed SUNAT without a configured SUNAT provider." });
      report.summary.manualReview += 1;
    }
    report.summary.exchangeRatesChanged += 1;
    if (apply) await db.collection("exchangerates").updateOne({ _id: rate._id }, { $set: set });
  }

  const periods = await db.collection("accountingperiods").find({}).toArray();
  for (const period of periods) {
    const set = {
      openedAt: period.openedAt || period.createdAt || new Date(),
      closedAt: period.closedAt || period.closingDate || null,
      history: period.history?.length ? period.history : [{
        action: period.status === "CLOSED" ? "CLOSED" : "CREATED",
        at: period.closedAt || period.closingDate || period.createdAt || new Date(),
        by: period.closedBy || period.openedBy,
        comments: "Imported by canonical workflow migration."
      }]
    };
    report.summary.periodsChanged += 1;
    if (apply) await db.collection("accountingperiods").updateOne({ _id: period._id }, { $set: set });
  }

  const users = await db.collection("users").find({}).toArray();
  for (const user of users) {
    const set = {};
    if (user.role === "Approver" && !user.approvalAreas?.length) set.approvalAreas = user.area ? [user.area] : [];
    if (!user.costCenter && user.area) {
      const candidates = costCentersForSnapshot.filter((center) => center.area === user.area && center.active !== false);
      if (candidates.length === 1) set.costCenter = candidates[0]._id;
      else if (user.role === "Solicitor") {
        report.manualReview.push({ entity: "User", id: String(user._id), email: user.email, reason: "Requester Cost Center could not be inferred uniquely from area." });
        report.summary.manualReview += 1;
      }
    }
    if (Object.keys(set).length) {
      report.summary.usersChanged += 1;
      if (apply) await db.collection("users").updateOne({ _id: user._id }, { $set: set });
    }
  }

  const requestNumbers = requests
    .map((request) => /^(?:SOL|REQ)-(\d{4})-(\d+)$/.exec(request.requestNumber || ""))
    .filter(Boolean);
  for (const year of [...new Set(requestNumbers.map((match) => Number(match[1])))]) {
    const maximum = Math.max(...requestNumbers.filter((match) => Number(match[1]) === year).map((match) => Number(match[2])));
    if (apply) {
      await db.collection("counters").updateOne(
        { key: "financial-request", year },
        { $max: { sequence: maximum }, $setOnInsert: { key: "financial-request", year, createdAt: new Date() }, $set: { updatedAt: new Date() } },
        { upsert: true }
      );
    }
  }

  const legacyEntries = await db.collection("accountingentries").countDocuments();
  if (legacyEntries) {
    report.summary.manualReview += legacyEntries;
    report.manualReview.push({
      entity: "AccountingEntry",
      count: legacyEntries,
      reason: "Legacy rows are retained as read-only history and are not fabricated into balanced journals. Review/source documents are required."
    });
  }

  const legacyBankFiles = await db.collection("generatedfiles").countDocuments({ kind: "BANK_TXT" });
  if (legacyBankFiles) {
    report.summary.manualReview += legacyBankFiles;
    report.manualReview.push({
      entity: "GeneratedFile",
      count: legacyBankFiles,
      reason: "Legacy bank TXT files predate persisted PaymentBatch records and remain download-only history."
    });
  }

  await fs.mkdir(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportFile = path.join(reportDir, `${MIGRATION_KEY}-${apply ? "apply" : "dry-run"}-${stamp}.json`);
  await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (apply) {
    await db.collection("migrationruns").updateOne(
      { key: MIGRATION_KEY },
      { $setOnInsert: { key: MIGRATION_KEY, appliedAt: new Date(), summary: report.summary, reportFile, createdAt: new Date(), updatedAt: new Date() } },
      { upsert: true }
    );
  }

  console.log(JSON.stringify({ mode: report.mode, reportFile, summary: report.summary }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
