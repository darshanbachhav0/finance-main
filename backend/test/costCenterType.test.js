import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import mongoose from "mongoose";
import AccountingMapping from "../src/models/AccountingMapping.js";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import AuditLog from "../src/models/AuditLog.js";
import BudgetCommitment from "../src/models/BudgetCommitment.js";
import CostCenter from "../src/models/CostCenter.js";
import Counter from "../src/models/Counter.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinanceConfiguration from "../src/models/FinanceConfiguration.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import JournalEntry from "../src/models/JournalEntry.js";
import Notification from "../src/models/Notification.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";
import User from "../src/models/User.js";
import { getConsolidation, processAccountsPayable } from "../src/services/accountingService.js";
import { approveThroughChain } from "./approvalFixtures.js";
import { activeApprovalStep } from "../src/services/approvalRuleService.js";
import { groupedRequestLines } from "../src/services/budgetService.js";
import { allowedRequestActions } from "../src/services/requestActionPolicy.js";
import { decideApproval, getApprovalDecisionOptions } from "../src/services/approvalService.js";
import {
  createFinancialRequest,
  getRequestDetail,
  listRequestsPage,
  previewFinancialRequestBudget,
  requestBeneficiaryCostCenters,
  submitFinancialRequest,
  updateFinancialRequest
} from "../src/services/requestService.js";
import { canViewRequest } from "../src/utils/permissions.js";
import { ERROR_CODES, EXPENSE_NATURE, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";
import { costAllocationProblems, distributeAcrossCostCenters, percentageTotal, splitByPercentages } from "../../shared/costCenterAllocation.mjs";
import { fiscalFixture } from "./fiscalFixtures.js";
import { quoteAttachment, recommendedQuote } from "./quoteFixtures.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };
const period = "2026-10";
const sum = (values) => Math.round(values.reduce((total, value) => total + value * 100, 0)) / 100;
const invalidAllocation = (pattern) => (error) => error.code === ERROR_CODES.INVALID_COST_ALLOCATION && error.statusCode === 422 && (!pattern || pattern.test(error.message));

test("a distribution is split to the cent and must add up to 100%", () => {
  assert.deepEqual(splitByPercentages(10000, [60, 30, 10]), [6000, 3000, 1000]);
  assert.deepEqual(splitByPercentages(100, [33.33, 33.33, 33.34]), [33.33, 33.33, 33.34]);
  assert.deepEqual(splitByPercentages(0.1, [50, 50]), [0.05, 0.05]);
  // Every cent is assigned once: odd amounts still add up exactly.
  for (const amount of [8474.58, 0.03, 1, 999999.99]) assert.equal(sum(splitByPercentages(amount, [60, 30, 10])), amount);
  assert.equal(percentageTotal([33.33, 33.33, 33.34]), 100);

  assert.deepEqual(costAllocationProblems([{ costCenter: "a".repeat(24) }]), [], "one beneficiary alone is 100%");
  assert.deepEqual(costAllocationProblems([]).map((problem) => problem.message), ["Choose the school or department the request is for."]);
  assert.deepEqual(costAllocationProblems([{ costCenter: "a".repeat(24), percentage: 60 }, { costCenter: "b".repeat(24), percentage: 30 }]).map((problem) => problem.message), ["The distribution must add up to 100%."]);
  assert.ok(costAllocationProblems([{ costCenter: "a".repeat(24), percentage: 50 }, { costCenter: "a".repeat(24), percentage: 50 }]).some((problem) => problem.message === "Each cost center can be chosen only once."));
  assert.ok(costAllocationProblems([{ costCenter: "a".repeat(24), percentage: 100 }, { costCenter: "b".repeat(24), percentage: 0 }]).some((problem) => problem.field === "costAllocations.1.percentage"));
  assert.ok(costAllocationProblems([{ costCenter: "a".repeat(24), percentage: 33.333 }, { costCenter: "b".repeat(24), percentage: 66.667 }]).some((problem) => /two decimals/.test(problem.message)));

  const rows = distributeAcrossCostCenters([{ costCenter: "x", debit: 100, accountNumber: "632101" }], [{ costCenter: "m", percentage: 60 }, { costCenter: "n", percentage: 40 }], "debit");
  assert.deepEqual(rows.map((row) => [row.costCenter, row.debit, row.accountNumber]), [["m", 60, "632101"], ["n", 40, "632101"]]);
  assert.deepEqual(distributeAcrossCostCenters([{ costCenter: "x", amount: 5 }], [], "amount"), [{ costCenter: "x", amount: 5 }], "nothing shared: rows unchanged");
});

test("Tipo de Centro de Costo: Propio and Por Encargo, with one or several beneficiaries", { timeout: 240000 }, async (t) => {
  const databaseName = `erp_cost_center_type_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:${Number(process.env.TEST_MONGODB_PORT || 27017)}/${databaseName}`);
  const cleanup = [];
  try {
    await Promise.all([Counter.init(), FinancialRequest.init(), AccountsPayable.init(), JournalEntry.init(), Notification.init(), AuditLog.init(), Supplier.init(), SupplierBankAccount.init()]);
    const center = (code, name, area, extra = {}) => CostCenter.create({ code, name, area, annualBudget: 100000, budgetMode: "ACTIVE", active: true, ...extra });
    const it = await center("CT-TI", "Tecnología de la Información", "Tecnología de la Información");
    const medicine = await center("CT-MED", "Escuela de Medicina", "Escuela de Medicina");
    const nursing = await center("CT-ENF", "Escuela de Enfermería", "Escuela de Enfermería");
    const dentistry = await center("CT-ODO", "Escuela de Odontología", "Escuela de Odontología");
    const closed = await center("CT-OLD", "CECO cerrado", "Archivo", { active: false });
    const opex = await ExpenseType.create({ code: "CT-OPEX", name: "Operating expense", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", deductible: true, active: true });
    const person = (name, extra = {}) => User.create({ name, email: `${name.toLowerCase().replace(/\W+/g, ".")}@test.local`, passwordHash: "unused", role: ROLES.SOLICITOR, ...extra });
    const vicerector = await person("Vicerrector", { role: ROLES.VICE_RECTOR, approvalLevel: "VICE_RECTOR", area: "Rectorado" });
    const itJefe = await person("Jefe TI", { area: "Tecnología de la Información", costCenter: it._id, jefe: vicerector._id });
    // A category 5 position: only categories 3, 5 and 6 may charge other cost centers (Por Encargo).
    const requester = await person("Analista TI", { area: "Tecnología de la Información", costCenter: it._id, authorizedCostCenters: [it._id], jefe: itJefe._id, jobCategory: 5 });
    const juniorRequester = await person("Asistente TI", { area: "Tecnología de la Información", costCenter: it._id, jefe: itJefe._id, jobCategory: 2 });
    // Medicine's head is its top jefe in the roster; Nursing's is its Area Director, known by area
    // only (no CECO on the profile, as the demo directors). An approver of every area ("*") is neither.
    const dean = await person("Decana de Medicina", { area: "Escuela de Medicina", costCenter: medicine._id, jefe: vicerector._id });
    const medicineStaff = await person("Docente de Medicina", { area: "Escuela de Medicina", costCenter: medicine._id, jefe: dean._id });
    const nursingDirector = await person("Directora de Enfermería", { role: ROLES.AREA_DIRECTOR, approvalLevel: "AREA_DIRECTOR", area: "Escuela de Enfermería", approvalAreas: ["Escuela de Enfermería"] });
    await person("Director de todas las áreas", { role: ROLES.AREA_DIRECTOR, approvalLevel: "AREA_DIRECTOR", area: "Rectorado", approvalAreas: ["*"] });
    // Odontología has no head in the roster: its responsible is set on the CECO.
    const dentistryHead = await person("Director de Odontología", { role: ROLES.AREA_DIRECTOR, approvalLevel: "AREA_DIRECTOR", area: "Rectorado" });
    await CostCenter.updateOne({ _id: dentistry._id }, { $set: { responsible: dentistryHead._id } });
    const noHead = await center("CT-ARQ", "Escuela de Arquitectura", "Escuela de Arquitectura");
    const accounting = await User.create({ name: "Contabilidad", email: "ct.accounting@test.local", passwordHash: "unused", role: ROLES.ACCOUNTING, area: "Contabilidad" });
    const admin = await User.create({ name: "Admin TI", email: "ct.admin@test.local", passwordHash: "unused", role: ROLES.ADMIN, area: "Tecnología de la Información", costCenter: it._id, jefe: itJefe._id });
    const supplier = await Supplier.create({ identifierType: "RUC", rucDni: "20777000001", normalizedIdentifier: "20777000001", legalName: "Computadoras del Perú SAC", name: "Computadoras del Perú SAC", supplierCode: "PRV-7701", taxpayerStatus: "MANUALLY_VALIDATED", complianceStatus: "COMPLIANT", homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true });
    await AccountingPeriod.create({ period, status: "OPEN" });
    // These requests are sent with one quotation: the A1 three-quotation rule has its own tests.
    await FinanceConfiguration.create({ key: "A1_MINIMUM_QUOTATIONS", numericValue: 1, effectiveFrom: new Date("2020-01-01T00:00:00Z"), active: true });
    await SupplierBankAccount.create({ supplier: supplier._id, bank: "BCP", currency: "PEN", accountType: "CURRENT", accountNumber: "191000007701", cci: "00219100000000007701", active: true, verificationStatus: "VERIFIED", ownershipResult: "MATCH", createdBy: accounting._id });
    for (const [purpose, accountNumber] of [["ACCOUNTS_PAYABLE", "421201"], ["IGV", "401111"]]) {
      await AccountingMapping.create({ code: `CT-${purpose}`, name: purpose, purpose, requestType: "*", expenseNature: "*", bank: "*", currency: "*", accountNumber, active: true });
    }

    const payload = (extra = {}) => ({
      flowType: "A1", requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.GOODS, priority: "MEDIA", issueDate: "2026-10-12", accountingPeriod: period, currency: "PEN",
      supplier: String(supplier._id), requesterCostCenter: String(it._id), title: "Computadoras", description: "10 computadoras para laboratorio", detailedDescription: "10 computadoras para laboratorio", businessJustification: "Inicio del ciclo",
      lines: JSON.stringify([{ costCenter: String(it._id), itemDescription: "Computadoras", quantity: "1", unitOfMeasure: "UNIT", unitPrice: "10000", priceIncludesIGV: true }]),
      ...extra
    });
    const allocations = (...pairs) => JSON.stringify(pairs.map(([costCenter, percentage]) => ({ costCenter: String(costCenter._id), ...(percentage === undefined ? {} : { percentage }) })));
    // Drafts are saved through the form's API; the quote goes on before it is sent.
    const sendWithQuote = async (draft, owner = requester) => {
      await FinancialRequest.updateOne({ _id: draft._id }, { $push: { attachments: quoteAttachment(owner._id) }, $set: { quotations: [recommendedQuote(supplier._id, 10000)] } });
      return submitFinancialRequest({ id: draft._id, user: owner, req });
    };
    // The jefe sends it to their superior (the Vice-Rector), who finalizes.
    const approve = (request, user, extra = {}) => approveThroughChain({ id: request._id, user, req, ...extra });
    const commitmentLines = async (request) => (await BudgetCommitment.findOne({ request: request._id }).lean()).lines.map((line) => [String(line.costCenter), line.amount]).sort();

    await t.test("Propio is the default: the request uses the requester's own CECO, as before", async () => {
      const draft = await createFinancialRequest({ payload: payload(), files: {}, user: requester, req });
      assert.equal(draft.costCenterType, "PROPIO");
      assert.equal(draft.costAllocations, undefined, "a Propio request stores no distribution");
      assert.equal(String(draft.lines[0].costCenter._id || draft.lines[0].costCenter), String(it._id));
      const sent = await sendWithQuote(draft);
      assert.equal(sent.costCenterReviewers, undefined);
      await approve(sent, itJefe);
      assert.equal((await FinancialRequest.findById(sent._id)).status, REQUEST_STATUS.BUDGET_COMMITTED);
      assert.deepEqual(await commitmentLines(sent), [[String(it._id), 10000]]);
      // The existing CECO rule still applies to Propio: another area's CECO is refused.
      await assert.rejects(() => createFinancialRequest({ payload: payload({ lines: JSON.stringify([{ costCenter: String(medicine._id), itemDescription: "X", quantity: "1", unitOfMeasure: "UNIT", unitPrice: "10", priceIncludesIGV: true }]) }), files: {}, user: requester, req }), (error) => error.code === ERROR_CODES.INVALID_COST_CENTER_LINE);
    });

    let single;
    await t.test("Por Encargo for one school: IT requests, Medicine's CECO bears the S/ 10,000", async () => {
      const draft = await createFinancialRequest({ payload: payload({ costCenterType: "POR_ENCARGO", costAllocations: allocations([medicine]) }), files: {}, user: requester, req });
      assert.equal(draft.costCenterType, "POR_ENCARGO");
      assert.equal(draft.requesterArea, "Tecnología de la Información", "the requesting department stays IT");
      assert.equal(String(draft.requesterCostCenter._id || draft.requesterCostCenter), String(it._id));
      assert.deepEqual(draft.costAllocations.map((item) => [item.costCenterSnapshot.code, item.costCenterSnapshot.area, item.percentage, item.amount, item.penEquivalent]), [["CT-MED", "Escuela de Medicina", 100, 10000, 10000]]);
      assert.equal(String(draft.lines[0].costCenter._id || draft.lines[0].costCenter), String(medicine._id), "the CECO comes from the master, not from what the form sent");
      assert.equal(draft.lines[0].costCenterSnapshot.code, "CT-MED");

      single = await sendWithQuote(draft);
      assert.deepEqual(single.costCenterReviewers.map((reviewer) => String(reviewer._id || reviewer)), [String(dean._id)], "Medicine's head reviews it; its staff and IT do not");
      assert.ok(await Notification.exists({ user: dean._id, type: "COST_CENTER_ON_BEHALF", entityId: single._id }));
      assert.equal(await Notification.exists({ user: medicineStaff._id, type: "COST_CENTER_ON_BEHALF" }), null);
      // Manual técnico, "Ruta de aprobación": after the requester's jefe chain, Medicine's head gives
      // the visto as a fixed approval step (BEN:<ceco>).
      const route = [...single.approvalRouteSnapshot].sort((a, b) => a.sequence - b.sequence);
      assert.deepEqual(route.map((step) => [String(step.approverUser?._id || step.approverUser), step.fixed ? step.costCenterRole : "JEFE"]), [[String(itJefe._id), "JEFE"], [String(dean._id), "BENEFICIARY"]]);
      assert.equal(route[1].costCenterCode, "CT-MED");
    });

    await t.test("only job categories 3, 5 and 6 may charge other cost centers", async () => {
      const draft = await createFinancialRequest({ payload: payload({ costCenterType: "POR_ENCARGO", costAllocations: allocations([medicine]) }), files: {}, user: juniorRequester, req });
      await assert.rejects(() => sendWithQuote(draft, juniorRequester), (error) => error.statusCode === 422 && error.details.check === "ENCARGO_JOB_CATEGORY");
      const own = await createFinancialRequest({ payload: payload(), files: {}, user: juniorRequester, req });
      assert.equal((await sendWithQuote(own, juniorRequester)).status, REQUEST_STATUS.PENDING_APPROVAL, "Propio needs no category");
    });

    await t.test("a beneficiary CECO without a head or responsible cannot give the visto: the sending is refused", async () => {
      const draft = await createFinancialRequest({ payload: payload({ costCenterType: "POR_ENCARGO", costAllocations: allocations([noHead]) }), files: {}, user: requester, req });
      await assert.rejects(() => sendWithQuote(draft), (error) => error.code === ERROR_CODES.APPROVAL_ROUTE_NOT_CONFIGURED && error.details.code === "CT-ARQ");
    });

    await t.test("the beneficiary's head approves only at their own step; nobody approves their own request", async () => {
      const stored = await FinancialRequest.findById(single._id);
      assert.equal(canViewRequest(stored, dean), true);
      // Medicine's staff read the requests charged to their own cost center (alcance de lectura).
      assert.equal(canViewRequest(stored, medicineStaff), true);
      assert.equal(canViewRequest(stored, nursingDirector), false, "another school's Director does not");
      assert.equal(allowedRequestActions(stored, dean).includes("APPROVE"), false, "not yet: the jefe chain approves first");
      assert.ok((await getRequestDetail(single._id, dean)).request, "the head opens the request page");
      assert.deepEqual((await listRequestsPage({}, dean)).data.map((row) => row.requestNumber), [single.requestNumber]);
      assert.deepEqual((await listRequestsPage({}, medicineStaff)).data.map((row) => row.requestNumber), [single.requestNumber]);
      assert.equal(allowedRequestActions(stored, medicineStaff).includes("APPROVE"), false);
      await assert.rejects(() => approve(single, dean), (error) => error.statusCode === 403);
      await assert.rejects(() => approve(single, requester), (error) => error.statusCode === 403);
      assert.equal(allowedRequestActions(stored, requester).includes("APPROVE"), false);
    });

    await t.test("on approval the budget is committed against Medicine, not IT", async () => {
      const itBefore = (await CostCenter.findById(it._id)).committedAmount;
      // The jefe sends it to the Vice-Rector, who finalizes the chain; then Medicine's head approves.
      await decideApproval({ id: single._id, action: "APPROVE", comments: "Conforme", user: itJefe, req });
      const atViceRector = await FinancialRequest.findById(single._id);
      assert.equal(String(activeApprovalStep(atViceRector).approverUser), String(vicerector._id));
      await decideApproval({ id: single._id, action: "APPROVE", comments: "Conforme", forward: false, user: vicerector, req });
      const atDean = await FinancialRequest.findById(single._id);
      assert.equal(atDean.status, REQUEST_STATUS.PENDING_APPROVAL, "the beneficiary's visto is still due");
      assert.equal(String(activeApprovalStep(atDean).approverUser), String(dean._id));
      assert.equal(allowedRequestActions(atDean, dean).includes("APPROVE"), true);
      assert.deepEqual((await getApprovalDecisionOptions(single._id, dean)).chain, false, "a fixed step offers no 'send to my jefe'");
      await decideApproval({ id: single._id, action: "APPROVE", comments: "Visto bueno de Medicina", user: dean, req });
      assert.equal((await FinancialRequest.findById(single._id)).status, REQUEST_STATUS.BUDGET_COMMITTED);
      assert.deepEqual(await commitmentLines(single), [[String(medicine._id), 10000]]);
      assert.equal((await CostCenter.findById(medicine._id)).committedAmount, 10000);
      assert.equal((await CostCenter.findById(it._id)).committedAmount, itBefore, "IT's budget is untouched");
    });

    let shared;
    await t.test("Por Encargo shared by three schools: 60/30/10, each share computed and committed", async () => {
      const draft = await createFinancialRequest({ payload: payload({ expenseNature: EXPENSE_NATURE.RESEARCH, costCenterType: "POR_ENCARGO", costAllocations: allocations([medicine, 60], [nursing, 30], [dentistry, 10]) }), files: {}, user: requester, req });
      assert.deepEqual(draft.costAllocations.map((item) => [item.costCenterSnapshot.code, item.percentage, item.amount]), [["CT-MED", 60, 6000], ["CT-ENF", 30, 3000], ["CT-ODO", 10, 1000]]);
      assert.equal(String(draft.lines[0].costCenter._id || draft.lines[0].costCenter), String(medicine._id), "lines carry the first beneficiary");
      assert.deepEqual(groupedRequestLines(draft).map((line) => [String(line.costCenter), line.amount]), [[String(medicine._id), 6000], [String(nursing._id), 3000], [String(dentistry._id), 1000]]);

      const preview = await previewFinancialRequestBudget({ payload: { ...payload(), costCenterType: "POR_ENCARGO", costAllocations: allocations([medicine, 60], [nursing, 30], [dentistry, 10]) }, user: requester });
      assert.deepEqual(preview.lines.map((line) => [line.costCenterSnapshot.code, line.amount]), [["CT-MED", 6000], ["CT-ENF", 3000], ["CT-ODO", 1000]], "the form previews each school's budget");

      shared = await sendWithQuote(draft);
      assert.deepEqual(shared.costCenterReviewers.map((reviewer) => String(reviewer._id || reviewer)).sort(), [String(dean._id), String(nursingDirector._id), String(dentistryHead._id)].sort(), "Odontología's responsible is set on its CECO");
      const vistos = [...shared.approvalRouteSnapshot].sort((a, b) => a.sequence - b.sequence).filter((step) => step.costCenterRole === "BENEFICIARY");
      assert.deepEqual(vistos.map((step) => [step.costCenterCode, String(step.approverUser?._id || step.approverUser)]), [["CT-MED", String(dean._id)], ["CT-ENF", String(nursingDirector._id)], ["CT-ODO", String(dentistryHead._id)]], "one visto per school, in the order of the distribution");
      await approve(shared, itJefe);
      assert.deepEqual(await commitmentLines(shared), [[String(medicine._id), 6000], [String(nursing._id), 3000], [String(dentistry._id), 1000]].sort());
    });

    await t.test("Contabilidad books each school's share of the expense to its own CECO", async () => {
      const request = await FinancialRequest.findById(shared._id);
      const voucher = { ruc: supplier.rucDni, voucherType: "FACTURA", series: "F001", number: "8801", issueDate: "2026-10-12", currency: "PEN", netAmount: request.totalNet, igvAmount: request.totalIGV, totalAmount: request.totalAmount };
      const { xmlFile } = await fiscalFixture(request, supplier, voucher, accounting, cleanup);
      request.attachments.push({ ...xmlFile, kind: "XML", uploadedBy: accounting._id });
      request.attachments.push({ kind: "CONFORMITY", originalName: "conformidad.pdf", filename: "conformidad.pdf", url: "/test/conformidad.pdf", mimetype: "application/pdf", size: 10, uploadedBy: requester._id });
      await request.save();
      await processAccountsPayable({ requestId: request._id, payload: { documentType: "FACTURA", series: "F001", number: "8801", documentDate: "2026-10-12", accountingDate: "2026-10-12", fiscalPeriod: period, accountNumber: opex.accountNumber, dueDate: "2026-11-30" }, user: accounting, req });
      const journal = await JournalEntry.findOne({ request: request._id, entryType: "PROVISION" }).lean();
      assert.equal(journal.totalDebit, journal.totalCredit, "the journal stays balanced");
      const expense = journal.lines.filter((line) => line.accountNumber === opex.accountNumber);
      const byCenter = Object.fromEntries(expense.map((line) => [String(line.costCenter), line.debit]));
      assert.deepEqual(Object.keys(byCenter).sort(), [String(medicine._id), String(nursing._id), String(dentistry._id)].sort());
      assert.equal(sum(Object.values(byCenter)), request.totalNet, "the shares add up to the net expense");
      assert.deepEqual([byCenter[String(medicine._id)], byCenter[String(nursing._id)], byCenter[String(dentistry._id)]], splitByPercentages(request.totalNet, [60, 30, 10]));
      const consolidation = await getConsolidation(period);
      const consolidated = consolidation.rows.filter((row) => row.accountNumber === opex.accountNumber).map((row) => String(row.costCenter));
      for (const id of [medicine._id, nursing._id, dentistry._id]) assert.ok(consolidated.includes(String(id)), "the month-end consolidation shows each school");
    });

    await t.test("a distribution that does not add up to 100%, a repeated, closed or typed CECO is refused", async () => {
      const before = await FinancialRequest.countDocuments();
      const attempt = (extra) => createFinancialRequest({ payload: payload({ costCenterType: "POR_ENCARGO", ...extra }), files: {}, user: requester, req });
      await assert.rejects(() => attempt({ costAllocations: allocations([medicine, 60], [nursing, 30]) }), invalidAllocation(/add up to 100%/));
      await assert.rejects(() => attempt({ costAllocations: allocations([medicine, 70], [nursing, 40]) }), invalidAllocation(/add up to 100%/));
      await assert.rejects(() => attempt({ costAllocations: allocations([medicine, 50], [medicine, 50]) }), invalidAllocation(/only once/));
      await assert.rejects(() => attempt({ costAllocations: allocations([medicine, 100], [nursing, 0]) }), invalidAllocation(/percentage/));
      await assert.rejects(() => attempt({ costAllocations: allocations([closed]) }), invalidAllocation(/active school or department/));
      await assert.rejects(() => attempt({ costAllocations: JSON.stringify([{ costCenter: "CT-MED", percentage: 100 }]) }), invalidAllocation(/cost center list/), "a typed code is not a CECO");
      await assert.rejects(() => attempt({ costAllocations: "[]" }), invalidAllocation(/school or department/));
      await assert.rejects(() => attempt({ costAllocations: allocations([it]) }), invalidAllocation(/your own cost center/), "Por Encargo names another department");
      await assert.rejects(() => attempt({ costCenterType: "OTRO", costAllocations: allocations([medicine]) }), invalidAllocation(/Propio or Por Encargo/));
      await assert.rejects(() => createFinancialRequest({ payload: { ...payload({ flowType: "C", requestType: REQUEST_TYPE.ENTREGA_RENDIR, expenseNature: EXPENSE_NATURE.TRAVEL, supplier: undefined }), costCenterType: "POR_ENCARGO", costAllocations: allocations([medicine]) }, files: {}, user: requester, req }), invalidAllocation(/choose Propio/), "advances stay on the employee's own CECO");
      await assert.rejects(() => previewFinancialRequestBudget({ payload: { ...payload(), costCenterType: "POR_ENCARGO", costAllocations: allocations([medicine, 60], [nursing, 30]) }, user: requester }), invalidAllocation(/add up to 100%/));
      assert.equal(await FinancialRequest.countDocuments(), before, "nothing was saved");
      // The model refuses it too, whatever path saves the request.
      const stored = await FinancialRequest.findById(single._id);
      stored.costAllocations = [{ costCenter: medicine._id, percentage: 50 }, { costCenter: nursing._id, percentage: 40 }];
      await assert.rejects(() => stored.validate(), (error) => error.name === "ValidationError" && /add up to 100%/.test(error.errors.costAllocations?.message));
    });

    await t.test("changes to the distribution are audited", async () => {
      const draft = await createFinancialRequest({ payload: payload({ costCenterType: "POR_ENCARGO", costAllocations: allocations([medicine]) }), files: {}, user: requester, req });
      const created = await AuditLog.findOne({ entityId: draft._id, action: "CREATED" }).lean();
      assert.equal(created.newValues.costCenterType, "POR_ENCARGO");
      assert.deepEqual(created.newValues.costAllocations.map((item) => [item.code, item.percentage, item.amount]), [["CT-MED", 100, 10000]]);
      const updated = await updateFinancialRequest({ id: draft._id, payload: { costAllocations: allocations([medicine, 60], [nursing, 40]) }, files: {}, user: requester, req });
      assert.deepEqual(updated.costAllocations.map((item) => item.amount), [6000, 4000]);
      const audit = await AuditLog.findOne({ entityId: draft._id, action: "UPDATED" }).lean();
      assert.deepEqual(audit.oldValues.officialRequest.costAllocations.map((item) => item.code), ["CT-MED"]);
      assert.deepEqual(audit.newValues.officialRequest.costAllocations.map((item) => [item.code, item.percentage]), [["CT-MED", 60], ["CT-ENF", 40]]);
      // Back to Propio: the distribution is dropped and the lines return to the requester's CECO.
      const own = await updateFinancialRequest({ id: draft._id, payload: { costCenterType: "PROPIO", lines: payload().lines }, files: {}, user: requester, req });
      assert.equal(own.costCenterType, "PROPIO");
      assert.equal(own.costAllocations, undefined);
      assert.equal(String(own.lines[0].costCenter._id || own.lines[0].costCenter), String(it._id));
    });

    await t.test("an Admin requester cannot approve their own Por Encargo request either", async () => {
      const draft = await createFinancialRequest({ payload: payload({ costCenterType: "POR_ENCARGO", costAllocations: allocations([nursing]) }), files: {}, user: admin, req });
      const sent = await sendWithQuote(draft, admin);
      await assert.rejects(() => approve(sent, admin), (error) => error.statusCode === 403 && error.details?.segregationOfDuties === true);
    });

    await t.test("requests saved before the field exist read as Propio and keep working", async () => {
      const legacy = await createFinancialRequest({ payload: payload(), files: {}, user: requester, req });
      await FinancialRequest.collection.updateOne({ _id: legacy._id }, { $unset: { costCenterType: "", costAllocations: "", costCenterReviewers: "" } });
      const loaded = await FinancialRequest.findById(legacy._id);
      assert.equal(loaded.costCenterType, "PROPIO");
      assert.deepEqual(groupedRequestLines(loaded).map((line) => [String(line.costCenter), line.amount]), [[String(it._id), 10000]]);
      await sendWithQuote(loaded);
      await approve(loaded, itJefe);
      assert.equal((await FinancialRequest.findById(legacy._id)).status, REQUEST_STATUS.BUDGET_COMMITTED);
    });

    await t.test("the beneficiary list is the active CECO master, without budgets", async () => {
      const list = await requestBeneficiaryCostCenters();
      assert.deepEqual(list.map((item) => item.code), ["CT-ARQ", "CT-ENF", "CT-MED", "CT-ODO", "CT-TI"]);
      assert.equal(list[0].annualBudget, undefined);
    });
  } finally {
    for (const file of cleanup) await fs.rm(file, { force: true });
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
