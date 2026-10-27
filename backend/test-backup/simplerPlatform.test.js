import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import BudgetAllocation from "../src/models/BudgetAllocation.js";
import CostCenter from "../src/models/CostCenter.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import Notification from "../src/models/Notification.js";
import Supplier from "../src/models/Supplier.js";
import User from "../src/models/User.js";
import WorkDraft from "../src/models/WorkDraft.js";
import { headerKey, parseAmount, parseDateKey, runExcelImport } from "../src/services/excelImportService.js";
import { closeStaleDrafts, followUpConfiguration, notifyNextPaymentRun, remindReturnedRequests, returnedAt } from "../src/services/followUpService.js";
import { nextPaymentRunSummary } from "../src/services/treasuryService.js";
import { buildWeeklyReport, limaWeek, sendWeeklyReportIfDue, weeklyReportConfiguration } from "../src/services/weeklyReportService.js";
import { ROLES } from "../src/utils/constants.js";

const DAY = 86400000;

async function workbook(rows) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Datos");
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await book.xlsx.writeBuffer());
}

test("Excel import helpers read Spanish headers, amounts and dates the way Finance writes them", () => {
  assert.equal(headerKey("Año"), "ano");
  assert.equal(headerKey("RUC / DNI"), "rucdni");
  assert.equal(headerKey(" Fecha de pago "), "fechadepago");
  assert.equal(parseAmount("S/ 1,250.50"), 1250.5);
  assert.equal(parseAmount("1250,5"), 1250.5);
  assert.equal(parseAmount(""), null);
  assert.ok(Number.isNaN(parseAmount("-")));
  assert.equal(parseDateKey("30/10/2026"), "2026-10-30");
  assert.equal(parseDateKey("2026-10-30T00:00:00.000Z"), "2026-10-30");
  assert.equal(parseDateKey("tomorrow"), "");
});

test("follow-up, weekly report and digest settings have safe defaults", () => {
  assert.deepEqual(followUpConfiguration({}), { returnedWorkingDays: 2, draftCloseDays: 30, draftWarningDays: 5, paymentRunNoticeDays: 2 });
  assert.equal(followUpConfiguration({ DRAFT_AUTO_CLOSE_DAYS: "0" }).draftCloseDays, 0, "0 turns closing drafts off");
  const weekly = weeklyReportConfiguration({});
  assert.deepEqual([weekly.enabled, weekly.day, weekly.hour], [true, 1, 8]);
  assert.deepEqual(weekly.roles, [ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.MANAGEMENT]);
  assert.equal(weeklyReportConfiguration({ WEEKLY_REPORT_ENABLED: "false" }).enabled, false);
  // Monday 19 Oct 2026, 08:30 in Lima.
  assert.deepEqual(limaWeek(new Date("2026-10-19T13:30:00Z")), { weekday: 1, hour: 8, weekKey: "2026-10-19" });
  assert.equal(limaWeek(new Date("2026-10-25T13:30:00Z")).weekKey, "2026-10-19", "Sunday belongs to the week that began on Monday");
  const returned = new Date("2026-10-12T15:00:00Z");
  assert.equal(returnedAt({ approvalHistory: [{ action: "SUBMIT", to: "PENDIENTE_APROBACION", createdAt: new Date("2026-10-01") }, { action: "OBSERVE", to: "OBSERVADO", createdAt: returned }], updatedAt: new Date() }).getTime(), returned.getTime());
});

test("imports, payment runs, follow-ups and the weekly report", { timeout: 90000 }, async (t) => {
  const database = `erp_simpler_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 5000 });
  try {
    await Promise.all([Notification.init(), WorkDraft.init()]);
    const [budget, solicitor, treasury, accounting] = await User.create([
      { name: "Bea Budget", role: ROLES.TREASURY, passwordHash: "x", email: "bea@uma.edu.pe" },
      { name: "Sol Requester", role: ROLES.SOLICITOR, passwordHash: "x", email: "sol@uma.edu.pe" },
      { name: "Teo Treasury", role: ROLES.TREASURY, passwordHash: "x", email: "teo@uma.edu.pe" },
      { name: "Ana Accounting", role: ROLES.ACCOUNTING, passwordHash: "x", email: "ana@uma.edu.pe" }
    ]);
    const center = await CostCenter.create({ code: "1101", name: "Enfermería", area: "Salud", active: true });

    await t.test("budget plans: checked first, then created through Budget's own rules", async () => {
      const file = await workbook([
        ["Año", "CECO", "Proyecto", "Monto anual", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
        [2031, "1101", "", 120000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000],
        [2032, "1101", "", "50,000.00"],
        [2031, "9999", "", 1000],
        [2033, "1101", "", 1000, 5000]
      ]);
      await assert.rejects(() => runExcelImport({ kind: "budget-plans", buffer: file, user: solicitor }), (error) => error.statusCode === 403 || error.status === 403 || /cannot run this import/.test(error.message));
      const check = await runExcelImport({ kind: "budget-plans", buffer: file, fileName: "plan.xlsx", user: budget });
      assert.deepEqual([check.dryRun, check.ok, check.failed], [true, 2, 2]);
      assert.equal(await BudgetAllocation.countDocuments(), 0, "checking saves nothing");
      assert.equal(check.rows[2].message, "Cost Center {code} does not exist or is inactive.");
      assert.deepEqual(check.rows[2].params, { code: "9999" });
      assert.match(check.rows[3].message, /twelve months/);
      const done = await runExcelImport({ kind: "budget-plans", buffer: file, fileName: "plan.xlsx", dryRun: false, user: budget });
      assert.equal(done.ok, 2);
      const plans = await BudgetAllocation.find().sort({ period: 1 }).lean();
      assert.deepEqual(plans.map((plan) => [plan.period, plan.planningMode, plan.assignedAmount]), [["2031", "ANNUAL_MONTHLY", 120000], ["2032", "ANNUAL_ONLY", 50000]]);
      const again = await runExcelImport({ kind: "budget-plans", buffer: file, user: budget });
      assert.match(again.rows[0].message, /already has a budget/);
    });

    await t.test("suppliers: proposals pending approval, never duplicates", async () => {
      const file = await workbook([
        ["RUC/DNI", "Razón social", "Correo", "Justificación"],
        ["20512345678", "SOFTWARE ANDINO S.A.C.", "ventas@andino.pe", ""],
        ["20512345678", "SOFTWARE ANDINO S.A.C.", "", ""],
        ["123", "MAL RUC", "", ""],
        ["20600000001", "", "", ""]
      ]);
      const done = await runExcelImport({ kind: "suppliers", buffer: file, dryRun: false, user: accounting });
      assert.deepEqual([done.ok, done.failed], [1, 3]);
      assert.match(done.rows[1].message, /repeats an earlier row|already exists/);
      const supplier = await Supplier.findOne({ rucDni: "20512345678" }).lean();
      assert.equal(supplier.homologationStatus, "PENDING_VALIDATION");
      assert.equal(supplier.active, false, "an imported supplier still needs its approval before it is paid");
    });

    await t.test("payment schedule: Treasury's planned date puts the payable into that payment run", async () => {
      const request = await FinancialRequest.collection.insertOne({ requestNumber: "SOL-2031-00001", status: "CONTABILIZADO", flowType: "B", requestType: "OPEX", currency: "PEN", totalAmount: 500, requester: solicitor._id });
      const later = new Date(Date.now() + 120 * DAY);
      await AccountsPayable.collection.insertOne({ request: request.insertedId, status: "OPEN", currency: "PEN", exchangeRate: 1, penEquivalent: 500, originalAmount: 500, outstandingAmount: 500, supplierIdentifierSnapshot: "20512345678", dueDate: later, paymentPriority: "NORMAL" });
      const before = await nextPaymentRunSummary();
      assert.equal(before.count, 0, "due in four months: not in the next run");
      const nextRun = before.date;
      const file = await workbook([["Solicitud", "Fecha de pago", "Prioridad"], ["SOL-2031-00001", nextRun.split("-").reverse().join("/"), "Prioritaria"], ["SOL-2031-99999", nextRun, ""], ["SOL-2031-00001", "01/01/2020", ""]]);
      await assert.rejects(() => runExcelImport({ kind: "payment-schedule", buffer: file, user: accounting }), /cannot run this import/);
      const done = await runExcelImport({ kind: "payment-schedule", buffer: file, dryRun: false, user: treasury });
      assert.deepEqual([done.ok, done.failed], [1, 2]);
      const payable = await AccountsPayable.findOne({ request: request.insertedId }).lean();
      assert.equal(payable.paymentPriority, "PRIORITY");
      assert.equal(limaWeek(payable.plannedPaymentDate).weekKey.length, 10);
      const after = await nextPaymentRunSummary();
      assert.deepEqual([after.date, after.count, after.totalsByCurrency.PEN.total], [nextRun, 1, 500]);

      // Two working days or less before the run, Treasury is told once.
      const notice = await notifyNextPaymentRun({ now: new Date(`${nextRun}T12:00:00Z`), config: { paymentRunNoticeDays: 2 } });
      await notifyNextPaymentRun({ now: new Date(`${nextRun}T12:00:00Z`), config: { paymentRunNoticeDays: 2 } });
      assert.equal(notice.notified, true);
      const notes = await Notification.find({ user: treasury._id, type: "PAYMENT_RUN_READY" }).lean();
      assert.equal(notes.length, 1);
      assert.equal(notes[0].path, "/treasury?run=next");
    });

    await t.test("a request sent back and not corrected gets a reminder; scanning again repeats nothing", async () => {
      const returned = new Date(Date.now() - 10 * DAY);
      const { insertedId } = await FinancialRequest.collection.insertOne({ requestNumber: "SOL-2031-00002", status: "OBSERVADO", requester: solicitor._id, approvalHistory: [{ action: "OBSERVE", to: "OBSERVADO", createdAt: returned }], updatedAt: returned });
      const first = await remindReturnedRequests({ config: { returnedWorkingDays: 2 } });
      await remindReturnedRequests({ config: { returnedWorkingDays: 2 } });
      assert.equal(first.reminders, 1);
      const reminders = await Notification.find({ user: solicitor._id, type: "REQUEST_FOLLOW_UP", entityId: insertedId }).lean();
      assert.equal(reminders.length, 1, "ten working days: only the second-stage reminder, once");
      assert.equal(reminders[0].path, `/requests/${insertedId}`);
    });

    await t.test("drafts untouched for 30 days are closed; the owner is warned 5 days before", async () => {
      const period = new Date().toISOString().slice(0, 7);
      await AccountingPeriod.create({ period, status: "OPEN" });
      const supplier = await Supplier.findOne({ rucDni: "20512345678" }).lean();
      const make = async (number, daysAgo) => {
        const request = await FinancialRequest.create({ requestNumber: number, description: "Servicio", supplier: supplier._id, requestType: "OPEX", expenseNature: "SERVICES", issueDate: new Date(), accountingPeriod: period, requester: solicitor._id, solicitor: solicitor._id, currency: "PEN", lines: [{ itemDescription: "Servicio", quantity: 1, unitOfMeasure: "SERVICE", unitPrice: 118, costCenter: center._id, netAmount: 100, igvAmount: 18, totalAmount: 118 }] });
        await FinancialRequest.collection.updateOne({ _id: request._id }, { $set: { updatedAt: new Date(Date.now() - daysAgo * DAY) } });
        return request;
      };
      const stale = await make("SOL-2031-00003", 40);
      const soon = await make("SOL-2031-00004", 27);
      const fresh = await make("SOL-2031-00005", 3);
      await WorkDraft.collection.insertMany([
        { _id: "old-form", owner: solicitor._id, scope: "request", recordId: "new", route: "/requests/new", title: "Compra de tóner", closed: false, updatedAt: new Date(Date.now() - 45 * DAY), createdAt: new Date(Date.now() - 45 * DAY) },
        { _id: "new-form", owner: solicitor._id, scope: "request", recordId: "new", route: "/requests/new", title: "Viaje", closed: false, updatedAt: new Date(), createdAt: new Date() }
      ]);
      const result = await closeStaleDrafts({ config: { draftCloseDays: 30, draftWarningDays: 5 } });
      assert.deepEqual([result.annulled, result.closedForms, result.warned, result.skipped], [1, 1, 1, 0]);
      assert.equal((await FinancialRequest.findById(stale._id)).status, "ANULADO");
      assert.equal((await FinancialRequest.findById(soon._id)).status, "BORRADOR");
      assert.equal((await FinancialRequest.findById(fresh._id)).status, "BORRADOR");
      assert.equal((await WorkDraft.findById("old-form")).closed, true);
      assert.equal((await WorkDraft.findById("new-form")).closed, false);
      assert.equal(await Notification.countDocuments({ user: solicitor._id, type: "DRAFT_CLOSE_WARNING" }), 1);
      assert.equal(await Notification.countDocuments({ user: solicitor._id, type: "DRAFT_AUTO_CLOSED" }), 1);
      assert.equal((await closeStaleDrafts({ config: { draftCloseDays: 0 } })).annulled, 0, "switched off");
    });

    await t.test("the weekly report is one Excel workbook, sent once on Monday morning", async () => {
      const report = await buildWeeklyReport();
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(report.buffer);
      assert.deepEqual(book.worksheets.map((sheet) => sheet.name), ["Resumen", "Solicitudes nuevas", "Por aprobar", "Pagos de la semana", "Por pagar"]);
      assert.ok(report.summary.openPayables >= 1);
      const sent = [];
      const transport = { async send(message) { sent.push(message); } };
      const env = { NOTIFICATION_EMAIL_MODE: "LOG", APP_PUBLIC_URL: "https://finanzas.uma.test" };
      const monday = new Date("2031-03-03T13:30:00Z");
      assert.equal((await sendWeeklyReportIfDue({ now: new Date("2031-03-04T13:30:00Z"), env, transport })).reason, "not-due");
      const first = await sendWeeklyReportIfDue({ now: monday, env, transport });
      const second = await sendWeeklyReportIfDue({ now: new Date(monday.getTime() + 3600000), env, transport });
      assert.equal(first.sent, true);
      assert.equal(second.reason, "already-sent");
      assert.equal(sent.length, 1);
      assert.deepEqual([...sent[0].bcc].sort(), ["ana@uma.edu.pe", "bea@uma.edu.pe", "teo@uma.edu.pe"], "Accounting, Budget and Treasury - not the requester");
      assert.match(sent[0].attachments[0].filename, /^reporte-semanal-.*\.xlsx$/);
      assert.equal((await sendWeeklyReportIfDue({ now: monday, env: { NOTIFICATION_EMAIL_MODE: "OFF" }, transport })).reason, "disabled");
    });
  } finally {
    if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
