import User from "../models/User.js";
import ApprovalRule from "../models/ApprovalRule.js";
import AccountingMapping from "../models/AccountingMapping.js";
import BankFormatConfiguration from "../models/BankFormatConfiguration.js";
import { durableAssetsEnabled } from "./durableAssetService.js";
import { cloudTaxpayerMode, TaxpayerProfileCache } from "./taxpayerProfileCache.js";
import { getSunatPadronStatus } from "./sunatPadronService.js";
import { usesPublicPadron } from "../config/sunatMode.js";

// Configuration checks the Super Admin console shows under System health.
export async function configurationHealth() {
  const issues = [];
  const users = await User.find({ active: true }).select("name jefe role").lean();
  const byId = new Map(users.map(user => [String(user._id), user]));
  for (const user of users) {
    const seen = new Set([String(user._id)]);
    let manager = user.jefe;
    while (manager) {
      const id = String(manager);
      if (seen.has(id)) { issues.push({ message: `${user.name}: manager hierarchy contains a cycle.`, owner: "Admin", path: "/users" }); break; }
      seen.add(id);
      if (!byId.has(id)) { issues.push({ message: `${user.name}: manager is missing or inactive.`, owner: "Admin", path: "/users" }); break; }
      manager = byId.get(id).jefe;
    }
  }
  if (!await ApprovalRule.exists({ active: true })) issues.push({ message: "No active role-based approval rules. Verify manager-chain coverage before submission.", owner: "Admin", path: "/configuration/approval-rules" });
  for (const purpose of ["ACCOUNTS_PAYABLE", "BANK", "IGV", "ADVANCE_TRANSIT"]) {
    if (!await AccountingMapping.exists({ active: true, purpose })) issues.push({ message: `No active ${purpose} accounting mapping.`, owner: "Accounting", path: "/configuration/accounting-mappings" });
  }
  for (const currency of ["PEN", "USD"]) if (!await BankFormatConfiguration.exists({ bank: "BBVA", currency, active: true, certified: true })) issues.push({ message: `${currency}: no active certified BBVA format.`, owner: "Treasury", path: "/configuration/bank-formats" });
  if (!durableAssetsEnabled()) issues.push({ message: "Durable cloud document storage is disabled. Verify persistent disk and backups.", owner: "Admin", path: "/settings" });
  if (process.env.NODE_ENV === "production" && !process.env.DRAFT_ENCRYPTION_KEY) issues.push({ message: "Set a stable dedicated draft encryption key before rotating authentication secrets.", owner: "Admin", path: "/settings" });
  if (process.env.OPERATIONS_WORKER_ENABLED === "false") issues.push({ message: "Automatic supplier reminders, follow-ups and the weekly report are disabled.", owner: "Admin", path: "/settings" });
  if (cloudTaxpayerMode()) {
    const expired = await TaxpayerProfileCache.countDocuments({ expiresAt: { $lte: new Date() } });
    if (expired) issues.push({ message: `${expired} cached taxpayer profiles require fresh official evidence.`, owner: "Accounting / Admin", path: "/suppliers" });
  } else if (usesPublicPadron()) {
    const status = await getSunatPadronStatus();
    if (!status.ready || !status.fresh) issues.push({ message: "SUNAT Padrón is missing or stale. Check the refresh worker.", owner: "Admin", path: "/settings" });
  }
  return { issues, checkedAt: new Date(), scope: "Configuration checks; not external integration certification." };
}
