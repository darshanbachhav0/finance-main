import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import AuditLog from "../src/models/AuditLog.js";
import Counter from "../src/models/Counter.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";
import User from "../src/models/User.js";
import {
  addSupplierBankAccount,
  createSupplierProposal,
  deactivateSupplierBankAccount,
  evaluateSupplierHomologation,
  getSupplierDetailPayload,
  getSupplierHomologationReadiness,
  homologateSupplier,
  isSupplierUsable,
  reviewSupplierCompliance,
  setPreferredSupplierBankAccount,
  supplierDeclarationWarnings,
  updateSupplierProposal,
  validateSupplierTaxpayer,
  verifySupplierBankAccount
} from "../src/services/supplierService.js";
import { ROLES } from "../src/utils/constants.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };

test("RCO-FOR-002 Supplier Master and homologation controls", { timeout: 120000 }, async (t) => {
  const databaseName = `erp_supplier_phase2_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  const originalProviderMode = process.env.SUNAT_PROVIDER_MODE;
  try {
    await Promise.all([Counter.init(), Supplier.init(), SupplierBankAccount.init(), User.init(), AuditLog.init()]);
    const users = {
      admin: await User.create({ name: "UMA Admin", email: "phase2.admin@uma.edu.pe", passwordHash: "unused", role: ROLES.ADMIN }),
      accounting: await User.create({ name: "UMA Accounting", email: "phase2.accounting@uma.edu.pe", passwordHash: "unused", role: ROLES.ACCOUNTING }),
      solicitor: await User.create({ name: "UMA Solicitor", email: "phase2.solicitor@uma.edu.pe", passwordHash: "unused", role: ROLES.SOLICITOR }),
      otherSolicitor: await User.create({ name: "Other Solicitor", email: "phase2.other@uma.edu.pe", passwordHash: "unused", role: ROLES.SOLICITOR }),
      treasury: await User.create({ name: "UMA Treasury", email: "phase2.treasury@uma.edu.pe", passwordHash: "unused", role: ROLES.TREASURY })
    };
    let sequence = 20691000000;
    const nextRuc = () => String(++sequence);
    const nextCci = () => String(++sequence).padStart(20, "0");

    async function completeSupplier(overrides = {}) {
      return Supplier.create({
        rucDni: nextRuc(),
        legalName: "Servicios UMA Demo SAC",
        commercialName: "Servicios UMA",
        name: "Servicios UMA Demo SAC",
        personType: "LEGAL_ENTITY",
        fiscalAddress: "Av. Canto Bello 431, San Juan de Lurigancho, Lima",
        legalRepresentative: "Mariana Torres Rojas",
        legalRepresentativeDocument: { type: "DNI", number: "47112233" },
        proposalJustification: "Alta requerida para servicios institucionales de UMA.",
        proposedBy: users.solicitor._id,
        proposedAt: new Date(),
        currency: "PEN",
        taxpayerStatus: "MANUALLY_VALIDATED",
        taxpayerValidation: {
          status: "VALID",
          providerMode: "MANUAL",
          providerConfigured: true,
          source: "MANUAL",
          identifierMatch: "MATCH",
          legalNameMatch: "MATCH",
          validatedBy: users.accounting._id,
          validatedAt: new Date()
        },
        compliance: { taxpayerActive: true, compliant: true },
        complianceStatus: "COMPLIANT",
        complianceReview: { result: "APPROVED", reviewedBy: users.accounting._id, reviewedAt: new Date(), comments: "Reviewed" },
        declarations: {
          stateSanctions: { answer: "NO", declaredAt: new Date() },
          complianceModel: { answer: "YES", declaredAt: new Date() }
        },
        documents: [
          { kind: "RUC_FILE", originalName: "ficha-ruc.pdf" },
          { kind: "LEGAL_REP_ID", originalName: "dni-representante.pdf" },
          { kind: "BANK_CERTIFICATE", originalName: "certificado-bancario.pdf" }
        ],
        ...overrides
      });
    }

    async function addReviewedAccount(supplier, overrides = {}) {
      const added = await addSupplierBankAccount({
        supplierId: supplier._id,
        payload: {
          bank: "BCP",
          accountType: "CURRENT",
          accountNumber: String(Date.now()).slice(-12),
          cci: nextCci(),
          currency: "PEN",
          accountHolderName: supplier.legalName,
          ...overrides
        },
        user: users.accounting,
        req
      });
      await verifySupplierBankAccount({
        supplierId: supplier._id,
        accountId: added.account._id,
        payload: { verificationStatus: "VERIFIED", ownershipResult: "MATCH" },
        user: users.accounting,
        req
      });
      return SupplierBankAccount.findById(added.account._id);
    }

    await t.test("1-2. lookup-safe duplicate prevention and pending proposal without PRV", async () => {
      const ruc = nextRuc();
      const payload = { rucDni: ruc, legalName: "Laboratorios Clinicos UMA SAC", proposalJustification: "Nuevo servicio para Ciencias de la Salud." };
      const created = await createSupplierProposal({ payload, files: {}, user: users.solicitor, req });
      assert.equal(created.supplier.supplierCode, undefined);
      assert.equal(created.supplier.homologationStatus, "PENDING_VALIDATION");
      assert.equal(created.supplier.active, false);
      await assert.rejects(
        () => createSupplierProposal({ payload, files: {}, user: users.solicitor, req }),
        (error) => error.code === "DUPLICATE_SUPPLIER" && String(error.details.supplier) === String(created.supplier._id)
      );
    });

    await t.test("3-4. missing official documents and declarations return structured blockers", async () => {
      const supplier = await completeSupplier({ documents: [], declarations: { stateSanctions: { answer: "NOT_DECLARED" }, complianceModel: { answer: "NOT_DECLARED" } } });
      const result = await evaluateSupplierHomologation(supplier);
      const codes = result.issues.map((item) => item.code);
      for (const code of ["MISSING_RUC_FILE", "MISSING_LEGAL_REP_ID", "MISSING_BANK_CERTIFICATE", "STATE_SANCTIONS_DECLARATION_INCOMPLETE", "COMPLIANCE_MODEL_DECLARATION_INCOMPLETE"]) {
        assert.ok(codes.includes(code), `Expected blocker ${code}`);
      }
      await assert.rejects(() => homologateSupplier({ supplierId: supplier._id, user: users.admin, req }), (error) => Array.isArray(error.details.issues));
    });

    await t.test("5. risky declarations are Finance flags and never auto approve or reject", async () => {
      const supplier = await completeSupplier({
        complianceReview: { result: "PENDING" },
        declarations: { stateSanctions: { answer: "YES" }, complianceModel: { answer: "NO" } }
      });
      const warnings = supplierDeclarationWarnings(supplier);
      assert.deepEqual(warnings.map((item) => item.code), ["STATE_SANCTIONS_DECLARED", "COMPLIANCE_MODEL_NOT_AVAILABLE"]);
      const stored = await Supplier.findById(supplier._id);
      assert.equal(stored.homologationStatus, "PENDING_VALIDATION");
      assert.equal(stored.complianceReview.result, "PENDING");
    });

    await t.test("6-8. Solicitor cannot own Finance review, bank verification, or PRV", async () => {
      const supplier = await completeSupplier({ complianceReview: { result: "PENDING" } });
      const account = await addSupplierBankAccount({
        supplierId: supplier._id,
        payload: { bank: "BCP", accountType: "CURRENT", accountNumber: "191004400001", cci: nextCci(), currency: "PEN", accountHolderName: supplier.legalName },
        user: users.solicitor,
        req
      });
      await assert.rejects(() => reviewSupplierCompliance({ supplierId: supplier._id, payload: { result: "APPROVED" }, user: users.solicitor, req }), (error) => error.code === "FORBIDDEN");
      await assert.rejects(() => verifySupplierBankAccount({ supplierId: supplier._id, accountId: account.account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MATCH" }, user: users.solicitor, req }), (error) => error.code === "FORBIDDEN");
      await assert.rejects(() => updateSupplierProposal({ supplierId: supplier._id, payload: { supplierCode: "PRV-9999" }, files: {}, user: users.solicitor, req }), (error) => error.code === "FORBIDDEN");
      assert.equal((await Supplier.findById(supplier._id)).supplierCode, undefined);
    });

    await t.test("9-10. successful and concurrent homologation assigns one immutable PRV", async () => {
      const supplier = await completeSupplier();
      await addReviewedAccount(supplier);
      const [first, second] = await Promise.all([
        homologateSupplier({ supplierId: supplier._id, user: users.accounting, req }),
        homologateSupplier({ supplierId: supplier._id, user: users.admin, req })
      ]);
      assert.match(first.supplier.supplierCode, /^PRV-\d{4,}$/);
      assert.equal(first.supplier.supplierCode, second.supplier.supplierCode);
      const repeated = await homologateSupplier({ supplierId: supplier._id, user: users.admin, req });
      assert.equal(repeated.supplier.supplierCode, first.supplier.supplierCode);
      assert.equal(repeated.assignedCode, false);
      const protectedCode = await Supplier.findById(supplier._id);
      protectedCode.supplierCode = "PRV-9999";
      await assert.rejects(() => protectedCode.save(), /immutable after assignment/);
    });

    await t.test("11 and 24. rejected supplier receives no PRV and duplicate recreation cannot bypass it", async () => {
      const ruc = nextRuc();
      const supplier = await completeSupplier({ rucDni: ruc, normalizedIdentifier: ruc, complianceReview: { result: "PENDING" } });
      await reviewSupplierCompliance({ supplierId: supplier._id, payload: { result: "REJECTED", comments: "Commercial risk was not resolved." }, user: users.accounting, req });
      const rejected = await Supplier.findById(supplier._id);
      assert.equal(rejected.supplierCode, undefined);
      assert.equal(rejected.homologationStatus, "REJECTED");
      assert.equal(isSupplierUsable(rejected), false);
      await assert.rejects(
        () => createSupplierProposal({ payload: { rucDni: ruc, legalName: "Duplicate rejected supplier", proposalJustification: "Attempted duplicate" }, files: {}, user: users.otherSolicitor, req }),
        (error) => error.code === "DUPLICATE_SUPPLIER" && error.details.homologationStatus === "REJECTED"
      );
      await assert.rejects(() => reviewSupplierCompliance({ supplierId: supplier._id, payload: { result: "APPROVED" }, user: users.admin, req }), (error) => error.code === "INVALID_STATUS_TRANSITION");
    });

    await t.test("12. observed proposal returns through permitted correction and retains audit history", async () => {
      const supplier = await completeSupplier({ complianceReview: { result: "PENDING" } });
      await reviewSupplierCompliance({ supplierId: supplier._id, payload: { result: "OBSERVED", comments: "Correct the representative document." }, user: users.accounting, req });
      await updateSupplierProposal({
        supplierId: supplier._id,
        payload: { legalRepresentativeDocument: { type: "DNI", number: "48889999" } },
        files: {},
        user: users.solicitor,
        req
      });
      const corrected = await Supplier.findById(supplier._id);
      assert.equal(corrected.homologationStatus, "PENDING_VALIDATION");
      assert.equal(corrected.complianceReview.result, "PENDING");
      const actions = await AuditLog.find({ entityId: supplier._id }).distinct("action");
      assert.ok(actions.includes("OBSERVED"));
      assert.ok(actions.includes("CORRECTION_SUBMITTED"));
    });

    await t.test("13-17. multiple active accounts, pending start, preferred policy, CCI, and authorized verification", async () => {
      const supplier = await completeSupplier();
      const first = await addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BCP", accountType: "CURRENT", accountNumber: "191005500001", cci: nextCci(), currency: "PEN", accountHolderName: supplier.legalName }, user: users.accounting, req });
      const second = await addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BBVA", accountType: "CURRENT", accountNumber: "001105500002", cci: nextCci(), currency: "PEN", accountHolderName: supplier.legalName }, user: users.accounting, req });
      assert.equal(first.account.verificationStatus, "PENDING");
      assert.equal(await SupplierBankAccount.countDocuments({ supplier: supplier._id, active: true }), 2);
      await setPreferredSupplierBankAccount({ supplierId: supplier._id, accountId: first.account._id, user: users.accounting, req });
      await setPreferredSupplierBankAccount({ supplierId: supplier._id, accountId: second.account._id, user: users.accounting, req });
      assert.equal(await SupplierBankAccount.countDocuments({ supplier: supplier._id, currency: "PEN", accountType: "CURRENT", active: true, preferred: true }), 1);
      assert.equal((await SupplierBankAccount.findById(first.account._id)).preferred, false);
      const verified = await verifySupplierBankAccount({ supplierId: supplier._id, accountId: second.account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MATCH" }, user: users.accounting, req });
      assert.equal(verified.verificationSource, "AUTHORIZED_MANUAL_REVIEW");
      await assert.rejects(() => addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BCP", accountType: "CURRENT", accountNumber: "191", cci: "002123", currency: "PEN", accountHolderName: supplier.legalName }, user: users.accounting, req }), /exactly 20 digits/);
      await deactivateSupplierBankAccount({ supplierId: supplier._id, accountId: first.account._id, user: users.accounting, req });
      await assert.rejects(() => setPreferredSupplierBankAccount({ supplierId: supplier._id, accountId: first.account._id, user: users.accounting, req }), /inactive bank account/);
    });

    await t.test("18. ownership mismatch cannot satisfy new-supplier homologation", async () => {
      const supplier = await completeSupplier();
      const added = await addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BCP", accountType: "CURRENT", accountNumber: "191006600001", cci: nextCci(), currency: "PEN", accountHolderName: "Different Holder SAC" }, user: users.accounting, req });
      await verifySupplierBankAccount({ supplierId: supplier._id, accountId: added.account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MISMATCH", comments: "Certificate holder differs from legal name." }, user: users.accounting, req });
      const readiness = await evaluateSupplierHomologation(supplier._id);
      assert.ok(readiness.issues.some((item) => item.code === "BANK_ACCOUNT_FINANCE_VERIFICATION_REQUIRED"));
    });

    await t.test("19. authorized manual ownership acceptance requires comments and is audited", async () => {
      const supplier = await completeSupplier();
      const added = await addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BCP", accountType: "CURRENT", accountNumber: "191007700001", cci: nextCci(), currency: "PEN", accountHolderName: supplier.legalName }, user: users.accounting, req });
      await assert.rejects(() => verifySupplierBankAccount({ supplierId: supplier._id, accountId: added.account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MANUAL_ACCEPTED" }, user: users.accounting, req }), /Comments are required/);
      await verifySupplierBankAccount({ supplierId: supplier._id, accountId: added.account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MANUAL_ACCEPTED", comments: "Bank certificate manually reviewed by Accounting." }, user: users.accounting, req });
      const readiness = await evaluateSupplierHomologation(supplier._id);
      assert.equal(readiness.valid, true, JSON.stringify(readiness.issues));
      const audit = await AuditLog.findOne({ entityId: supplier._id, action: "BANK_ACCOUNT_REVIEWED", "newValues.ownershipResult": "MANUAL_ACCEPTED" });
      assert.ok(audit);
    });

    await t.test("20-21. detraction account requires Banco de la Nacion only when explicitly selected", async () => {
      const supplier = await completeSupplier();
      await assert.rejects(() => addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BCP", accountType: "DETRACTION", accountNumber: "000008800001", cci: nextCci(), currency: "PEN", accountHolderName: supplier.legalName }, user: users.accounting, req }), /Banco de la Nacion/);
      const accepted = await addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BANCO_NACION", accountType: "DETRACTION", accountNumber: "000008800002", cci: nextCci(), currency: "PEN", accountHolderName: supplier.legalName }, user: users.accounting, req });
      assert.equal(accepted.account.bank, "BANCO_NACION");
      assert.equal(accepted.account.accountType, "DETRACTION");
      assert.equal(accepted.account.verificationStatus, "PENDING");
    });

    await t.test("22. LEGACY_ACCEPTED stays compatible but is never relabelled VERIFIED", async () => {
      const supplier = await Supplier.create({ rucDni: nextRuc(), name: "Legacy UMA Supplier", supplierCode: "PRV-8801", status: "ACTIVE", homologationStatus: "HOMOLOGATED", active: true });
      const account = await SupplierBankAccount.create({ supplier: supplier._id, bank: "BCP", currency: "PEN", accountType: "CURRENT", accountNumber: "191009900001", cci: nextCci(), active: true, verificationStatus: "LEGACY_ACCEPTED", ownershipResult: "NOT_REVIEWED", legacyImported: true });
      const readiness = await getSupplierHomologationReadiness(supplier._id);
      assert.equal(readiness.legacyCompatible, true);
      assert.equal((await SupplierBankAccount.findById(account._id)).verificationStatus, "LEGACY_ACCEPTED");
    });

    await t.test("23. manual, mock and not-configured taxpayer validation report their real source", async () => {
      const manualSupplier = await completeSupplier({ taxpayerStatus: "PENDING", taxpayerValidation: undefined, compliance: { taxpayerActive: false, compliant: true } });
      process.env.SUNAT_PROVIDER_MODE = "MANUAL";
      await validateSupplierTaxpayer({ supplierId: manualSupplier._id, payload: { valid: true, returnedIdentifier: manualSupplier.rucDni, returnedLegalName: manualSupplier.legalName, comments: "Ficha RUC reviewed manually." }, user: users.accounting, req });
      const manual = await Supplier.findById(manualSupplier._id);
      assert.equal(manual.taxpayerValidation.source, "MANUAL");
      assert.equal(manual.taxpayerValidation.legalNameMatch, "MATCH");
      assert.equal(manual.taxpayerStatus, "MANUALLY_VALIDATED");

      const mockSupplier = await completeSupplier({ taxpayerStatus: "PENDING", taxpayerValidation: undefined, compliance: { taxpayerActive: false, compliant: true } });
      process.env.SUNAT_PROVIDER_MODE = "MOCK";
      await validateSupplierTaxpayer({ supplierId: mockSupplier._id, payload: { valid: true }, user: users.accounting, req });
      const mock = await Supplier.findById(mockSupplier._id);
      assert.equal(mock.taxpayerValidation.source, "MOCK");
      assert.equal(mock.taxpayerStatus, "PENDING");
      assert.equal(mock.compliance.taxpayerActive, false);

      process.env.SUNAT_PROVIDER_MODE = "PRODUCTION";
      await assert.rejects(() => validateSupplierTaxpayer({ supplierId: mockSupplier._id, payload: { valid: true }, user: users.accounting, req }), (error) => error.code === "INTEGRATION_NOT_CONFIGURED");
    });

    await t.test("bank data is full for Treasury/Finance and masked for unrelated Solicitors", async () => {
      const supplier = await completeSupplier();
      await addReviewedAccount(supplier, { accountNumber: "191001234567" });
      const treasuryView = await getSupplierDetailPayload(supplier._id, users.treasury);
      const unrelatedView = await getSupplierDetailPayload(supplier._id, users.otherSolicitor);
      assert.equal(treasuryView.bankAccounts[0].accountNumber, "191001234567");
      assert.match(unrelatedView.bankAccounts[0].accountNumber, /^\*+4567$/);
      assert.match(unrelatedView.bankAccount, /^\*+/);
    });
  } finally {
    if (originalProviderMode === undefined) delete process.env.SUNAT_PROVIDER_MODE;
    else process.env.SUNAT_PROVIDER_MODE = originalProviderMode;
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
  }
});
