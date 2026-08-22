import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import test from "node:test";
import mongoose from "mongoose";
import AccountingMapping from "../src/models/AccountingMapping.js";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import AuditLog from "../src/models/AuditLog.js";
import BudgetCommitment from "../src/models/BudgetCommitment.js";
import BudgetException from "../src/models/BudgetException.js";
import BudgetRule from "../src/models/BudgetRule.js";
import CostCenter from "../src/models/CostCenter.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import JournalEntry from "../src/models/JournalEntry.js";
import PaymentBatch from "../src/models/PaymentBatch.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";
import User from "../src/models/User.js";
import ExpenseType from "../src/models/ExpenseType.js";
import XmlValidationAttempt from "../src/models/XmlValidationAttempt.js";
import { createFinancialRequest, closeFinancialRequest, submitFinancialRequest } from "../src/services/requestService.js";
import { decideApproval } from "../src/services/approvalService.js";
import { processAccountsPayable, getConsolidation } from "../src/services/accountingService.js";
import { validateAccountingDimensions } from "../src/services/accountingDimensionService.js";
import { releaseBudget, reserveBudget } from "../src/services/budgetService.js";
import { slaStatus } from "../src/services/approvalRuleService.js";
import { guardAccountingPeriod } from "../src/services/periodService.js";
import { assertRequestLines } from "../src/services/requestRules.js";
import { createSupplierProposal, replaceActiveBankAccount } from "../src/services/supplierService.js";
import { reviewRendition } from "../src/services/renditionService.js";
import { confirmTreasuryPayment, generatePaymentBatch, reconcilePayment } from "../src/services/treasuryService.js";
import { validateXmlAgainstRequest } from "../src/services/xmlValidationService.js";
import { recordAudit } from "../src/services/auditService.js";
import { generatedRoot, tempUploadDir, uploadRoot } from "../src/services/storageService.js";
import { AP_STATUS, BUDGET_STATUS, EXPENSE_NATURE, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";

const period = "2026-08";
const issueDate = "2026-08-10";
const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };

test("production financial controls cover the canonical lifecycle", { timeout: 120000 }, async (t) => {
  const databaseName = `erp_financial_lifecycle_${process.pid}_${Date.now()}`;
  const cleanupPaths = [];
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await Promise.all([
      FinancialRequest.init(),
      AccountsPayable.init(),
      JournalEntry.init(),
      Supplier.init(),
      AuditLog.init(),
      PaymentBatch.init()
    ]);
    const center = await CostCenter.create({ code: "CC-LIFE", name: "Lifecycle", area: "Operations", budgetMode: "TRANSITIONAL", active: true });
    const activeCenter = await CostCenter.create({ code: "CC-ACTIVE", name: "Active Budget", area: "Operations", annualBudget: 1000, budgetMode: "ACTIVE", active: true });
    const insufficientCenter = await CostCenter.create({ code: "CC-LOW", name: "Low Budget", area: "Research", annualBudget: 50, budgetMode: "ACTIVE", active: true });
    const opex = await ExpenseType.create({ code: "EXP-OPEX", name: "OPEX Service", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", deductible: true, permittedRequestTypes: [REQUEST_TYPE.OPEX, REQUEST_TYPE.ENTREGA_RENDIR, REQUEST_TYPE.REEMBOLSO_CON_SUSTENTO], active: true });
    const capex = await ExpenseType.create({ code: "EXP-CAPEX", name: "CAPEX Asset", category: "CAPEX", accountingClass: "CLASS_3", accountNumber: "336101", deductible: true, permittedRequestTypes: [REQUEST_TYPE.CAPEX], active: true });
    const nonDeductible = await ExpenseType.create({ code: "EXP-ND", name: "Non-deductible", category: "NON_DEDUCTIBLE", accountingClass: "NON_DEDUCTIBLE", accountNumber: "991001", deductible: false, permittedRequestTypes: [REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO], active: true });
    const users = {
      solicitor: await User.create({ name: "Requester", email: "requester@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", costCenter: center._id, authorizedCostCenters: [center._id, activeCenter._id, insufficientCenter._id] }),
      director: await User.create({ name: "Director", email: "director@test.local", passwordHash: "unused", role: ROLES.APPROVER, approvalLevel: "AREA_DIRECTOR", approvalAreas: ["Operations"], area: "Operations" }),
      vice: await User.create({ name: "Vice", email: "vice@test.local", passwordHash: "unused", role: ROLES.APPROVER, approvalLevel: "VICE_RECTOR", approvalAreas: ["*"], area: "Rectorate" }),
      accounting: await User.create({ name: "Accounting", email: "accounting@test.local", passwordHash: "unused", role: ROLES.ACCOUNTING, area: "Accounting" }),
      treasury: await User.create({ name: "Treasury", email: "treasury@test.local", passwordHash: "unused", role: ROLES.TREASURY, area: "Treasury" }),
      budget: await User.create({ name: "Budget", email: "budget@test.local", passwordHash: "unused", role: ROLES.BUDGET, area: "Budget" }),
      admin: await User.create({ name: "Admin", email: "admin@test.local", passwordHash: "unused", role: ROLES.ADMIN, area: "Systems" })
    };
    const supplier = await Supplier.create({
      identifierType: "RUC",
      rucDni: "20999999991",
      normalizedIdentifier: "20999999991",
      legalName: "Lifecycle Supplier SAC",
      name: "Lifecycle Supplier SAC",
      taxpayerStatus: "MANUALLY_VALIDATED",
      complianceStatus: "COMPLIANT",
      homologationStatus: "HOMOLOGATED",
      supplierCode: "PRV-9791",
      paymentTerms: { option: "CREDIT_30", days: 30 },
      active: true,
      status: "ACTIVE"
    });
    await SupplierBankAccount.create({ supplier: supplier._id, bank: "BCP", currency: "PEN", accountType: "CURRENT", accountNumber: "191000000001", cci: "00219100000000000001", active: true, verificationStatus: "VERIFIED", ownershipResult: "MATCH", createdBy: users.admin._id });
    await AccountingPeriod.create({ period, status: "OPEN", openedBy: users.accounting._id, history: [{ action: "CREATED", by: users.accounting._id }] });
    const mappings = [
      ["TEST-AP", "ACCOUNTS_PAYABLE", "*", "421201"],
      ["TEST-IGV", "IGV", "*", "401111"],
      ["TEST-ADV", "ADVANCE_TRANSIT", REQUEST_TYPE.ENTREGA_RENDIR, "141301"],
      ["TEST-RETURN", "RETURN_RECEIVABLE", REQUEST_TYPE.ENTREGA_RENDIR, "101199"]
    ];
    for (const [code, purpose, requestType, accountNumber] of mappings) {
      await AccountingMapping.create({ code, name: code, purpose, requestType, expenseNature: "*", bank: "*", currency: "*", accountNumber, active: true });
    }
    await AccountingMapping.create({ code: "TEST-BANK", name: "BCP PEN", purpose: "BANK", requestType: "*", expenseNature: "*", bank: "BCP", currency: "PEN", accountNumber: "104101", active: true });

    let request;
    await t.test("1. save draft", async () => {
      request = await createFinancialRequest({
        payload: {
          requestType: REQUEST_TYPE.OPEX,
          expenseNature: EXPENSE_NATURE.MAINTENANCE,
          priority: "MEDIA",
          issueDate,
          accountingPeriod: period,
          currency: "PEN",
          supplier: supplier._id.toString(),
          description: "Canonical lifecycle test",
          lines: [{ costCenter: center._id.toString(), expenseType: opex._id.toString(), netAmount: 100, igvAmount: 18, totalAmount: 118 }],
          submit: false
        },
        files: {}, user: users.solicitor, req
      });
      cleanupPaths.push(path.join(uploadRoot, "requests", String(request._id)));
      assert.equal(request.status, REQUEST_STATUS.DRAFT);
      assert.equal(request.totalAmount, 118);
    });

    await t.test("2. submit complete request", async () => {
      request = await submitFinancialRequest({ id: request._id, user: users.solicitor, req, comments: "Submit" });
      assert.equal(request.status, REQUEST_STATUS.PENDING_APPROVAL);
      assert.equal(request.approvalRouteSnapshot.length, 2);
    });

    await t.test("3. missing required attachment blocks submit", async () => {
      await assert.rejects(() => createFinancialRequest({
        payload: {
          requestType: REQUEST_TYPE.REEMBOLSO_CON_SUSTENTO,
          expenseNature: EXPENSE_NATURE.ADVERTISING,
          issueDate,
          accountingPeriod: period,
          currency: "PEN",
          supplier: supplier._id.toString(),
          description: "Missing files",
          lines: [{ costCenter: center._id.toString(), expenseType: opex._id.toString(), netAmount: 100, igvAmount: 18, totalAmount: 118 }],
          submit: true
        }, files: {}, user: users.solicitor, req
      }), (error) => error.code === "MISSING_REQUIRED_DOCUMENT");
    });

    await t.test("4. XML amount mismatch blocks and records failed validation", async () => {
      await fs.mkdir(tempUploadDir, { recursive: true });
      const filePath = path.join(tempUploadDir, `mismatch-${Date.now()}.xml`);
      cleanupPaths.push(filePath);
      await fs.writeFile(filePath, `<?xml version="1.0"?><Invoice><ID>F001-1</ID><IssueDate>${issueDate}</IssueDate><AccountingSupplierParty><Party><PartyIdentification><ID>${supplier.rucDni}</ID></PartyIdentification></Party></AccountingSupplierParty><TaxTotal><TaxAmount>18</TaxAmount></TaxTotal><LegalMonetaryTotal><LineExtensionAmount>100</LineExtensionAmount><PayableAmount>119</PayableAmount></LegalMonetaryTotal></Invoice>`);
      await assert.rejects(() => validateXmlAgainstRequest(filePath, { supplier, issueDate, totalNet: 100, totalIGV: 18, totalAmount: 118 }, { request: request._id, user: users.solicitor, supplier, fileName: "mismatch.xml" }), (error) => error.code === "XML_AMOUNT_MISMATCH");
      assert.equal(await XmlValidationAttempt.countDocuments({ status: "INVALID" }), 1);
    });

    await t.test("5. duplicate supplier is blocked", async () => {
      const payload = { rucDni: "20888888881", legalName: "Duplicate Test", proposalJustification: "Required for a duplicate-control test." };
      await createSupplierProposal({ payload, files: {}, user: users.solicitor, req });
      await assert.rejects(() => createSupplierProposal({ payload, files: {}, user: users.solicitor, req }), (error) => error.code === "DUPLICATE_SUPPLIER");
    });

    await t.test("6. supplier bank-account history is retained", async () => {
      const historySupplier = await Supplier.create({ rucDni: "20777777771", name: "Bank History", status: "PENDING_VALIDATION" });
      await replaceActiveBankAccount(historySupplier, { bankName: "BCP", currency: "PEN", bankAccount: "111", cci: "00211100000000000001" }, users.accounting._id);
      await historySupplier.save();
      await replaceActiveBankAccount(historySupplier, { bankName: "BBVA", currency: "PEN", bankAccount: "333", cci: "01133300000000000001" }, users.accounting._id);
      await historySupplier.save();
      assert.equal(await SupplierBankAccount.countDocuments({ supplier: historySupplier._id }), 2);
      assert.equal(await SupplierBankAccount.countDocuments({ supplier: historySupplier._id, active: true }), 2);
    });

    await t.test("7. Director approval", async () => {
      const result = await decideApproval({ id: request._id, action: "APPROVE", comments: "Director approved", user: users.director, req });
      request = result.request;
      assert.equal(request.status, REQUEST_STATUS.DIRECTOR_APPROVED);
      assert.equal(request.approvalStage, "VICE_RECTOR");
    });

    await t.test("8. Vice Rector approval and transitional budget commitment", async () => {
      const result = await decideApproval({ id: request._id, action: "APPROVE", comments: "Vice approved", user: users.vice, req });
      request = result.request;
      assert.equal(request.status, REQUEST_STATUS.BUDGET_COMMITTED);
      assert.ok(request.budgetCommitment);
    });

    await t.test("9. SLA overdue calculation", () => {
      const result = slaStatus({ dueAt: new Date(Date.now() - 1000) });
      assert.equal(result.overdue, true);
      assert.equal(result.severity, "OVERDUE");
    });

    await t.test("10. budget commitment succeeds with sufficient funds", async () => {
      const budgetRequest = await FinancialRequest.create({ requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.MAINTENANCE, issueDate, accountingPeriod: period, currency: "PEN", supplier: supplier._id, solicitor: users.solicitor._id, description: "Budget reserve", lines: [{ costCenter: activeCenter._id, expenseType: opex._id, netAmount: 100, igvAmount: 0, totalAmount: 100 }] });
      const commitment = await reserveBudget(budgetRequest, users.budget._id);
      assert.equal(commitment.status, BUDGET_STATUS.COMMITTED);
      assert.equal((await CostCenter.findById(activeCenter._id)).committedAmount, 100);
      await releaseBudget(budgetRequest, users.budget._id, "Test rollback");
      assert.equal((await CostCenter.findById(activeCenter._id)).committedAmount, 0);
      await releaseBudget(budgetRequest, users.budget._id, "Idempotent retry");
      assert.equal((await CostCenter.findById(activeCenter._id)).committedAmount, 0);
    });

    await t.test("11. insufficient budget creates exception branch", async () => {
      await BudgetRule.create({ name: "Extraordinary", mode: "ACTIVE", exceptionStrategy: "EXTRAORDINARY_APPROVAL", costCenter: insufficientCenter._id, expenseType: capex._id, project: "*", active: true });
      const lowRequest = await FinancialRequest.create({ requestType: REQUEST_TYPE.CAPEX, expenseNature: EXPENSE_NATURE.EQUIPMENT, issueDate, accountingPeriod: period, currency: "PEN", supplier: supplier._id, solicitor: users.solicitor._id, description: "Insufficient", lines: [{ costCenter: insufficientCenter._id, expenseType: capex._id, netAmount: 100, igvAmount: 0, totalAmount: 100 }] });
      await assert.rejects(() => reserveBudget(lowRequest, users.budget._id), (error) => error.code === "INSUFFICIENT_BUDGET");
      assert.equal(await BudgetException.countDocuments({ request: lowRequest._id, status: "PENDING" }), 1);
    });

    await t.test("12-14. missing dimensions are blocked and account taxonomy is enforced", async () => {
      assert.throws(() => assertRequestLines([{ costCenter: center._id, netAmount: 1, igvAmount: 0, totalAmount: 1 }]), /Expense Type/);
      await assert.rejects(() => validateAccountingDimensions({ requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.MAINTENANCE, lines: [{ costCenter: center._id, expenseType: capex._id }], user: users.accounting }), /OPEX/);
      await assert.rejects(() => validateAccountingDimensions({ requestType: REQUEST_TYPE.CAPEX, expenseNature: EXPENSE_NATURE.EQUIPMENT, lines: [{ costCenter: center._id, expenseType: opex._id }], user: users.accounting }), /CAPEX/);
    });

    let payable;
    await t.test("15-17. duplicate voucher protection, CXP creation, and balanced provision", async () => {
      const result = await processAccountsPayable({ requestId: request._id, payload: { documentType: "FACTURA", series: "F001", number: "0001", documentDate: issueDate, accountingDate: issueDate, fiscalPeriod: period, accountNumber: opex.accountNumber, dueDate: "2026-09-30" }, user: users.accounting, req });
      request = result.request;
      payable = result.accountsPayable;
      assert.equal(request.status, REQUEST_STATUS.ACCOUNTED);
      assert.equal(payable.status, AP_STATUS.OPEN);
      assert.equal(payable.paymentTermsSnapshot.option, "CREDIT_30");
      assert.equal(payable.paymentTermsSnapshot.days, 30);
      assert.equal(payable.dueDate.toISOString().slice(0, 10), "2026-09-30");
      supplier.paymentTerms = { option: "CREDIT_45", days: 45 };
      await supplier.save();
      const historicalPayable = await AccountsPayable.findById(payable._id);
      assert.equal(historicalPayable.paymentTermsSnapshot.option, "CREDIT_30");
      assert.equal(historicalPayable.paymentTermsSnapshot.days, 30);
      assert.equal(result.journal.totalDebit, result.journal.totalCredit);
      const duplicateRequest = await FinancialRequest.create({ requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.MAINTENANCE, issueDate, accountingPeriod: period, currency: "PEN", supplier: supplier._id, solicitor: users.solicitor._id, status: REQUEST_STATUS.BUDGET_COMMITTED, description: "Duplicate voucher", lines: [{ costCenter: center._id, expenseType: opex._id, netAmount: 100, igvAmount: 18, totalAmount: 118 }] });
      await assert.rejects(() => processAccountsPayable({ requestId: duplicateRequest._id, payload: { documentType: " factura ", series: " f001 ", number: " 0001 ", documentDate: issueDate, accountingDate: issueDate, fiscalPeriod: period }, user: users.accounting, req }), (error) => error.code === "DUPLICATE_VOUCHER");
    });

    await t.test("18-20. OPEX, CAPEX, and unsupported reimbursement mappings", async () => {
      await validateAccountingDimensions({ requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.MAINTENANCE, lines: [{ costCenter: center._id, expenseType: opex._id }], user: users.accounting });
      await validateAccountingDimensions({ requestType: REQUEST_TYPE.CAPEX, expenseNature: EXPENSE_NATURE.EQUIPMENT, lines: [{ costCenter: center._id, expenseType: capex._id }], user: users.accounting });
      await validateAccountingDimensions({ requestType: REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO, expenseNature: EXPENSE_NATURE.ADVERTISING, lines: [{ costCenter: center._id, expenseType: nonDeductible._id }], user: users.accounting });
    });

    let advanceRequest;
    await t.test("21-22. Entrega a Rendir posts Account 14 then recognizes expense on rendition", async () => {
      advanceRequest = await FinancialRequest.create({ requestType: REQUEST_TYPE.ENTREGA_RENDIR, expenseNature: EXPENSE_NATURE.MAINTENANCE, issueDate, accountingPeriod: period, currency: "PEN", supplier: supplier._id, solicitor: users.solicitor._id, requester: users.solicitor._id, status: REQUEST_STATUS.BUDGET_COMMITTED, description: "Advance", lines: [{ costCenter: center._id, expenseType: opex._id, netAmount: 100, igvAmount: 18, totalAmount: 118 }] });
      const processed = await processAccountsPayable({ requestId: advanceRequest._id, payload: { documentType: "RECIBO", series: "ADV", number: "1", documentDate: issueDate, accountingDate: issueDate, fiscalPeriod: period }, user: users.accounting, req });
      assert.equal(processed.journal.entryType, "ADVANCE");
      assert.equal(processed.journal.lines[0].accountNumber, "141301");
      const advanceAp = processed.accountsPayable;
      advanceAp.status = AP_STATUS.PAID;
      advanceAp.outstandingAmount = 0;
      advanceAp.paidDate = issueDate;
      await advanceAp.save();
      advanceRequest = await FinancialRequest.findById(advanceRequest._id);
      advanceRequest.status = REQUEST_STATUS.RENDITION_PENDING;
      advanceRequest.payment = { operationNumber: "ADV-1", paidAt: issueDate, confirmedAmount: 118, confirmedAt: new Date(), confirmedBy: users.treasury._id };
      advanceRequest.rendition = { amountAdvanced: 118, amountRendered: 118, amountReturned: 0, balanceOutstanding: 0, status: "SUBMITTED", submittedAt: new Date(), submittedBy: users.solicitor._id, lines: [{ costCenter: center._id, expenseType: opex._id, netAmount: 100, igvAmount: 18, totalAmount: 118, penEquivalent: 118 }] };
      advanceRequest.attachments.push({ kind: "RENDITION", originalName: "rendition.pdf", filename: "rendition.pdf", url: "/test/rendition.pdf", mimetype: "application/pdf", size: 10, uploadedBy: users.solicitor._id });
      await advanceRequest.save();
      const reviewed = await reviewRendition({ requestId: advanceRequest._id, action: "VALIDATE", comments: "Valid", user: users.accounting, req });
      assert.equal(reviewed.request.rendition.status, "VALIDATED");
      assert.equal(reviewed.journal.entryType, "RENDITION");
      assert.equal(reviewed.journal.totalDebit, reviewed.journal.totalCredit);
    });

    await t.test("23-25. closed period mutations and approvals are blocked and audited", async () => {
      await AccountingPeriod.findOneAndUpdate({ period }, { status: "CLOSED", closedAt: new Date() });
      await assert.rejects(() => guardAccountingPeriod({ period, action: "UPDATE", user: users.accounting, req, module: "TEST", requestId: request._id }), (error) => error.code === "ACCOUNTING_PERIOD_CLOSED");
      await assert.rejects(() => guardAccountingPeriod({ period, action: "APPROVE", user: users.director, req, module: "TEST", requestId: request._id }), (error) => error.code === "ACCOUNTING_PERIOD_CLOSED");
      assert.equal(await AuditLog.countDocuments({ requestId: request._id, blocked: true }), 2);
      await AccountingPeriod.findOneAndUpdate({ period }, { status: "OPEN", closedAt: null });
    });

    let batch;
    await t.test("26-27. bank TXT batch persists but does not mark CXP paid", async () => {
      const result = await generatePaymentBatch({ requestIds: [request._id.toString()], bank: "BCP", currency: "PEN", paymentDate: issueDate, user: users.treasury, req });
      batch = result.batch;
      cleanupPaths.push(path.join(generatedRoot, "bank-files", batch.fileName));
      request = await FinancialRequest.findById(request._id);
      payable = await AccountsPayable.findById(payable._id);
      assert.equal(request.status, REQUEST_STATUS.BANK_FILE_GENERATED);
      assert.equal(payable.status, AP_STATUS.PAYMENT_FILE_CREATED);
      assert.equal(await JournalEntry.countDocuments({ request: request._id, entryType: "PAYMENT" }), 0);
      assert.match(result.content, /UMA_DEMO_NOT_CERTIFIED/);
    });

    await t.test("28-29. payment confirmation settles CXP and creates payment journal", async () => {
      const result = await confirmTreasuryPayment({ requestId: request._id, payload: { operationNumber: "OP-100", paidAt: issueDate, confirmedAmount: 118, comments: "Paid" }, user: users.treasury, req });
      request = result.request;
      assert.equal(request.status, REQUEST_STATUS.PAID);
      assert.equal(result.accountsPayable.status, AP_STATUS.PAID);
      assert.equal(result.accountsPayable.outstandingAmount, 0);
      assert.equal(result.paymentJournal.entryType, "PAYMENT");
      assert.equal(result.paymentJournal.totalDebit, result.paymentJournal.totalCredit);
    });

    await t.test("30. payment reconciliation and closure", async () => {
      const result = await reconcilePayment({ requestId: request._id, payload: { bankReference: "STM-100", statementAmount: 118, comments: "Matched" }, user: users.treasury, req });
      request = result.request;
      assert.equal(request.status, REQUEST_STATUS.RECONCILED);
      request = await closeFinancialRequest({ id: request._id, user: users.accounting, req, comments: "Closed" });
      assert.equal(request.status, REQUEST_STATUS.CLOSED);
    });

    await t.test("31. month-end Cost Center/account consolidation reconciles", async () => {
      const consolidation = await getConsolidation(period);
      assert.ok(consolidation.rows.length > 0);
      assert.equal(consolidation.summary.balanced, true);
      assert.equal(consolidation.summary.difference, 0);
    });

    await t.test("32. backend permission enforcement prevents self approval", async () => {
      const own = await FinancialRequest.create({ requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.MAINTENANCE, issueDate, accountingPeriod: period, currency: "PEN", supplier: supplier._id, solicitor: users.director._id, requester: users.director._id, status: REQUEST_STATUS.PENDING_APPROVAL, description: "Self approval", lines: [{ costCenter: center._id, expenseType: opex._id, netAmount: 1, igvAmount: 0, totalAmount: 1 }], approvalRouteSnapshot: [{ approvalLevel: "AREA_DIRECTOR", role: ROLES.APPROVER, sequence: 1, slaHours: 24, required: true, status: "PENDING" }], approvalStage: "AREA_DIRECTOR" });
      await assert.rejects(() => decideApproval({ id: own._id, action: "APPROVE", user: users.director, req }), /cannot approve their own/);
    });

    await t.test("33. audit records are immutable through normal operations", async () => {
      const audit = await recordAudit({ entityType: "FinancialRequest", entity: request, action: "IMMUTABLE_TEST", user: users.admin, req });
      audit.message = "Changed";
      await assert.rejects(() => audit.save(), /append-only/);
      await assert.rejects(() => AuditLog.deleteOne({ _id: audit._id }), /append-only/);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await Promise.all(cleanupPaths.map((target) => fs.rm(target, { recursive: true, force: true }).catch(() => undefined)));
  }
});
