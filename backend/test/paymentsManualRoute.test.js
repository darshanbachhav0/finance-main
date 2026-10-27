import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AuditLog from "../src/models/AuditLog.js";
import CostCenter from "../src/models/CostCenter.js";
import Counter from "../src/models/Counter.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import Notification from "../src/models/Notification.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";
import User from "../src/models/User.js";
import { activeApprovalStep, initializeApprovalRoute } from "../src/services/approvalRuleService.js";
import { decideApproval, getApprovalDecisionOptions } from "../src/services/approvalService.js";
import { applyCascadeImport, planCascadeImport } from "../src/services/cecoCascadeImportService.js";
import { loadCascade, superiorCostCenterIn, visibleCostCenterIdsFor } from "../src/services/costCenterCascadeService.js";
import { migrateLegacyPriorities } from "../src/services/legacyPriorityService.js";
import { createFinancialRequest, previewRequestSubmission, submitFinancialRequest } from "../src/services/requestService.js";
import { requestSubmissionChecks } from "../src/services/requestSubmissionChecks.js";
import { canViewRequest, requestVisibilityFilter } from "../src/utils/permissions.js";
import { EXPENSE_NATURE, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";
import { normalizeRequestPriority, priorityNeedsJustification } from "../../shared/requestPriority.mjs";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };
const period = "2026-10";
const idOf = (value) => String(value?._id || value || "");
const routeOf = (request) => [...request.approvalRouteSnapshot].sort((a, b) => a.sequence - b.sequence)
  .map((step) => [step.fixed ? step.costCenterRole : step.tier || "JEFE", idOf(step.approverUser) || step.role]);

test("payment priority P1-P4: the former Alta / Media / Baja read as P2 / P3 / P3; P1 and P2 need a justification", () => {
  assert.deepEqual(["ALTA", "MEDIA", "BAJA", "p1", "P4"].map(normalizeRequestPriority), ["P2", "P3", "P3", "P1", "P4"]);
  assert.deepEqual(["P1", "P2", "P3", "P4", "ALTA"].map(priorityNeedsJustification), [true, true, false, false, true]);
});

test("Manual técnico: approvals follow the cost-center cascade, Por Encargo adds each beneficiary's visto", { timeout: 240000 }, async (t) => {
  await mongoose.connect(`mongodb://127.0.0.1:${Number(process.env.TEST_MONGODB_PORT || 27017)}/erp_payments_manual_${process.pid}_${Date.now()}`);
  try {
    await Promise.all([Counter.init(), FinancialRequest.init(), Notification.init(), AuditLog.init(), Supplier.init(), SupplierBankAccount.init()]);
    const person = (name, extra = {}) => User.create({ name, email: `${name.toLowerCase().replace(/\W+/g, ".")}@manual.test`, passwordHash: "unused", role: ROLES.SOLICITOR, ...extra });
    // The Motor de Ingresos cascade: Junta (7) > Gerencia General (6) > Vicerrectorado IINN (4) >
    // Facultad (3) > Enfermería / Nutrición (2); and the GAF under Gerencia General.
    const centerOf = (code, name, level, parentCode, extra = {}) => CostCenter.create({ code, name, area: name, level, parentCode, line: "COST_OF_SERVICE", annualBudget: 500000, budgetMode: "TRANSITIONAL", active: true, ...extra });
    await centerOf("10001", "Junta General de Accionistas", 7, null, { line: "ADMINISTRATION" });
    const ggCenter = await centerOf("20001", "Gerencia General", 6, "10001", { line: "ADMINISTRATION" });
    const vrCenter = await centerOf("20009", "Vicerrectorado Académico IINN", 4, "20001");
    const gafCenter = await centerOf("20007", "Gerencia de Administración Financiera", 6, "20001", { line: "ADMINISTRATION" });
    const faculty = await centerOf("30009", "Facultad de Ciencias de la Salud", 3, "20009");
    const nursing = await centerOf("50101", "Escuela de Enfermería", 2, "30009");
    const nutrition = await centerOf("50102", "Escuela de Nutrición", 2, "30009");
    const orphan = await centerOf("50999", "Escuela sin responsable", 2, "30009");

    const generalManager = await person("Gerente General", { role: ROLES.MANAGEMENT, costCenter: ggCenter._id });
    const viceRector = await person("Vicerrector IINN", { role: ROLES.VICE_RECTOR, approvalLevel: "VICE_RECTOR", costCenter: vrCenter._id, jefe: generalManager._id });
    const gaf = await person("Gerente GAF", { role: ROLES.GAF, costCenter: gafCenter._id, jefe: generalManager._id });
    const nursingHead = await person("Directora de Enfermería", { role: ROLES.AREA_DIRECTOR, costCenter: nursing._id, jefe: viceRector._id });
    const nutritionHead = await person("Director de Nutrición", { role: ROLES.AREA_DIRECTOR, costCenter: nutrition._id, jefe: viceRector._id });
    const requester = await person("Coordinadora de Enfermería", { costCenter: nursing._id, area: "Escuela de Enfermería", jefe: nursingHead._id, jobCategory: 5 });
    const colleague = await person("Asistente de Enfermería", { costCenter: nursing._id, area: "Escuela de Enfermería", jefe: nursingHead._id, jobCategory: 2 });
    const nutritionStaff = await person("Asistente de Nutrición", { costCenter: nutrition._id, area: "Escuela de Nutrición", jefe: nutritionHead._id });
    const orphanStaff = await person("Docente sin responsable", { costCenter: orphan._id, area: "Escuela sin responsable", jefe: nursingHead._id });
    for (const [center, responsible] of [[ggCenter, generalManager], [vrCenter, viceRector], [gafCenter, gaf], [nursing, nursingHead], [nutrition, nutritionHead]]) {
      await CostCenter.updateOne({ _id: center._id }, { $set: { responsible: responsible._id } });
    }
    await AccountingPeriod.create({ period, status: "OPEN" });

    await t.test("the superior of a school is the Vicerrectorado it depends on; the root is nobody's", async () => {
      const cascade = await loadCascade();
      assert.equal(superiorCostCenterIn(cascade, cascade.byCode.get("50101")).code, "20009");
      assert.equal(superiorCostCenterIn(cascade, cascade.byCode.get("20009")).code, "20001", "a Vicerrectorado answers to its parent");
      assert.equal(superiorCostCenterIn(cascade, cascade.byCode.get("20001")), null, "the Junta is not an approver");
    });

    const draftRoute = (extra) => {
      const request = { requester: requester._id, solicitor: requester._id, requesterCostCenter: nursing._id, flowType: "A1", lines: [], ...extra };
      return initializeApprovalRoute(request).then(() => request);
    };

    await t.test("S/ 30,000 (5.45 UIT) from Enfermería: responsible, then the Vicerrector, then the GAF", async () => {
      const request = await draftRoute({ totalPENEquivalent: 30000 });
      assert.deepEqual(routeOf(request), [["RESPONSIBLE", idOf(nursingHead)], ["SUPERIOR", idOf(viceRector)], ["GAF", ROLES.GAF]]);
      assert.equal(request.approvalRouteSnapshot[0].status, "PENDING");
      assert.equal(request.approvalRouteSnapshot[1].status, "NOT_REACHED", "a fixed step waits for the one before");
      assert.equal(request.approvalRouteSnapshot[0].costCenterCode, "50101");
      assert.equal(request.approvalRouteSnapshot[1].costCenterCode, "20009");
    });

    await t.test("above 20 UIT the Gerencia General approves too; a small amount still needs the superior", async () => {
      assert.deepEqual(routeOf(await draftRoute({ totalPENEquivalent: 120000 })).map(([kind]) => kind), ["RESPONSIBLE", "SUPERIOR", "GAF", "GENERAL_MANAGEMENT"]);
      assert.deepEqual(routeOf(await draftRoute({ totalPENEquivalent: 500 })).map(([kind]) => kind), ["RESPONSIBLE", "SUPERIOR"]);
    });

    await t.test("Por Encargo 50/50 with Nutrición: the visto of Nutrición's responsible comes before the superior", async () => {
      const request = await draftRoute({ totalPENEquivalent: 2000, costCenterType: "POR_ENCARGO", costAllocations: [{ costCenter: nursing._id, percentage: 50 }, { costCenter: nutrition._id, percentage: 50 }] });
      assert.deepEqual(routeOf(request), [["RESPONSIBLE", idOf(nursingHead)], ["BENEFICIARY", idOf(nutritionHead)], ["SUPERIOR", idOf(viceRector)]]);
      assert.equal(request.approvalRouteSnapshot[1].costCenterCode, "50102");
    });

    await t.test("a CECO without a responsible keeps the requester's jefe chain", async () => {
      const request = { requester: orphanStaff._id, solicitor: orphanStaff._id, requesterCostCenter: orphan._id, flowType: "A1", lines: [], totalPENEquivalent: 500 };
      await initializeApprovalRoute(request);
      assert.deepEqual(routeOf(request), [["JEFE", idOf(nursingHead)]]);
      assert.equal(request.approvalRouteSnapshot[0].superiorRequired, true);
    });

    await t.test("the responsible on leave: their substitute takes the step when it opens", async () => {
      const substitute = await person("Subdirectora de Enfermería", { costCenter: nursing._id });
      await User.updateOne({ _id: nursingHead._id }, { $set: { onLeave: true, substitute: substitute._id } });
      const request = await draftRoute({ totalPENEquivalent: 500 });
      await User.updateOne({ _id: nursingHead._id }, { $set: { onLeave: false }, $unset: { substitute: "" } });
      assert.equal(idOf(request.approvalRouteSnapshot[0].approverUser), idOf(substitute));
      assert.equal(idOf(request.approvalRouteSnapshot[0].coveringFor), idOf(nursingHead));
    });

    // A request sent through the service: three quotations into a verified account.
    const suppliers = await Supplier.create([1, 2, 3].map((index) => ({
      identifierType: "RUC", rucDni: `2077700000${index}`, normalizedIdentifier: `2077700000${index}`, legalName: `Proveedor ${index} SAC`, name: `Proveedor ${index} SAC`,
      supplierCode: `PRV-770${index}`, homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true
    })));
    await SupplierBankAccount.create({ supplier: suppliers[0]._id, bank: "BCP", currency: "PEN", accountType: "CURRENT", accountNumber: "191000077701", cci: "00219100000000077701", active: true, verificationStatus: "VERIFIED", ownershipResult: "MATCH" });
    const quoteFiles = suppliers.map((supplier, index) => ({ _id: new mongoose.Types.ObjectId(), kind: "QUOTATION", originalName: `cotizacion-${index + 1}.pdf`, filename: `cotizacion-${index + 1}.pdf`, url: `/test/cotizacion-${index + 1}.pdf`, mimetype: "application/pdf", size: 10, uploadedBy: requester._id }));
    const payload = (extra = {}) => ({
      flowType: "A1", requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.SERVICES, priority: "P3", issueDate: "2026-10-20", accountingPeriod: period, currency: "PEN",
      supplier: String(suppliers[0]._id), requesterCostCenter: String(nursing._id), description: "Insumos para el laboratorio de simulación", detailedDescription: "Insumos para el laboratorio de simulación", businessJustification: "Prácticas del ciclo", supplierSelectionReason: "Mejor precio",
      lines: JSON.stringify([{ costCenter: String(nursing._id), itemDescription: "Insumos", quantity: "1", unitOfMeasure: "UNIT", unitPrice: "30000", priceIncludesIGV: true }]),
      ...extra
    });
    const withQuotes = async (draft, count = 3) => {
      await FinancialRequest.updateOne({ _id: draft._id }, { $push: { attachments: { $each: quoteFiles.slice(0, count) } }, $set: {
        quotations: suppliers.slice(0, count).map((supplier, index) => ({ supplier: supplier._id, amount: 30000 + index * 500, currency: "PEN", attachment: quoteFiles[index]._id, recommended: index === 0 }))
      } });
      return draft;
    };

    let sent;
    await t.test("the online validations stop the sending: A1 three quotations, P2 justification, CAPEX case, job category", async () => {
      const short = await withQuotes(await createFinancialRequest({ payload: payload(), files: {}, user: requester, req }), 1);
      await assert.rejects(() => submitFinancialRequest({ id: short._id, user: requester, req }), (error) => error.details.check === "A1_QUOTATIONS" && /1 of 3/.test(error.message));
      const urgent = await withQuotes(await createFinancialRequest({ payload: payload({ priority: "P2" }), files: {}, user: requester, req }));
      await assert.rejects(() => submitFinancialRequest({ id: urgent._id, user: requester, req }), (error) => error.details.check === "URGENCY_JUSTIFICATION");
      const capex = await withQuotes(await createFinancialRequest({ payload: payload({ requestType: REQUEST_TYPE.CAPEX, capexDetails: JSON.stringify({ businessCaseCode: "CASO-1" }) }), files: {}, user: requester, req }));
      await assert.rejects(() => submitFinancialRequest({ id: capex._id, user: requester, req }), (error) => error.details.check === "CAPEX_BUSINESS_CASE");
      await assert.rejects(() => createFinancialRequest({ payload: payload({ costCenterType: "POR_ENCARGO", costAllocations: JSON.stringify([{ costCenter: String(nutrition._id), percentage: 100 }]) }), files: {}, user: colleague, req }),
        (error) => error.statusCode === 403 && error.details.field === "jobCategory", "a category 2 position cannot even save a Por Encargo draft");
      const encargoChecks = await requestSubmissionChecks(new FinancialRequest({ flowType: "A1", costCenterType: "POR_ENCARGO", currency: "PEN", priority: "P3" }), { user: colleague });
      assert.equal(encargoChecks.find((item) => item.code === "ENCARGO_JOB_CATEGORY").ok, false, "the form says why before saving");

      const draft = await withQuotes(await createFinancialRequest({ payload: payload({ priority: "P2", urgencyJustification: "El laboratorio abre el lunes", dueDate: "2026-11-30" }), files: {}, user: requester, req }));
      sent = await submitFinancialRequest({ id: draft._id, user: requester, req });
      assert.equal(sent.status, REQUEST_STATUS.PENDING_APPROVAL);
      assert.equal(sent.priority, "P2");
      assert.equal(sent.requesterJobCategory, 5, "the job category is kept on the request as it was sent");
      assert.deepEqual(routeOf(sent), [["RESPONSIBLE", idOf(nursingHead)], ["SUPERIOR", idOf(viceRector)], ["GAF", ROLES.GAF]]);
    });

    await t.test("each approver of a fixed step only approves; the route runs to the GAF and the request is approved", async () => {
      const options = await getApprovalDecisionOptions(sent._id, nursingHead);
      assert.equal(options.chain, false, "no 'send to my jefe' on a cost-center step");
      await assert.rejects(() => decideApproval({ id: sent._id, action: "APPROVE", comments: "Conforme", user: viceRector, req }), (error) => error.statusCode === 403, "not the Vicerrector's turn yet");
      await decideApproval({ id: sent._id, action: "APPROVE", comments: "Conforme", user: nursingHead, req });
      let current = await FinancialRequest.findById(sent._id);
      assert.equal(idOf(activeApprovalStep(current).approverUser), idOf(viceRector));
      await decideApproval({ id: sent._id, action: "APPROVE", comments: "Conforme", user: viceRector, req });
      current = await FinancialRequest.findById(sent._id);
      assert.equal(activeApprovalStep(current).tier, "GAF");
      await decideApproval({ id: sent._id, action: "APPROVE", comments: "Conforme", user: gaf, req });
      current = await FinancialRequest.findById(sent._id);
      assert.ok([REQUEST_STATUS.APPROVED, REQUEST_STATUS.BUDGET_COMMITTED].includes(current.status));
      const audit = await AuditLog.find({ entityId: sent._id }).lean();
      assert.ok(audit.length > 0, "every decision is audited");
    });

    await t.test("who reads which request: a requester their CECO, a Director their cascade, a Vicerrector all below", async () => {
      const stored = await FinancialRequest.findById(sent._id);
      const visible = async (user) => canViewRequest(stored, { ...user.toObject(), $locals: { visibleCostCenterIds: await visibleCostCenterIdsFor(user) } });
      assert.equal(await visible(colleague), true, "a colleague of the same CECO");
      assert.equal(await visible(nutritionStaff), false, "another school");
      assert.equal(await visible(nutritionHead), false, "another school's Director");
      assert.equal(await visible(viceRector), true, "the Vicerrector sees the schools below the Vicerrectorado");
      assert.deepEqual((await visibleCostCenterIdsFor(viceRector)).sort(), [vrCenter, faculty, nursing, nutrition, orphan].map(idOf).sort());
      const filter = requestVisibilityFilter({ ...nutritionHead.toObject(), $locals: { visibleCostCenterIds: await visibleCostCenterIdsFor(nutritionHead) } });
      assert.equal(await FinancialRequest.countDocuments({ _id: sent._id, ...filter }), 0);
    });

    await t.test("the live panel: the checks, the route and the estimated payment, without saving anything", async () => {
      const before = await FinancialRequest.countDocuments();
      const preview = await previewRequestSubmission({ payload: { ...payload({ priority: "P1" }), lines: JSON.parse(payload().lines), quotations: [], quotationFileCount: 2 }, user: requester });
      assert.equal(await FinancialRequest.countDocuments(), before);
      assert.deepEqual(preview.checks.filter((item) => !item.ok).map((item) => item.code).sort(), ["A1_QUOTATIONS", "URGENCY_JUSTIFICATION"]);
      assert.equal(preview.checks.find((item) => item.code === "A1_QUOTATIONS").template.detailParams.count, 2);
      assert.deepEqual(preview.route.steps.map((step) => step.kind), ["RESPONSIBLE", "SUPERIOR", "GAF"]);
      assert.equal(preview.route.steps[0].approverName, "Directora de Enfermería");
      assert.ok(preview.amount.amountUit > 5);
      assert.equal(preview.payment.window, "SAME_DAY");
      const checks = await requestSubmissionChecks(new FinancialRequest({ flowType: "B", requestType: REQUEST_TYPE.OPEX, currency: "PEN", supplier: suppliers[1]._id, priority: "P3" }), { user: requester, supplier: suppliers[1] });
      assert.equal(checks.find((item) => item.code === "PAYMENT_ACCOUNT").ok, false, "a supplier with no verified account in the currency");
    });

    await t.test("the cascade import loads parent, level and line by code and never touches a responsible", async () => {
      await CostCenter.create({ code: "60001", name: "Escuela importada", area: "Escuela importada", active: true });
      const rows = [{ code: "60001", name: "Escuela importada", level: 2, parentCode: "30009", line: "COST_OF_SERVICE" }, { code: "60002", name: "Escuela nueva", level: 2, parentCode: "30009", line: "SALES" }];
      const plan = await planCascadeImport(rows);
      assert.deepEqual(plan.updates.map((item) => [item.code, item.changes]), [["60001", { parentCode: "30009", level: 2, line: "COST_OF_SERVICE" }]]);
      assert.deepEqual(plan.missing.map((item) => item.code), ["60002"]);
      await applyCascadeImport(plan, rows);
      assert.equal(await CostCenter.exists({ code: "60002" }), null, "missing CECOs are created only when asked");
      await applyCascadeImport(await planCascadeImport(rows), rows, { createMissing: true });
      assert.equal((await CostCenter.findOne({ code: "60002" }).lean()).parentCode, "30009");
      assert.equal((await CostCenter.findById(nursing._id).lean()).responsible.toString(), idOf(nursingHead));
    });

    await t.test("stored Alta / Media / Baja move to P2 / P3 once", async () => {
      await FinancialRequest.collection.updateOne({ _id: sent._id }, { $set: { priority: "ALTA", priorityRank: 3 } });
      assert.equal((await migrateLegacyPriorities()).ALTA, 1);
      assert.equal((await FinancialRequest.findById(sent._id).lean()).priority, "P2");
      assert.deepEqual(await migrateLegacyPriorities(), { ALTA: 0, MEDIA: 0, BAJA: 0 });
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
