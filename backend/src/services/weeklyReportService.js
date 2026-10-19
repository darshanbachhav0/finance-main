import ExcelJS from "exceljs";
import mongoose from "mongoose";
import AccountsPayable from "../models/AccountsPayable.js";
import FinancialRequest from "../models/FinancialRequest.js";
import User from "../models/User.js";
import { createEmailTransport } from "../integrations/email/index.js";
import { isValidEmail, notificationEmailConfiguration } from "./notificationEmailService.js";
import { nextPaymentRunSummary } from "./treasuryService.js";
import { AP_STATUS, ROLES } from "../utils/constants.js";
import { limaDateKey } from "../../../shared/businessCalendar.mjs";

// The weekly report Finance used to build by hand: every Monday morning (Lima) one Excel workbook
// is emailed to Accounting, Treasury and Management - the week's new requests, what waits
// for approval, what was paid, what is still to pay and the next payment run. The same workbook
// can be downloaded any time from Reports (GET /reports/weekly.xlsx).
//
// WEEKLY_REPORT_ENABLED (default on while notification emails are on), WEEKLY_REPORT_DAY
// (1 = Monday ... 7 = Sunday), WEEKLY_REPORT_HOUR (Lima, default 8) and WEEKLY_REPORT_ROLES
// (comma-separated roles, default Accounting,Treasury,Management).

const DAY_MS = 86400000;
const LIMA_OFFSET_MS = 5 * 3600000;
const DEFAULT_ROLES = [ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.MANAGEMENT];
const runSchema = new mongoose.Schema({ _id: String, sentAt: Date, recipients: Number }, { timestamps: true });
export const WeeklyReportRun = mongoose.models.WeeklyReportRun || mongoose.model("WeeklyReportRun", runSchema);

const STATUS_LABELS = {
  BORRADOR: "Borrador", PENDIENTE_APROBACION: "Pendiente de aprobación", APROBADO: "Aprobado", COMPROMISO_PRESUPUESTAL: "Compromiso presupuestal",
  CONTABILIZADO: "Contabilizado", PROGRAMADO: "Programado", TXT_GENERADO: "TXT generado", PAGADO: "Pagado", CONCILIADO: "Conciliado", CERRADO: "Cerrado",
  OBSERVADO: "Observado", DEVUELTO: "Devuelto", RECHAZADO: "Rechazado", ANULADO: "Anulado"
};

export function weeklyReportConfiguration(env = process.env) {
  const day = Number(env.WEEKLY_REPORT_DAY);
  const hour = Number(env.WEEKLY_REPORT_HOUR);
  const roles = String(env.WEEKLY_REPORT_ROLES || "").split(",").map((item) => item.trim()).filter((item) => Object.values(ROLES).includes(item));
  const enabledText = String(env.WEEKLY_REPORT_ENABLED ?? "").trim().toLowerCase();
  return {
    enabled: enabledText ? ["1", "true", "yes", "on"].includes(enabledText) : true,
    day: Number.isInteger(day) && day >= 1 && day <= 7 ? day : 1,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 8,
    roles: roles.length ? roles : DEFAULT_ROLES
  };
}

// Lima calendar parts of a moment: weekday 1 (Monday) ... 7 (Sunday), hour and the ISO-like week
// key of its Monday, used to send each week's report once.
export function limaWeek(now = new Date()) {
  const lima = new Date(now.getTime() - LIMA_OFFSET_MS);
  const weekday = lima.getUTCDay() || 7;
  const monday = new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate() - (weekday - 1)));
  return { weekday, hour: lima.getUTCHours(), weekKey: monday.toISOString().slice(0, 10) };
}

const dateText = (value) => (value ? limaDateKey(value).split("-").reverse().join("/") : "");
const person = (value) => value?.name || "";

function addSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map(([header, key, width = 18]) => ({ header, key, width }));
  sheet.getRow(1).font = { bold: true };
  rows.forEach((row) => sheet.addRow(row));
  if (rows.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  columns.forEach(([, key], index) => { if (/amount|total|monto/i.test(key)) sheet.getColumn(index + 1).numFmt = "#,##0.00"; });
  return sheet;
}

export async function buildWeeklyReport({ now = new Date() } = {}) {
  const to = now;
  const from = new Date(now.getTime() - 7 * DAY_MS);
  const [created, waiting, paid, open, run] = await Promise.all([
    FinancialRequest.find({ createdAt: { $gte: from, $lt: to } }).select("requestNumber createdAt requester requesterArea title description flowType totalAmount currency totalPENEquivalent status").populate("requester", "name").sort({ createdAt: 1 }).lean(),
    FinancialRequest.find({ status: "PENDIENTE_APROBACION" }).select("requestNumber requester requesterArea title totalAmount currency totalPENEquivalent approvalRouteSnapshot submittedAt createdAt").populate("requester", "name").sort({ createdAt: 1 }).lean(),
    AccountsPayable.find({ status: AP_STATUS.PAID, paidDate: { $gte: from, $lt: to } }).select("request supplier supplierSnapshot paidDate originalAmount currency").populate("request", "requestNumber").populate("supplier", "legalName name").sort({ paidDate: 1 }).lean(),
    AccountsPayable.find({ status: { $in: [AP_STATUS.OPEN, AP_STATUS.SCHEDULED, AP_STATUS.PARTIALLY_PAID] } }).select("request supplier dueDate plannedPaymentDate scheduledFor outstandingAmount currency status").populate("request", "requestNumber").populate("supplier", "legalName name").sort({ dueDate: 1 }).lean(),
    nextPaymentRunSummary(now)
  ]);
  const sum = (rows, key) => Math.round(rows.reduce((total, row) => total + Number(row[key] || 0), 0) * 100) / 100;
  const byCurrency = (rows, key) => Object.entries(rows.reduce((totals, row) => ({ ...totals, [row.currency || "PEN"]: (totals[row.currency || "PEN"] || 0) + Number(row[key] || 0) }), {})).map(([currency, total]) => `${currency} ${total.toFixed(2)}`).join(" + ") || "0.00";
  const oldestDays = waiting.length ? Math.floor((now - new Date(waiting[0].submittedAt || waiting[0].createdAt)) / DAY_MS) : 0;
  const summary = {
    from: limaDateKey(from), to: limaDateKey(to),
    newRequests: created.length, newRequestsPen: sum(created, "totalPENEquivalent"),
    waitingApproval: waiting.length, oldestWaitingDays: oldestDays,
    paidCount: paid.length, paidTotals: byCurrency(paid, "originalAmount"),
    openPayables: open.length, openTotals: byCurrency(open, "outstandingAmount"),
    nextRun: run.date, nextRunCount: run.count
  };

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "UMA · Gestión Financiera";
  workbook.created = now;
  addSheet(workbook, "Resumen", [["Indicador", "label", 44], ["Valor", "value", 30]], [
    { label: "Semana", value: `${dateText(from)} - ${dateText(to)}` },
    { label: "Solicitudes nuevas", value: summary.newRequests },
    { label: "Monto de solicitudes nuevas (PEN equivalente)", value: summary.newRequestsPen },
    { label: "Esperando aprobación ahora", value: summary.waitingApproval },
    { label: "Días de la solicitud más antigua sin aprobar", value: summary.oldestWaitingDays },
    { label: "Pagos de la semana", value: summary.paidCount },
    { label: "Total pagado en la semana", value: summary.paidTotals },
    { label: "CXP por pagar", value: summary.openPayables },
    { label: "Total por pagar", value: summary.openTotals },
    { label: "Próxima corrida de pagos", value: dateText(`${run.date}T12:00:00Z`) },
    { label: "Pagos en la próxima corrida", value: run.count }
  ]);
  addSheet(workbook, "Solicitudes nuevas", [["Solicitud", "number"], ["Fecha", "date", 12], ["Solicitante", "requester", 28], ["Área", "area", 22], ["Descripción", "title", 40], ["Vía", "flow", 8], ["Moneda", "currency", 8], ["Monto", "amount", 14], ["Estado", "status", 22]],
    created.map((row) => ({ number: row.requestNumber, date: dateText(row.createdAt), requester: person(row.requester), area: row.requesterArea || "", title: row.title || row.description || "", flow: row.flowType || "", currency: row.currency, amount: Number(row.totalAmount || 0), status: STATUS_LABELS[row.status] || row.status })));
  addSheet(workbook, "Por aprobar", [["Solicitud", "number"], ["Solicitante", "requester", 28], ["Área", "area", 22], ["Descripción", "title", 40], ["Aprobador", "approver", 28], ["Desde", "since", 12], ["Moneda", "currency", 8], ["Monto", "amount", 14]],
    waiting.map((row) => { const step = (row.approvalRouteSnapshot || []).find((item) => item.status === "PENDING"); return { number: row.requestNumber, requester: person(row.requester), area: row.requesterArea || "", title: row.title || "", approver: step?.approverSnapshot?.name || step?.approvalLevel || "", since: dateText(step?.startedAt || row.submittedAt || row.createdAt), currency: row.currency, amount: Number(row.totalAmount || 0) }; }));
  addSheet(workbook, "Pagos de la semana", [["Solicitud", "number"], ["Proveedor / beneficiario", "supplier", 36], ["Fecha de pago", "date", 14], ["Moneda", "currency", 8], ["Monto", "amount", 14]],
    paid.map((row) => ({ number: row.request?.requestNumber || "", supplier: row.supplier?.legalName || row.supplier?.name || row.supplierSnapshot?.legalName || "", date: dateText(row.paidDate), currency: row.currency, amount: Number(row.originalAmount || 0) })));
  addSheet(workbook, "Por pagar", [["Solicitud", "number"], ["Proveedor / beneficiario", "supplier", 36], ["Vence", "due", 12], ["Pago planificado", "planned", 16], ["Estado", "status", 14], ["Moneda", "currency", 8], ["Saldo", "amount", 14]],
    open.map((row) => ({ number: row.request?.requestNumber || "", supplier: row.supplier?.legalName || row.supplier?.name || "", due: dateText(row.dueDate), planned: dateText(row.scheduledFor || row.plannedPaymentDate), status: row.status, currency: row.currency, amount: Number(row.outstandingAmount || 0) })));

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, summary, fileName: `reporte-semanal-${summary.to}.xlsx` };
}

export function composeWeeklyReportEmail(summary) {
  const subject = `Reporte semanal de finanzas · ${summary.from.split("-").reverse().join("/")} al ${summary.to.split("-").reverse().join("/")}`;
  const lines = [
    "Hola:", "",
    "Adjuntamos el reporte semanal del sistema de gestión financiera de la UMA (Excel).", "",
    `• Solicitudes nuevas: ${summary.newRequests}`,
    `• Esperando aprobación: ${summary.waitingApproval}${summary.waitingApproval ? ` (la más antigua, ${summary.oldestWaitingDays} días)` : ""}`,
    `• Pagado en la semana: ${summary.paidCount} (${summary.paidTotals})`,
    `• Por pagar: ${summary.openPayables} (${summary.openTotals})`,
    `• Próxima corrida de pagos: ${summary.nextRun.split("-").reverse().join("/")} · ${summary.nextRunCount} pagos`,
    "", "—", "UMA · Gestión Financiera"
  ];
  return { subject, text: lines.join("\n") };
}

// Sends this week's report once, on the configured weekday from the configured hour (Lima).
export async function sendWeeklyReportIfDue({ now = new Date(), env = process.env, transport } = {}) {
  const config = weeklyReportConfiguration(env);
  const email = notificationEmailConfiguration(env);
  if (!config.enabled || !email.enabled) return { sent: false, reason: "disabled" };
  const { weekday, hour, weekKey } = limaWeek(now);
  if (weekday !== config.day || hour < config.hour) return { sent: false, reason: "not-due" };
  try { await WeeklyReportRun.create({ _id: weekKey }); }
  catch (error) { if (error.code === 11000) return { sent: false, reason: "already-sent" }; throw error; }
  const users = await User.find({ active: true, role: { $in: config.roles }, emailNotifications: { $ne: false } }).select("email").lean();
  const recipients = [...new Set(users.map((user) => String(user.email || "").trim().toLowerCase()).filter((address) => isValidEmail(address) && (!email.allowedDomains.length || email.allowedDomains.includes(address.split("@")[1]))))];
  if (!recipients.length) return { sent: false, reason: "no-recipients" };
  const report = await buildWeeklyReport({ now });
  const message = composeWeeklyReportEmail(report.summary);
  const sender = transport || createEmailTransport(email);
  try {
    // One email, recipients in Bcc: nobody's address is shown to the others.
    await sender.send({ from: email.from || "UMA · Gestión Financiera <no-reply@localhost>", replyTo: email.replyTo, to: email.from || recipients[0], bcc: recipients, ...message, attachments: [{ filename: report.fileName, content: report.buffer, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }] });
  } catch (error) {
    // Not sent: the next pass this week tries again.
    await WeeklyReportRun.deleteOne({ _id: weekKey });
    throw error;
  } finally {
    if (!transport) sender.close?.();
  }
  await WeeklyReportRun.updateOne({ _id: weekKey }, { $set: { sentAt: new Date(), recipients: recipients.length } });
  console.log(`[WEEKLY-REPORT] Sent the report of week ${weekKey} to ${recipients.length} recipient(s).`);
  return { sent: true, recipients: recipients.length, summary: report.summary };
}
