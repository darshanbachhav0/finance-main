import { Router } from "express";
import {
  accountingMappings,
  accountingPeriods,
  approvalRules,
  bankFormats,
  budgetAllocations,
  budgetRules,
  costCenters,
  documentRules,
  exchangeRates,
  expenseTypes,
  financeConfigurations,
  projects
} from "../controllers/masterDataController.js";
import { authorizePermission, protect } from "../middleware/auth.js";
import { PERMISSIONS } from "../utils/constants.js";

const P = PERMISSIONS;

// writePermissions: who maintains the resource; readPermissions (optional): who reads it, when it
// is not shared reference data every signed-in person may read.
function bindCrud(router, controller, writePermissions, readPermissions) {
  const read = readPermissions ? [authorizePermission(...readPermissions)] : [];
  router.get("/", protect, ...read, controller.list);
  router.get("/:id", protect, ...read, controller.get);
  router.post("/", protect, authorizePermission(...writePermissions), controller.create);
  router.put("/:id", protect, authorizePermission(...writePermissions), controller.update);
  router.delete("/:id", protect, authorizePermission(...writePermissions), controller.remove);
}

// Cost centers and their responsibles are the organization's hierarchy: the administrator keeps it.
export const costCenterRouter = Router();
bindCrud(costCenterRouter, costCenters, [P.COST_CENTER_MANAGE]);

export const expenseTypeRouter = Router();
// The accounting account catalog is Contabilidad's tool: requesters never see or choose accounts.
bindCrud(expenseTypeRouter, expenseTypes, [P.ACCOUNTING_CODES_MANAGE], [P.ACCOUNTING_CODES_MANAGE, P.ACCOUNTING_PROVISION]);

// Tesorería and Contabilidad register the day's exchange rate.
export const exchangeRateRouter = Router();
exchangeRateRouter.get("/current", protect, authorizePermission(P.ACCOUNTING_PROVISION, P.TREASURY_SCHEDULE), exchangeRates.current);
bindCrud(exchangeRateRouter, exchangeRates, [P.ACCOUNTING_CODES_MANAGE, P.TREASURY_SCHEDULE]);

export const projectRouter = Router();
bindCrud(projectRouter, projects, [P.ACCOUNTING_CODES_MANAGE]);

// Approval thresholds and rules are financial parameters: only the GAF changes them. Everyone reads
// them (the administrator reviews the approval hierarchy).
export const approvalRuleRouter = Router();
bindCrud(approvalRuleRouter, approvalRules, [P.FINANCE_PARAMETERS_MANAGE]);

export const budgetRuleRouter = Router();
bindCrud(budgetRuleRouter, budgetRules, [P.BUDGET_MANAGE]);

export const budgetAllocationRouter = Router();
bindCrud(budgetAllocationRouter, budgetAllocations, [P.BUDGET_MANAGE]);

export const documentRuleRouter = Router();
bindCrud(documentRuleRouter, documentRules, [P.ACCOUNTING_CODES_MANAGE]);

// GL account mappings are Contabilidad's master data. Posting services read the model directly.
export const accountingMappingRouter = Router();
accountingMappingRouter.use(protect, authorizePermission(P.ACCOUNTING_CODES_MANAGE));
bindCrud(accountingMappingRouter, accountingMappings, [P.ACCOUNTING_CODES_MANAGE]);

export const bankFormatRouter = Router();
bindCrud(bankFormatRouter, bankFormats, [P.BANK_FORMAT_CERTIFY]);
bankFormatRouter.post("/:id/certify", protect, authorizePermission(PERMISSIONS.BANK_FORMAT_CERTIFY), bankFormats.certify);

// UIT value, payment windows and other financial parameters: the GAF changes them (Manual técnico,
// "solo la Gerencia de Administración Financiera debería cambiarlos"); Contabilidad and Tesorería read them.
export const financeConfigurationRouter = Router();
const readFinanceConfiguration = authorizePermission(P.FINANCE_PARAMETERS_MANAGE, P.ACCOUNTING_PROVISION, P.TREASURY_SCHEDULE);
const manageFinanceConfiguration = authorizePermission(P.FINANCE_PARAMETERS_MANAGE);
financeConfigurationRouter.get("/", protect, readFinanceConfiguration, financeConfigurations.list);
financeConfigurationRouter.get("/:id", protect, readFinanceConfiguration, financeConfigurations.get);
financeConfigurationRouter.post("/", protect, manageFinanceConfiguration, financeConfigurations.create);
financeConfigurationRouter.put("/:id", protect, manageFinanceConfiguration, financeConfigurations.update);
financeConfigurationRouter.delete("/:id", protect, manageFinanceConfiguration, financeConfigurations.remove);

// Contabilidad opens and closes periods; a closed period is reopened only by the GAF (Manual
// técnico: "Periodo cerrado: no admite provisiones ni pagos; solo GAF lo reabre").
export const accountingPeriodRouter = Router();
const managePeriods = authorizePermission(P.ACCOUNTING_CLOSE_PERIOD);
accountingPeriodRouter.get("/", protect, accountingPeriods.list);
accountingPeriodRouter.post("/", protect, managePeriods, accountingPeriods.create);
accountingPeriodRouter.post("/:id/close", protect, managePeriods, accountingPeriods.close);
accountingPeriodRouter.post("/:id/reopen", protect, authorizePermission(P.ACCOUNTING_REOPEN_PERIOD), accountingPeriods.reopen);
accountingPeriodRouter.put("/:id", protect, managePeriods, accountingPeriods.update);
accountingPeriodRouter.delete("/:id", protect, managePeriods, accountingPeriods.remove);
