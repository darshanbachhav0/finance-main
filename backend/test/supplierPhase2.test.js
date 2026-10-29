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
  recordSupplierSunatRepresentatives,
  verifySupplierBankAccount
} from "../src/services/supplierService.js";
import { ROLES } from "../src/utils/constants.js";
import { AppError } from "../src/utils/AppError.js";

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
      // A second Treasury officer: whoever registers a bank account cannot also verify it.
      treasury2: await User.create({ name: "UMA Treasury Two", email: "phase2.treasury2@uma.edu.pe", passwordHash: "unused", role: ROLES.TREASURY }),
      director,
      jefe
    };
    const approve = (supplier, user = users.treasury, comments = "") => decideSupplierApproval({ supplierId: supplier._id, payload: { decision: "APPROVE", comments }, user, req });
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
          validatedBy: users.treasury._id,
          validatedAt: new Date()
        },
        compliance: { taxpayerActive: true, compliant: true },
        complianceStatus: "COMPLIANT",
        complianceReview: { result: "APPROVED", reviewedBy: users.treasury._id, reviewedAt: new Date(), comments: "Reviewed" },
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
        user: users.treasury,
        req
      });
      await verifySupplierBankAccount({
        supplierId: supplier._id,
        accountId: added.account._id,
        payload: { verificationStatus: "VERIFIED", ownershipResult: "MATCH" },
        user: users.treasury2,
        req
      });
      return SupplierBankAccount.findById(added.account._id);
    }

    // Approval needs an active account; Treasury's verification of it is not required.
    async function addPendingAccount(supplier) {
      await addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BCP", accountType: "CURRENT", accountNumber: String(Date.now()).slice(-12), cci: nextCci(), currency: "PEN", accountHolderName: supplier.legalName }, user: users.treasury, req });
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
      const task = await Notification.findOne({ user: users.treasury._id, eventKey: `supplier:${created.supplier._id}:finance-review` });
      assert.equal(task?.type, "SUPPLIER_REVIEW_PENDING", "Treasury receives the provider review");
      assert.equal(await Notification.countDocuments({ user: users.accounting._id, entityId: created.supplier._id }), 0, "Accounting no longer receives provider reviews");
      assert.ok(await Notification.exists({ user: users.jefe._id, entityId: created.supplier._id, type: "SUPPLIER_REVIEW_PENDING" }), "the proposer's jefe also receives the review task");
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

    await t.test("6-8. Treasury or the assigned jefe reviews providers; unrelated users cannot decide", async () => {
      const supplier = await completeSupplier();
      const account = await addSupplierBankAccount({
        supplierId: supplier._id,
        payload: { bank: "BCP", accountType: "CURRENT", accountNumber: "191004400001", cci: nextCci(), currency: "PEN", accountHolderName: supplier.legalName },
        user: users.solicitor,
        req
      });
      await assert.rejects(() => approve(supplier, users.solicitor), (error) => error.code === "FORBIDDEN" && /Another Treasury/.test(error.message), "the proposer cannot approve their own supplier");
      for (const outsider of [users.otherSolicitor, users.accounting, users.admin, users.director]) {
        await assert.rejects(() => approve(supplier, outsider), (error) => error.code === "FORBIDDEN" && /Only Treasury/.test(error.message), `${outsider.name} does not review providers`);
      }
      await assert.rejects(() => updateAndReviewSupplier({ supplierId: supplier._id, payload: { homologationStatus: "HOMOLOGATED" }, user: users.accounting, req }), (error) => error.code === "FORBIDDEN", "Accounting can no longer homologate");
      await assert.rejects(() => updateAndReviewSupplier({ supplierId: supplier._id, payload: { homologationStatus: "HOMOLOGATED" }, user: users.treasury, req }), (error) => error.code === "FORBIDDEN", "not even Treasury sets the status directly: it decides through the review");
      await assert.rejects(() => verifySupplierBankAccount({ supplierId: supplier._id, accountId: account.account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MATCH" }, user: users.solicitor, req }), (error) => error.code === "FORBIDDEN");
      await assert.rejects(() => updateSupplierProposal({ supplierId: supplier._id, payload: { supplierCode: "PRV-9999" }, files: {}, user: users.solicitor, req }), (error) => error.code === "FORBIDDEN");
      await assert.rejects(() => updateSupplierProposal({ supplierId: supplier._id, payload: { jefeApproval: { decision: "APPROVED" } }, files: {}, user: users.solicitor, req }), (error) => error.code === "FORBIDDEN");
      await assert.rejects(() => updateSupplierProposal({ supplierId: supplier._id, payload: { taxpayerLookup: { status: "UNAVAILABLE" } }, user: users.solicitor, req }), (error) => error.code === "FORBIDDEN");
      const stored = await Supplier.findById(supplier._id);
      assert.equal(stored.supplierCode, undefined);
      assert.equal(stored.homologationStatus, "PENDING_VALIDATION");
    });

    await t.test("9-10. Treasury review homologates once and assigns one immutable PRV", async () => {
      // Treasury has not reviewed anything: no Finance review, an unverified bank account.
      const supplier = await completeSupplier({ complianceReview: { result: "PENDING" }, taxpayerStatus: "PENDING", taxpayerValidation: undefined, compliance: { taxpayerActive: false } });
      await addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BCP", accountType: "CURRENT", accountNumber: "191004500001", cci: nextCci(), currency: "PEN", accountHolderName: supplier.legalName }, user: users.solicitor, req });
      assert.equal((await evaluateSupplierHomologation(supplier._id)).valid, true);
      assert.deepEqual((await suppliersAwaitingApprovalBy(users.treasury)).map((item) => String(item._id)).filter((id) => id === String(supplier._id)), [String(supplier._id)]);
      assert.deepEqual(await suppliersAwaitingApprovalBy(users.accounting), [], "Accounting has no provider review queue");
      const results = await Promise.allSettled([approve(supplier, users.treasury, "Needed for the lab"), approve(supplier, users.treasury)]);
      assert.equal(results.filter((item) => item.status === "fulfilled").length, 1, "a double approval records one decision");
      assert.ok(results.filter((item) => item.status === "rejected").every((item) => ["CONFLICT", "INVALID_STATUS_TRANSITION"].includes(item.reason.code)));
      const approved = await Supplier.findById(supplier._id);
      assert.match(approved.supplierCode, /^PRV-\d{4,}$/);
      assert.equal(approved.homologationStatus, "HOMOLOGATED");
      assert.equal(approved.jefeApproval.decision, "APPROVED");
      assert.equal(String(approved.jefeApproval.decidedBy), String(users.treasury._id));
      assert.ok(approved.homologationValidUntil > new Date());
      assert.equal(isSupplierUsable(approved), true, "every requester can use it now");
      assert.doesNotThrow(() => assertSupplierUsable(approved));
      assert.ok(await AuditLog.exists({ entityId: supplier._id, action: "APPROVED_BY_TREASURY" }));
      assert.equal((await suppliersAwaitingApprovalBy(users.treasury)).some((item) => String(item._id) === String(supplier._id)), false);
      await assert.rejects(() => approve(supplier), (error) => error.code === "INVALID_STATUS_TRANSITION");
      // The proposer hears the decision; Treasury is asked to verify the account it pays to.
      assert.ok(await Notification.exists({ user: users.solicitor._id, type: "SUPPLIER_APPROVAL_DECISION", entityId: supplier._id }));
      assert.ok(await Notification.exists({ user: users.treasury._id, eventKey: `supplier:${supplier._id}:bank-review`, resolvedAt: null }));
      assert.ok(!(await Notification.exists({ user: users.accounting._id, eventKey: `supplier:${supplier._id}:bank-review` })), "Accounting no longer verifies supplier bank accounts");
      const protectedCode = await Supplier.findById(supplier._id);
      protectedCode.supplierCode = "PRV-9999";
      await assert.rejects(() => protectedCode.save(), /immutable after assignment/);
    });

    await t.test("11 and 24. rejected supplier receives no PRV and duplicate recreation cannot bypass it", async () => {
      const ruc = nextRuc();
      const supplier = await completeSupplier({ rucDni: ruc, normalizedIdentifier: ruc, complianceReview: { result: "PENDING" } });
      await assert.rejects(() => decideSupplierApproval({ supplierId: supplier._id, payload: { decision: "REJECT" }, user: users.treasury, req }), /Comments are required/);
      await decideSupplierApproval({ supplierId: supplier._id, payload: { decision: "REJECT", comments: "Commercial risk was not resolved." }, user: users.treasury, req });
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

    await t.test("12. observed proposal returns to Treasury through the proposer's correction and retains audit history", async () => {
      const supplier = await completeSupplier();
      await decideSupplierApproval({ supplierId: supplier._id, payload: { decision: "OBSERVE", comments: "Correct the representative document." }, user: users.treasury, req });
      const observed = await Supplier.findById(supplier._id);
      assert.equal(observed.homologationStatus, "OBSERVED");
      assert.throws(() => assertSupplierUsable(observed), (error) => error.code === "SUPPLIER_NOT_HOMOLOGATED" && /observed/.test(error.message));
      await Notification.updateMany({ user: users.treasury._id, eventKey: `supplier:${supplier._id}:finance-review` }, { $set: { readAt: new Date() } });
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
      const again = await Notification.findOne({ user: users.treasury._id, eventKey: `supplier:${supplier._id}:finance-review` });
      assert.equal(again.readAt, undefined, "the corrected proposal reaches Treasury again as unread");
      assert.equal(again.resolvedAt, null);
      const actions = await AuditLog.find({ entityId: supplier._id }).distinct("action");
      assert.ok(actions.includes("OBSERVED_BY_ACCOUNTING"));
      assert.ok(actions.includes("CORRECTION_SUBMITTED"));
      await addPendingAccount(supplier);
      await approve(supplier);
      assert.equal((await Supplier.findById(supplier._id)).homologationStatus, "HOMOLOGATED");
    });

    await t.test("Treasury can review when the jefe is unavailable; the next available manager covers", async () => {
      const supplier = await addPendingAccount(await completeSupplier());
      await User.updateOne({ _id: users.jefe._id }, { $set: { onLeave: true } });
      try {
        assert.equal((await supplierApproverFor(users.solicitor._id)).financeReview, true);
        assert.equal(String((await supplierApproverFor(users.solicitor._id)).approver._id), String(users.director._id));
        assert.deepEqual(await suppliersAwaitingApprovalBy(users.jefe), []);
        await assert.rejects(() => approve(supplier, users.jefe), error => error.code === "FORBIDDEN");
        await approve(supplier, users.treasury);
        assert.equal((await Supplier.findById(supplier._id)).homologationStatus, "HOMOLOGATED");
      } finally { await User.updateOne({ _id: users.jefe._id }, { $set: { onLeave: false } }); }
      const noManager = await addPendingAccount(await completeSupplier({ proposedBy: users.otherSolicitor._id }));
      // The Admin is no longer a superuser and cannot step in; any Treasury officer can.
      await assert.rejects(() => approve(noManager, users.admin), (error) => error.code === "FORBIDDEN");
      await approve(noManager, users.treasury2);
      assert.equal((await Supplier.findById(noManager._id)).homologationStatus, "HOMOLOGATED");
    });

    await t.test("an expired provider returns to Treasury for renewal", async () => {
      const supplier = await completeSupplier({ supplierCode: `PRV-${String(nextRuc()).slice(-6)}`, homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true, homologationValidUntil: new Date(Date.now() - 86400000) });
      await addPendingAccount(supplier);
      assert.throws(() => assertSupplierUsable(supplier), (error) => error.details.reason === "HOMOLOGATION_EXPIRED");
      assert.ok((await suppliersAwaitingApprovalBy(users.treasury)).some((item) => String(item._id) === String(supplier._id)));
      assert.equal((await getSupplierDetailPayload(supplier._id, users.treasury)).permissions.canApprove, true);
      const renewed = await approve(supplier);
      assert.equal(renewed.assignedCode, false, "the PRV code is kept");
      assert.ok(renewed.supplier.homologationValidUntil > new Date());
    });

    await t.test("pending suppliers cannot be used financially until Treasury or the jefe reviews them", async () => {
      const pending = await completeSupplier();
      assert.throws(() => assertSupplierUsable(pending), (error) => error.code === "SUPPLIER_NOT_HOMOLOGATED" && /waiting for Treasury/.test(error.message));
      const inactive = await completeSupplier({ homologationStatus: "INACTIVE", status: "INACTIVE" });
      assert.throws(() => assertSupplierUsable(inactive), (error) => error.code === "SUPPLIER_INACTIVE");
    });

    await t.test("13-17. multiple active accounts, pending start, preferred policy, CCI, and authorized verification", async () => {
      const supplier = await completeSupplier();
      const first = await addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BCP", accountType: "CURRENT", accountNumber: "191005500001", cci: nextCci(), currency: "PEN", accountHolderName: supplier.legalName }, user: users.treasury, req });
      const second = await addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BBVA", accountType: "CURRENT", accountNumber: "00110550000000000002", cci: nextCci("011"), currency: "PEN", accountHolderName: supplier.legalName }, user: users.treasury, req });
      assert.equal(first.account.verificationStatus, "PENDING");
      assert.equal(await SupplierBankAccount.countDocuments({ supplier: supplier._id, active: true }), 2);
      await assert.rejects(() => setPreferredSupplierBankAccount({ supplierId: supplier._id, accountId: first.account._id, user: users.accounting, req }), (error) => error.statusCode === 403 && /Only Treasury/.test(error.message));
      await setPreferredSupplierBankAccount({ supplierId: supplier._id, accountId: first.account._id, user: users.treasury, req });
      await setPreferredSupplierBankAccount({ supplierId: supplier._id, accountId: second.account._id, user: users.treasury, req });
      assert.equal(await SupplierBankAccount.countDocuments({ supplier: supplier._id, currency: "PEN", accountType: "CURRENT", active: true, preferred: true }), 1);
      assert.equal((await SupplierBankAccount.findById(first.account._id)).preferred, false);
      await assert.rejects(() => verifySupplierBankAccount({ supplierId: supplier._id, accountId: second.account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MATCH" }, user: users.treasury, req }), (error) => error.statusCode === 403 && /another authorized user/.test(error.message), "the person who added an account cannot verify it");
      for (const outsider of [users.accounting, users.admin]) {
        await assert.rejects(() => verifySupplierBankAccount({ supplierId: supplier._id, accountId: second.account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MATCH" }, user: outsider, req }), (error) => error.statusCode === 403 && /Only Treasury/.test(error.message), `${outsider.name} does not verify supplier bank accounts`);
      }
      const verified = await verifySupplierBankAccount({ supplierId: supplier._id, accountId: second.account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MATCH" }, user: users.treasury2, req });
      assert.equal(verified.verificationSource, "AUTHORIZED_MANUAL_REVIEW");
      await assert.rejects(() => addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BCP", accountType: "CURRENT", accountNumber: "191", cci: "002123", currency: "PEN", accountHolderName: supplier.legalName }, user: users.treasury, req }), /exactly 20 digits/);
      await deactivateSupplierBankAccount({ supplierId: supplier._id, accountId: first.account._id, user: users.treasury, req });
      await assert.rejects(() => setPreferredSupplierBankAccount({ supplierId: supplier._id, accountId: first.account._id, user: users.treasury, req }), /inactive bank account/);
    });

    await t.test("18. an account Treasury found to belong to someone else cannot carry the approval", async () => {
      const supplier = await completeSupplier();
      const added = await addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BCP", accountType: "CURRENT", accountNumber: "191006600001", cci: nextCci(), currency: "PEN", accountHolderName: "Different Holder SAC" }, user: users.treasury, req });
      await verifySupplierBankAccount({ supplierId: supplier._id, accountId: added.account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MISMATCH", comments: "Certificate holder differs from legal name." }, user: users.treasury2, req });
      const readiness = await evaluateSupplierHomologation(supplier._id);
      assert.ok(readiness.issues.some((item) => item.code === "BANK_ACCOUNT_REJECTED"));
      await assert.rejects(() => approve(supplier), (error) => error.details.issues.some((item) => item.code === "BANK_ACCOUNT_REJECTED"));
    });

    await t.test("19. authorized manual ownership acceptance requires comments and is audited", async () => {
      const supplier = await completeSupplier();
      const added = await addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BCP", accountType: "CURRENT", accountNumber: "191007700001", cci: nextCci(), currency: "PEN", accountHolderName: supplier.legalName }, user: users.treasury, req });
      await assert.rejects(() => verifySupplierBankAccount({ supplierId: supplier._id, accountId: added.account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MANUAL_ACCEPTED" }, user: users.treasury2, req }), /Comments are required/);
      await verifySupplierBankAccount({ supplierId: supplier._id, accountId: added.account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MANUAL_ACCEPTED", comments: "Bank certificate manually reviewed by Treasury." }, user: users.treasury2, req });
      const readiness = await evaluateSupplierHomologation(supplier._id);
      assert.equal(readiness.valid, true, JSON.stringify(readiness.issues));
      const audit = await AuditLog.findOne({ entityId: supplier._id, action: "BANK_ACCOUNT_REVIEWED", "newValues.ownershipResult": "MANUAL_ACCEPTED" });
      assert.ok(audit);
    });

    await t.test("20-21. detraction account requires Banco de la Nacion only when explicitly selected", async () => {
      const supplier = await completeSupplier();
      await assert.rejects(() => addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BCP", accountType: "DETRACTION", accountNumber: "000008800001", cci: nextCci(), currency: "PEN", accountHolderName: supplier.legalName }, user: users.treasury, req }), /Banco de la Nacion/);
      const accepted = await addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BANCO_NACION", accountType: "DETRACTION", accountNumber: "000008800002", cci: nextCci("018"), currency: "PEN", accountHolderName: supplier.legalName }, user: users.treasury, req });
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
        data: { rucDni: supplier.rucDni, legalName: supplier.legalName, active: true, habido: true, taxpayerStatus: "ACTIVO", domicileCondition: "HABIDO", registrationDate: "2020-01-01", activityStartDate: "2020-02-01" } };
      await validateAutomaticSupplierTaxpayer(supplier, users.treasury, req, async () => profile);
      const saved = await Supplier.findById(supplier._id);
      assert.equal(saved.taxpayerStatus, "ACTIVE");
      assert.equal(saved.taxpayerValidation.source, "SUNAT_CONSULTA_RUC");
      assert.equal(saved.taxpayerValidation.identifierMatch, "MATCH");
      assert.equal(saved.taxpayerValidation.sunat.taxpayerStatus, "ACTIVO");
      assert.equal(saved.taxpayerValidation.sunat.domicileCondition, "HABIDO");
      assert.equal(saved.taxpayerValidation.sunat.registrationDate, "2020-01-01");
      assert.equal(saved.taxpayerValidation.sunat.activityStartDate, "2020-02-01");
      assert.equal(saved.taxpayerValidation.sunat.queriedAt.toISOString(), profile.queriedAt);
      assert.ok(await AuditLog.exists({ entityId: supplier._id, action: "TAXPAYER_VALIDATION_RECORDED" }));
      await validateAutomaticSupplierTaxpayer(saved, users.treasury, req, async () => ({ ...profile, data: { ...profile.data, legalName: "OTHER COMPANY" } }));
      assert.equal(saved.compliance.taxpayerActive, false);
      assert.equal(saved.taxpayerValidation.legalNameMatch, "MISMATCH");
      await validateAutomaticSupplierTaxpayer(saved, users.treasury, req, async () => ({ ...profile, data: { ...profile.data, active: false, taxpayerStatus: "BAJA DE OFICIO" } }));
      assert.equal(saved.taxpayerStatus, "INACTIVE");
      await assert.rejects(validateAutomaticSupplierTaxpayer(saved, users.treasury, req, async () => ({ ...profile, officialSource: false })), /Official taxpayer evidence/);
      await assert.rejects(validateAutomaticSupplierTaxpayer(saved, users.treasury, req, async () => { throw new Error("SUNAT unavailable"); }), /SUNAT unavailable/);
      assert.equal((await Supplier.findById(saved._id)).taxpayerStatus, "INACTIVE");
      await validateAutomaticSupplierTaxpayer(saved, users.treasury, req, async () => ({ ...profile, source: "SUNAT_PUBLIC_PADRON_RUC", datasetDate: "2026-10-01" }));
      assert.equal(saved.taxpayerStatus, "ACTIVE");
      assert.match(saved.taxpayerValidation.comments, /2026-10-01/);
    });

    await t.test("SUNAT representatives are persisted with provenance; selection and manual corrections are preserved", async () => {
      const supplier = await completeSupplier({ legalRepresentative: "", legalRepresentativeDocument: { type: "DNI", number: "" } });
      const one = { documentType: "DOC. NACIONAL DE IDENTIDAD", documentNumber: "01234567", fullName: "ANA REPRESENTANTE", position: "GERENTE GENERAL", dateFrom: "15/01/2024" };
      const result = { ruc: supplier.rucDni, legalName: supplier.legalName, officialSource: true, source: "SUNAT_CONSULTA_RUC_BROWSER", queriedAt: new Date().toISOString(), representatives: [one] };
      await recordSupplierSunatRepresentatives(supplier, users.treasury, req, async () => result);
      const saved = await Supplier.findById(supplier._id);
      assert.equal(saved.legalRepresentative, one.fullName);
      assert.equal(saved.legalRepresentativeDocument.type, "DNI");
      assert.equal(saved.legalRepresentativeDocument.number, "01234567");
      assert.equal(saved.sunatRepresentatives.entries[0].dateFrom, "2024-01-15");
      assert.equal(saved.sunatRepresentatives.queriedAt.toISOString(), result.queriedAt);
      assert.ok(await AuditLog.exists({ entityId: supplier._id, action: "SUNAT_REPRESENTATIVES_RECORDED" }));
      saved.legalRepresentative = "CORREGIDO MANUALMENTE";
      await recordSupplierSunatRepresentatives(saved, users.treasury, req, async () => result);
      assert.equal(saved.legalRepresentative, "CORREGIDO MANUALMENTE");
      saved.legalRepresentative = "";
      saved.legalRepresentativeDocument = { type: "DNI", number: "" };
      await recordSupplierSunatRepresentatives(saved, users.treasury, req, async () => ({ ...result, representatives: [one, { ...one, fullName: "OTRO REPRESENTANTE" }] }));
      assert.equal(saved.legalRepresentative, "");
      assert.equal(saved.sunatRepresentatives.entries.length, 2);
      await assert.rejects(recordSupplierSunatRepresentatives(saved, users.treasury, req, async () => ({ ...result, ruc: "20123456789" })), /does not match/);
      await assert.rejects(createSupplierProposal({ payload: { rucDni: nextRuc(), legalName: "UNTRUSTED", proposalJustification: "test", sunatRepresentatives: result }, user: users.solicitor, req }), /server-controlled/);
    });

    await t.test("23. manual, mock and not-configured taxpayer validation report their real source", async () => {
      const manualSupplier = await completeSupplier({ taxpayerStatus: "PENDING", taxpayerValidation: undefined, compliance: { taxpayerActive: false, compliant: true } });
      process.env.SUNAT_PROVIDER_MODE = "MANUAL";
      await validateSupplierTaxpayer({ supplierId: manualSupplier._id, payload: { valid: true, returnedIdentifier: manualSupplier.rucDni, returnedLegalName: manualSupplier.legalName, comments: "Ficha RUC reviewed manually." }, user: users.treasury, req });
      const manual = await Supplier.findById(manualSupplier._id);
      assert.equal(manual.taxpayerValidation.source, "MANUAL");
      assert.equal(manual.taxpayerValidation.legalNameMatch, "MATCH");
      assert.equal(manual.taxpayerStatus, "MANUALLY_VALIDATED");

      const mockSupplier = await completeSupplier({ taxpayerStatus: "PENDING", taxpayerValidation: undefined, compliance: { taxpayerActive: false, compliant: true } });
      process.env.SUNAT_PROVIDER_MODE = "MOCK";
      await validateSupplierTaxpayer({ supplierId: mockSupplier._id, payload: { valid: true }, user: users.treasury, req });
      const mock = await Supplier.findById(mockSupplier._id);
      assert.equal(mock.taxpayerValidation.source, "MOCK");
      assert.equal(mock.taxpayerStatus, "PENDING");
      assert.equal(mock.compliance.taxpayerActive, false);

      process.env.SUNAT_PROVIDER_MODE = "PRODUCTION";
      await assert.rejects(() => validateSupplierTaxpayer({ supplierId: mockSupplier._id, payload: { valid: true }, user: users.treasury, req }), (error) => error.code === "INTEGRATION_NOT_CONFIGURED");
    });

    await t.test("a valid unchanged supplier reuses taxpayer evidence; material changes retain evidence and require revalidation", async () => {
      const supplier = await completeSupplier();
      supplier.taxpayerValidation.returnedIdentifier = supplier.rucDni;
      supplier.taxpayerValidation.returnedLegalName = supplier.legalName;
      await supplier.save();
      const validatedAt = supplier.taxpayerValidation.validatedAt;
      const before = await AuditLog.countDocuments({ entityId: supplier._id, action: "TAXPAYER_VALIDATION_RECORDED" });
      const cached = await validateSupplierTaxpayer({ supplierId: supplier._id,payload:{},user:users.treasury,req });
      assert.equal(cached.taxpayerValidation.validatedAt.getTime(),validatedAt.getTime());
      assert.equal(await AuditLog.countDocuments({ entityId: supplier._id,action:"TAXPAYER_VALIDATION_RECORDED" }),before);
      await updateSupplierProposal({ supplierId:supplier._id,payload:{legalName:"Proveedor Corregido SAC"},user:users.treasury,req });
      const updated = await Supplier.findById(supplier._id);
      assert.equal(updated.taxpayerValidation.status,"NOT_VERIFIED");
      assert.equal(updated.taxpayerValidation.returnedLegalName,supplier.legalName,"the original evidence is preserved");
      assert.equal((await getSupplierDetailPayload(supplier._id,users.treasury)).permissions.canValidateTaxpayer,true);
    });

    await t.test("bank data is visible to the assigned jefe for review and masked for unrelated Solicitors", async () => {
      const supplier = await completeSupplier();
      await addReviewedAccount(supplier, { accountNumber: "191001234567" });
      const treasuryView = await getSupplierDetailPayload(supplier._id, users.treasury);
      const unrelatedView = await getSupplierDetailPayload(supplier._id, users.otherSolicitor);
      const jefeView = await getSupplierDetailPayload(supplier._id, users.jefe);
      const accountingView = await getSupplierDetailPayload(supplier._id, users.accounting);
      assert.equal(treasuryView.bankAccounts[0].accountNumber, "191001234567");
      assert.equal(jefeView.bankAccounts[0].accountNumber, "191001234567");
      assert.equal(accountingView.bankAccounts[0].accountNumber, "191001234567", "Accounting keeps supplier.bank_view");
      assert.equal(jefeView.permissions.canApprove, true);
      assert.equal(treasuryView.permissions.canApprove, true, "Treasury reviews the supplier");
      assert.equal(accountingView.permissions.canApprove, false, "Accounting no longer reviews suppliers");
      assert.equal(jefeView.approval.financeReview, true);
      assert.equal(unrelatedView.permissions.canApprove, false);
      assert.match(unrelatedView.bankAccounts[0].accountNumber, /^\*+4567$/);
      assert.match(unrelatedView.bankAccount, /^\*+/);
    });

    await t.test("SUNAT and Padron outage: Treasury or the proposer's jefe approves without inventing verification", async () => {
      const previousMode = process.env.SUNAT_PROVIDER_MODE;
      process.env.SUNAT_PROVIDER_MODE = "CONSULTA_RUC";
      try {
        for (const reviewer of [users.treasury, users.jefe]) {
          const supplier = await addPendingAccount(await completeSupplier({
            taxpayerStatus: "PENDING", taxpayerValidation: undefined, compliance: { taxpayerActive: false },
            departments: ["An area different from the jefe's"]
          }));
          await assert.rejects(validateAutomaticSupplierTaxpayer(supplier, users.solicitor, req, async () => {
            throw new AppError(503, "SUNAT and Padron are unavailable.", { consultaFailure: "CONSULTA_ACCESS_RESTRICTED" });
          }), error => error.statusCode === 503);
          const detail = await getSupplierDetailPayload(supplier._id, reviewer);
          assert.equal(detail.permissions.canApprove, true, "the assigned jefe can review across areas");
          assert.equal(detail.taxpayerLookup.status, "UNAVAILABLE");
          assert.ok((await suppliersAwaitingApprovalBy(reviewer)).some(row => String(row._id) === String(supplier._id)));
          await approve(supplier, reviewer);
          const approved = await Supplier.findById(supplier._id);
          assert.equal(isSupplierUsable(approved), true);
          assert.equal(approved.taxpayerStatus, "PENDING");
          assert.equal(approved.taxpayerValidation.status, "NOT_VERIFIED");
          assert.equal(approved.compliance.taxpayerActive, false);
          assert.equal(approved.jefeApproval.reviewMethod, "MANUAL_SUNAT_UNAVAILABLE");
          assert.equal(approved.jefeApproval.sunatFailureCode, "CONSULTA_ACCESS_RESTRICTED");
          assert.equal(String(approved.jefeApproval.decidedBy), String(reviewer._id));
          const completed = await getSupplierDetailPayload(supplier._id, reviewer);
          assert.equal(completed.homologationStatus, "HOMOLOGATED", "the reviewer can read the completed decision across areas");
          assert.equal(completed.permissions.canApprove, false);
          assert.equal((await getSupplierHomologationReadiness(supplier._id, reviewer)).valid, true);
          assert.equal((await SupplierBankAccount.findOne({ supplier: supplier._id })).verificationStatus, "PENDING");
          assert.ok(await AuditLog.exists({ entityId: supplier._id, action: reviewer === users.treasury ? "APPROVED_BY_TREASURY" : "APPROVED_BY_JEFE",
            "newValues.reviewMethod": "MANUAL_SUNAT_UNAVAILABLE" }));
          await assert.rejects(() => approve(supplier, reviewer), error => error.code === "INVALID_STATUS_TRANSITION");
        }
        const supplier = await addPendingAccount(await completeSupplier({ taxpayerStatus: "INACTIVE" }));
        supplier.taxpayerLookup = { status: "UNAVAILABLE", identifier: supplier.rucDni, legalName: supplier.legalName,
          checkedAt: new Date(), failureCode: "CONSULTA_ACCESS_RESTRICTED" };
        await supplier.save();
        for (const reviewer of [users.treasury, users.jefe]) {
          await assert.rejects(() => approve(supplier, reviewer), error => error.details.issues.some(issue => issue.code === "TAXPAYER_NOT_ACTIVE"));
        }
        supplier.taxpayerStatus = "PENDING";
        supplier.taxpayerValidation.identifierMatch = "MISMATCH";
        await supplier.save();
        await assert.rejects(() => approve(supplier, users.jefe), error => error.details.issues.some(issue => issue.code === "TAXPAYER_IDENTIFIER_MISMATCH"));
        const concurrent = await addPendingAccount(await completeSupplier({ taxpayerStatus: "PENDING", taxpayerValidation: undefined,
          supplierCode: "PRV-999999", taxpayerLookup: undefined }));
        await assert.rejects(validateAutomaticSupplierTaxpayer(concurrent, users.solicitor, req, async () => {
          throw new AppError(503, "SUNAT is unavailable.", { consultaFailure: "CONSULTA_ACCESS_RESTRICTED" });
        }));
        const results = await Promise.allSettled([approve(concurrent, users.treasury), approve(concurrent, users.jefe)]);
        assert.equal(results.filter(result => result.status === "fulfilled").length, 1, "simultaneous reviewers record only one decision for a preassigned PRV");
        assert.ok(results.filter(result => result.status === "rejected").every(result => ["CONFLICT", "INVALID_STATUS_TRANSITION"].includes(result.reason.code)));
        assert.equal(await AuditLog.countDocuments({ entityId: concurrent._id, action: { $in: ["APPROVED_BY_TREASURY", "APPROVED_BY_JEFE"] } }), 1);
      } finally {
        if (previousMode === undefined) delete process.env.SUNAT_PROVIDER_MODE;
        else process.env.SUNAT_PROVIDER_MODE = previousMode;
      }
    });
  } finally {
    if (originalProviderMode === undefined) delete process.env.SUNAT_PROVIDER_MODE;
    else process.env.SUNAT_PROVIDER_MODE = originalProviderMode;
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
  }
});
