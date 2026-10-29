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

    await t.test("the jefe receives request decisions without provider approval controls", async () => {
      const ready = await requestWith(await waitingSupplier());
      const options = await getApprovalDecisionOptions(ready._id, jefe);
      assert.equal(options.chain, true);
      assert.equal(options.supplierApproval, null);
      const incomplete = await requestWith(await waitingSupplier({ complete: false }));
      assert.equal((await getApprovalDecisionOptions(incomplete._id, jefe)).supplierApproval, null);
    });
    await t.test("quick and bulk approval record only the request decision; Finance readiness still gates financial handoff", async () => {
      const supplier = await waitingSupplier(); const request = await requestWith(supplier);
      const result = await bulkApproveRequests({ ids: [request._id], forward: false, user: jefe, req });
      assert.equal(result.results[0].ok, true);
      // The jefe's approval goes to their superior, who finalizes it.
      assert.equal((await bulkApproveRequests({ ids: [request._id], forward: false, user: root, req })).results[0].ok, true);
      assert.equal((await Supplier.findById(supplier._id)).homologationStatus, "PENDING_VALIDATION");
      assert.notEqual(await statusOf(request), REQUEST_STATUS.PENDING_APPROVAL);
      assert.equal(await AuditLog.countDocuments({ entityId: supplier._id, action: "APPROVED_BY_JEFE" }),0);
    });
    await t.test("a request can still be returned with a reason", async () => {
      const request = await requestWith(await waitingSupplier({ complete: false }));
      await decideApproval({ id: request._id, action: "OBSERVE", comments: "Clarify the requirement.", user: jefe, req });
      assert.equal(await statusOf(request), REQUEST_STATUS.OBSERVED);
    });
    await t.test("the manager chain continues without a separate provider decision", async () => {
      const supplier = await waitingSupplier({ proposedBy: colleague }); const request = await requestWith(supplier);
      await decideApproval({ id: request._id, action: "APPROVE", forward: true, user: jefe, req });
      assert.equal(String(activeApprovalStep(await FinancialRequest.findById(request._id)).approverUser), String(root._id));
      await approve(request, root);
      assert.equal((await Supplier.findById(supplier._id)).homologationStatus, "PENDING_VALIDATION");
      assert.ok(await Notification.exists({ user: requester._id, type: "REQUEST_APPROVED", entityId: request._id }));
      assert.equal(await Notification.exists({ entityId: request._id, type: "BUDGET_EXCEPTION" }), null, "a pending supplier is not a budget exception");
      // Treasury can find the saved approval even though the failed handoff created no payable.
      const { listPendingTreasuryBudgets } = await import("../src/services/treasuryBudgetQueueService.js");
      const waiting = await listPendingTreasuryBudgets({ request: String(request._id) });
      assert.equal(waiting.pagination.total, 1);
      assert.equal(String(waiting.data[0]._id), String(request._id));
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
