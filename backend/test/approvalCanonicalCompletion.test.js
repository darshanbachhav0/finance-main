import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import CostCenter from "../src/models/CostCenter.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import Supplier from "../src/models/Supplier.js";
import User from "../src/models/User.js";
import { decideApproval } from "../src/services/approvalService.js";
import { REQUEST_STATUS, REQUEST_TYPE, EXPENSE_NATURE, ROLES } from "../src/utils/constants.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };

test("the parent status never takes on an organization-specific approval-level label", { timeout: 60000 }, async (t) => {
  const databaseName = `erp_approval_canonical_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    const center = await CostCenter.create({ code: "CC-CANON", name: "Canonical", area: "Operations", budgetMode: "ACTIVE", annualBudget: 100000, active: true });
    const expenseType = await ExpenseType.create({ code: "EXP-CANON", name: "Services", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", active: true });
    const solicitor = await User.create({ name: "Requester", email: "canon.requester@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations" });
    const supplier = await Supplier.create({ identifierType: "RUC", rucDni: "20999999995", normalizedIdentifier: "20999999995", legalName: "Canon Supplier SAC", name: "Canon Supplier SAC", homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true, supplierCode: "PRV-9795", paymentTerms: { option: "CREDIT_30", days: 30 } });
    await AccountingPeriod.create({ period: "2026-09", status: "OPEN" });

    async function makeRoutedRequest(number, approvalRouteSnapshot) {
      return FinancialRequest.create({
        requestNumber: number, requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.SERVICES,
        issueDate: "2026-09-10", accountingPeriod: "2026-09", currency: "PEN",
        solicitor: solicitor._id, requester: solicitor._id, supplier: supplier._id,
        description: "Canonical completion test", status: REQUEST_STATUS.PENDING_APPROVAL, approvalStage: approvalRouteSnapshot[0].approvalLevel,
        approvalRouteSnapshot,
        attachments: [{ kind: "CONTRACT", originalName: "contract.pdf", filename: "contract.pdf", url: "/test/contract.pdf", mimetype: "application/pdf", size: 10, uploadedBy: solicitor._id }],
        lines: [{ costCenter: center._id, expenseType: expenseType._id, netAmount: 100, igvAmount: 18, totalAmount: 118 }]
      });
    }

    await t.test("a single-step route ending in a level other than Area Director/Vice Rector still reaches APROBADO", async () => {
      // Before the fix, only AREA_DIRECTOR/VICE_RECTOR steps could complete a
      // rule-based route into a valid approved state; any other configured
      // final level threw "did not finish in an approved lifecycle state".
      const generalManagement = await User.create({ name: "General Management Reviewer", email: "canon.generalmgmt@test.local", passwordHash: "unused", role: ROLES.APPROVER, approvalLevel: "GENERAL_MANAGEMENT", approvalAreas: ["*"], area: "Rectorate" });
      const request = await makeRoutedRequest("REQ-2026-97101", [
        { approvalLevel: "GENERAL_MANAGEMENT", role: ROLES.APPROVER, sequence: 1, slaHours: 24, required: true, status: "PENDING", startedAt: new Date(), dueAt: new Date(Date.now() + 86400000) }
      ]);
      const result = await decideApproval({ id: request._id, action: "APPROVE", comments: "General Management approved", user: generalManagement, req });
      // The route completes into APROBADO and budget commitment then runs
      // automatically within the same decision (matching the existing
      // Director+Vice-Rector behavior) — reaching BUDGET_COMMITTED without
      // error is exactly the proof that APROBADO was a valid, reachable state.
      assert.equal(result.request.status, REQUEST_STATUS.BUDGET_COMMITTED);
      assert.ok(result.request.approvalHistory.some((event) => event.action === "GENERAL_MANAGEMENT_APPROVED"));
    });

    await t.test("a multi-step route only reaches APROBADO after its final step, never resting at an intermediate label", async () => {
      const first = await User.create({ name: "First Reviewer", email: "canon.first@test.local", passwordHash: "unused", role: ROLES.APPROVER, approvalLevel: "AREA_DIRECTOR", approvalAreas: ["*"], area: "Operations" });
      const second = await User.create({ name: "Second Reviewer", email: "canon.second@test.local", passwordHash: "unused", role: ROLES.APPROVER, approvalLevel: "VICE_RECTOR", approvalAreas: ["*"], area: "Rectorate" });
      const request = await makeRoutedRequest("REQ-2026-97102", [
        { approvalLevel: "AREA_DIRECTOR", role: ROLES.APPROVER, sequence: 1, slaHours: 24, required: true, status: "PENDING", startedAt: new Date(), dueAt: new Date(Date.now() + 86400000) },
        { approvalLevel: "VICE_RECTOR", role: ROLES.APPROVER, sequence: 2, slaHours: 24, required: true, status: "PENDING" }
      ]);
      const afterFirst = await decideApproval({ id: request._id, action: "APPROVE", comments: "First approved", user: first, req });
      assert.equal(afterFirst.request.status, REQUEST_STATUS.PENDING_APPROVAL, "still mid-route; no organization-specific label is written");
      assert.equal(afterFirst.request.approvalStage, "VICE_RECTOR");
      const afterSecond = await decideApproval({ id: request._id, action: "APPROVE", comments: "Second approved", user: second, req });
      assert.equal(afterSecond.request.status, REQUEST_STATUS.BUDGET_COMMITTED, "route completed into APROBADO, then auto-committed budget in the same decision");
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
