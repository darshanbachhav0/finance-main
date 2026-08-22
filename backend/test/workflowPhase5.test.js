import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import AccountsPayable from "../src/models/AccountsPayable.js";
import AuditLog from "../src/models/AuditLog.js";
import BudgetCommitment from "../src/models/BudgetCommitment.js";
import CostCenter from "../src/models/CostCenter.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import PurchaseOrder from "../src/models/PurchaseOrder.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";
import User from "../src/models/User.js";
import {
  listEligibleSupplierPaymentAccounts,
  resolvePaymentDestination
} from "../src/services/paymentDestinationService.js";
import {
  evaluateProcurementReadiness,
  orderKindForRequest
} from "../src/services/procurementReadinessService.js";
import {
  generatePurchaseOrder,
  issueProcurementOrder
} from "../src/services/purchaseOrderService.js";
import { getRequestDetail } from "../src/services/requestService.js";
import {
  AP_STATUS,
  BUDGET_STATUS,
  ERROR_CODES,
  EXPENSE_NATURE,
  PERMISSIONS,
  REQUEST_STATUS,
  REQUEST_TYPE,
  ROLES
} from "../src/utils/constants.js";
import { hasPermission } from "../src/utils/permissions.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };

test("Phase 5 end-to-end workflow integration controls", { timeout: 120000 }, async (t) => {
  const databaseName = `erp_workflow_phase5_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await Promise.all([
      AccountsPayable.init(),
      AuditLog.init(),
      BudgetCommitment.init(),
      FinancialRequest.init(),
      PurchaseOrder.init(),
      Supplier.init(),
      SupplierBankAccount.init(),
      User.init()
    ]);

    const center = await CostCenter.create({ code: "CC-PH5-100", name: "Health Sciences", area: "Health Sciences", budgetMode: "TRANSITIONAL", active: true });
    const expense = await ExpenseType.create({ code: "PH5-GOODS", name: "Medical supplies", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "603201", active: true });
    const users = {
      solicitor: await User.create({ name: "Phase 5 Requester", email: "phase5.requester@uma.edu.pe", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Health Sciences", costCenter: center._id }),
      approver: await User.create({ name: "Phase 5 Director", email: "phase5.director@uma.edu.pe", passwordHash: "unused", role: ROLES.APPROVER, area: "Health Sciences", approvalLevel: "AREA_DIRECTOR" }),
      budget: await User.create({ name: "Phase 5 Budget", email: "phase5.budget@uma.edu.pe", passwordHash: "unused", role: ROLES.BUDGET, area: "Budget" }),
      treasury: await User.create({ name: "Phase 5 Treasury", email: "phase5.treasury@uma.edu.pe", passwordHash: "unused", role: ROLES.TREASURY, area: "Treasury" }),
      accounting: await User.create({ name: "Phase 5 Accounting", email: "phase5.accounting@uma.edu.pe", passwordHash: "unused", role: ROLES.ACCOUNTING, area: "Accounting" })
    };

    let supplierSequence = 20695000000;
    async function supplier(overrides = {}) {
      const identifier = String(++supplierSequence);
      return Supplier.create({
        identifierType: "RUC",
        rucDni: identifier,
        normalizedIdentifier: identifier,
        legalName: `UMA Phase 5 Supplier ${identifier}`,
        name: `UMA Phase 5 Supplier ${identifier}`,
        homologationStatus: "HOMOLOGATED",
        status: "ACTIVE",
        active: true,
        supplierCode: `PRV-${String(supplierSequence).slice(-4)}`,
        paymentTerms: { option: "CREDIT_30", days: 30 },
        ...overrides
      });
    }

    const mainSupplier = await supplier();
    const quoteSupplierTwo = await supplier();
    const quoteSupplierThree = await supplier();
    const otherSupplier = await supplier();

    async function procurementRequest({ selectedSupplier = mainSupplier, requestType = REQUEST_TYPE.OPEX, expenseNature = EXPENSE_NATURE.GOODS, status = REQUEST_STATUS.BUDGET_COMMITTED, supplierSnapshot } = {}) {
      const quoteIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
      const request = await FinancialRequest.create({
        issueDate: "2026-08-12",
        accountingPeriod: "2026-08",
        requestType,
        expenseNature,
        currency: "PEN",
        supplier: selectedSupplier._id,
        supplierSnapshot,
        requester: users.solicitor._id,
        solicitor: users.solicitor._id,
        requesterArea: "Health Sciences",
        requesterCostCenter: center._id,
        status,
        title: "UMA laboratory procurement",
        description: "Acquire supplies for UMA teaching laboratories.",
        detailedDescription: "Approved commercial requirements for laboratory operation.",
        businessJustification: "Maintain uninterrupted academic sessions.",
        nonApprovalRisk: "Laboratory sessions may be delayed.",
        supplierSelectionReason: "Best evaluated commercial proposal.",
        lines: [{ itemDescription: "Laboratory supply kit", quantity: 2, unitOfMeasure: "KIT", unitPrice: 59, costCenter: center._id, expenseType: expense._id, netAmount: 100, igvAmount: 18, totalAmount: 118 }],
        quotations: [
          { supplier: selectedSupplier._id, amount: 118, currency: "PEN", attachment: quoteIds[0], recommended: true },
          { supplier: quoteSupplierTwo._id, amount: 125, currency: "PEN", attachment: quoteIds[1] },
          { supplier: quoteSupplierThree._id, amount: 130, currency: "PEN", attachment: quoteIds[2] }
        ],
        attachments: [
          ...quoteIds.map((id, index) => ({ _id: id, kind: "QUOTATION", originalName: `quote-${index + 1}.pdf`, filename: `quote-${index + 1}.pdf` })),
          { kind: "PDF", originalName: "invoice.pdf", filename: "invoice.pdf" },
          { kind: "CONTRACT", originalName: "contract.pdf", filename: "contract.pdf" },
          { kind: "CONFORMITY", originalName: "conformity.pdf", filename: "conformity.pdf" }
        ],
        approvalRouteSnapshot: [
          { approvalLevel: "AREA_DIRECTOR", role: ROLES.APPROVER, sequence: 1, required: true, status: "APPROVED", completedBy: users.approver._id, completedAt: new Date() },
          { approvalLevel: "VICE_RECTOR", role: ROLES.APPROVER, sequence: 2, required: true, status: "APPROVED", completedBy: users.approver._id, completedAt: new Date() }
        ],
        approvalStage: "COMPLETE"
      });
      if (status === REQUEST_STATUS.BUDGET_COMMITTED) {
        const commitment = await BudgetCommitment.create({
          request: request._id,
          requestNumber: request.requestNumber,
          period: request.accountingPeriod,
          lines: [{ costCenter: center._id, expenseType: expense._id, amount: request.totalAmount, mode: "TRANSITIONAL" }],
          totalAmount: request.totalAmount,
          status: BUDGET_STATUS.COMMITTED,
          createdBy: users.budget._id,
          reservedAt: new Date()
        });
        request.budgetCommitment = commitment._id;
        await request.save();
      }
      return request;
    }

    await t.test("controlled expense nature determines Purchase versus Service without parsing free text", () => {
      assert.equal(orderKindForRequest({ expenseNature: EXPENSE_NATURE.GOODS }), "PURCHASE");
      assert.equal(orderKindForRequest({ expenseNature: EXPENSE_NATURE.SERVICES }), "SERVICE");
      assert.equal(orderKindForRequest({ expenseNature: EXPENSE_NATURE.TRAVEL }), null);
    });

    let readyRequest;
    await t.test("approved, committed, documented request with homologated active PRV supplier is ready", async () => {
      readyRequest = await procurementRequest();
      const readiness = await evaluateProcurementReadiness(readyRequest);
      assert.equal(readiness.ready, true);
      assert.equal(readiness.orderKind, "PURCHASE");
      assert.equal(readiness.supplier.supplierCode, mainSupplier.supplierCode);
      assert.equal(readiness.approval.complete, true);
      assert.equal(readiness.budget.complete, true);
    });

    await t.test("pending, observed, rejected, and inactive suppliers remain distinct procurement blockers", async () => {
      const fixtures = [
        [await supplier({ homologationStatus: "PENDING_VALIDATION", status: "PENDING_VALIDATION", active: false, supplierCode: undefined }), ERROR_CODES.SUPPLIER_HOMOLOGATION_PENDING],
        [await supplier({ homologationStatus: "OBSERVED", status: "OBSERVED", active: false, supplierCode: undefined }), ERROR_CODES.SUPPLIER_HOMOLOGATION_OBSERVED],
        [await supplier({ homologationStatus: "REJECTED", status: "REJECTED", active: false, supplierCode: undefined }), ERROR_CODES.SUPPLIER_REJECTED],
        [await supplier({ homologationStatus: "INACTIVE", status: "INACTIVE", active: false }), ERROR_CODES.SUPPLIER_INACTIVE]
      ];
      for (const [candidate, expectedCode] of fixtures) {
        const request = await procurementRequest({ selectedSupplier: candidate });
        const result = await evaluateProcurementReadiness(request);
        assert.equal(result.ready, false);
        assert.ok(result.issues.some((item) => item.code === expectedCode), `Missing ${expectedCode}`);
      }
    });

    await t.test("PRV is read from Supplier Master and a forged request snapshot cannot satisfy the gate", async () => {
      const noPrv = await supplier({ supplierCode: undefined });
      const request = await procurementRequest({ selectedSupplier: noPrv, supplierSnapshot: { identifier: noPrv.rucDni, legalName: noPrv.legalName, homologationStatus: "HOMOLOGATED", supplierCode: "PRV-9999" } });
      const readiness = await evaluateProcurementReadiness(request);
      assert.ok(readiness.issues.some((item) => item.code === ERROR_CODES.SUPPLIER_PRV_MISSING));
      assert.equal(readiness.supplier.supplierCode, undefined);
    });

    await t.test("pending approval or missing commitment blocks order execution without creating a commitment", async () => {
      const request = await procurementRequest({ status: REQUEST_STATUS.PENDING_APPROVAL });
      const before = await BudgetCommitment.countDocuments({ request: request._id });
      const readiness = await evaluateProcurementReadiness(request);
      assert.ok(readiness.issues.some((item) => item.code === ERROR_CODES.REQUEST_APPROVAL_PENDING));
      assert.ok(readiness.issues.some((item) => item.code === ERROR_CODES.BUDGET_NOT_COMMITTED));
      assert.equal(await BudgetCommitment.countDocuments({ request: request._id }), before);
    });

    await t.test("Solicitor cannot issue an order and Budget creates it only from approved request data", async () => {
      await assert.rejects(() => issueProcurementOrder({ requestId: readyRequest._id, user: users.solicitor, req }), (error) => error.code === ERROR_CODES.FORBIDDEN);
      const order = await issueProcurementOrder({ requestId: readyRequest._id, user: users.budget, req });
      assert.match(order.poNumber, /^OC-2026-\d{5,7}$/);
      assert.equal(order.orderKind, "PURCHASE");
      assert.equal(String(order.supplier), String(mainSupplier._id));
      assert.equal(order.supplierCodeSnapshot, mainSupplier.supplierCode);
      assert.equal(order.amount, readyRequest.totalAmount);
      assert.equal(order.currency, readyRequest.currency);
      assert.equal(order.lines[0].itemDescription, readyRequest.lines[0].itemDescription);

      const serviceRequest = await procurementRequest({ expenseNature: EXPENSE_NATURE.SERVICES });
      const serviceOrder = await issueProcurementOrder({ requestId: serviceRequest._id, user: users.budget, req });
      assert.equal(serviceOrder.orderKind, "SERVICE");
    });

    await t.test("repeated and concurrent order creation remains idempotent", async () => {
      const repeated = await issueProcurementOrder({ requestId: readyRequest._id, user: users.budget, req });
      assert.equal(await PurchaseOrder.countDocuments({ request: readyRequest._id }), 1);
      assert.equal(String(repeated._id), String((await PurchaseOrder.findOne({ request: readyRequest._id }))._id));

      const concurrentRequest = await procurementRequest();
      const [firstDoc, secondDoc] = await Promise.all([FinancialRequest.findById(concurrentRequest._id), FinancialRequest.findById(concurrentRequest._id)]);
      const [first, second] = await Promise.all([
        generatePurchaseOrder(firstDoc, users.budget, req),
        generatePurchaseOrder(secondDoc, users.budget, req)
      ]);
      assert.equal(String(first._id), String(second._id));
      assert.equal(await PurchaseOrder.countDocuments({ request: concurrentRequest._id }), 1);
    });

    await t.test("reimbursements and Entrega a Rendir never become procurement-order eligible", async () => {
      for (const requestType of [REQUEST_TYPE.ENTREGA_RENDIR, REQUEST_TYPE.REEMBOLSO_CON_SUSTENTO, REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO]) {
        const request = await procurementRequest({ requestType, expenseNature: EXPENSE_NATURE.REIMBURSEMENT_LIQUIDATION });
        const readiness = await evaluateProcurementReadiness(request);
        assert.equal(readiness.applicable, false);
        await assert.rejects(() => issueProcurementOrder({ requestId: request._id, user: users.budget, req }), (error) => error.code === ERROR_CODES.PROCUREMENT_NOT_APPLICABLE);
      }
    });

    let accountSequence = 100;
    async function account(overrides = {}) {
      accountSequence += 1;
      return SupplierBankAccount.create({
        supplier: mainSupplier._id,
        bank: "BCP",
        currency: "PEN",
        accountType: "CURRENT",
        accountHolderName: mainSupplier.legalName,
        accountNumber: `191000000${accountSequence}`,
        cci: `00219100000000000${accountSequence}`.slice(-20),
        active: true,
        preferred: false,
        verificationStatus: "VERIFIED",
        ownershipResult: "MATCH",
        createdBy: users.accounting._id,
        ...overrides
      });
    }

    let preferredAccount;
    let alternateAccount;
    let legacyAccount;
    let ineligibleAccountIds;
    await t.test("Treasury receives only eligible CURRENT accounts and preferred is first", async () => {
      preferredAccount = await account({ preferred: true });
      alternateAccount = await account({ ownershipResult: "MANUAL_ACCEPTED" });
      legacyAccount = await account({ verificationStatus: "LEGACY_ACCEPTED", ownershipResult: "NOT_REVIEWED" });
      const pending = await account({ verificationStatus: "PENDING", ownershipResult: "NOT_REVIEWED" });
      const observed = await account({ verificationStatus: "OBSERVED" });
      const rejected = await account({ verificationStatus: "REJECTED" });
      const mismatch = await account({ ownershipResult: "MISMATCH" });
      const inactive = await account({ active: false });
      const detraction = await account({ bank: "BANCO_NACION", accountType: "DETRACTION" });
      await account({ currency: "USD" });
      ineligibleAccountIds = [pending, observed, rejected, mismatch, inactive, detraction].map((item) => String(item._id));

      const eligible = await listEligibleSupplierPaymentAccounts({ supplierId: mainSupplier._id, bank: "BCP", currency: "PEN" });
      assert.deepEqual(eligible.map((item) => String(item._id)), [String(preferredAccount._id), String(legacyAccount._id), String(alternateAccount._id)]);
      assert.equal(eligible[0].preferred, true);
      assert.equal(eligible.some((item) => ineligibleAccountIds.includes(String(item._id))), false);
      assert.equal(eligible.some((item) => item.accountType === "DETRACTION"), false);
    });

    let paymentRequest;
    let payable;
    await t.test("alternative eligible selection works while arbitrary, inactive, pending, and currency-mismatched IDs are rejected", async () => {
      paymentRequest = await procurementRequest();
      payable = await AccountsPayable.create({
        request: paymentRequest._id,
        supplier: mainSupplier._id,
        supplierIdentifierSnapshot: mainSupplier.rucDni,
        originalAmount: paymentRequest.totalAmount,
        currency: "PEN",
        exchangeRate: 1,
        penEquivalent: paymentRequest.totalAmount,
        outstandingAmount: paymentRequest.totalAmount,
        status: AP_STATUS.OPEN
      });
      const alternative = await resolvePaymentDestination({ request: paymentRequest, accountsPayable: payable, bank: "BCP", currency: "PEN", selectedAccountId: alternateAccount._id });
      assert.equal(String(alternative.snapshot.bankAccountId), String(alternateAccount._id));

      const foreign = await SupplierBankAccount.create({ supplier: otherSupplier._id, bank: "BCP", currency: "PEN", accountType: "CURRENT", accountNumber: "191000009999", cci: "00219100000000009999", active: true, verificationStatus: "VERIFIED", ownershipResult: "MATCH" });
      for (const accountId of [foreign._id, ...ineligibleAccountIds]) {
        await assert.rejects(() => resolvePaymentDestination({ request: paymentRequest, accountsPayable: payable, bank: "BCP", currency: "PEN", selectedAccountId: accountId }), (error) => error.code === ERROR_CODES.BANK_ACCOUNT_NOT_ELIGIBLE);
      }
      await assert.rejects(() => resolvePaymentDestination({ request: paymentRequest, accountsPayable: payable, bank: "BCP", currency: "USD", selectedAccountId: preferredAccount._id }), (error) => error.code === ERROR_CODES.BANK_ACCOUNT_NOT_ELIGIBLE);
    });

    await t.test("scheduled supplier destination remains immutable after Supplier Master changes", async () => {
      const selected = await resolvePaymentDestination({ request: paymentRequest, accountsPayable: payable, bank: "BCP", currency: "PEN", selectedAccountId: preferredAccount._id });
      payable.status = AP_STATUS.SCHEDULED;
      payable.bankAccountSnapshot = selected.snapshot;
      await payable.save();
      const originalCci = payable.bankAccountSnapshot.cci;
      preferredAccount.active = false;
      preferredAccount.preferred = false;
      preferredAccount.cci = "00219100000000007777";
      await preferredAccount.save();
      const frozen = await resolvePaymentDestination({ request: paymentRequest, accountsPayable: payable, bank: "BCP", currency: "PEN" });
      assert.equal(frozen.snapshot.cci, originalCci);
      assert.equal(String(frozen.snapshot.bankAccountId), String(preferredAccount._id));
      await assert.rejects(() => resolvePaymentDestination({ request: paymentRequest, accountsPayable: payable, bank: "BCP", currency: "PEN", selectedAccountId: alternateAccount._id }), (error) => error.code === ERROR_CODES.PAYMENT_DESTINATION_LOCKED);
    });

    await t.test("employee reimbursement uses the immutable rendition destination and never Supplier banking", async () => {
      const employeeProfileId = new mongoose.Types.ObjectId();
      const reimbursement = await FinancialRequest.create({
        issueDate: "2026-08-12",
        accountingPeriod: "2026-08",
        requestType: REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO,
        expenseNature: EXPENSE_NATURE.REIMBURSEMENT_LIQUIDATION,
        currency: "PEN",
        supplier: mainSupplier._id,
        requester: users.solicitor._id,
        solicitor: users.solicitor._id,
        status: REQUEST_STATUS.ACCOUNTED,
        description: "Employee reimbursement",
        lines: [{ costCenter: center._id, expenseType: expense._id, netAmount: 75, igvAmount: 0, totalAmount: 75 }],
        rendition: { reimbursementBankSnapshot: { profile: employeeProfileId, bank: "BCP", currency: "PEN", accountHolderName: users.solicitor.name, accountNumber: "194100000001", cci: "00219410000000000001", verificationStatus: "VERIFIED", capturedAt: new Date() } }
      });
      const employeePayable = await AccountsPayable.create({ request: reimbursement._id, supplier: mainSupplier._id, supplierIdentifierSnapshot: mainSupplier.rucDni, originalAmount: 75, currency: "PEN", exchangeRate: 1, penEquivalent: 75, outstandingAmount: 75, status: AP_STATUS.OPEN });
      const selected = await resolvePaymentDestination({ request: reimbursement, accountsPayable: employeePayable, bank: "BCP", currency: "PEN" });
      assert.equal(selected.snapshot.sourceType, "EMPLOYEE_REIMBURSEMENT");
      assert.equal(String(selected.snapshot.employeeBankAccountId), String(employeeProfileId));
      assert.equal(selected.snapshot.bankAccountId, undefined);
      await assert.rejects(() => resolvePaymentDestination({ request: reimbursement, accountsPayable: employeePayable, bank: "BCP", currency: "PEN", selectedAccountId: alternateAccount._id }), (error) => error.code === ERROR_CODES.BANK_ACCOUNT_NOT_ELIGIBLE);
    });

    await t.test("old AP documents remain readable and payment terms/due dates are optional", async () => {
      const historicalRequest = await procurementRequest();
      const historical = await AccountsPayable.create({ request: historicalRequest._id, supplier: mainSupplier._id, supplierIdentifierSnapshot: mainSupplier.rucDni, originalAmount: 10, currency: "PEN", exchangeRate: 1, penEquivalent: 10, outstandingAmount: 10, status: AP_STATUS.OPEN });
      const loaded = await AccountsPayable.findById(historical._id);
      assert.equal(loaded.paymentTermsSnapshot?.option, undefined);
      assert.equal(loaded.dueDate, undefined);
    });

    await t.test("Request Detail masks payment destinations for approvers but Finance roles retain operational access", async () => {
      const visibleToApprover = await getRequestDetail(paymentRequest._id, users.approver);
      const visibleToTreasury = await getRequestDetail(paymentRequest._id, users.treasury);
      assert.match(visibleToApprover.accountsPayable[0].bankAccountSnapshot.cci, /^\*+\d{4}$/);
      assert.equal(visibleToApprover.accountsPayable[0].bankAccountSnapshot.accountHolderName, undefined);
      assert.equal(visibleToTreasury.accountsPayable[0].bankAccountSnapshot.cci, payable.bankAccountSnapshot.cci);
    });

    await t.test("Phase 5 role permissions preserve segregation of duties", () => {
      assert.equal(hasPermission(users.budget, PERMISSIONS.PROCUREMENT_ORDER_CREATE), true);
      assert.equal(hasPermission(users.solicitor, PERMISSIONS.PROCUREMENT_ORDER_CREATE), false);
      assert.equal(hasPermission(users.budget, PERMISSIONS.SUPPLIER_HOMOLOGATE), false);
      assert.equal(hasPermission(users.treasury, PERMISSIONS.SUPPLIER_HOMOLOGATE), false);
      assert.equal(hasPermission(users.treasury, PERMISSIONS.TREASURY_FILE), true);
      assert.equal(hasPermission(users.accounting, PERMISSIONS.PAYMENT_CONFIRM), false);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
