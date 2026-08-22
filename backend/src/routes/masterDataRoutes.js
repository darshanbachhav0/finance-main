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
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

function bindCrud(router, controller, writeRoles = [ROLES.ADMIN, ROLES.ACCOUNTING]) {
  router.get("/", protect, controller.list);
  router.post("/", protect, authorize(...writeRoles), controller.create);
  router.put("/:id", protect, authorize(...writeRoles), controller.update);
  router.delete("/:id", protect, authorize(...writeRoles), controller.remove);
}

export const costCenterRouter = Router();
bindCrud(costCenterRouter, costCenters);

export const expenseTypeRouter = Router();
bindCrud(expenseTypeRouter, expenseTypes);

export const exchangeRateRouter = Router();
exchangeRateRouter.get("/current", protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING), exchangeRates.current);
bindCrud(exchangeRateRouter, exchangeRates);

export const projectRouter = Router();
bindCrud(projectRouter, projects);

export const approvalRuleRouter = Router();
bindCrud(approvalRuleRouter, approvalRules, [ROLES.ADMIN]);

export const budgetRuleRouter = Router();
bindCrud(budgetRuleRouter, budgetRules, [ROLES.ADMIN, ROLES.BUDGET]);

export const budgetAllocationRouter = Router();
bindCrud(budgetAllocationRouter, budgetAllocations, [ROLES.ADMIN, ROLES.BUDGET]);

export const documentRuleRouter = Router();
bindCrud(documentRuleRouter, documentRules, [ROLES.ADMIN, ROLES.ACCOUNTING]);

export const accountingMappingRouter = Router();
bindCrud(accountingMappingRouter, accountingMappings, [ROLES.ADMIN, ROLES.ACCOUNTING]);

export const bankFormatRouter = Router();
bindCrud(bankFormatRouter, bankFormats, [ROLES.ADMIN]);

export const financeConfigurationRouter = Router();
financeConfigurationRouter.get("/", protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.BUDGET), financeConfigurations.list);
financeConfigurationRouter.post("/", protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING), financeConfigurations.create);
financeConfigurationRouter.put("/:id", protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING), financeConfigurations.update);
financeConfigurationRouter.delete("/:id", protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING), financeConfigurations.remove);

export const accountingPeriodRouter = Router();
accountingPeriodRouter.get("/", protect, accountingPeriods.list);
accountingPeriodRouter.post("/", protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING), accountingPeriods.create);
accountingPeriodRouter.post("/:id/close", protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING), accountingPeriods.close);
accountingPeriodRouter.post("/:id/reopen", protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING), accountingPeriods.reopen);
accountingPeriodRouter.put("/:id", protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING), accountingPeriods.update);
accountingPeriodRouter.delete("/:id", protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING), accountingPeriods.remove);
