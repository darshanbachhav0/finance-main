import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import ApprovalRule from "../src/models/ApprovalRule.js";
import DocumentRule from "../src/models/DocumentRule.js";
import {
  assertDocumentRequirements,
  configuredDocumentRequirements,
  defaultDocumentRequirements
} from "../src/services/documentRuleService.js";
import {
  defaultApprovalRouteForFlow,
  initializeApprovalRoute,
  resolveApprovalRoute
} from "../src/services/approvalRuleService.js";
import { DOCUMENT_PHASE, EXPENSE_NATURE, FLOW_TYPE } from "../src/utils/constants.js";

function kinds(request, phase) {
  return defaultDocumentRequirements(request, phase).map((item) => [item.kind, item.minCount]);
}

test("phase-based document and approval workflow rules", { timeout: 120000 }, async t => {
  await t.test("A1 goods requirements are enforced at their correct phases", () => {
    const request = { flowType: FLOW_TYPE.A1, expenseNature: EXPENSE_NATURE.GOODS };
    assert.deepEqual(kinds(request, DOCUMENT_PHASE.SUBMISSION), [["QUOTATION", 3]]);
    assert.deepEqual(kinds(request, DOCUMENT_PHASE.INVOICE_REGISTRATION), [["XML", 1], ["PDF", 1]]);
    assert.deepEqual(kinds(request, DOCUMENT_PHASE.ACCOUNTING), [["CONFORMITY", 1]]);
  });

  await t.test("A1 services separate contract, invoice, and service conformity", () => {
    const request = { flowType: FLOW_TYPE.A1, expenseNature: EXPENSE_NATURE.SERVICES };
    assert.deepEqual(kinds(request, DOCUMENT_PHASE.SUBMISSION), [["CONTRACT", 1]]);
    assert.deepEqual(kinds(request, DOCUMENT_PHASE.INVOICE_REGISTRATION), [["XML", 1], ["PDF", 1]]);
    assert.deepEqual(kinds(request, DOCUMENT_PHASE.ACCOUNTING), [["CONFORMITY", 1]]);
  });

  await t.test("professional services require receipt, agreement, and activity report", () => {
    const request = { flowType: FLOW_TYPE.A1, expenseNature: EXPENSE_NATURE.PROFESSIONAL_FEES };
    assert.deepEqual(kinds(request, DOCUMENT_PHASE.SUBMISSION), [["CONTRACT", 1]]);
    assert.deepEqual(kinds(request, DOCUMENT_PHASE.INVOICE_REGISTRATION), [["XML", 1], ["FEE_RECEIPT", 1]]);
    assert.deepEqual(kinds(request, DOCUMENT_PHASE.ACCOUNTING), [["ACTIVITY_REPORT", 1]]);
  });

  await t.test("missing current-phase evidence blocks progression", () => {
    const requirements = defaultDocumentRequirements({ flowType: FLOW_TYPE.A1, expenseNature: EXPENSE_NATURE.GOODS }, DOCUMENT_PHASE.INVOICE_REGISTRATION);
    assert.throws(
      () => assertDocumentRequirements({}, requirements, DOCUMENT_PHASE.INVOICE_REGISTRATION, [{ kind: "XML" }]),
      error => error.code === "MISSING_REQUIRED_DOCUMENT" && error.details.phase === DOCUMENT_PHASE.INVOICE_REGISTRATION && error.details.missing[0].kind === "PDF"
    );
  });

  await t.test("A2 invoice candidates require XML and PDF", () => {
    assert.deepEqual(kinds({ flowType: FLOW_TYPE.A2 }, DOCUMENT_PHASE.INVOICE_REGISTRATION), [["XML", 1], ["PDF", 1]]);
  });

  await t.test("Track C supporting documents belong to rendition", () => {
    assert.deepEqual(kinds({ flowType: FLOW_TYPE.C }, DOCUMENT_PHASE.SUBMISSION), []);
    assert.deepEqual(kinds({ flowType: FLOW_TYPE.C }, DOCUMENT_PHASE.RENDITION), [["RENDITION", 1]]);
  });

  await t.test("Track B defaults to Area Director then Vice Rector", () => {
    assert.deepEqual(defaultApprovalRouteForFlow(FLOW_TYPE.B).map((step) => step.approvalLevel), ["AREA_DIRECTOR", "VICE_RECTOR"]);
  });

  await t.test("historical approval route structure is retained on resubmission", async () => {
    const historicalRule = new mongoose.Types.ObjectId();
    const request = {
      approvalRouteSnapshot: [{ rule: historicalRule, approvalLevel: "AREA_DIRECTOR", role: "AreaDirector", sequence: 1, slaHours: 12, required: true, status: "RETURNED", completedAt: new Date(), completedBy: new mongoose.Types.ObjectId() }]
    };
    await initializeApprovalRoute(request);
    assert.equal(String(request.approvalRouteSnapshot[0].rule), String(historicalRule));
    assert.equal(request.approvalRouteSnapshot[0].slaHours, 12);
    assert.equal(request.approvalRouteSnapshot[0].status, "PENDING");
    assert.equal(request.approvalRouteSnapshot[0].completedAt, undefined);
  });

  await t.test("configured rules match flowType instead of being bypassed", async () => {
    const databaseName = `erp_document_phase_${process.pid}_${Date.now()}`;
    await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
    try {
      await DocumentRule.create({ code: "TEST-B-ACCOUNTING", flowType: FLOW_TYPE.B, phase: DOCUMENT_PHASE.ACCOUNTING, requirements: [{ kind: "SUPPORTING", minCount: 2, labelKey: "configured evidence" }] });
      await DocumentRule.collection.insertOne({ code: "TEST-LEGACY-SUBMISSION", flowType: "A1", requestType: "OPEX", expenseNature: EXPENSE_NATURE.SERVICES, requirements: [{ kind: "CONTRACT", minCount: 2, labelKey: "legacy submission evidence" }], active: true });
      const requirements = await configuredDocumentRequirements({ flowType: FLOW_TYPE.B, requestType: "OPEX", expenseNature: EXPENSE_NATURE.SERVICES }, DOCUMENT_PHASE.ACCOUNTING);
      assert.deepEqual(requirements.map((item) => [item.kind, item.minCount]), [["SUPPORTING", 2]]);
      const legacySubmission = await configuredDocumentRequirements({ flowType: FLOW_TYPE.A1, requestType: "OPEX", expenseNature: EXPENSE_NATURE.SERVICES }, DOCUMENT_PHASE.SUBMISSION);
      assert.deepEqual(legacySubmission.map((item) => [item.kind, item.minCount]), [["CONTRACT", 2]]);
      const legacyAccounting = await configuredDocumentRequirements({ flowType: FLOW_TYPE.A1, requestType: "OPEX", expenseNature: EXPENSE_NATURE.SERVICES }, DOCUMENT_PHASE.ACCOUNTING);
      assert.deepEqual(legacyAccounting.map((item) => [item.kind, item.minCount]), [["CONFORMITY", 1]]);

      await ApprovalRule.create({ name: "Legacy B director", approvalLevel: "AREA_DIRECTOR", role: "AreaDirector", flowType: FLOW_TYPE.B, sequence: 1, slaHours: 4 });
      const route = await resolveApprovalRoute({ flowType: FLOW_TYPE.B, requestType: "OPEX", requesterArea: "General", totalAmount: 100 });
      assert.deepEqual(route.map((step) => step.approvalLevel), ["AREA_DIRECTOR", "VICE_RECTOR"]);
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });
});
