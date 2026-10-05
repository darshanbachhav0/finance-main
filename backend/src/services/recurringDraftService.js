import mongoose from "mongoose";
import { PERMISSIONS } from "../utils/constants.js";
import { hasPermission } from "../utils/permissions.js";
import crypto from "node:crypto";
import FinancialRequest from "../models/FinancialRequest.js";
import User from "../models/User.js";
import WorkDraft from "../models/WorkDraft.js";
import { saveWorkDraft } from "./workDraftService.js";
import { notifyUser } from "./notificationService.js";
import { recordAudit } from "./auditService.js";
import { AppError } from "../utils/AppError.js";

const schema = new mongoose.Schema({ owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, source: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true }, name: String, nextMonth: String, active: { type: Boolean, default: true } }, { timestamps: true });
export const RecurringTemplate = mongoose.models.RecurringTemplate || mongoose.model("RecurringTemplate", schema);
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key] ?? ""]));
export function recurringDraftValue(request, month) {
  const form = pick(request, ["flowType", "requestType", "expenseNature", "priority", "currency", "title", "detailedDescription", "businessJustification", "nonApprovalRisk", "description", "schoolOrDepartment"]);
  Object.assign(form, { issueDate: `${month}-01`, accountingPeriod: month, requesterCostCenter: String(request.requesterCostCenter || ""), supplier: String(request.supplier || ""), supplierSelectionReason: "", areaCorrelative: "" });
  const lines = (request.lines || []).map(line => ({ ...pick(line, ["itemDescription", "quantity", "unitOfMeasure", "unitPrice", "priceIncludesIGV", "netAmount", "igvAmount", "totalAmount"]), costCenter: String(line.costCenter || ""), expenseType: String(line.expenseType || ""), budgetItem: "", projectId: "", clientId: crypto.randomUUID() }));
  return { form, lines, capex: {}, opexFrequency: "MONTHLY_RECURRING", quotations: [], files: {}, quotationFiles: {}, step: 0, maxStep: 0, completedSteps: [] };
}
export async function createRecurringTemplate(body, user, req) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.nextMonth || "")) throw new AppError(422, "Choose the first draft month.");
  const request = await FinancialRequest.findById(body.source);
  if (!request || String(request.requester || request.solicitor) !== String(user._id)) throw new AppError(403, "Use one of your own requests as the template.");
  if (request.requestType !== "OPEX" || !["A1", "B"].includes(request.flowType)) throw new AppError(422, "Recurring templates support OPEX A1 and B requests. Each new draft requires fresh review and evidence.");
  const record = await RecurringTemplate.create({ owner: user._id, source: request._id, name: request.title, nextMonth: body.nextMonth });
  await recordAudit({ entityType: "RecurringTemplate", entity: record, action: "TEMPLATE_CREATED", user, req, module: "REQUESTS", newValues: { source: record.source, nextMonth: record.nextMonth } });
  return record;
}
export async function generateDueDrafts() {
  // en-CA year/month formatting varies by ICU, so assemble from parts.
  const parts = new Intl.DateTimeFormat("en", { timeZone: "America/Lima", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const month = `${parts.find(p => p.type === "year").value}-${parts.find(p => p.type === "month").value}`;
  for await (const template of RecurringTemplate.find({ active: true, nextMonth: { $lte: month } }).cursor({ batchSize: 25 })) {
    const user = await User.findOne({ _id: template.owner, active: true });
    if (!user || !hasPermission(user, PERMISSIONS.REQUEST_CREATE)) continue;
    const request = await FinancialRequest.findById(template.source).lean();
    if (!request || String(request.requester || request.solicitor) !== String(user._id)) continue;
    const hash = crypto.createHash("sha256").update(`${template._id}:${month}`).digest("hex");
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
    if (!await WorkDraft.exists({ _id: id })) await saveWorkDraft(user, id, { scope: "request", recordId: "new", route: "/requests/new", title: `Recurring: ${template.name}`.slice(0, 100), revision: 0, mutationId: id, value: recurringDraftValue(request, month) });
    await notifyUser({ once: true, userId: user._id, eventKey: `recurring:${template._id}:${month}`, type: "RECURRING_DRAFT", title: "Recurring draft ready", message: `${template.name}: review current prices and attach new evidence before submission.`, path: "/requests/new" });
    const [year, number] = month.split("-").map(Number);
    const nextMonth = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
    await RecurringTemplate.updateOne({ _id: template._id, active: true }, { $set: { nextMonth } });
  }
}
