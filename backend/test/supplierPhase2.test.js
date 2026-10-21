import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import AuditLog from "../src/models/AuditLog.js";
import Counter from "../src/models/Counter.js";
import Notification from "../src/models/Notification.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";
import User from "../src/models/User.js";
import {
  addSupplierBankAccount,
  assertSupplierUsable,
  createSupplierProposal,
  deactivateSupplierBankAccount,
  decideSupplierApproval,
  evaluateSupplierHomologation,
  getSupplierDetailPayload,
  getSupplierHomologationReadiness,
  isSupplierUsable,
  setPreferredSupplierBankAccount,
  supplierApproverFor,
  suppliersAwaitingApprovalBy,
  supplierDeclarationWarnings,
  updateAndReviewSupplier,
  updateSupplierProposal,
  validateSupplierTaxpayer,
  validateAutomaticSupplierTaxpayer,
  verifySupplierBankAccount
} from "../src/services/supplierService.js";
import { ROLES } from "../src/utils/constants.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };

test("RCO-FOR-002 Supplier Master and homologation controls", { timeout: 120000 }, async (t) => {
  const databaseName = `erp_supplier_phase2_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  const originalProviderMode = process.env.SUNAT_PROVIDER_MODE;
  try {
    await Promise.all([Counter.init(), Supplier.init(), SupplierBankAccount.init(), User.init(), AuditLog.init(), Notification.init()]);
    // The solicitor reports to a jefe (Solicitor role with a team), who reports to a director.
    const director = await User.create({ name: "UMA Director", email: "phase2.director@uma.edu.pe", passwordHash: "unused", role: ROLES.AREA_DIRECTOR });
    const jefe = await User.create({ name: "UMA Jefe", email: "phase2.jefe@uma.edu.pe", passwordHash: "unused", role: ROLES.SOLICITOR, jefe: director._id });
    const users = {
      admin: await User.create({ name: "UMA Admin", email: "phase2.admin@uma.edu.pe", passwordHash: "unused", role: ROLES.ADMIN }),
      accounting: await User.create({ name: "UMA Accounting", email: "phase2.accounting@uma.edu.pe", passwordHash: "unused", role: ROLES.ACCOUNTING }),
      solicitor: await User.create({ name: "UMA Solicitor", email: "phase2.solicitor@uma.edu.pe", passwordHash: "unused", role: ROLES.SOLICITOR, jefe: jefe._id }),
      otherSolicitor: await User.create({ name: "Other Solicitor", email: "phase2.other@uma.edu.pe", passwordHash: "unused", role: ROLES.SOLICITOR }),
      treasury: await User.create({ name: "UMA Treasury", email: "phase2.treasury@uma.edu.pe", passwordHash: "unused", role: ROLES.TREASURY }),
      director,
      jefe
    };
    const approve = (supplier, user = users.accounting, comments = "") => decideSupplierApproval({ supplierId: supplier._id, payload: { decision: "APPROVE", comments }, user, req });
    let sequence = 20691000000;
    const nextRuc = () => String(++sequence);
    // A CCI opens with its bank's entity code (BCP 002, BBVA 011, Banco de la Nación 018).
    const nextCci = (prefix = "002") => `${prefix}${String(++sequence).padStart(17, "0")}`;

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
        user: users.admin,
        req
      });
      return SupplierBankAccount.findById(added.account._id);
    }

    // Approval needs an active account; Accounting's verification of it is not required.
    async function addPendingAccount(supplier) {
      await addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BCP", accountType: "CURRENT", accountNumber: String(Date.now()).slice(-12), cci: nextCci(), currency: "PEN", accountHolderName: supplier.legalName }, user: users.accounting, req });
      return supplier;
    }

    await t.test("1-2. lookup-safe duplicate prevention; a new proposal gets the next PRV code at once", async () => {
      const ruc = nextRuc();
      const payload = { rucDni: ruc, legalName: "Laboratorios Clinicos UMA SAC", proposalJustification: "Nuevo servicio para Ciencias de la Salud." };
      const created = await createSupplierProposal({ payload, files: {}, user: users.solicitor, req });
      // Every registration is numbered in order when it is made; approval no longer assigns it.
      assert.match(created.supplier.supplierCode, /^PRV-\d{4,}$/);
      assert.equal((await Supplier.findById(created.supplier._id)).supplierCode, created.supplier.supplierCode);
      assert.equal(created.supplier.homologationStatus, "PENDING_VALIDATION");
      assert.equal(created.supplier.jefeApproval.decision, "PENDING");
      assert.equal(created.supplier.active, false);
      const task = await Notification.findOne({ user: users.accounting._id, eventKey: `supplier:${created.supplier._id}:finance-review` });
      assert.equal(task?.type, "SUPPLIER_REVIEW_PENDING", "Accounting receives the provider review");
      assert.equal(await Notification.countDocuments({ user: users.jefe._id, entityId: created.supplier._id }), 0, "the jefe receives no provider approval task");
      assert.equal(created.supplier.paymentTerms?.option, undefined, "New proposals need no duplicate payment-term entry");
      const legacy = await Supplier.findById(created.supplier._id);
      legacy.paymentTerms = { option: "CUSTOM", days: 60, comments: "Historical agreement" };
      await legacy.save();
      await updateSupplierProposal({ supplierId: legacy._id, payload: { commercialName: "Updated name" }, user: users.solicitor, req });
      const preserved = await Supplier.findById(legacy._id);
      assert.equal(preserved.paymentTerms.days, 60, "Editing the simplified form preserves historical terms");
      assert.equal(preserved.paymentTerms.comments, "Historical agreement");
      await assert.rejects(
        () => createSupplierProposal({ payload, files: {}, user: users.solicitor, req }),
        (error) => error.code === "DUPLICATE_SUPPLIER" && String(error.details.supplier) === String(created.supplier._id)
      );
    });

    await t.test("3-4. supporting documents and declarations no longer block approval; missing identity data still does", async () => {
      // The proposal form no longer asks for the RUC file, representative ID, bank certificate or
      // the two compliance declarations, so their absence is not a blocker.
      const supplier = await completeSupplier({ documents: [], declarations: { stateSanctions: { answer: "NOT_DECLARED" }, complianceModel: { answer: "NOT_DECLARED" } } });
      const codes = (await evaluateSupplierHomologation(supplier)).issues.map((item) => item.code);
      for (const code of ["MISSING_RUC_FILE", "MISSING_LEGAL_REP_ID", "MISSING_BANK_CERTIFICATE", "STATE_SANCTIONS_DECLARATION_INCOMPLETE", "COMPLIANCE_MODEL_DECLARATION_INCOMPLETE"]) {
        assert.ok(!codes.includes(code), `${code} is no longer a blocker`);
      }
      const incomplete = await completeSupplier({ personType: undefined, legalRepresentative: "" });
      const blockers = (await evaluateSupplierHomologation(incomplete)).issues.map((item) => item.code);
      assert.ok(blockers.includes("PERSON_TYPE_MISSING") && blockers.includes("LEGAL_REPRESENTATIVE_MISSING"));
      await assert.rejects(() => approve(incomplete), (error) => Array.isArray(error.details.issues));
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

    await t.test("6-8. only Accounting and Admin review providers; nobody else owns the decision, bank verification or PRV", async () => {
      const supplier = await completeSupplier();
      const account = await addSupplierBankAccount({
        supplierId: supplier._id,
        payload: { bank: "BCP", accountType: "CURRENT", accountNumber: "191004400001", cci: nextCci(), currency: "PEN", accountHolderName: supplier.legalName },
        user: users.solicitor,
        req
      });
      await assert.rejects(() => approve(supplier, users.solicitor), (error) => error.code === "FORBIDDEN" && /Another Accounting or Admin/.test(error.message), "the proposer cannot approve their own supplier");
      for (const outsider of [users.otherSolicitor, users.jefe, users.treasury, users.director]) {
        await assert.rejects(() => approve(supplier, outsider), (error) => error.code === "FORBIDDEN", `${outsider.name} is not the proposer's jefe`);
      }
      await assert.rejects(() => updateAndReviewSupplier({ supplierId: supplier._id, payload: { homologationStatus: "HOMOLOGATED" }, user: users.accounting, req }), (error) => error.code === "FORBIDDEN", "Accounting can no longer homologate");
      await assert.rejects(() => verifySupplierBankAccount({ supplierId: supplier._id, accountId: account.account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MATCH" }, user: users.solicitor, req }), (error) => error.code === "FORBIDDEN");
      await assert.rejects(() => updateSupplierProposal({ supplierId: supplier._id, payload: { supplierCode: "PRV-9999" }, files: {}, user: users.solicitor, req }), (error) => error.code === "FORBIDDEN");
      await assert.rejects(() => updateSupplierProposal({ supplierId: supplier._id, payload: { jefeApproval: { decision: "APPROVED" } }, files: {}, user: users.solicitor, req }), (error) => error.code === "FORBIDDEN");
      const stored = await Supplier.findById(supplier._id);
      assert.equal(stored.supplierCode, undefined);
      assert.equal(stored.homologationStatus, "PENDING_VALIDATION");
    });

    await t.test("9-10. Accounting review homologates once and assigns one immutable PRV", async () => {
      // Accounting has not reviewed anything: no Finance review, an unverified bank account.
      const supplier = await completeSupplier({ complianceReview: { result: "PENDING" }, taxpayerStatus: "PENDING", taxpayerValidation: undefined, compliance: { taxpayerActive: false } });
      await addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BCP", accountType: "CURRENT", accountNumber: "191004500001", cci: nextCci(), currency: "PEN", accountHolderName: supplier.legalName }, user: users.solicitor, req });
      assert.equal((await evaluateSupplierHomologation(supplier._id)).valid, true);
      assert.deepEqual((await suppliersAwaitingApprovalBy(users.accounting)).map((item) => String(item._id)).filter((id) => id === String(supplier._id)), [String(supplier._id)]);
      const results = await Promise.allSettled([approve(supplier, users.accounting, "Needed for the lab"), approve(supplier, users.accounting)]);
      assert.equal(results.filter((item) => item.status === "fulfilled").length, 1, "a double approval records one decision");
      assert.ok(results.filter((item) => item.status === "rejected").every((item) => ["CONFLICT", "INVALID_STATUS_TRANSITION"].includes(item.reason.code)));
      const approved = await Supplier.findById(supplier._id);
      assert.match(approved.supplierCode, /^PRV-\d{4,}$/);
      assert.equal(approved.homologationStatus, "HOMOLOGATED");
      assert.equal(approved.jefeApproval.decision, "APPROVED");
      assert.equal(String(approved.jefeApproval.decidedBy), String(users.accounting._id));
      assert.ok(approved.homologationValidUntil > new Date());
      assert.equal(isSupplierUsable(approved), true, "every requester can use it now");
      assert.doesNotThrow(() => assertSupplierUsable(approved));
      assert.ok(await AuditLog.exists({ entityId: supplier._id, action: "APPROVED_BY_ACCOUNTING" }));
      assert.equal((await suppliersAwaitingApprovalBy(users.accounting)).some((item) => String(item._id) === String(supplier._id)), false);
      await assert.rejects(() => approve(supplier), (error) => error.code === "INVALID_STATUS_TRANSITION");
      // The proposer hears the decision; Accounting is asked to verify the account Treasury pays to.
      assert.ok(await Notification.exists({ user: users.solicitor._id, type: "SUPPLIER_APPROVAL_DECISION", entityId: supplier._id }));
      assert.ok(await Notification.exists({ user: users.accounting._id, eventKey: `supplier:${supplier._id}:bank-review`, resolvedAt: null }));
      const protectedCode = await Supplier.findById(supplier._id);
      protectedCode.supplierCode = "PRV-9999";
      await assert.rejects(() => protectedCode.save(), /immutable after assignment/);
    });

    await t.test("11 and 24. rejected supplier receives no PRV and duplicate recreation cannot bypass it", async () => {
      const ruc = nextRuc();
      const supplier = await completeSupplier({ rucDni: ruc, normalizedIdentifier: ruc, complianceReview: { result: "PENDING" } });
      await assert.rejects(() => decideSupplierApproval({ supplierId: supplier._id, payload: { decision: "REJECT" }, user: users.accounting, req }), /Comments are required/);
      await decideSupplierApproval({ supplierId: supplier._id, payload: { decision: "REJECT", comments: "Commercial risk was not resolved." }, user: users.accounting, req });
      const rejected = await Supplier.findById(supplier._id);
      assert.equal(rejected.supplierCode, undefined);
      assert.equal(rejected.homologationStatus, "REJECTED");
      assert.equal(rejected.jefeApproval.decision, "REJECTED");
      assert.equal(isSupplierUsable(rejected), false);
      assert.throws(() => assertSupplierUsable(rejected), (error) => error.code === "SUPPLIER_REJECTED");
      await assert.rejects(
        () => createSupplierProposal({ payload: { rucDni: ruc, legalName: "Duplicate rejected supplier", proposalJustification: "Attempted duplicate" }, files: {}, user: users.otherSolicitor, req }),
        (error) => error.code === "DUPLICATE_SUPPLIER" && error.details.homologationStatus === "REJECTED"
      );
      await assert.rejects(() => approve(supplier), (error) => error.code === "INVALID_STATUS_TRANSITION");
      assert.ok(await AuditLog.exists({ entityId: supplier._id, action: "REJECTED_BY_ACCOUNTING" }));
    });

    await t.test("12. observed proposal returns to Accounting through the proposer's correction and retains audit history", async () => {
      const supplier = await completeSupplier();
      await decideSupplierApproval({ supplierId: supplier._id, payload: { decision: "OBSERVE", comments: "Correct the representative document." }, user: users.accounting, req });
      const observed = await Supplier.findById(supplier._id);
      assert.equal(observed.homologationStatus, "OBSERVED");
      assert.throws(() => assertSupplierUsable(observed), (error) => error.code === "SUPPLIER_NOT_HOMOLOGATED" && /observed/.test(error.message));
      await Notification.updateMany({ user: users.accounting._id, eventKey: `supplier:${supplier._id}:finance-review` }, { $set: { readAt: new Date() } });
      await updateSupplierProposal({
        supplierId: supplier._id,
        payload: { legalRepresentativeDocument: { type: "DNI", number: "48889999" } },
        files: {},
        user: users.solicitor,
        req
      });
      const corrected = await Supplier.findById(supplier._id);
      assert.equal(corrected.homologationStatus, "PENDING_VALIDATION");
      assert.equal(corrected.jefeApproval.decision, "PENDING");
      const again = await Notification.findOne({ user: users.accounting._id, eventKey: `supplier:${supplier._id}:finance-review` });
      assert.equal(again.readAt, undefined, "the corrected proposal reaches the jefe again as unread");
      assert.equal(again.resolvedAt, null);
      const actions = await AuditLog.find({ entityId: supplier._id }).distinct("action");
      assert.ok(actions.includes("OBSERVED_BY_ACCOUNTING"));
      assert.ok(actions.includes("CORRECTION_SUBMITTED"));
      await addPendingAccount(supplier);
      await approve(supplier);
      assert.equal((await Supplier.findById(supplier._id)).homologationStatus, "HOMOLOGATED");
    });

    await t.test("provider reviews belong to Finance regardless of the requester's manager roster", async () => {
      const supplier = await addPendingAccount(await completeSupplier());
      await User.updateOne({ _id: users.jefe._id }, { $set: { onLeave: true } });
      try {
        assert.equal((await supplierApproverFor(users.solicitor._id)).financeReview, true);
        assert.deepEqual(await suppliersAwaitingApprovalBy(users.jefe), []);
        await assert.rejects(() => approve(supplier, users.jefe), error => error.code === "FORBIDDEN");
        await approve(supplier, users.accounting);
        assert.equal((await Supplier.findById(supplier._id)).homologationStatus, "HOMOLOGATED");
      } finally { await User.updateOne({ _id: users.jefe._id }, { $set: { onLeave: false } }); }
      const noManager = await addPendingAccount(await completeSupplier({ proposedBy: users.otherSolicitor._id }));
      await approve(noManager, users.admin);
      assert.equal((await Supplier.findById(noManager._id)).homologationStatus, "HOMOLOGATED");
    });

    await t.test("an expired provider returns to Accounting for renewal", async () => {
      const supplier = await completeSupplier({ supplierCode: `PRV-${String(nextRuc()).slice(-6)}`, homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true, homologationValidUntil: new Date(Date.now() - 86400000) });
      await addPendingAccount(supplier);
      assert.throws(() => assertSupplierUsable(supplier), (error) => error.details.reason === "HOMOLOGATION_EXPIRED");
      assert.ok((await suppliersAwaitingApprovalBy(users.accounting)).some((item) => String(item._id) === String(supplier._id)));
      assert.equal((await getSupplierDetailPayload(supplier._id, users.accounting)).permissions.canApprove, true);
      const renewed = await approve(supplier);
      assert.equal(renewed.assignedCode, false, "the PRV code is kept");
      assert.ok(renewed.supplier.homologationValidUntil > new Date());
    });

    await t.test("pending suppliers cannot be used financially until Accounting reviews them", async () => {
      const pending = await completeSupplier();
      assert.throws(() => assertSupplierUsable(pending), (error) => error.code === "SUPPLIER_NOT_HOMOLOGATED" && /waiting for the approval/.test(error.message));
      const inactive = await completeSupplier({ homologationStatus: "INACTIVE", status: "INACTIVE" });
      assert.throws(() => assertSupplierUsable(inactive), (error) => error.code === "SUPPLIER_INACTIVE");
    });

    await t.test("13-17. multiple active accounts, pending start, preferred policy, CCI, and authorized verification", async () => {
      const supplier = await completeSupplier();
      const first = await addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BCP", accountType: "CURRENT", accountNumber: "191005500001", cci: nextCci(), currency: "PEN", accountHolderName: supplier.legalName }, user: users.accounting, req });
      const second = await addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BBVA", accountType: "CURRENT", accountNumber: "00110550000000000002", cci: nextCci("011"), currency: "PEN", accountHolderName: supplier.legalName }, user: users.accounting, req });
      assert.equal(first.account.verificationStatus, "PENDING");
      assert.equal(await SupplierBankAccount.countDocuments({ supplier: supplier._id, active: true }), 2);
      await setPreferredSupplierBankAccount({ supplierId: supplier._id, accountId: first.account._id, user: users.accounting, req });
      await setPreferredSupplierBankAccount({ supplierId: supplier._id, accountId: second.account._id, user: users.accounting, req });
      assert.equal(await SupplierBankAccount.countDocuments({ supplier: supplier._id, currency: "PEN", accountType: "CURRENT", active: true, preferred: true }), 1);
      assert.equal((await SupplierBankAccount.findById(first.account._id)).preferred, false);
      await assert.rejects(() => verifySupplierBankAccount({ supplierId: supplier._id, accountId: second.account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MATCH" }, user: users.accounting, req }), (error) => error.statusCode === 403 && /another authorized user/.test(error.message), "the person who added an account cannot verify it");
      const verified = await verifySupplierBankAccount({ supplierId: supplier._id, accountId: second.account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MATCH" }, user: users.admin, req });
      assert.equal(verified.verificationSource, "AUTHORIZED_MANUAL_REVIEW");
      await assert.rejects(() => addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BCP", accountType: "CURRENT", accountNumber: "191", cci: "002123", currency: "PEN", accountHolderName: supplier.legalName }, user: users.accounting, req }), /exactly 20 digits/);
      await deactivateSupplierBankAccount({ supplierId: supplier._id, accountId: first.account._id, user: users.accounting, req });
      await assert.rejects(() => setPreferredSupplierBankAccount({ supplierId: supplier._id, accountId: first.account._id, user: users.accounting, req }), /inactive bank account/);
    });

    await t.test("18. an account Accounting found to belong to someone else cannot carry the approval", async () => {
      const supplier = await completeSupplier();
      const added = await addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BCP", accountType: "CURRENT", accountNumber: "191006600001", cci: nextCci(), currency: "PEN", accountHolderName: "Different Holder SAC" }, user: users.accounting, req });
      await verifySupplierBankAccount({ supplierId: supplier._id, accountId: added.account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MISMATCH", comments: "Certificate holder differs from legal name." }, user: users.admin, req });
      const readiness = await evaluateSupplierHomologation(supplier._id);
      assert.ok(readiness.issues.some((item) => item.code === "BANK_ACCOUNT_REJECTED"));
      await assert.rejects(() => approve(supplier), (error) => error.details.issues.some((item) => item.code === "BANK_ACCOUNT_REJECTED"));
    });

    await t.test("19. authorized manual ownership acceptance requires comments and is audited", async () => {
      const supplier = await completeSupplier();
      const added = await addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BCP", accountType: "CURRENT", accountNumber: "191007700001", cci: nextCci(), currency: "PEN", accountHolderName: supplier.legalName }, user: users.accounting, req });
      await assert.rejects(() => verifySupplierBankAccount({ supplierId: supplier._id, accountId: added.account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MANUAL_ACCEPTED" }, user: users.admin, req }), /Comments are required/);
      await verifySupplierBankAccount({ supplierId: supplier._id, accountId: added.account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MANUAL_ACCEPTED", comments: "Bank certificate manually reviewed by Accounting." }, user: users.admin, req });
      const readiness = await evaluateSupplierHomologation(supplier._id);
      assert.equal(readiness.valid, true, JSON.stringify(readiness.issues));
      const audit = await AuditLog.findOne({ entityId: supplier._id, action: "BANK_ACCOUNT_REVIEWED", "newValues.ownershipResult": "MANUAL_ACCEPTED" });
      assert.ok(audit);
    });

    await t.test("20-21. detraction account requires Banco de la Nacion only when explicitly selected", async () => {
      const supplier = await completeSupplier();
      await assert.rejects(() => addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BCP", accountType: "DETRACTION", accountNumber: "000008800001", cci: nextCci(), currency: "PEN", accountHolderName: supplier.legalName }, user: users.accounting, req }), /Banco de la Nacion/);
      const accepted = await addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BANCO_NACION", accountType: "DETRACTION", accountNumber: "000008800002", cci: nextCci("018"), currency: "PEN", accountHolderName: supplier.legalName }, user: users.accounting, req });
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

    await t.test("automatic official taxpayer validation is persisted, audited, and requires matching identity", async () => {
      const supplier = await completeSupplier({ taxpayerStatus: "PENDING", compliance: { taxpayerActive: false } });
      const profile = { found: true, officialSource: true, source: "SUNAT_CONSULTA_RUC", queriedAt: new Date().toISOString(),
        data: { rucDni: supplier.rucDni, legalName: supplier.legalName, active: true, habido: true, taxpayerStatus: "ACTIVO", domicileCondition: "HABIDO" } };
      await validateAutomaticSupplierTaxpayer(supplier, users.accounting, req, async () => profile);
      const saved = await Supplier.findById(supplier._id);
      assert.equal(saved.taxpayerStatus, "ACTIVE");
      assert.equal(saved.taxpayerValidation.source, "SUNAT_CONSULTA_RUC");
      assert.equal(saved.taxpayerValidation.identifierMatch, "MATCH");
      assert.ok(await AuditLog.exists({ entityId: supplier._id, action: "TAXPAYER_VALIDATION_RECORDED" }));
      await validateAutomaticSupplierTaxpayer(saved, users.accounting, req, async () => ({ ...profile, data: { ...profile.data, legalName: "OTHER COMPANY" } }));
      assert.equal(saved.compliance.taxpayerActive, false);
      assert.equal(saved.taxpayerValidation.legalNameMatch, "MISMATCH");
      await validateAutomaticSupplierTaxpayer(saved, users.accounting, req, async () => ({ ...profile, data: { ...profile.data, active: false, taxpayerStatus: "BAJA DE OFICIO" } }));
      assert.equal(saved.taxpayerStatus, "INACTIVE");
      await assert.rejects(validateAutomaticSupplierTaxpayer(saved, users.accounting, req, async () => ({ ...profile, officialSource: false })), /Official taxpayer evidence/);
      await assert.rejects(validateAutomaticSupplierTaxpayer(saved, users.accounting, req, async () => { throw new Error("SUNAT unavailable"); }), /SUNAT unavailable/);
      assert.equal((await Supplier.findById(saved._id)).taxpayerStatus, "INACTIVE");
      await validateAutomaticSupplierTaxpayer(saved, users.accounting, req, async () => ({ ...profile, source: "SUNAT_PUBLIC_PADRON_RUC", datasetDate: "2026-10-01" }));
      assert.equal(saved.taxpayerStatus, "ACTIVE");
      assert.match(saved.taxpayerValidation.comments, /2026-10-01/);
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

    await t.test("a valid unchanged supplier reuses taxpayer evidence; material changes retain evidence and require revalidation", async () => {
      const supplier = await completeSupplier();
      supplier.taxpayerValidation.returnedIdentifier = supplier.rucDni;
      supplier.taxpayerValidation.returnedLegalName = supplier.legalName;
      await supplier.save();
      const validatedAt = supplier.taxpayerValidation.validatedAt;
      const before = await AuditLog.countDocuments({ entityId: supplier._id, action: "TAXPAYER_VALIDATION_RECORDED" });
      const cached = await validateSupplierTaxpayer({ supplierId: supplier._id,payload:{},user:users.accounting,req });
      assert.equal(cached.taxpayerValidation.validatedAt.getTime(),validatedAt.getTime());
      assert.equal(await AuditLog.countDocuments({ entityId: supplier._id,action:"TAXPAYER_VALIDATION_RECORDED" }),before);
      await updateSupplierProposal({ supplierId:supplier._id,payload:{legalName:"Proveedor Corregido SAC"},user:users.accounting,req });
      const updated = await Supplier.findById(supplier._id);
      assert.equal(updated.taxpayerValidation.status,"NOT_VERIFIED");
      assert.equal(updated.taxpayerValidation.returnedLegalName,supplier.legalName,"the original evidence is preserved");
      assert.equal((await getSupplierDetailPayload(supplier._id,users.accounting)).permissions.canValidateTaxpayer,true);
    });

    await t.test("bank data is full for Treasury/Finance and masked for the jefe, and masked for unrelated Solicitors", async () => {
      const supplier = await completeSupplier();
      await addReviewedAccount(supplier, { accountNumber: "191001234567" });
      const treasuryView = await getSupplierDetailPayload(supplier._id, users.treasury);
      const unrelatedView = await getSupplierDetailPayload(supplier._id, users.otherSolicitor);
      const jefeView = await getSupplierDetailPayload(supplier._id, users.jefe);
      const financeView = await getSupplierDetailPayload(supplier._id, users.accounting);
      assert.equal(treasuryView.bankAccounts[0].accountNumber, "191001234567");
      assert.match(jefeView.bankAccounts[0].accountNumber, /^\*+4567$/);
      assert.equal(financeView.bankAccounts[0].accountNumber, "191001234567");
      assert.equal(jefeView.permissions.canApprove, false);
      assert.equal(financeView.permissions.canApprove, true);
      assert.equal(jefeView.approval.financeReview, true);
      assert.equal(unrelatedView.permissions.canApprove, false);
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
