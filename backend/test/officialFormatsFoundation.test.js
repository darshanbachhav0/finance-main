import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Counter from "../src/models/Counter.js";
import DocumentRule from "../src/models/DocumentRule.js";
import EmployeeReimbursementBankAccount from "../src/models/EmployeeReimbursementBankAccount.js";
import FinanceConfiguration from "../src/models/FinanceConfiguration.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";
import User from "../src/models/User.js";
import {
  defaultQuotationPolicy,
  validateStructuredQuotationComparison
} from "../src/services/documentRuleService.js";
import { evaluateMobilityLines } from "../src/services/financeConfigurationService.js";
import {
  runOfficialFormatsFoundationMigration
} from "../src/services/officialFormatsFoundationMigrationService.js";
import { nextRenditionNumber, nextSupplierCode } from "../src/services/sequenceService.js";
import {
  addVerifiedSupplierBankAccount,
  updateAndReviewSupplier
} from "../src/services/supplierService.js";
import {
  assertValidCci,
  normalizeBankAccountNumber,
  normalizeCci
} from "../src/utils/bankAccountValidation.js";
import { EXPENSE_NATURE, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };

test("official UMA format Phase 1 foundations remain additive and migration-safe", { timeout: 120000 }, async (t) => {
  const databaseName = `erp_official_formats_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await Promise.all([
      Counter.init(),
      FinancialRequest.init(),
      Supplier.init(),
      SupplierBankAccount.init(),
      EmployeeReimbursementBankAccount.init(),
      FinanceConfiguration.init(),
      User.init()
    ]);

    const objectIds = Array.from({ length: 12 }, () => new mongoose.Types.ObjectId());

    await t.test("legacy request, supplier, rendition, and bank documents still load", async () => {
      const legacyRequest = FinancialRequest.hydrate({
        _id: objectIds[0],
        requestNumber: "SOL-2026-80001",
        issueDate: new Date("2026-08-01"),
        accountingPeriod: "2026-08",
        requestType: "OPEX",
        expenseNature: "SERVICES",
        currency: "PEN",
        supplier: objectIds[1],
        solicitor: objectIds[2],
        description: "Legacy request",
        lines: [{ costCenter: objectIds[3], expenseType: objectIds[4], netAmount: 100, igvAmount: 18, totalAmount: 118 }],
        rendition: { amountAdvanced: 118, amountRendered: 0, status: "PENDING" }
      });
      const legacySupplier = Supplier.hydrate({ _id: objectIds[1], rucDni: "20600000001", name: "Legacy Supplier", status: "ACTIVE" });
      const legacyBank = SupplierBankAccount.hydrate({
        _id: objectIds[5],
        supplier: objectIds[1],
        bank: "BCP",
        currency: "PEN",
        accountNumber: "123",
        cci: "legacy-value",
        active: true,
        legacyImported: true
      });
      assert.equal(legacyRequest.description, "Legacy request");
      assert.equal(legacyRequest.rendition.status, "PENDING");
      assert.equal(legacySupplier.name, "Legacy Supplier");
      assert.equal(legacyBank.cci, "legacy-value");
    });

    await t.test("PRV and RG sequences are unique under concurrent use", async () => {
      const supplierCodes = await Promise.all(Array.from({ length: 20 }, () => nextSupplierCode()));
      const renditionCodes = await Promise.all(Array.from({ length: 20 }, () => nextRenditionNumber(new Date("2026-08-01"))));
      assert.equal(new Set(supplierCodes).size, 20);
      assert.equal(new Set(renditionCodes).size, 20);
      assert.ok(supplierCodes.every((value) => /^PRV-\d{4,}$/.test(value)));
      assert.ok(renditionCodes.every((value) => /^RG-2026-\d{5,}$/.test(value)));
    });

    await t.test("CCI and account normalization accepts formatting but rejects invalid length", () => {
      assert.equal(normalizeBankAccountNumber(" 001-234-567 "), "001234567");
      assert.equal(normalizeCci("002-1234 5678-9012 3456-7"), "00212345678901234567");
      assert.equal(assertValidCci("002 12345678901234567"), "00212345678901234567");
      assert.throws(() => assertValidCci("002-123"), /exactly 20 digits/);
      assert.throws(() => normalizeCci("002/123"), /digits only/);
    });

    await t.test("new enums reject unsupported values", () => {
      const invalidSupplier = new Supplier({ rucDni: "20600000012", name: "Invalid Enum", personType: "UNSUPPORTED" });
      assert.ok(invalidSupplier.validateSync()?.errors.personType);
      const invalidBank = new SupplierBankAccount({
        supplier: objectIds[1],
        bank: "BCP",
        currency: "PEN",
        accountType: "SAVINGS",
        accountNumber: "123",
        cci: "00212345678901234567"
      });
      assert.ok(invalidBank.validateSync()?.errors.accountType);
    });

    await t.test("commercial totals use the existing decimal-safe money helpers", async () => {
      const request = new FinancialRequest({
        requestNumber: "SOL-2026-80002",
        issueDate: new Date("2026-08-01"),
        accountingPeriod: "2026-08",
        requestType: REQUEST_TYPE.CAPEX,
        expenseNature: EXPENSE_NATURE.EQUIPMENT,
        currency: "PEN",
        supplier: objectIds[1],
        solicitor: objectIds[2],
        description: "Commercial calculation",
        lines: [{
          itemDescription: "Laboratory device",
          quantity: 3,
          unitOfMeasure: "UNIT",
          unitPrice: 10.005,
          costCenter: objectIds[3],
          expenseType: objectIds[4],
          netAmount: 30.03,
          igvAmount: 0,
          totalAmount: 30.03
        }]
      });
      await request.validate();
      assert.equal(request.lines[0].commercialTotal, 30.03);
      assert.equal(request.totalCommercialAmount, 30.03);
      assert.equal(request.commercialTotalStatus, "MATCH");
      assert.equal(request.totalAmount, 30.03);
    });

    await t.test("quotation comparison enforces the approved structured foundation without changing submission", () => {
      const supplierIds = [objectIds[6], objectIds[7], objectIds[8]];
      const policy = defaultQuotationPolicy({ requestType: REQUEST_TYPE.CAPEX, expenseNature: EXPENSE_NATURE.GOODS });
      const request = {
        requestType: REQUEST_TYPE.CAPEX,
        expenseNature: EXPENSE_NATURE.GOODS,
        supplier: supplierIds[1],
        supplierSelectionReason: "Best evaluated price and delivery period.",
        quotations: supplierIds.map((supplier, index) => ({
          supplier,
          amount: 100 + index,
          currency: "PEN",
          attachment: objectIds[index],
          recommended: index === 1
        }))
      };
      const result = validateStructuredQuotationComparison(request, policy);
      assert.equal(result.valid, true);
      assert.equal(policy.minimumCount, 3);
      assert.equal(validateStructuredQuotationComparison({ ...request, supplier: objectIds[9] }, policy).valid, false);
    });

    await t.test("mobility configuration evaluates the S/41 effective rule as a warning, not an automatic rejection", () => {
      const evaluation = evaluateMobilityLines([
        { date: "2026-08-10", amount: 20 },
        { date: "2026-08-10", amount: 22 },
        { date: "2026-08-11", amount: 10 }
      ], {
        _id: objectIds[10],
        key: "LOCAL_MOBILITY_DAILY_LIMIT",
        numericValue: 41,
        currency: "PEN",
        behavior: "WARNING",
        effectiveFrom: new Date("2026-01-01")
      });
      assert.equal(evaluation.exceededLineCount, 2);
      assert.equal(evaluation.outcome, "WARNING");
      assert.equal(evaluation.shouldBlock, false);
    });

    const admin = await User.create({
      employeeCode: "UMA-TEST-ADMIN",
      name: "Finance Admin",
      email: "finance.admin@test.local",
      passwordHash: "unused",
      role: ROLES.ADMIN,
      area: "Finance"
    });
    const employee = await User.create({
      employeeCode: "UMA-TEST-EMPLOYEE",
      name: "Requesting Employee",
      email: "employee@test.local",
      passwordHash: "unused",
      role: ROLES.SOLICITOR,
      area: "Health"
    });

    await t.test("supplier code is assigned at homologation, rejection remains distinct, and active bank history is retained", async () => {
      const supplier = await Supplier.create({
        rucDni: "20600000023",
        legalName: "Homologation Foundation SAC",
        name: "Homologation Foundation SAC",
        personType: "LEGAL_ENTITY",
        taxAddress: "Lima",
        legalRepresentative: "Representative",
        legalRepresentativeDocument: { type: "DNI", number: "40000001" },
        bankName: "BCP",
        bankAccount: "191000000001",
        cci: "00219100000000000001",
        currency: "PEN",
        taxpayerStatus: "MANUALLY_VALIDATED",
        complianceStatus: "COMPLIANT",
        compliance: { taxpayerActive: true, compliant: true },
        complianceReview: { result: "APPROVED", reviewedBy: admin._id, reviewedAt: new Date(), comments: "Foundation review" },
        declarations: {
          stateSanctions: { answer: "NO", declaredAt: new Date() },
          complianceModel: { answer: "YES", declaredAt: new Date() }
        },
        documents: [
          { kind: "RUC_FILE", originalName: "ruc.pdf" },
          { kind: "BANK_CERTIFICATE", originalName: "bank.pdf" },
          { kind: "LEGAL_REP_ID", originalName: "id.pdf" }
        ]
      });
      await addVerifiedSupplierBankAccount({
        supplier,
        payload: {
          bank: "BCP",
          currency: "PEN",
          accountType: "CURRENT",
          accountNumber: "191000000001",
          cci: "00219100000000000001",
          preferred: true,
          accountHolderName: supplier.legalName,
          ownershipResult: "MATCH"
        },
        user: admin,
        req
      });
      const result = await updateAndReviewSupplier({
        supplierId: supplier._id,
        payload: { homologationStatus: "HOMOLOGATED", reviewComments: "Approved in test" },
        files: {},
        user: admin,
        req
      });
      assert.match(result.supplier.supplierCode, /^PRV-\d{4,}$/);
      const originalCode = result.supplier.supplierCode;
      await addVerifiedSupplierBankAccount({
        supplier: result.supplier,
        payload: {
          bank: "BANCO_NACION",
          currency: "PEN",
          accountType: "DETRACTION",
          accountNumber: "000123456789",
          cci: "01800001234567890001",
          preferred: true,
          accountHolderName: result.supplier.legalName,
          ownershipResult: "MATCH"
        },
        user: admin
      });
      assert.equal(await SupplierBankAccount.countDocuments({ supplier: supplier._id, active: true }), 2);
      assert.equal((await Supplier.findById(supplier._id)).supplierCode, originalCode);
      const codeProtected = await Supplier.findById(supplier._id);
      codeProtected.supplierCode = "PRV-9999";
      await assert.rejects(() => codeProtected.save(), /immutable after assignment/);

      const rejected = await Supplier.create({ rucDni: "20600000034", name: "Rejected Foundation Supplier" });
      const rejectedResult = await updateAndReviewSupplier({
        supplierId: rejected._id,
        payload: { homologationStatus: "REJECTED", reviewComments: "Rejected in test" },
        files: {},
        user: admin,
        req
      });
      assert.equal(rejectedResult.supplier.homologationStatus, "REJECTED");
      assert.equal(rejectedResult.supplier.supplierCode, undefined);

      const legacyBankSupplier = await Supplier.create({
        rucDni: "20600000056",
        name: "Legacy Bank Edit Supplier",
        bankName: "BCP",
        bankAccount: "legacy/account",
        cci: "legacy-cci"
      });
      await SupplierBankAccount.collection.insertOne({
        supplier: legacyBankSupplier._id,
        bank: "BCP",
        currency: "PEN",
        accountNumber: "legacy/account",
        cci: "legacy-cci",
        active: true,
        legacyImported: true,
        validFrom: new Date()
      });
      const legacyEdit = await updateAndReviewSupplier({
        supplierId: legacyBankSupplier._id,
        payload: { website: "https://legacy.example.test" },
        files: {},
        user: admin,
        req
      });
      assert.equal(legacyEdit.supplier.website, "https://legacy.example.test");
    });

    await t.test("employee reimbursement banking is separate and hidden from default reads", async () => {
      const account = await EmployeeReimbursementBankAccount.create({
        user: employee._id,
        bank: "BCP",
        currency: "PEN",
        accountHolderName: employee.name,
        accountNumber: "1940000000001",
        cci: "00219400000000000001",
        active: true,
        preferred: true,
        verificationStatus: "VERIFIED",
        verifiedBy: admin._id,
        verifiedAt: new Date(),
        verificationSource: "TEST_REVIEW",
        createdBy: admin._id
      });
      const hidden = await EmployeeReimbursementBankAccount.findById(account._id);
      assert.equal(hidden.accountNumber, undefined);
      assert.equal(hidden.cci, undefined);
      const protectedRead = await EmployeeReimbursementBankAccount.findById(account._id).select("+accountHolderName +accountNumber +cci");
      assert.equal(protectedRead.cci, "00219400000000000001");
    });

    await t.test("dry-run migration does not mutate, apply is additive, and repeat apply is safe", async () => {
      const legacySupplierId = new mongoose.Types.ObjectId();
      const legacyRequestId = new mongoose.Types.ObjectId();
      await mongoose.connection.db.collection("suppliers").insertOne({
        _id: legacySupplierId,
        rucDni: "20600000045",
        normalizedIdentifier: "20600000045",
        legalName: "Legacy Migration SAC",
        name: "Legacy Migration SAC",
        complianceStatus: "COMPLIANT",
        homologationStatus: "HOMOLOGATED",
        active: true,
        status: "ACTIVE",
        createdAt: new Date("2025-01-01"),
        updatedAt: new Date("2025-01-01")
      });
      await mongoose.connection.db.collection("supplierbankaccounts").insertOne({
        supplier: legacySupplierId,
        bank: "BCP",
        currency: "PEN",
        accountNumber: " 123-456 ",
        cci: "002 12345678901234567",
        active: true,
        validFrom: new Date("2025-01-01")
      });
      await mongoose.connection.db.collection("financialrequests").insertOne({
        _id: legacyRequestId,
        requestNumber: "SOL-2026-90001",
        issueDate: new Date("2026-08-01"),
        accountingPeriod: "2026-08",
        requestType: "ENTREGA_RENDIR",
        expenseNature: "TRAVEL",
        currency: "PEN",
        supplier: legacySupplierId,
        solicitor: employee._id,
        description: "Legacy rendition description remains authoritative",
        lines: [{ costCenter: objectIds[3], expenseType: objectIds[4], netAmount: 41, igvAmount: 0, totalAmount: 41 }],
        rendition: { status: "SUBMITTED", submittedAt: new Date("2026-08-02"), amountAdvanced: 41, amountRendered: 41 },
        createdAt: new Date("2026-08-01"),
        updatedAt: new Date("2026-08-01")
      });
      await DocumentRule.create({
        code: "TEST-OFFICIAL-QUOTES",
        requestType: "CAPEX",
        expenseNature: "GOODS",
        requirements: [{ kind: "QUOTATION", minCount: 3, labelKey: "three quotations" }],
        active: true
      });

      const beforeSupplier = await mongoose.connection.db.collection("suppliers").findOne({ _id: legacySupplierId });
      const beforeRequest = await mongoose.connection.db.collection("financialrequests").findOne({ _id: legacyRequestId });
      const dryRun = await runOfficialFormatsFoundationMigration({ db: mongoose.connection.db, apply: false });
      assert.equal(dryRun.mode, "DRY_RUN");
      assert.equal(await mongoose.connection.db.collection("financeconfigurations").countDocuments(), 0);
      assert.deepEqual(await mongoose.connection.db.collection("suppliers").findOne({ _id: legacySupplierId }), beforeSupplier);
      assert.deepEqual(await mongoose.connection.db.collection("financialrequests").findOne({ _id: legacyRequestId }), beforeRequest);

      const applied = await runOfficialFormatsFoundationMigration({ db: mongoose.connection.db, apply: true });
      assert.equal(applied.alreadyApplied, false);
      const migratedSupplier = await mongoose.connection.db.collection("suppliers").findOne({ _id: legacySupplierId });
      const migratedRequest = await mongoose.connection.db.collection("financialrequests").findOne({ _id: legacyRequestId });
      const migratedBank = await mongoose.connection.db.collection("supplierbankaccounts").findOne({ supplier: legacySupplierId });
      assert.match(migratedSupplier.supplierCode, /^PRV-\d{4,}$/);
      assert.equal(migratedSupplier.name, beforeSupplier.name);
      assert.equal(migratedRequest.description, beforeRequest.description);
      assert.equal(migratedRequest.title, beforeRequest.description.slice(0, 120));
      assert.match(migratedRequest.rendition.number, /^RG-2026-\d{5,}$/);
      assert.equal(migratedBank.accountNumber, "123456");
      assert.equal(migratedBank.cci, "00212345678901234567");
      assert.equal(migratedBank.verificationStatus, "LEGACY_ACCEPTED");
      assert.equal(await mongoose.connection.db.collection("financeconfigurations").countDocuments({ numericValue: 41 }), 1);
      const renditionProtected = await FinancialRequest.findById(legacyRequestId);
      renditionProtected.rendition.number = "RG-2026-99999";
      await assert.rejects(() => renditionProtected.save(), /immutable after assignment/);

      const repeated = await runOfficialFormatsFoundationMigration({ db: mongoose.connection.db, apply: true });
      assert.equal(repeated.alreadyApplied, true);
      assert.equal(await mongoose.connection.db.collection("financeconfigurations").countDocuments({ numericValue: 41 }), 1);
      assert.equal(await mongoose.connection.db.collection("financialrequests").countDocuments({ "rendition.number": migratedRequest.rendition.number }), 1);
    });

    await t.test("new sparse and partial indexes remain compatible with legacy records", async () => {
      await Promise.all([
        Supplier.createIndexes(),
        SupplierBankAccount.createIndexes(),
        FinancialRequest.createIndexes(),
        EmployeeReimbursementBankAccount.createIndexes()
      ]);
      const requestIndexes = await FinancialRequest.collection.indexes();
      const bankIndexes = await SupplierBankAccount.collection.indexes();
      assert.ok(requestIndexes.some((index) => index.name === "rendition_number_unique"));
      assert.ok(bankIndexes.some((index) => index.name === "one_active_preferred_supplier_account_per_currency_type"));
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
