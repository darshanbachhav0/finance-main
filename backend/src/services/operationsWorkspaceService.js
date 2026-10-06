import { assertDraftScope } from "./workDraftService.js";
import FinancialRequest from "../models/FinancialRequest.js";
import User from "../models/User.js";
import Supplier from "../models/Supplier.js";
import ApprovalRule from "../models/ApprovalRule.js";
import AccountingMapping from "../models/AccountingMapping.js";
import BankFormatConfiguration from "../models/BankFormatConfiguration.js";
import AccountingPeriod from "../models/AccountingPeriod.js";
import SunatVoucher from "../models/SunatVoucher.js";
import InvoiceObservation from "../models/InvoiceObservation.js";
import AccountsPayable from "../models/AccountsPayable.js";
import JournalEntry from "../models/JournalEntry.js";
import { SUPPLIER_WORK_ROLES, actsAsSupplierProposer, requestVisibilityFilter } from "../utils/permissions.js";
import { requestReadiness } from "./operationsReadinessService.js";
import { evaluateSupplierHomologation } from "./supplierService.js";
import { periodCloseBlockers } from "./periodAdministrationService.js";
import { getConsolidation } from "./accountingService.js";
import { durableAssetsEnabled } from "./durableAssetService.js";
import { cloudTaxpayerMode, TaxpayerProfileCache } from "./taxpayerProfileCache.js";
import { getSunatPadronStatus } from "./sunatPadronService.js";
import { AppError } from "../utils/AppError.js";

export async function operationsQueue(user, query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const filter = { $and: [requestVisibilityFilter(user), query.kind === "closure" ? { status: "CONCILIADO" } : { status: { $nin: ["CERRADO", "RECHAZADO", "ANULADO", "PAGADO_CERRADO"] } }] };
  if (query.kind === "closure" && !["Admin", "Accounting"].includes(user.role)) throw new AppError(403, "Closure review requires Accounting.");
  const rows = await FinancialRequest.find(filter).sort({ updatedAt: 1 }).skip((page - 1) * 20).limit(20).select("requestNumber title updatedAt").lean();
  const data = [];
  for (const row of rows) {
    const readiness = await requestReadiness(row._id, user);
    data.push({ id: row._id, requestNumber: row.requestNumber, title: row.title, updatedAt: row.updatedAt, ...readiness });
  }
  return { data, page, total: await FinancialRequest.countDocuments(filter) };
}

export async function supplierReviewQueue(user) {
  const query = { homologationStatus: { $in: ["PENDING_VALIDATION", "OBSERVED"] } };
  if (!SUPPLIER_WORK_ROLES.includes(user.role)) {
    if (!actsAsSupplierProposer(user)) throw new AppError(403, "Supplier review is not available for this role.");
    query.proposedBy = user._id;
  }
  const suppliers = await Supplier.find(query).sort({ updatedAt: 1 }).limit(50);
  const data = [];
  for (const supplier of suppliers) {
    const readiness = await evaluateSupplierHomologation(supplier);
    data.push({ id: supplier._id, name: supplier.legalName || supplier.name, status: supplier.homologationStatus, issues: readiness.issues, ready: readiness.valid, owner: "Accounting", path: "/suppliers" });
  }
  return { data, total: await Supplier.countDocuments(query) };
}

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
  for (const resource of ["direct-payment-eligibility-rules", "users", "approval-rules", "bank-formats", "finance-configurations", "document-rules", "budget-allocations"]) {
    try { assertDraftScope({ role: "Admin" }, `resource:${resource}`); }
    catch { issues.push({ message: `${resource}: draft permissions do not match Admin configuration access.`, owner: "Admin", path: "/settings" }); }
  }
  for (const currency of ["PEN", "USD"]) if (!await BankFormatConfiguration.exists({ bank: "BBVA", currency, active: true, certified: true })) issues.push({ message: `${currency}: no active certified BBVA format.`, owner: "Treasury / Admin", path: "/configuration/bank-formats" });
  if (!durableAssetsEnabled()) issues.push({ message: "Durable cloud document storage is disabled. Verify persistent disk and backups.", owner: "Admin", path: "/operations" });
  if (process.env.NODE_ENV === "production" && !process.env.DRAFT_ENCRYPTION_KEY) issues.push({ message: "Set a stable dedicated draft encryption key before rotating authentication secrets.", owner: "Admin", path: "/operations" });
  if (process.env.OPERATIONS_WORKER_ENABLED === "false") issues.push({ message: "Automatic recurring drafts and supplier review scans are disabled.", owner: "Admin", path: "/operations" });
  if (cloudTaxpayerMode()) {
    const expired = await TaxpayerProfileCache.countDocuments({ expiresAt: { $lte: new Date() } });
    if (expired) issues.push({ message: `${expired} cached taxpayer profiles require fresh official evidence.`, owner: "Accounting / Admin", path: "/suppliers" });
  } else if (["PADRON", "PUBLIC_PADRON", "PUBLIC-PADRON"].includes(String(process.env.SUNAT_PROVIDER_MODE).toUpperCase())) {
    const status = await getSunatPadronStatus();
    if (!status.ready || !status.fresh) issues.push({ message: "SUNAT Padrón is missing or stale. Check the refresh worker.", owner: "Admin", path: "/operations" });
  }
  return { issues, checkedAt: new Date(), scope: "Configuration checks; not external integration certification." };
}

export async function monthEndReadiness(period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new AppError(422, "Select a valid accounting month.");
  const [year, month] = period.split("-").map(Number);
  const dated = { $gte: new Date(Date.UTC(year, month - 1, 1)), $lt: new Date(Date.UTC(year, month, 1)) };
  const [counts, vouchers, observations, payables, journals, configuration] = await Promise.all([
    periodCloseBlockers(period),
    SunatVoucher.find({ issueDate: dated, validationStatus: { $ne: "ANNULLED" }, supersededBy: null, $or: [{ voucherType: { $nin: ["NOTA_CREDITO", "NOTA_DEBITO"] }, accountsPayable: null }, { voucherType: { $in: ["NOTA_CREDITO", "NOTA_DEBITO"] }, adjustmentAppliedAt: null }] }).select("request seriesNumber").limit(100).lean(),
    InvoiceObservation.find({ issueDate: dated, resolutionStatus: "OPEN" }).select("request detail").limit(100).lean(),
    AccountsPayable.find({ accountingPeriod: period, status: { $ne: "CANCELLED" }, provisionJournal: null }).select("request").limit(100).lean(),
    JournalEntry.find({ period, status: "DRAFT" }).select("request").limit(100).lean(),
    AccountingPeriod.findOne({ period }).lean()
  ]);
  const items = [...vouchers.map(row => ({ ...row, message: "Invoice not posted", owner: "Accounting" })), ...observations.map(row => ({ ...row, message: "Open invoice observation", owner: "Accounting / Requester" })), ...payables.map(row => ({ ...row, message: "Missing provision journal", owner: "Accounting" })), ...journals.map(row => ({ ...row, message: "Draft journal", owner: "Accounting" }))].map(row => ({ ...row, path: row.request ? `/requests/${row.request}` : "/accounting" }));
  const { summary } = await getConsolidation(period);
  if (!summary.balanced || Math.abs(summary.difference) >= 0.005) items.push({ message: "Resolve journal imbalance or source differences before closing.", owner: "Accounting", path: "/accounting" });
  return { period, counts, items, consolidation: summary, configured: Boolean(configuration), status: configuration?.status, ready: configuration?.status === "OPEN" && !Object.values(counts).some(Boolean) && summary.balanced && Math.abs(summary.difference) < 0.005, perCategoryLimit: 100 };
}
