import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import BudgetCommitment from "../src/models/BudgetCommitment.js";
import CostCenter from "../src/models/CostCenter.js";
import DocumentRule from "../src/models/DocumentRule.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import Project from "../src/models/Project.js";
import Supplier from "../src/models/Supplier.js";
import User from "../src/models/User.js";
import { validateStructuredQuotationComparison } from "../src/services/documentRuleService.js";
import {
  createFinancialRequest,
  parseQuotations,
  previewFinancialRequestBudget,
  requestAuthorizedCostCenters,
  requestFormPolicy,
  submitFinancialRequest
} from "../src/services/requestService.js";
import {
  assertSupplierEligibleForRequestReview,
  assertSupplierUsable
} from "../src/services/supplierService.js";
import { ERROR_CODES, EXPENSE_NATURE, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };

test("RCO-FOR-001 Phase 3 request controls", { timeout: 120000 }, async (t) => {
  const databaseName = `erp_request_phase3_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    const [center, secondCenter, forbiddenCenter] = await CostCenter.create([
      { code: "CC-PH3-100", name: "Health Sciences", area: "Health Sciences", annualBudget: 50000, active: true, budgetMode: "ACTIVE" },
      { code: "CC-PH3-110", name: "Pharmacy", area: "Pharmacy", annualBudget: 25000, active: true },
      { code: "CC-PH3-900", name: "Unassigned Engineering", area: "Engineering", annualBudget: 50000, active: true }
    ]);
    const [opex, capex] = await ExpenseType.create([
      { code: "PH3-OPEX", name: "Laboratory maintenance", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "634101", active: true },
      { code: "PH3-CAPEX", name: "Laboratory equipment", category: "CAPEX", accountingClass: "CLASS_3", accountNumber: "336101", active: true }
    ]);
    const project = await Project.create({ code: "PEP-PH3-01", name: "Health Laboratory Upgrade", costCenter: center._id, active: true });
    const solicitor = await User.create({
      employeeCode: "UMA-PH3-SOL",
      name: "Phase 3 Requester",
      email: "phase3.requester@uma.edu.pe",
      passwordHash: "unused",
      role: ROLES.SOLICITOR,
      area: "Health Sciences",
      costCenter: center._id,
      authorizedCostCenters: [secondCenter._id]
    });
    await AccountingPeriod.create({ period: "2026-08", status: "OPEN", openedAt: new Date(), openedBy: solicitor._id });
    const suppliers = await Supplier.create([
      { rucDni: "20611111111", legalName: "Homologated Phase 3 SAC", name: "Homologated Phase 3 SAC", homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true, supplierCode: "PRV-8101" },
      { rucDni: "20622222222", legalName: "Pending Phase 3 SAC", name: "Pending Phase 3 SAC", homologationStatus: "PENDING_VALIDATION", status: "PENDING_VALIDATION", active: false },
      { rucDni: "20633333333", legalName: "Observed Phase 3 SAC", name: "Observed Phase 3 SAC", homologationStatus: "OBSERVED", status: "OBSERVED", active: false },
      { rucDni: "20644444444", legalName: "Rejected Phase 3 SAC", name: "Rejected Phase 3 SAC", homologationStatus: "REJECTED", status: "REJECTED", active: false },
      { rucDni: "20655555555", legalName: "Inactive Phase 3 SAC", name: "Inactive Phase 3 SAC", homologationStatus: "INACTIVE", status: "INACTIVE", active: false }
    ]);
    await DocumentRule.create({
      code: "PH3-OFFICIAL-OPEX",
      requestType: REQUEST_TYPE.OPEX,
      expenseNature: EXPENSE_NATURE.MAINTENANCE,
      requirements: [{ kind: "QUOTATION", minCount: 3, labelKey: "three quotations" }],
      quotationPolicy: { enabled: true, minimumCount: 3, allowAuthorizedException: true, exceptionReasonRequired: true },
      active: true
    });

    function line(overrides = {}) {
      return {
        itemDescription: "Preventive maintenance service",
        quantity: 1,
        unitOfMeasure: "SERVICE",
        unitPrice: 118,
        costCenter: center._id,
        expenseType: opex._id,
        netAmount: 100,
        igvAmount: 18,
        totalAmount: 118,
        ...overrides
      };
    }

    async function officialDocument(overrides = {}) {
      const attachmentIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
      return FinancialRequest.create({
        requestType: REQUEST_TYPE.OPEX,
        expenseNature: EXPENSE_NATURE.MAINTENANCE,
        issueDate: "2026-08-12",
        accountingPeriod: "2026-08",
        requester: solicitor._id,
        solicitor: solicitor._id,
        requesterArea: solicitor.area,
        requesterCostCenter: center._id,
        currency: "PEN",
        supplier: suppliers[1]._id,
        title: "Official laboratory maintenance",
        detailedDescription: "Maintain laboratory equipment and deliver the service report.",
        businessJustification: "Protects teaching continuity and equipment availability.",
        nonApprovalRisk: "Practical classes may be interrupted.",
        description: "Official laboratory maintenance",
        supplierSelectionReason: "Best delivery period and technically compliant proposal.",
        opexDetails: { expenseFrequency: "ONE_OFF" },
        lines: [line()],
        attachments: attachmentIds.map((id, index) => ({ _id: id, kind: "QUOTATION", originalName: `quote-${index + 1}.pdf`, filename: `quote-${index + 1}.pdf`, url: `/files/quote-${index + 1}.pdf`, mimetype: "application/pdf", size: 10, uploadedBy: solicitor._id })),
        quotations: suppliers.slice(0, 3).map((supplier, index) => ({ supplier: supplier._id, amount: 118 + index, currency: "PEN", attachment: attachmentIds[index], recommended: index === 1 })),
        ...overrides
      });
    }

    await t.test("legacy request remains readable and official fields are additive", () => {
      const legacy = FinancialRequest.hydrate({ requestNumber: "SOL-2026-98001", description: "Legacy description", requestType: "OPEX" });
      assert.equal(legacy.description, "Legacy description");
      assert.equal(legacy.title, "");
    });

    await t.test("authorized CECO options are filtered and forged header/line CECOs are rejected", async () => {
      const options = await requestAuthorizedCostCenters(solicitor);
      assert.deepEqual(options.map((item) => item.code), ["CC-PH3-100", "CC-PH3-110"]);
      await assert.rejects(() => createFinancialRequest({
        payload: { requestType: "OPEX", expenseNature: "MAINTENANCE", requesterCostCenter: forbiddenCenter._id, issueDate: "2026-08-12", accountingPeriod: "2026-08", currency: "PEN", supplier: suppliers[0]._id, title: "Official", description: "Official", lines: [line()] },
        files: {}, user: solicitor, req
      }), (error) => error.code === ERROR_CODES.INVALID_COST_CENTER);
      await assert.rejects(() => createFinancialRequest({
        payload: { requestType: "OPEX", expenseNature: "MAINTENANCE", requesterCostCenter: center._id, issueDate: "2026-08-12", accountingPeriod: "2026-08", currency: "PEN", supplier: suppliers[0]._id, title: "Official", description: "Official", lines: [line({ costCenter: forbiddenCenter._id })] },
        files: {}, user: solicitor, req
      }), (error) => error.code === ERROR_CODES.INVALID_COST_CENTER_LINE && error.details.line === 1 && error.details.code === forbiddenCenter.code);
    });

    await t.test("CAPEX fields, project snapshot, NPV and Payback are server controlled and stored without calculation", async () => {
      const request = await createFinancialRequest({
        payload: {
          requestType: "CAPEX", expenseNature: "EQUIPMENT", requesterCostCenter: center._id, issueDate: "2026-08-12", accountingPeriod: "2026-08", currency: "PEN", supplier: suppliers[0]._id,
          title: "Microscope renewal", detailedDescription: "Replace teaching microscopes.", businessJustification: "Capacity improvement.", nonApprovalRisk: "Reduced lab capacity.", description: "Microscope renewal",
          capexDetails: { projectSnapshot: { id: project._id, code: "FORGED", name: "FORGED" }, assetCategory: "MACHINERY", usefulLifeYears: 8, npv: { amount: 15000, currency: "PEN" }, payback: { value: 3, unit: "YEARS" } },
          lines: [line({ expenseType: capex._id, itemDescription: "Microscope", quantity: 2, unitPrice: 59 })]
        }, files: {}, user: solicitor, req
      });
      assert.equal(request.capexDetails.projectSnapshot.code, project.code);
      assert.equal(request.capexDetails.projectSnapshot.name, project.name);
      assert.equal(request.capexDetails.npv.amount, 15000);
      assert.equal(request.capexDetails.payback.value, 3);
      const invalid = new FinancialRequest({ requestType: "CAPEX", capexDetails: { assetCategory: "INVALID", usefulLifeYears: -1 } });
      assert.ok(invalid.validateSync()?.errors["capexDetails.assetCategory"]);
      assert.ok(invalid.validateSync()?.errors["capexDetails.usefulLifeYears"]);
    });

    await t.test("OPEX frequency and exact commercial reconciliation preserve accounting totals", async () => {
      const request = await createFinancialRequest({
        payload: { requestType: "OPEX", expenseNature: "MAINTENANCE", requesterCostCenter: center._id, issueDate: "2026-08-12", accountingPeriod: "2026-08", currency: "PEN", supplier: suppliers[0]._id, title: "OPEX service", detailedDescription: "Service", businessJustification: "Need", nonApprovalRisk: "Risk", description: "OPEX service", opexDetails: { expenseFrequency: "MONTHLY_RECURRING" }, lines: [{ ...line(), commercialTotal: 999999 }] },
        files: {}, user: solicitor, req
      });
      assert.equal(request.opexDetails.expenseFrequency, "MONTHLY_RECURRING");
      assert.equal(request.lines[0].commercialTotal, 118);
      assert.equal(request.totalCommercialAmount, 118);
      assert.equal(request.totalAmount, 118);
      assert.equal(request.commercialTotalStatus, "MATCH");
      request.lines[0].unitPrice = 100;
      await request.validate();
      assert.equal(request.commercialTotalStatus, "MISMATCH");
      assert.equal(request.totalAmount, 118);
    });

    await t.test("configured quotation policy exposes its real minimum and detailed recommendation errors", async () => {
      const policy = await requestFormPolicy({ requestType: "OPEX", expenseNature: "MAINTENANCE" });
      assert.equal(policy.quotationPolicy.enabled, true);
      assert.equal(policy.quotationPolicy.minimumCount, 3);
      const base = { supplier: suppliers[0]._id, supplierSelectionReason: "Technical choice", quotations: [] };
      const none = validateStructuredQuotationComparison(base, policy.quotationPolicy);
      assert.ok(none.errors.some((item) => item.code === "QUOTATION_MINIMUM_NOT_MET"));
      assert.ok(none.errors.some((item) => item.code === "NO_RECOMMENDED_QUOTATION"));
      const multiple = validateStructuredQuotationComparison({ ...base, quotations: suppliers.slice(0, 3).map((supplier) => ({ supplier: supplier._id, attachment: new mongoose.Types.ObjectId(), recommended: true })) }, policy.quotationPolicy);
      assert.ok(multiple.errors.some((item) => item.code === "MULTIPLE_RECOMMENDED_QUOTATIONS"));
    });

    await t.test("client cannot forge quotation snapshots or authorize its own exception", async () => {
      const parsed = parseQuotations([{ supplier: suppliers[0]._id, supplierSnapshot: { legalName: "FORGED" }, recommended: true }]);
      assert.equal(parsed[0].supplierSnapshot, undefined);
      const request = await createFinancialRequest({
        payload: { requestType: "OPEX", expenseNature: "MAINTENANCE", requesterCostCenter: center._id, issueDate: "2026-08-12", accountingPeriod: "2026-08", currency: "PEN", supplier: suppliers[0]._id, title: "Exception attempt", detailedDescription: "Detail", businessJustification: "Need", nonApprovalRisk: "Risk", description: "Exception attempt", quotationException: { authorized: true, authorizedBy: solicitor._id }, quotations: [{ supplier: suppliers[0]._id, supplierSnapshot: { legalName: "FORGED" }, recommended: true }], lines: [line()] },
        files: {}, user: solicitor, req
      });
      assert.equal(request.quotationException.authorized, false);
      assert.equal(request.quotations[0].supplierSnapshot.legalName, suppliers[0].legalName);
    });

    await t.test("each missing official narrative field blocks submission with a precise code", async () => {
      for (const [field, code] of [["title", "TITLE_REQUIRED"], ["detailedDescription", "DETAILED_DESCRIPTION_REQUIRED"], ["businessJustification", "BUSINESS_JUSTIFICATION_REQUIRED"], ["nonApprovalRisk", "NON_APPROVAL_RISK_REQUIRED"]]) {
        const request = await officialDocument({ [field]: "" });
        await assert.rejects(() => submitFinancialRequest({ id: request._id, user: solicitor, req }), (error) => error.code === code);
      }
    });

    await t.test("quotation evidence, minimum, recommendation and supplier consistency are enforced", async () => {
      const insufficient = await officialDocument({ quotations: [{ supplier: suppliers[1]._id, recommended: true }] });
      await assert.rejects(() => submitFinancialRequest({ id: insufficient._id, user: solicitor, req }), (error) => error.code === "QUOTATION_MINIMUM_NOT_MET");
      const noEvidence = await officialDocument();
      noEvidence.quotations[0].attachment = undefined;
      noEvidence.attachments.splice(0, 1);
      await noEvidence.save();
      await assert.rejects(() => submitFinancialRequest({ id: noEvidence._id, user: solicitor, req }), (error) => error.code === "QUOTATION_ATTACHMENT_REQUIRED");
      const mismatch = await officialDocument({ supplier: suppliers[0]._id });
      await assert.rejects(() => submitFinancialRequest({ id: mismatch._id, user: solicitor, req }), (error) => error.code === "RECOMMENDED_SUPPLIER_MISMATCH");
    });

    await t.test("pending and observed suppliers may be reviewed, while rejected/inactive and commitment use remain blocked", () => {
      assert.doesNotThrow(() => assertSupplierEligibleForRequestReview(suppliers[1]));
      assert.doesNotThrow(() => assertSupplierEligibleForRequestReview(suppliers[2]));
      assert.throws(() => assertSupplierEligibleForRequestReview(suppliers[3]), (error) => error.code === "SUPPLIER_REJECTED");
      assert.throws(() => assertSupplierEligibleForRequestReview(suppliers[4]), (error) => error.code === "SUPPLIER_INACTIVE");
      assert.throws(() => assertSupplierUsable(suppliers[1]), (error) => error.code === "SUPPLIER_NOT_HOMOLOGATED");
      assert.doesNotThrow(() => assertSupplierUsable(suppliers[0]));
    });

    await t.test("a complete pending-supplier request submits for approval and carries server supplier snapshots", async () => {
      const request = await officialDocument();
      const submitted = await submitFinancialRequest({ id: request._id, user: solicitor, req, comments: "Phase 3 submission" });
      assert.equal(submitted.status, REQUEST_STATUS.PENDING_APPROVAL);
      assert.equal(submitted.supplier.homologationStatus, "PENDING_VALIDATION");
      assert.equal(submitted.quotations[0].supplierSnapshot.legalName, suppliers[0].legalName);
    });

    await t.test("budget preview uses current Budget dimensions, ignores fake status and never creates a commitment", async () => {
      const before = await BudgetCommitment.countDocuments();
      const preview = await previewFinancialRequestBudget({
        payload: { requestType: "OPEX", expenseNature: "MAINTENANCE", issueDate: "2026-08-12", accountingPeriod: "2026-08", currency: "PEN", budgetStatus: "AVAILABLE", lines: [line()] },
        user: solicitor
      });
      assert.equal(preview.status, "AVAILABLE");
      assert.equal(preview.totalRequested, 118);
      assert.equal(preview.lines[0].available, 50000);
      assert.equal(preview.lines[0].projectedBalance, 49882);
      assert.equal(await BudgetCommitment.countDocuments(), before);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
