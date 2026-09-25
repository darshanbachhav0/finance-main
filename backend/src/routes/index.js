import padronRoutes from "./padronRoutes.js";
import { Router } from "express";
import workDraftRoutes from "./workDraftRoutes.js";
import accountingRoutes from "./accountingRoutes.js";
import approvalRoutes from "./approvalRoutes.js";
import authRoutes from "./authRoutes.js";
import dashboardRoutes from "./dashboardRoutes.js";
import requestRoutes from "./requestRoutes.js";
import sunatOverrideRoutes from "./sunatOverrideRoutes.js";
import sireRoutes from "./sireRoutes.js";
import supplierRoutes from "./supplierRoutes.js";
import treasuryRoutes from "./treasuryRoutes.js";
import budgetRoutes from "./budgetRoutes.js";
import batchInvoiceRoutes from "./batchInvoiceRoutes.js";
import reportRoutes from "./reportRoutes.js";
import notificationRoutes from "./notificationRoutes.js";
import fileRoutes from "./fileRoutes.js";
import userRoutes from "./userRoutes.js";
import employeeReimbursementBankRoutes from "./employeeReimbursementBankRoutes.js";
import externalManagementRoutes from "./externalManagementRoutes.js";
import {
  accountingPeriodRouter,
  accountingMappingRouter,
  approvalRuleRouter,
  bankFormatRouter,
  budgetAllocationRouter,
  budgetRuleRouter,
  costCenterRouter,
  directPaymentEligibilityRuleRouter,
  documentRuleRouter,
  exchangeRateRouter,
  expenseTypeRouter,
  financeConfigurationRouter,
  projectRouter
} from "./masterDataRoutes.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

const router = Router();
router.use("/auth", authRoutes);
router.use("/management/v1", externalManagementRoutes);
router.use(protect, authorize(ROLES.ADMIN, ROLES.SOLICITOR, ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR, ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.BUDGET, ROLES.PROCUREMENT, ROLES.MANAGEMENT, ROLES.MANAGEMENT_VIEWER));

router.use("/sunat-padron", padronRoutes);
router.use("/work-drafts", workDraftRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/requests", requestRoutes);
router.use("/requests", sunatOverrideRoutes);
router.use("/approvals", approvalRoutes);
router.use("/accounting", accountingRoutes);
router.use("/treasury", treasuryRoutes);
router.use("/budget", budgetRoutes);
router.use("/batch-invoices", batchInvoiceRoutes);
router.use("/reports", reportRoutes);
router.use("/notifications", notificationRoutes);
router.use("/files", fileRoutes);
router.use("/suppliers", supplierRoutes);
router.use("/cost-centers", costCenterRouter);
router.use("/expense-types", expenseTypeRouter);
router.use("/exchange-rates", exchangeRateRouter);
router.use("/accounting-periods", accountingPeriodRouter);
router.use("/projects", projectRouter);
router.use("/approval-rules", approvalRuleRouter);
router.use("/budget-rules", budgetRuleRouter);
router.use("/budget-allocations", budgetAllocationRouter);
router.use("/document-rules", documentRuleRouter);
router.use("/direct-payment-eligibility-rules", directPaymentEligibilityRuleRouter);
router.use("/accounting-mappings", accountingMappingRouter);
router.use("/bank-formats", bankFormatRouter);
router.use("/finance-configurations", financeConfigurationRouter);
router.use("/sire", sireRoutes);
router.use("/users", userRoutes);
router.use("/employee-bank-accounts", employeeReimbursementBankRoutes);

export default router;
