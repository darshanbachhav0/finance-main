import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { limaDateKey } from "../../shared/businessCalendar.mjs";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AuditLog from "../src/models/AuditLog.js";
import CostCenter from "../src/models/CostCenter.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinanceConfiguration from "../src/models/FinanceConfiguration.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import JournalEntry from "../src/models/JournalEntry.js";
import Notification from "../src/models/Notification.js";
import Supplier from "../src/models/Supplier.js";
import TreasuryBankAccount from "../src/models/TreasuryBankAccount.js";
import User from "../src/models/User.js";
import { auditorMayCall } from "../src/middleware/auth.js";
import { activeApprovalStep, initializeApprovalRoute } from "../src/services/approvalRuleService.js";
import { decideApproval, getApprovalDecisionOptions, listApprovalInbox } from "../src/services/approvalService.js";
import { allowedRequestActions } from "../src/services/requestActionPolicy.js";
import { createTreasuryTransfer, executeTreasuryTransfer, listTreasuryTransfers, reconcileTreasuryTransfer, resubmitTreasuryTransfer } from "../src/services/treasuryTransferService.js";
import { EXPENSE_NATURE, PERMISSIONS, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";
import { actsAsRequester, canViewRequest, hasPermission, permissionScopes } from "../src/utils/permissions.js";
import { quoteAttachment, recommendedQuote } from "./quoteFixtures.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };

test("new roles carry the manual's permissions", () => {
  assert.equal(hasPermission({ role: ROLES.GAF }, PERMISSIONS.REQUEST_APPROVE), true);
  assert.equal(hasPermission({ role: ROLES.GAF }, PERMISSIONS.BATCH_APPROVE), true, "the GAF approves bank files");
  assert.equal(hasPermission({ role: ROLES.GAF }, PERMISSIONS.REQUEST_CREATE), false);
  assert.equal(hasPermission({ role: ROLES.LEGAL }, PERMISSIONS.LEGAL_REVIEW), true, "Legal validates process E");
  assert.equal(hasPermission({ role: ROLES.HUMAN_RESOURCES }, PERMISSIONS.HONORARIOS_MANAGE), true, "GP uploads process H");
  for (const role of [ROLES.LEGAL, ROLES.HUMAN_RESOURCES]) {
    assert.equal(actsAsRequester({ role }), false, `${role} does not register requests by role`);
    assert.equal(hasPermission({ role }, PERMISSIONS.REQUEST_CREATE), false);
    assert.equal(hasPermission({ role }, PERMISSIONS.SUPPLIER_CREATE), false);
    assert.equal(permissionScopes({ role })[PERMISSIONS.REQUEST_VIEW], "OWN", `${role} reads only its own requests`);
    // An employee who also raises their area's requests holds Solicitante as an additional role.
    assert.equal(actsAsRequester({ role, roles: [ROLES.SOLICITOR] }), true, `${role} + Solicitante registers its area's requests`);
    assert.equal(hasPermission({ role, roles: [ROLES.SOLICITOR] }, PERMISSIONS.SUPPLIER_CREATE), true);
  }
  assert.equal(hasPermission({ role: ROLES.AUDITOR }, PERMISSIONS.AUDIT_READ), true);
  assert.equal(hasPermission({ role: ROLES.AUDITOR }, PERMISSIONS.REQUEST_VIEW), true);
  for (const permission of [PERMISSIONS.REQUEST_APPROVE, PERMISSIONS.REQUEST_CREATE, PERMISSIONS.SUPPLIER_CREATE, PERMISSIONS.SUPPLIER_BANK_VIEW, PERMISSIONS.TREASURY_GENERATE_BATCH]) {
    assert.equal(hasPermission({ role: ROLES.AUDITOR }, permission), false, `the Auditor never holds ${permission}`);
  }
  assert.equal(auditorMayCall("GET", "/api/requests"), true);
  assert.equal(auditorMayCall("POST", "/api/requests"), false);
  assert.equal(auditorMayCall("POST", "/api/approvals/1/approve"), false);
  assert.equal(auditorMayCall("PUT", "/api/notifications/read-all"), true);
  assert.equal(auditorMayCall("GET", "/api/sire/export"), false);
  const draft = { status: REQUEST_STATUS.DRAFT, requester: new mongoose.Types.ObjectId() };
  assert.equal(canViewRequest(draft, { _id: new mongoose.Types.ObjectId(), role: ROLES.AUDITOR }), false, "nobody reads other people's drafts");
  assert.equal(canViewRequest({ ...draft, status: REQUEST_STATUS.PENDING_APPROVAL }, { _id: new mongoose.Types.ObjectId(), role: ROLES.GAF }), true);
});

test("approval tiers by UIT and Track D transfers", { timeout: 120000 }, async (t) => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/erp_track_d_tiers_${process.pid}_${Date.now()}`);
  try {
    await Promise.all([Notification.init(), AuditLog.init(), JournalEntry.init()]);
    const today = limaDateKey(new Date());
    const center = await CostCenter.create({ code: "CC-TIER", name: "Tiers", area: "Operations", budgetMode: "TRANSITIONAL", annualBudget: 10000000, active: true });
    const treasuryCenter = await CostCenter.create({ code: "CC-TESO", name: "Tesorería", area: "Finanzas", budgetMode: "TRANSITIONAL", active: true });
    const expenseType = await ExpenseType.create({ code: "EXP-TIER", name: "Services", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", active: true });
    const supplier = await Supplier.create({ identifierType: "RUC", rucDni: "20999999971", normalizedIdentifier: "20999999971", legalName: "Tier Supplier SAC", name: "Tier Supplier SAC", homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true, supplierCode: "PRV-9771", paymentTerms: { option: "CREDIT_30", days: 30 } });
    for (const period of new Set(["2026-09", today.slice(0, 7)])) await AccountingPeriod.create({ period, status: "OPEN" });
    const user = (name, role, extra = {}) => User.create({ name, email: `${name.toLowerCase().replace(/\W+/g, ".")}@tiers.test`, passwordHash: "unused", role, area: "Operations", ...extra });
    const root = await user("Vice Rector", ROLES.VICE_RECTOR);
    const head = await user("Cost Center Head", ROLES.SOLICITOR, { jefe: root._id });
    const requester = await user("Requester", ROLES.SOLICITOR, { jefe: head._id, costCenter: center._id });
    const management = await user("Gerencia General", ROLES.MANAGEMENT, { approvalLevel: "GENERAL_MANAGEMENT" });
    let sequence = 0;

    async function makeRequest(total) {
      sequence += 1;
      const net = Math.round((total / 1.18) * 100) / 100;
      const request = new FinancialRequest({
        requestNumber: `REQ-2026-97${String(sequence).padStart(3, "0")}`, requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.SERVICES,
        issueDate: "2026-09-10", accountingPeriod: "2026-09", currency: "PEN", flowType: "A1",
        solicitor: requester._id, requester: requester._id, requesterArea: "Operations", requesterCostCenter: center._id, supplier: supplier._id,
        description: "Tier test", detailedDescription: "Tier test", businessJustification: "Tier coverage.", status: REQUEST_STATUS.PENDING_APPROVAL,
        quotations: [recommendedQuote(supplier._id)], attachments: [quoteAttachment(requester._id)],
        lines: [{ costCenter: center._id, expenseType: expenseType._id, netAmount: net, igvAmount: Math.round((total - net) * 100) / 100, totalAmount: total }]
      });
      await initializeApprovalRoute(request);
      await request.save();
      return request;
    }

    await t.test("the cost center's responsible cannot finalize alone: the superior also approves", async () => {
      const request = await makeRequest(118);
      const first = activeApprovalStep(request);
      assert.equal(String(first.approverUser), String(head._id));
      assert.equal(first.superiorRequired, true);
      const options = await getApprovalDecisionOptions(request._id, head);
      assert.equal(options.canFinalize, false);
      assert.equal(options.superiorRequired, true);
      assert.equal(String(options.forwardTo._id), String(root._id));
      // Asking to finalize still sends it up.
      const result = await decideApproval({ id: request._id, action: "APPROVE", forward: false, comments: "OK", user: head, req });
      assert.equal(result.request.status, REQUEST_STATUS.PENDING_APPROVAL);
      assert.equal(String(activeApprovalStep(result.request).approverUser), String(root._id));
      assert.equal((await getApprovalDecisionOptions(request._id, root)).canFinalize, true, "the superior may finalize");
      const final = await decideApproval({ id: request._id, action: "APPROVE", forward: false, comments: "OK", user: root, req });
      assert.notEqual(final.request.status, REQUEST_STATUS.PENDING_APPROVAL);
      assert.equal(final.request.approvalStage, "COMPLETE");
    });

    await t.test("above 5 UIT the GAF approves after the chain, and the route needs a GAF user", async () => {
      await assert.rejects(makeRequest(30000), (error) => error.code === "APPROVAL_ROUTE_NOT_CONFIGURED" && /Gerencia de Administración Financiera/.test(error.message));
      const gaf = await user("GAF", ROLES.GAF);
      const request = await makeRequest(30000);
      assert.deepEqual(request.approvalRouteSnapshot.map((step) => step.tier || "CHAIN"), ["CHAIN", "GAF"]);
      await decideApproval({ id: request._id, action: "APPROVE", comments: "OK", user: head, req });
      const afterChain = await decideApproval({ id: request._id, action: "APPROVE", forward: false, comments: "OK", user: root, req });
      assert.equal(afterChain.request.status, REQUEST_STATUS.PENDING_APPROVAL, "finalizing the chain opens the GAF step");
      assert.equal(activeApprovalStep(afterChain.request).tier, "GAF");
      const inbox = await listApprovalInbox({}, gaf);
      assert.ok(inbox.data.some((row) => String(row._id) === String(request._id)), "the GAF sees the step in its inbox");
      assert.ok(allowedRequestActions(afterChain.request, gaf).includes("APPROVE"));
      await assert.rejects(decideApproval({ id: request._id, action: "APPROVE", comments: "OK", user: management, req }), (error) => error.statusCode === 403);
      const done = await decideApproval({ id: request._id, action: "APPROVE", comments: "OK", user: gaf, req });
      assert.equal(done.request.approvalStage, "COMPLETE");
      assert.notEqual(done.request.status, REQUEST_STATUS.PENDING_APPROVAL);
    });

    await t.test("above 20 UIT the Gerencia General approves too; a tier already approved in the chain is skipped", async () => {
      const request = await makeRequest(120000);
      assert.deepEqual(request.approvalRouteSnapshot.map((step) => step.tier || "CHAIN"), ["CHAIN", "GAF", "GENERAL_MANAGEMENT"]);
      // The superior is the GAF here: its chain approval covers the GAF tier.
      await User.updateOne({ _id: root._id }, { role: ROLES.GAF });
      const superior = await User.findById(root._id);
      await decideApproval({ id: request._id, action: "APPROVE", comments: "OK", user: head, req });
      const afterChain = await decideApproval({ id: request._id, action: "APPROVE", forward: false, comments: "OK", user: superior, req });
      const tiers = afterChain.request.approvalRouteSnapshot.filter((step) => step.tier);
      assert.equal(tiers.find((step) => step.tier === "GAF").status, "SKIPPED");
      assert.equal(activeApprovalStep(afterChain.request).tier, "GENERAL_MANAGEMENT");
      const done = await decideApproval({ id: request._id, action: "APPROVE", comments: "OK", user: management, req });
      assert.equal(done.request.approvalStage, "COMPLETE");
      await User.updateOne({ _id: root._id }, { role: ROLES.VICE_RECTOR });
    });

    await t.test("the UIT thresholds are finance configuration", async () => {
      await FinanceConfiguration.create({ key: "GAF_APPROVAL_UIT", numericValue: 100, effectiveFrom: new Date(Date.now() - 86400000), active: true });
      // Earlier requests of this test to the same supplier and CECO would count together
      // (anti-fragmentation); close them so only the threshold is measured here.
      await FinancialRequest.updateMany({ requestNumber: /^REQ-2026-97/ }, { $set: { status: REQUEST_STATUS.REJECTED } });
      const request = await makeRequest(30000);
      assert.deepEqual(request.approvalRouteSnapshot.map((step) => step.tier || "CHAIN"), ["CHAIN"]);
      await FinanceConfiguration.deleteMany({ key: "GAF_APPROVAL_UIT" });
    });

    await t.test("Track D: Treasury registers, another Treasury user and the GAF approve, Treasury executes and reconciles", async () => {
      const gaf = await User.findOne({ role: ROLES.GAF });
      const treasury = await user("Tesorero", ROLES.TREASURY, { area: "Finanzas", costCenter: treasuryCenter._id });
      const source = await TreasuryBankAccount.create({ code: "BBVA-PEN", bank: "BBVA", currency: "PEN", accountNumber: "0011-0000-01", ledgerAccount: "104102" });
      const destination = await TreasuryBankAccount.create({ code: "BCP-PEN", bank: "BCP", currency: "PEN", accountNumber: "191-000-01", ledgerAccount: "104101" });
      const dollars = await TreasuryBankAccount.create({ code: "BCP-USD", bank: "BCP", currency: "USD", accountNumber: "191-000-02", ledgerAccount: "104101" });
      const body = { sourceAccount: source._id, destinationAccount: destination._id, amount: 250000, purpose: "FUNDING", description: "Fondeo BCP para la quincena" };

      await assert.rejects(createTreasuryTransfer({ body: { ...body, destinationAccount: dollars._id }, user: treasury, req }), (error) => error.statusCode === 422 && error.details.field === "destinationAccount");
      await assert.rejects(createTreasuryTransfer({ body, user: requester, req }), (error) => error.statusCode === 403);
      await assert.rejects(createTreasuryTransfer({ body, user: treasury, req }), (error) => error.code === "APPROVAL_ROUTE_NOT_CONFIGURED", "another Treasury user must exist to approve");
      const head = await user("Jefe de Tesorería", ROLES.TREASURY, { area: "Finanzas" });

      const transfer = await createTreasuryTransfer({ body, user: treasury, req });
      assert.equal(transfer.flowType, "D");
      assert.equal(transfer.status, REQUEST_STATUS.PENDING_APPROVAL);
      assert.equal(transfer.totalAmount, 250000);
      assert.equal(transfer.totalIGV, 0);
      assert.deepEqual(transfer.approvalRouteSnapshot.map((step) => step.tier), ["TREASURY_HEAD", "GAF"]);
      await assert.rejects(decideApproval({ id: transfer._id, action: "APPROVE", comments: "OK", user: treasury, req }), (error) => error.statusCode === 403, "nobody approves their own transfer");
      assert.ok((await listApprovalInbox({}, head)).data.some((row) => String(row._id) === String(transfer._id)));
      assert.equal((await listApprovalInbox({}, treasury)).data.some((row) => String(row._id) === String(transfer._id)), false);
      const returned = await decideApproval({ id: transfer._id, action: "RETURN", comments: "El monto es 240000", user: head, req });
      assert.equal(returned.request.status, REQUEST_STATUS.RETURNED);
      await assert.rejects(resubmitTreasuryTransfer({ id: transfer._id, body: { amount: 240000 }, user: head, req }), (error) => error.statusCode === 403);
      const resent = await resubmitTreasuryTransfer({ id: transfer._id, body: { amount: 250000 }, user: treasury, req });
      assert.equal(resent.status, REQUEST_STATUS.PENDING_APPROVAL);
      assert.equal(activeApprovalStep(resent).tier, "TREASURY_HEAD");
      await decideApproval({ id: transfer._id, action: "APPROVE", comments: "OK", user: head, req });
      const approved = (await decideApproval({ id: transfer._id, action: "APPROVE", comments: "OK", user: gaf, req })).request;
      assert.equal(approved.status, REQUEST_STATUS.APPROVED);
      assert.equal(approved.budgetCommitment, undefined, "a transfer reserves no budget");
      assert.ok(await Notification.exists({ user: treasury._id, eventKey: `request:${transfer._id}:transfer-execute` }));

      await assert.rejects(executeTreasuryTransfer({ id: transfer._id, body: {}, user: treasury, req }), (error) => error.details.field === "operationNumber");
      const paid = await executeTreasuryTransfer({ id: transfer._id, body: { operationNumber: "OP-7788", executedAt: today }, user: treasury, req });
      assert.equal(paid.status, REQUEST_STATUS.PAID);
      const journal = await JournalEntry.findById(paid.treasuryTransfer.journal).lean();
      assert.equal(journal.entryType, "TRANSFER");
      assert.deepEqual(journal.lines.map((line) => [line.accountNumber, line.debit, line.credit]), [["104101", 250000, 0], ["104102", 0, 250000]]);

      await assert.rejects(reconcileTreasuryTransfer({ id: transfer._id, body: { statementAmount: 249000 }, user: treasury, req }), (error) => error.details.field === "comments");
      const closed = await reconcileTreasuryTransfer({ id: transfer._id, body: {}, user: treasury, req });
      assert.equal(closed.status, REQUEST_STATUS.CLOSED);
      const listed = await listTreasuryTransfers({ stage: "done" });
      assert.equal(listed.summary.done, 1);
      assert.equal(String(listed.data[0]._id), String(transfer._id));
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
