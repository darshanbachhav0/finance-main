import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AuditLog from "../src/models/AuditLog.js";
import CostCenter from "../src/models/CostCenter.js";
import Counter from "../src/models/Counter.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import Notification from "../src/models/Notification.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";
import User from "../src/models/User.js";
import { activeApprovalStep, initializeApprovalRoute } from "../src/services/approvalRuleService.js";
import { bulkApproveRequests, decideApproval, getApprovalDecisionOptions } from "../src/services/approvalService.js";
import { decideSupplierApproval } from "../src/services/supplierService.js";
import { EXPENSE_NATURE, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";
import { quoteAttachment, recommendedQuote } from "./quoteFixtures.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };

// A request may be sent with a supplier still waiting for its proposer's jefe. That jefe verifies the
// supplier while deciding the request and approves both at once; nobody completes the approval
// while the supplier still waits.
test("a request carrying a supplier that waits for its proposer's jefe", { timeout: 180000 }, async (t) => {
  const databaseName = `erp_pending_supplier_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await Promise.all([Counter.init(), Supplier.init(), SupplierBankAccount.init(), Notification.init(), AuditLog.init()]);
    const center = await CostCenter.create({ code: "CC-PSUP", name: "Pending supplier", area: "Operations", budgetMode: "ACTIVE", annualBudget: 1000000, active: true });
    const expenseType = await ExpenseType.create({ code: "EXP-PSUP", name: "Services", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", active: true });
    await AccountingPeriod.create({ period: "2026-09", status: "OPEN" });
    const person = (name, extra = {}) => User.create({ name, email: `${name.toLowerCase().replace(/\W+/g, ".")}@test.local`, passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", ...extra });
    const root = await person("Root Manager");
    const jefe = await person("Requester Jefe", { jefe: root._id });
    const otherJefe = await person("Other Jefe");
    const requester = await person("Requester", { costCenter: center._id, jefe: jefe._id });
    const colleague = await person("Colleague", { costCenter: center._id, jefe: otherJefe._id });
    let sequence = 20699000000;

    async function waitingSupplier({ proposedBy = requester, complete = true } = {}) {
      const ruc = String(++sequence);
      const supplier = await Supplier.create({
        identifierType: "RUC", rucDni: ruc, normalizedIdentifier: ruc, legalName: `Proveedor ${ruc} SAC`, name: `Proveedor ${ruc} SAC`,
        homologationStatus: "PENDING_VALIDATION", status: "PENDING_VALIDATION", active: false,
        proposedBy: proposedBy._id, proposedAt: new Date(), proposalJustification: "Needed for this request.",
        ...(complete ? {
          personType: "LEGAL_ENTITY", fiscalAddress: "Av. Lima 100", legalRepresentative: "Ana Torres", legalRepresentativeDocument: { type: "DNI", number: "47112233" },
          declarations: { stateSanctions: { answer: "NO", declaredAt: new Date() }, complianceModel: { answer: "YES", declaredAt: new Date() } },
          documents: [{ kind: "RUC_FILE", originalName: "ruc.pdf" }, { kind: "LEGAL_REP_ID", originalName: "dni.pdf" }, { kind: "BANK_CERTIFICATE", originalName: "bank.pdf" }]
        } : {})
      });
      if (complete) await SupplierBankAccount.create({ supplier: supplier._id, bank: "BCP", currency: "PEN", accountType: "CURRENT", accountNumber: ruc.slice(-12), cci: ruc.padStart(20, "0"), active: true });
      return supplier;
    }

    async function requestWith(supplier, owner = requester) {
      const request = new FinancialRequest({
        requestNumber: `REQ-2026-98${String(++sequence % 1000).padStart(3, "0")}`, requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.SERVICES,
        issueDate: "2026-09-10", accountingPeriod: "2026-09", currency: "PEN", flowType: "A1",
        solicitor: owner._id, requester: owner._id, requesterArea: "Operations", requesterCostCenter: center._id, supplier: supplier._id,
        description: "Pending supplier test", status: REQUEST_STATUS.PENDING_APPROVAL,
        quotations: [recommendedQuote(supplier._id)], attachments: [quoteAttachment(owner._id)],
        lines: [{ costCenter: center._id, expenseType: expenseType._id, netAmount: 100, igvAmount: 18, totalAmount: 118 }]
      });
      await initializeApprovalRoute(request);
      await request.save();
      return request;
    }
    const approve = (request, user, extra = {}) => decideApproval({ id: request._id, action: "APPROVE", forward: false, user, req, ...extra });
    const statusOf = async (request) => (await FinancialRequest.findById(request._id)).status;

    await t.test("the jefe sees the supplier to verify, and what it still needs, with the request", async () => {
      const ready = await requestWith(await waitingSupplier());
      const options = await getApprovalDecisionOptions(ready._id, jefe);
      assert.equal(options.chain, true);
      assert.equal(options.supplierApproval.yours, true);
      assert.equal(options.supplierApproval.ready, true);
      assert.equal(options.supplierApproval.approver.name, "Requester Jefe");
      const incomplete = await requestWith(await waitingSupplier({ complete: false }));
      const missing = (await getApprovalDecisionOptions(incomplete._id, jefe)).supplierApproval;
      assert.equal(missing.ready, false);
      assert.ok(missing.issues.some((issue) => issue.code === "MISSING_RUC_FILE"));
      assert.equal((await getApprovalDecisionOptions(ready._id, requester)).supplierApproval, null, "only someone who can approve sees it");
    });

    await t.test("approving the request asks for the supplier explicitly: a quick or bulk approval never approves it unseen", async () => {
      const supplier = await waitingSupplier();
      const request = await requestWith(supplier);
      await assert.rejects(approve(request, jefe), (error) => error.code === "SUPPLIER_APPROVAL_REQUIRED" && error.statusCode === 409);
      const bulk = await bulkApproveRequests({ ids: [request._id], forward: false, user: jefe, req });
      assert.equal(bulk.results[0].ok, false);
      assert.equal(bulk.results[0].code, "SUPPLIER_APPROVAL_REQUIRED");
      assert.equal(await statusOf(request), REQUEST_STATUS.PENDING_APPROVAL);
      assert.equal((await Supplier.findById(supplier._id)).homologationStatus, "PENDING_VALIDATION");
    });

    await t.test("a supplier that cannot be approved yet keeps the request where it is; it can still be sent back", async () => {
      const supplier = await waitingSupplier({ complete: false });
      const request = await requestWith(supplier);
      await assert.rejects(approve(request, jefe, { approveSupplier: true }), (error) => error.code === "SUPPLIER_HOMOLOGATION_PENDING" && error.statusCode === 422 && error.details.errors.length > 0);
      assert.equal(await statusOf(request), REQUEST_STATUS.PENDING_APPROVAL);
      assert.equal((await Supplier.findById(supplier._id)).homologationStatus, "PENDING_VALIDATION");
      await decideApproval({ id: request._id, action: "OBSERVE", comments: "Complete the supplier's documents.", user: jefe, req });
      assert.equal(await statusOf(request), REQUEST_STATUS.OBSERVED);
    });

    await t.test("the jefe approves supplier and request in one decision", async () => {
      const supplier = await waitingSupplier();
      const request = await requestWith(supplier);
      const { request: decided } = await approve(request, jefe, { approveSupplier: true, comments: "Checked the supplier too." });
      const approved = await Supplier.findById(supplier._id);
      assert.equal(approved.homologationStatus, "HOMOLOGATED");
      assert.ok(approved.supplierCode, "the PRV code is assigned");
      assert.equal(String(approved.jefeApproval.decidedBy), String(jefe._id));
      assert.equal(decided.status, REQUEST_STATUS.BUDGET_COMMITTED, "the budget commitment runs with the approved supplier");
      assert.equal((await FinancialRequest.findById(request._id)).supplierSnapshot.homologationStatus, "HOMOLOGATED");
      assert.ok(await AuditLog.exists({ entityId: supplier._id, action: "APPROVED_BY_JEFE" }));
      assert.ok(await Notification.exists({ user: requester._id, type: "REQUEST_APPROVED", entityId: request._id }));
    });

    await t.test("someone else's waiting supplier: the request goes up the chain but is finalized only once the supplier is approved", async () => {
      const supplier = await waitingSupplier({ proposedBy: colleague });
      const request = await requestWith(supplier);
      const options = (await getApprovalDecisionOptions(request._id, jefe)).supplierApproval;
      assert.equal(options.yours, false);
      assert.equal(options.approver.name, "Other Jefe");
      await assert.rejects(approve(request, jefe, { approveSupplier: true }), (error) => error.code === "SUPPLIER_HOMOLOGATION_PENDING" && error.statusCode === 409);
      await decideApproval({ id: request._id, action: "APPROVE", forward: true, user: jefe, req });
      const forwarded = await FinancialRequest.findById(request._id);
      assert.equal(String(activeApprovalStep(forwarded).approverUser), String(root._id));
      await assert.rejects(approve(request, root), (error) => error.code === "SUPPLIER_HOMOLOGATION_PENDING");
      await decideSupplierApproval({ supplierId: supplier._id, payload: { decision: "APPROVE" }, user: otherJefe, req });
      const { request: decided } = await approve(request, root);
      assert.equal(decided.status, REQUEST_STATUS.BUDGET_COMMITTED);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
