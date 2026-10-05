import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import mongoose from "mongoose";
import AccountingMapping from "../src/models/AccountingMapping.js";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import BudgetAllocation from "../src/models/BudgetAllocation.js";
import BudgetCommitment from "../src/models/BudgetCommitment.js";
import BudgetException from "../src/models/BudgetException.js";
import BudgetRule from "../src/models/BudgetRule.js";
import CostCenter from "../src/models/CostCenter.js";
import DirectPaymentEligibilityRule from "../src/models/DirectPaymentEligibilityRule.js";
import DocumentRule from "../src/models/DocumentRule.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import Notification from "../src/models/Notification.js";
import Supplier from "../src/models/Supplier.js";
import User from "../src/models/User.js";
import { processAccountsPayable } from "../src/services/accountingService.js";
import { countPendingBudgetExceptions, recordBudgetExceptionDecision } from "../src/services/budgetExceptionService.js";
import { adjustBudgetPlan, carryOverOpenCommitments, createBudgetPlan } from "../src/services/budgetPlanService.js";
import { budgetOverview } from "../src/services/budgetReportingService.js";
import { assertBudgetBeforePosting, executeBudgetAmount, reserveBudget } from "../src/services/budgetService.js";
import { configuredDocumentRequirements, configuredQuotationPolicy, defaultQuotationPolicy, validateStructuredQuotationComparison } from "../src/services/documentRuleService.js";
import { evaluateProcurementReadiness, NO_ORDER_EXPENSE_NATURES, requiresPurchaseOrder } from "../src/services/procurementReadinessService.js";
import { createFinancialRequest, updateFinancialRequest } from "../src/services/requestService.js";
import { BUDGET_STATUS, DOCUMENT_PHASE, EXPENSE_NATURE, FLOW_TYPE, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";
import { fiscalFixture } from "./fiscalFixtures.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };

test("product-owner decisions for quotations, procurement, budget exceptions, carry-over and Track B", { timeout: 120000 }, async (t) => {
  const database = `erp_budget_procurement_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`);
  const cleanup = [];
  try {
    await Promise.all([BudgetCommitment.init(), BudgetException.init(), BudgetAllocation.init(), FinancialRequest.init(), AccountsPayable.init()]);
    const center = await CostCenter.create({ code: "PO-DEC-CC", name: "Decisions", area: "Operations", annualBudget: 100000, budgetMode: "ACTIVE", active: true });
    const planCenter = await CostCenter.create({ code: "PO-DEC-PLAN", name: "Planned", area: "Operations", annualBudget: 0, budgetMode: "ACTIVE", active: true });
    const extraCenter = await CostCenter.create({ code: "PO-DEC-EXTRA", name: "Extraordinary", area: "Operations", annualBudget: 100, budgetMode: "ACTIVE", active: true });
    const transitionalCenter = await CostCenter.create({ code: "PO-DEC-TRANS", name: "Transitional", area: "Operations", annualBudget: 50, budgetMode: "TRANSITIONAL", active: true });
    const opex = await ExpenseType.create({ code: "PO-DEC-OPEX", name: "Operating expense", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", deductible: true, permittedRequestTypes: [REQUEST_TYPE.OPEX], active: true });
    const users = {
      solicitor: await User.create({ name: "Requester", email: "po-dec-requester@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", costCenter: center._id, authorizedCostCenters: [center._id] }),
      budget: await User.create({ name: "Budget Officer", email: "po-dec-budget@test.local", passwordHash: "unused", role: ROLES.BUDGET, area: "Budget" }),
      management: await User.create({ name: "Management", email: "po-dec-management@test.local", passwordHash: "unused", role: ROLES.MANAGEMENT, area: "Rectorate", active: true }),
      admin: await User.create({ name: "Admin", email: "po-dec-admin@test.local", passwordHash: "unused", role: ROLES.ADMIN, area: "Systems" }),
      accounting: await User.create({ name: "Accounting", email: "po-dec-accounting@test.local", passwordHash: "unused", role: ROLES.ACCOUNTING, area: "Accounting" })
    };
    const supplier = await Supplier.create({ identifierType: "RUC", rucDni: "20999999991", normalizedIdentifier: "20999999991", legalName: "Decision Supplier SAC", name: "Decision Supplier SAC", taxpayerStatus: "MANUALLY_VALIDATED", complianceStatus: "COMPLIANT", homologationStatus: "HOMOLOGATED", supplierCode: "PRV-9801", paymentTerms: { option: "CREDIT_30", days: 30 }, active: true, status: "ACTIVE" });
    await AccountingPeriod.create({ period: "2026-08", status: "OPEN" });
    for (const [code, purpose, accountNumber] of [["DEC-AP", "ACCOUNTS_PAYABLE", "421201"], ["DEC-IGV", "IGV", "401111"]]) {
      await AccountingMapping.create({ code, name: code, purpose, requestType: "*", expenseNature: "*", bank: "*", currency: "*", accountNumber, active: true });
    }
    const makeRequest = (overrides = {}) => FinancialRequest.create({
      flowType: FLOW_TYPE.A1, requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.MAINTENANCE, issueDate: "2026-08-10", accountingPeriod: "2026-08",
      currency: "PEN", supplier: supplier._id, solicitor: users.solicitor._id, requester: users.solicitor._id, description: "Decision test", status: REQUEST_STATUS.OBSERVED_BUDGET,
      lines: [{ costCenter: center._id, expenseType: opex._id, netAmount: 100, igvAmount: 18, totalAmount: 118 }], ...overrides
    });
    const line = (costCenter, totalAmount) => [{ costCenter, expenseType: opex._id, netAmount: totalAmount, igvAmount: 0, totalAmount }];

    await t.test("1. at least one quotation is required; three are not compulsory and legacy rules of 3 are normalized", async () => {
      const goods = { flowType: FLOW_TYPE.A1, requestType: REQUEST_TYPE.CAPEX, expenseNature: EXPENSE_NATURE.GOODS };
      assert.equal(defaultQuotationPolicy(goods).minimumCount, 1);
      assert.equal(defaultQuotationPolicy(goods).allowAuthorizedException, undefined, "the single-source exception is gone");
      await DocumentRule.create({ code: "DEC-LEGACY-3", flowType: "A1", requestType: "*", expenseNature: EXPENSE_NATURE.EQUIPMENT, requirements: [{ kind: "QUOTATION", minCount: 3, labelKey: "three quotations" }], quotationPolicy: { enabled: true, minimumCount: 3 }, active: true });
      const legacy = { ...goods, expenseNature: EXPENSE_NATURE.EQUIPMENT };
      const policy = await configuredQuotationPolicy(legacy);
      assert.equal(policy.enabled, true);
      assert.equal(policy.minimumCount, 1);
      assert.deepEqual((await configuredDocumentRequirements(legacy, DOCUMENT_PHASE.SUBMISSION)).map((item) => [item.kind, item.minCount]), [["QUOTATION", 1]]);
      const base = { supplier: supplier._id, supplierSelectionReason: "Only compliant proposal" };
      const none = validateStructuredQuotationComparison({ ...base, quotations: [] }, policy);
      assert.ok(none.errors.some((error) => error.code === "QUOTATION_MINIMUM_NOT_MET" && error.required === 1));
      const one = validateStructuredQuotationComparison({ ...base, quotations: [{ supplier: supplier._id, attachment: new mongoose.Types.ObjectId(), recommended: true }] }, policy);
      assert.equal(one.valid, true);
      const withForgedException = validateStructuredQuotationComparison({ ...base, quotationException: { authorized: true }, quotations: [] }, policy);
      assert.equal(withForgedException.valid, false, "a quotation exception can no longer waive the single required quotation");
    });

    await t.test("3. A1 natures without an order report 'not applicable' cleanly and reach Accounting without a PO", async () => {
      for (const nature of NO_ORDER_EXPENSE_NATURES) assert.equal(requiresPurchaseOrder({ flowType: "A1", requestType: "OPEX", expenseNature: nature }), false);
      assert.equal(requiresPurchaseOrder({ flowType: "A1", requestType: "CAPEX", expenseNature: EXPENSE_NATURE.GOODS }), true);
      assert.equal(requiresPurchaseOrder({ flowType: "A1", requestType: "OPEX", expenseNature: EXPENSE_NATURE.SERVICES }), true);
      const travel = await makeRequest({ expenseNature: EXPENSE_NATURE.TRAVEL, status: REQUEST_STATUS.BUDGET_COMMITTED, attachments: [{ kind: "CONFORMITY", originalName: "conformity.pdf", filename: "conformity.pdf", url: "/test/conformity.pdf", mimetype: "application/pdf", size: 10, uploadedBy: users.solicitor._id }] });
      const readiness = await evaluateProcurementReadiness(travel);
      assert.equal(readiness.applicable, false);
      assert.equal(readiness.notApplicable, true);
      assert.equal(readiness.reason, "EXPENSE_NATURE_WITHOUT_ORDER");
      assert.deepEqual(readiness.issues.map((item) => item.code), ["PROCUREMENT_NOT_APPLICABLE"], "no ORDER_KIND_UNDETERMINED or supplier noise");
      const commitment = await reserveBudget(travel, users.budget._id);
      travel.budgetCommitment = commitment._id;
      const { xmlFile } = await fiscalFixture(travel, supplier, { ruc: supplier.rucDni, voucherType: "FACTURA", series: "F001", number: "7001", issueDate: "2026-08-10", currency: "PEN", netAmount: 100, igvAmount: 18, totalAmount: 118 }, users.accounting, cleanup);
      travel.attachments.push({ ...xmlFile, kind: "XML", uploadedBy: users.accounting._id });
      await travel.save();
      const result = await processAccountsPayable({ requestId: travel._id, payload: { documentType: "FACTURA", series: "F001", number: "7001", documentDate: "2026-08-10", accountingDate: "2026-08-10", fiscalPeriod: "2026-08", accountNumber: opex.accountNumber, dueDate: "2026-09-30" }, user: users.accounting, req });
      assert.equal(result.request.status, REQUEST_STATUS.ACCOUNTED);
      assert.equal(result.accountsPayable.purchaseOrder, undefined);
    });

    await t.test("6. the Track B cap uses the real PEN total on create+submit and update+submit", async () => {
      await DirectPaymentEligibilityRule.create({ name: "Small direct payments", area: "*", expenseNature: "*", maxAmount: 100, active: true });
      const payload = (totalAmount, submit) => ({ flowType: FLOW_TYPE.B, requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.MAINTENANCE, issueDate: "2026-08-10", accountingPeriod: "2026-08", currency: "PEN", supplier: supplier._id.toString(), requesterCostCenter: center._id.toString(), description: "Direct payment", lines: line(center._id.toString(), totalAmount), submit });
      await assert.rejects(() => createFinancialRequest({ payload: payload(118, true), files: {}, user: users.solicitor, req }), (error) => /Track B/.test(error.message) && error.details.amount === 118);
      await assert.rejects(() => createFinancialRequest({ payload: payload(90, true), files: {}, user: users.solicitor, req }), (error) => !/Track B/.test(error.message), "within the cap, eligibility passes and the usual XML requirement applies");
      const draft = await createFinancialRequest({ payload: payload(90, false), files: {}, user: users.solicitor, req });
      await assert.rejects(() => updateFinancialRequest({ id: draft._id, payload: { lines: line(center._id.toString(), 180), submit: true }, files: {}, user: users.solicitor, req }), (error) => /Track B/.test(error.message) && error.details.amount === 180);
    });

    await t.test("7. TRANSITIONAL budget never blocks a larger (USD) invoice and its usage is reported", async () => {
      const usd = await makeRequest({ currency: "USD", exchangeRate: 3.5, accountingPeriod: "2026-10", status: REQUEST_STATUS.BUDGET_COMMITTED, lines: line(transitionalCenter._id, 100) });
      const commitment = await reserveBudget(usd, users.budget._id);
      assert.equal(commitment.status, BUDGET_STATUS.NO_BUDGET);
      const topUp = await assertBudgetBeforePosting(usd, { amount: 420, userId: users.budget._id, allowFxTopUp: true, exchangeRateEvidence: { rate: 3.8 } });
      assert.equal(topUp.totalAmount, 420);
      assert.equal(topUp.adjustments.at(-1).reason, "INFORMATIONAL_TOP_UP");
      const pen = await makeRequest({ accountingPeriod: "2026-10", status: REQUEST_STATUS.BUDGET_COMMITTED, lines: line(transitionalCenter._id, 60) });
      await reserveBudget(pen, users.budget._id);
      await assert.doesNotReject(() => assertBudgetBeforePosting(pen, { amount: 75, userId: users.budget._id }));
      await executeBudgetAmount(pen, users.budget._id, 75);
      const center = await CostCenter.findById(transitionalCenter._id);
      assert.equal(center.committedAmount, 0, "pooled balances stay untouched");
      assert.equal(center.executedAmount, 0);
      const overview = await budgetOverview({ period: "2026-10", summaryOnly: "true" });
      assert.equal(overview.totals.transitional.committed, 420);
      assert.equal(overview.totals.transitional.executed, 75);
      assert.equal(overview.totals.committed, 420, "the overview no longer shows 0 committed for TRANSITIONAL usage");
    });

    let plan;
    let firstRequest;
    let secondRequest;
    await t.test("4a. Budget reviews first, Management decides, and an approved increase adds the money automatically", async () => {
      plan = await createBudgetPlan({ year: "2026", planningMode: "ANNUAL_MONTHLY", costCenter: planCenter._id, expenseType: opex._id, assignedAmount: 1200, distribution: "EQUAL", reason: "Operating plan" }, users.budget, req);
      await BudgetRule.create({ name: "Increase on shortage", mode: "ACTIVE", exceptionStrategy: "REQUEST_BUDGET_INCREASE", costCenter: planCenter._id, active: true });
      firstRequest = await makeRequest({ lines: line(planCenter._id, 150) });
      await assert.rejects(() => reserveBudget(firstRequest, users.budget._id), (error) => error.code === "INSUFFICIENT_BUDGET");
      const exception = await BudgetException.findOne({ request: firstRequest._id });
      assert.equal(exception.strategy, "REQUEST_BUDGET_INCREASE");
      assert.equal(await countPendingBudgetExceptions(), 1);
      assert.equal(await countPendingBudgetExceptions({ awaitingDecision: true }), 0, "Management has nothing to decide before Budget's review");
      await assert.rejects(() => recordBudgetExceptionDecision(exception._id, "APPROVED", "Too early", users.management, req), (error) => error.statusCode === 409);
      await recordBudgetExceptionDecision(exception._id, "REVIEWED", "Budget recommends the increase", users.budget, req);
      const notice = await Notification.findOne({ user: users.management._id, eventKey: `budget-exception:${exception._id}:decision` });
      assert.ok(notice, "Management is notified once Budget has reviewed");
      assert.match(notice.path, new RegExp(`/budget\\?tab=exceptions&record=${exception._id}`));
      assert.equal(await countPendingBudgetExceptions({ awaitingDecision: true }), 1);
      const approved = await recordBudgetExceptionDecision(exception._id, "APPROVED", "Approved increase", users.management, req);
      assert.equal(approved.status, "APPROVED");
      assert.equal(approved.appliedIncrease.amount, 50);
      assert.equal(approved.appliedIncrease.target, "BUDGET_PLAN");
      const increased = await BudgetAllocation.findById(plan._id);
      assert.equal(increased.assignedAmount, 1250);
      assert.equal(increased.months[7].assignedAmount, 150);
      assert.equal(increased.adjustments.at(-1).action, "EXCEPTION_INCREASE");
      assert.ok(await Notification.exists({ user: users.budget._id, eventKey: `budget-exception:${exception._id}:approved` }));
      assert.equal((await Notification.findOne({ user: users.management._id, eventKey: `budget-exception:${exception._id}:decision` })).resolvedAt instanceof Date, true);
      const commitment = await reserveBudget(firstRequest, users.budget._id);
      assert.equal(commitment.status, BUDGET_STATUS.COMMITTED, "the commitment proceeds within the increased plan");
      await recordBudgetExceptionDecision(exception._id, "REVIEWED", "late", users.budget, req).then(() => assert.fail("decided exceptions are final"), (error) => assert.equal(error.statusCode, 409));
    });

    await t.test("4b. a rejected exception is not reused on resubmission, and a moot PENDING exception auto-resolves", async () => {
      secondRequest = await makeRequest({ lines: line(planCenter._id, 150) });
      await assert.rejects(() => reserveBudget(secondRequest, users.budget._id));
      const rejected = await BudgetException.findOne({ request: secondRequest._id, status: "PENDING" });
      await recordBudgetExceptionDecision(rejected._id, "REVIEWED", "Not recommended", users.budget, req);
      await recordBudgetExceptionDecision(rejected._id, "REJECTED", "Rejected", users.management, req);
      await assert.rejects(() => reserveBudget(secondRequest, users.budget._id), (error) => error.details.exceptionStatus === "PENDING");
      const fresh = await BudgetException.findOne({ request: secondRequest._id, status: "PENDING" });
      assert.ok(fresh, "the resubmission gets a new exception");
      assert.notEqual(String(fresh._id), String(rejected._id));
      assert.equal(String(fresh.supersedes), String(rejected._id));
      assert.equal(await BudgetException.countDocuments({ request: secondRequest._id }), 2);
      const current = await BudgetAllocation.findById(plan._id);
      const increasedPlan = await adjustBudgetPlan(plan._id, { operationId: "dec-increase-0001", revision: current.__v, action: "INCREASE", amount: 150, reason: "Budget found funds" }, users.admin, req);
      await adjustBudgetPlan(plan._id, { operationId: "dec-reserve-0001", revision: increasedPlan.__v, action: "ALLOCATE_RESERVE", toMonth: 8, amount: 150, reason: "Fund August" }, users.admin, req);
      const commitment = await reserveBudget(secondRequest, users.budget._id);
      assert.equal(commitment.status, BUDGET_STATUS.COMMITTED);
      const resolved = await BudgetException.findById(fresh._id);
      assert.equal(resolved.status, "RESOLVED", "the commitment succeeded, so the pending exception is moot");
      assert.equal(resolved.history.at(-1).action, "AUTO_RESOLVED");
      assert.equal(await countPendingBudgetExceptions(), 0);
    });

    await t.test("4c. an approved extraordinary exception that is now exceeded is not reused", async () => {
      await BudgetRule.create({ name: "Extraordinary", mode: "ACTIVE", exceptionStrategy: "EXTRAORDINARY_APPROVAL", costCenter: extraCenter._id, active: true });
      const request = await makeRequest({ lines: line(extraCenter._id, 150) });
      await assert.rejects(() => reserveBudget(request, users.budget._id));
      const exception = await BudgetException.findOne({ request: request._id });
      await recordBudgetExceptionDecision(exception._id, "REVIEWED", "Recommend", users.budget, req);
      await recordBudgetExceptionDecision(exception._id, "APPROVED", "Approved overrun", users.management, req);
      request.lines = line(extraCenter._id, 200);
      await request.save();
      await assert.rejects(() => reserveBudget(request, users.budget._id), (error) => error.details.exceptionStatus === "PENDING");
      const replacement = await BudgetException.findOne({ request: request._id, status: "PENDING" });
      assert.equal(replacement.requestedAmount, 200);
      assert.equal(String(replacement.supersedes), String(exception._id));
    });

    await t.test("5. year-end carry-over moves open commitments into next year's plan, audited and idempotent", async () => {
      await executeBudgetAmount(firstRequest, users.budget._id, 50);
      await assert.rejects(() => carryOverOpenCommitments({ year: "2026", user: users.management, req }), (error) => error.statusCode === 403);
      const before = await BudgetAllocation.findById(plan._id);
      const summary = await carryOverOpenCommitments({ year: "2026", user: users.budget, req });
      assert.equal(summary.carriedCommitments, 2);
      assert.equal(summary.carriedAmount, 250);
      assert.equal(summary.createdAllocations.length, 1);
      const next = await BudgetAllocation.findOne({ period: "2027", costCenter: planCenter._id });
      assert.equal(next.planningMode, "ANNUAL_MONTHLY");
      assert.equal(next.assignedAmount, 250);
      assert.equal(next.committedAmount, 250);
      assert.equal(next.months[0].committedAmount, 250);
      assert.equal(next.months[0].assignedAmount, 250);
      const after = await BudgetAllocation.findById(plan._id);
      assert.equal(after.committedAmount, before.committedAmount - 250);
      assert.equal(after.assignedAmount, before.assignedAmount - 250);
      assert.equal(after.executedAmount, 50, "execution history stays in the closing year");
      const carried = await BudgetCommitment.findOne({ request: firstRequest._id });
      assert.equal(carried.period, "2027-01");
      assert.deepEqual(carried.lines.map((item) => [String(item.allocation), item.amount, item.executedAmount]), [[String(plan._id), 50, 50], [String(next._id), 100, 0]]);
      assert.equal(carried.adjustments.at(-1).reason, "YEAR_END_CARRY_OVER");
      const again = await carryOverOpenCommitments({ year: "2026", user: users.admin, req });
      assert.equal(again.carriedCommitments, 0);
      assert.equal((await BudgetAllocation.findById(next._id)).assignedAmount, 250, "running it again changes nothing");
      await executeBudgetAmount(firstRequest, users.budget._id, 100);
      assert.equal((await BudgetAllocation.findById(next._id)).executedAmount, 100, "later invoices execute against the new year");
      assert.ok(await mongoose.model("AuditLog").exists({ action: "YEAR_END_CARRY_OVER_RUN" }));
    });
  } finally {
    for (const file of cleanup) await fs.rm(file, { force: true });
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
