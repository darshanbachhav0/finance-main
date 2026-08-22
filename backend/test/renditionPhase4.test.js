import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import CostCenter from "../src/models/CostCenter.js";
import EmployeeReimbursementBankAccount from "../src/models/EmployeeReimbursementBankAccount.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinanceConfiguration from "../src/models/FinanceConfiguration.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import Supplier from "../src/models/Supplier.js";
import User from "../src/models/User.js";
import {
  createEmployeeReimbursementBankAccount,
  listEmployeeReimbursementBankAccounts,
  reviewEmployeeReimbursementBankAccount,
  updateEmployeeReimbursementBankAccount
} from "../src/services/employeeReimbursementBankService.js";
import { evaluateConfiguredMobilityLines } from "../src/services/financeConfigurationService.js";
import { reviewRendition, submitRendition } from "../src/services/renditionService.js";
import { ERROR_CODES, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";

const req = { headers: { "x-forwarded-for": "127.0.0.1" }, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };

test("official UMA Phase 4 rendition and employee reimbursement banking", { timeout: 120000 }, async (t) => {
  const databaseName = `erp_rendition_phase4_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    const center = await CostCenter.create({ code: "CC-PH4-100", name: "Health Sciences", area: "Health Sciences", annualBudget: 10000, active: true });
    const [opex, nonDeductible] = await ExpenseType.create([
      { code: "PH4-OPEX", name: "Local mobility", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "631101", active: true },
      { code: "PH4-ND", name: "Non-deductible reimbursement", category: "OPEX", accountingClass: "NON_DEDUCTIBLE", accountNumber: "659901", active: true }
    ]);
    const supplier = await Supplier.create({ rucDni: "20680000001", legalName: "Phase 4 Beneficiary", name: "Phase 4 Beneficiary", status: "ACTIVE", active: true, homologationStatus: "HOMOLOGATED", supplierCode: "PRV-9401" });
    const [employee, otherEmployee, accounting, admin] = await User.create([
      { employeeCode: "UMA-PH4-001", name: "Rosa Rendicion", email: "rosa.rendicion@uma.edu.pe", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Health Sciences", costCenter: center._id },
      { employeeCode: "UMA-PH4-002", name: "Luis Other", email: "luis.other@uma.edu.pe", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Engineering", costCenter: new mongoose.Types.ObjectId() },
      { employeeCode: "UMA-PH4-003", name: "Carla Accounting", email: "carla.accounting@uma.edu.pe", passwordHash: "unused", role: ROLES.ACCOUNTING, area: "Finance" },
      { employeeCode: "UMA-PH4-004", name: "Ana Admin", email: "ana.admin@uma.edu.pe", passwordHash: "unused", role: ROLES.ADMIN, area: "IT" }
    ]);
    await AccountingPeriod.create({ period: "2026-08", status: "OPEN", openedAt: new Date(), openedBy: admin._id });
    await FinanceConfiguration.create({ key: "LOCAL_MOBILITY_DAILY_LIMIT", numericValue: 41, currency: "PEN", behavior: "WARNING", effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-08-15"), active: true, createdBy: admin._id });
    await FinanceConfiguration.create({ key: "LOCAL_MOBILITY_DAILY_LIMIT", numericValue: 60, currency: "PEN", behavior: "WARNING", effectiveFrom: new Date("2026-08-16"), active: true, createdBy: admin._id });

    function requestDocument({ requestType, total, status, renditionStatus = "NOT_REQUIRED", expenseType = nonDeductible }) {
      return FinancialRequest.create({
        requestType,
        expenseNature: requestType === REQUEST_TYPE.ENTREGA_RENDIR ? "TRAVEL" : "REIMBURSEMENT_LIQUIDATION",
        issueDate: "2026-08-10",
        accountingPeriod: "2026-08",
        currency: "PEN",
        supplier: supplier._id,
        requester: employee._id,
        solicitor: employee._id,
        requesterArea: employee.area,
        requesterCostCenter: center._id,
        status,
        description: "Official Phase 4 expense detail",
        lines: [{ costCenter: center._id, expenseType: expenseType._id, netAmount: total, igvAmount: 0, totalAmount: total }],
        rendition: { status: renditionStatus, amountAdvanced: requestType === REQUEST_TYPE.ENTREGA_RENDIR ? total : 0, balanceOutstanding: requestType === REQUEST_TYPE.ENTREGA_RENDIR ? total : 0 },
        attachments: requestType === REQUEST_TYPE.ENTREGA_RENDIR ? [{ kind: "RENDITION", originalName: "legacy-evidence.pdf", filename: "legacy-evidence.pdf", url: "/test/legacy-evidence.pdf", mimetype: "application/pdf", size: 10, uploadedBy: employee._id }] : []
      });
    }

    const bank = await createEmployeeReimbursementBankAccount({ payload: { bank: "BCP", currency: "PEN", accountHolderName: employee.name, accountNumber: "1941000000001", cci: "00219410000000000001", preferred: true }, user: employee, req });

    await t.test("employee profile starts pending and protected Finance fields cannot be mass assigned", async () => {
      assert.equal(bank.verificationStatus, "PENDING");
      await assert.rejects(() => createEmployeeReimbursementBankAccount({ payload: { bank: "BCP", currency: "PEN", accountHolderName: employee.name, accountNumber: "1941000000002", cci: "00219410000000000002", verificationStatus: "VERIFIED" }, user: employee, req }), (error) => error.code === ERROR_CODES.FORBIDDEN);
      await assert.rejects(() => reviewEmployeeReimbursementBankAccount({ accountId: bank._id, payload: { result: "VERIFIED" }, user: employee, req }), (error) => error.code === ERROR_CODES.FORBIDDEN);
    });

    await t.test("Accounting manual verification works and malformed CCI is rejected", async () => {
      const verified = await reviewEmployeeReimbursementBankAccount({ accountId: bank._id, payload: { result: "VERIFIED", comments: "Manual document review" }, user: accounting, req });
      assert.equal(verified.verificationStatus, "VERIFIED");
      assert.equal(verified.verificationSource, "UMA_MANUAL_FINANCE_REVIEW");
      await assert.rejects(() => createEmployeeReimbursementBankAccount({ payload: { bank: "BCP", currency: "PEN", accountHolderName: employee.name, accountNumber: "1941000000003", cci: "123" }, user: employee, req }), /exactly 20 digits/);
    });

    await t.test("cross-user bank changes are blocked and default model reads omit sensitive values", async () => {
      await assert.rejects(() => updateEmployeeReimbursementBankAccount({ accountId: bank._id, payload: { bank: "BBVA" }, user: otherEmployee, req }), (error) => error.code === ERROR_CODES.FORBIDDEN);
      const otherList = await listEmployeeReimbursementBankAccounts({ user: otherEmployee });
      assert.equal(otherList.length, 0);
      const hidden = await EmployeeReimbursementBankAccount.findById(bank._id);
      assert.equal(hidden.accountNumber, undefined);
      assert.equal(hidden.cci, undefined);
    });

    await t.test("effective-dated mobility configuration uses the transaction date", async () => {
      const early = await evaluateConfiguredMobilityLines([{ date: "2026-08-10", amount: 50 }], "2026-08-10");
      const later = await evaluateConfiguredMobilityLines([{ date: "2026-08-20", amount: 50 }], "2026-08-20");
      assert.equal(early.configuredValue, 41);
      assert.equal(early.shouldBlock, false);
      assert.equal(early.exceededLineCount, 1);
      assert.equal(later.configuredValue, 60);
      assert.equal(later.exceededLineCount, 0);
      assert.equal(await FinanceConfiguration.countDocuments({ key: "UNSUPPORTED_EXPENSE_LIMIT" }), 0);
    });

    let advance = await requestDocument({ requestType: REQUEST_TYPE.ENTREGA_RENDIR, total: 50, status: REQUEST_STATUS.RENDITION_PENDING, renditionStatus: "PENDING", expenseType: opex });
    const advancePayload = {
      lines: [{ costCenter: center._id, expenseType: opex._id, netAmount: 50, igvAmount: 0, totalAmount: 50 }],
      mobilityLines: [
        { date: "2026-08-10", origin: "UMA", destination: "Hospital", servicePurpose: "Academic coordination", amount: 25 },
        { date: "2026-08-10", origin: "Hospital", destination: "UMA", servicePurpose: "Return to campus", amount: 25 }
      ],
      unsupportedExpenseLines: [],
      amountReturned: 0,
      beneficiaryAcknowledged: true,
      comments: "Phase 4 advance rendition"
    };

    await t.test("acknowledgment and exact official/accounting reconciliation are blocking controls", async () => {
      await assert.rejects(() => submitRendition({ requestId: advance._id, payload: { ...advancePayload, beneficiaryAcknowledged: false }, files: {}, user: employee, req }), (error) => error.code === ERROR_CODES.BENEFICIARY_ACKNOWLEDGMENT_REQUIRED);
      await assert.rejects(() => submitRendition({ requestId: advance._id, payload: { ...advancePayload, mobilityLines: [{ ...advancePayload.mobilityLines[0], amount: 40 }] }, files: {}, user: employee, req }), (error) => error.code === ERROR_CODES.RENDITION_TOTAL_MISMATCH);
      advance = await FinancialRequest.findById(advance._id);
      assert.equal(advance.rendition.number, undefined);
    });

    await t.test("advance submission assigns one RG, snapshots beneficiary and preserves warning-only behavior", async () => {
      advance = await submitRendition({ requestId: advance._id, payload: advancePayload, files: {}, user: employee, req });
      assert.match(advance.rendition.number, /^RG-2026-\d{5,7}$/);
      assert.equal(advance.rendition.beneficiarySnapshot.employeeCode, employee.employeeCode);
      assert.equal(advance.rendition.beneficiarySnapshot.costCenterCode, center.code);
      assert.equal(advance.rendition.mobilitySubtotal, 50);
      assert.equal(advance.rendition.reimbursementTotal, 50);
      assert.equal(advance.rendition.detailReconciliation.status, "MATCH");
      assert.equal(advance.rendition.limitEvaluation.behavior, "WARNING");
      assert.equal(advance.rendition.limitEvaluation.exceededLineCount, 2);
      assert.ok(advance.rendition.beneficiaryAcknowledgment.reference);
      assert.equal(advance.rendition.reimbursementBankSnapshot?.profile, undefined);
    });

    await t.test("observed advance can be corrected and resubmitted without changing its RG", async () => {
      const originalNumber = advance.rendition.number;
      advance = await reviewRendition({ requestId: advance._id, action: "OBSERVE", comments: "Clarify mobility purpose", user: accounting, req });
      assert.equal(advance.rendition.financeReview.result, "OBSERVED");
      advance = await submitRendition({ requestId: advance._id, payload: advancePayload, files: {}, user: employee, req });
      assert.equal(advance.rendition.number, originalNumber);
      assert.equal(advance.rendition.financeReview.result, "PENDING");
    });

    let reimbursement = await requestDocument({ requestType: REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO, total: 100, status: REQUEST_STATUS.BUDGET_COMMITTED });
    const reimbursementPayload = {
      unsupportedExpenseLines: [{ date: "2026-08-10", description: "Exceptional local service without fiscal support", goodsServiceType: "SERVICES", grossAmount: 100 }],
      confirmedExceptionalUse: true,
      exceptionalUseComments: "Supporting document was unavailable.",
      beneficiaryAcknowledged: true,
      reimbursementBankProfile: bank._id
    };

    await t.test("unsupported declaration and verified bank are required only for reimbursement", async () => {
      await assert.rejects(() => submitRendition({ requestId: reimbursement._id, payload: { ...reimbursementPayload, confirmedExceptionalUse: false }, files: {}, user: employee, req }), (error) => error.code === ERROR_CODES.UNSUPPORTED_EXPENSE_DECLARATION_REQUIRED);
      reimbursement = await submitRendition({ requestId: reimbursement._id, payload: reimbursementPayload, files: {}, user: employee, req });
      assert.equal(reimbursement.rendition.unsupportedExpenseSubtotal, 100);
      assert.equal(reimbursement.rendition.reimbursementBankSnapshot.bank, "BCP");
      assert.equal(reimbursement.rendition.financeReview.result, "PENDING");
      assert.equal(advance.rendition.reimbursementBankSnapshot?.profile, undefined);
    });

    await t.test("Finance observe, resubmit, approve and reject remain distinct audited results", async () => {
      const originalNumber = reimbursement.rendition.number;
      reimbursement = await reviewRendition({ requestId: reimbursement._id, action: "OBSERVE", comments: "Expand the description", user: accounting, req });
      assert.equal(reimbursement.rendition.status, "OBSERVED");
      reimbursement = await submitRendition({ requestId: reimbursement._id, payload: reimbursementPayload, files: {}, user: employee, req });
      assert.equal(reimbursement.rendition.number, originalNumber);
      reimbursement = (await reviewRendition({ requestId: reimbursement._id, action: "APPROVE", comments: "Approved detail", user: accounting, req })).request;
      assert.equal(reimbursement.rendition.status, "VALIDATED");
      assert.equal(reimbursement.rendition.financeReview.result, "APPROVED");

      let rejected = await requestDocument({ requestType: REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO, total: 100, status: REQUEST_STATUS.BUDGET_COMMITTED });
      rejected = await submitRendition({ requestId: rejected._id, payload: reimbursementPayload, files: {}, user: employee, req });
      rejected = await reviewRendition({ requestId: rejected._id, action: "REJECT", comments: "Not accepted by Finance", user: accounting, req });
      assert.equal(rejected.rendition.financeReview.result, "REJECTED");
      await assert.rejects(() => submitRendition({ requestId: rejected._id, payload: reimbursementPayload, files: {}, user: employee, req }), (error) => error.code === ERROR_CODES.INVALID_STATUS_TRANSITION);
    });

    await t.test("later employee profile edits retain history and do not change the reimbursement snapshot", async () => {
      const before = await FinancialRequest.findById(reimbursement._id).select("+rendition.reimbursementBankSnapshot.accountNumber +rendition.reimbursementBankSnapshot.cci");
      const snapshotAccount = before.rendition.reimbursementBankSnapshot.accountNumber;
      const replacement = await updateEmployeeReimbursementBankAccount({ accountId: bank._id, payload: { bank: "BBVA", currency: "PEN", accountHolderName: employee.name, accountNumber: "0011000000002", cci: "01100110000000000002" }, user: employee, req });
      assert.equal(replacement.verificationStatus, "PENDING");
      assert.equal(await EmployeeReimbursementBankAccount.countDocuments({ user: employee._id }), 2);
      const original = await EmployeeReimbursementBankAccount.findById(bank._id);
      assert.equal(original.active, false);
      const after = await FinancialRequest.findById(reimbursement._id).select("+rendition.reimbursementBankSnapshot.accountNumber +rendition.reimbursementBankSnapshot.cci");
      assert.equal(after.rendition.reimbursementBankSnapshot.accountNumber, snapshotAccount);
      assert.equal(after.rendition.reimbursementBankSnapshot.bank, "BCP");
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
