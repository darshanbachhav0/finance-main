import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import mongoose from "mongoose";
import AccountsPayable from "../src/models/AccountsPayable.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import Notification from "../src/models/Notification.js";
import RequestComment from "../src/models/RequestComment.js";
import Supplier from "../src/models/Supplier.js";
import User from "../src/models/User.js";
import { invoiceFieldsFromLines } from "../src/services/invoicePdfService.js";
import { previewInvoiceForRequest } from "../src/services/invoicePreviewService.js";
import { invoiceXmlLines } from "../src/services/xmlValidationService.js";
import { liveListenerCount, publishToUser, streamUserEvents, subscribeUser } from "../src/services/liveEventsService.js";
import { approvalSummaryLine, composeNotificationEmail } from "../src/services/notificationEmailService.js";
import { notifyUser } from "../src/services/notificationService.js";
import { expectedPaymentDate, personalDashboard } from "../src/services/personalDashboardService.js";
import { remindRenditionDeadlines, renditionReminderStage } from "../src/services/renditionReminderService.js";
import { addRequestComment, listRequestComments, mentionableUsers } from "../src/services/requestCommentService.js";
import { tempUploadDir } from "../src/services/storageService.js";
import { invoiceXml } from "./fiscalFixtures.js";

const UMA_RUC = "20550807123";

test("a factura read for a new request never takes UMA's own RUC as the supplier's", () => {
  const lines = ["UNIVERSIDAD MARIA AUXILIADORA S.A.C. RUC 20550807123", "SOFTWARE ANDINO S.A.C. RUC 20512345678", "FACTURA ELECTRONICA F001-12", "FECHA DE EMISION 2026-10-10", "MONEDA: SOLES", "OP. GRAVADA 100.00", "IGV 18.00", "IMPORTE TOTAL 118.00"];
  assert.equal(invoiceFieldsFromLines(lines).ruc, "", "ambiguous unlabelled parties are never guessed");
  assert.equal(invoiceFieldsFromLines(lines, { buyerRuc: UMA_RUC }).ruc, "20512345678");
});

test("payments are expected on their scheduled day, else on the next payment cycle", () => {
  const now = new Date("2026-10-14T15:00:00Z");
  assert.deepEqual(expectedPaymentDate({ scheduledFor: new Date("2026-10-30T00:00:00Z") }, now), { date: "2026-10-30", estimated: false });
  assert.deepEqual(expectedPaymentDate({}, now), { date: "2026-10-15", estimated: true });
  assert.deepEqual(expectedPaymentDate({}, new Date("2026-10-16T15:00:00Z")), { date: "2026-10-30", estimated: true });
  // A scheduled day that passed is never promised again (seen on 20 Oct for a payment of 15 Oct).
  const later = new Date("2026-10-20T15:00:00Z");
  const missed = new Date("2026-10-15T00:00:00Z");
  assert.deepEqual(expectedPaymentDate({ status: "SCHEDULED", scheduledFor: missed }, later), { date: "2026-10-30", estimated: true }, "not paid on its day: the next run");
  assert.deepEqual(expectedPaymentDate({ status: "PARTIALLY_PAID", scheduledFor: missed }, later), { date: "2026-10-30", estimated: true }, "the rest of a partial payment");
  assert.equal(expectedPaymentDate({ status: "PAYMENT_FILE_CREATED", scheduledFor: missed }, later), null, "in the bank file of 15 Oct: no new date until Treasury confirms it");
  assert.deepEqual(expectedPaymentDate({ status: "SCHEDULED", scheduledFor: new Date("2026-10-20T00:00:00Z") }, later), { date: "2026-10-20", estimated: false }, "today is not past");
  // Unscheduled: the run Treasury's queue puts it in.
  assert.deepEqual(expectedPaymentDate({ dueDate: new Date("2026-11-20T05:00:00Z") }, later), { date: "2026-11-30", estimated: true }, "credit terms: not before the due date");
  assert.deepEqual(expectedPaymentDate({ dueDate: new Date("2026-10-01T05:00:00Z") }, later), { date: "2026-10-30", estimated: true }, "overdue: the next run");
  assert.deepEqual(expectedPaymentDate({ flowType: "C", voucher: { voucherType: "ANTICIPO" } }, later), { date: "2026-10-20", estimated: true }, "an advance is paid the same day");
});

test("rendition reminders fire at 3 working days, at 1 and once overdue", () => {
  // Due Thursday 29 Oct 2026 at the end of the Lima day.
  const due = new Date("2026-10-30T04:59:59.999Z");
  assert.equal(renditionReminderStage(due, new Date("2026-10-22T15:00:00Z")), null, "5 working days left: no reminder yet");
  assert.deepEqual(renditionReminderStage(due, new Date("2026-10-26T15:00:00Z")), { stage: "3", daysLeft: 3 });
  assert.deepEqual(renditionReminderStage(due, new Date("2026-10-28T15:00:00Z")), { stage: "1", daysLeft: 1 });
  assert.deepEqual(renditionReminderStage(due, new Date("2026-10-29T15:00:00Z")), { stage: "1", daysLeft: 0 });
  assert.deepEqual(renditionReminderStage(due, new Date("2026-10-30T15:00:00Z")), { stage: "overdue", daysLeft: 0 });
});

test("approval emails carry an 'Aprobar ahora' link to the one-page approval, with the request summary", () => {
  const id = "0123456789abcdef01234567";
  const email = composeNotificationEmail({
    user: { name: "ANA QUISPE" },
    appUrl: "https://uma.test",
    summaries: { [id]: approvalSummaryLine({ totalAmount: 1250, currency: "PEN", requester: { name: "TORRES DIAZ ANA" }, supplierSnapshot: { legalName: "Software Andino S.A.C." }, title: "Licencias" }) },
    notifications: [
      { type: "APPROVAL_PENDING", title: "Approval pending", message: "SOL-1 is waiting", path: `/approvals?request=${id}`, createdAt: new Date() },
      { type: "TREASURY_PAYMENT", title: "Paid", message: "SOL-2 paid", path: "/treasury?record=1", createdAt: new Date() }
    ]
  });
  assert.match(email.html, new RegExp(`https://uma\\.test/approvals/${id}"`));
  assert.equal((email.html.match(/Aprobar ahora/g) || []).length, 1, "only the approval gets the button");
  assert.match(email.text, new RegExp(`Aprobar ahora: https://uma\\.test/approvals/${id}`));
  assert.match(email.text, /1,250\.00 · Torres Diaz Ana · Software Andino S\.A\.C\. · Licencias/);
  const odd = composeNotificationEmail({ user: { name: "Ana" }, appUrl: "https://uma.test", notifications: [{ type: "APPROVAL_PENDING", title: "x", message: "y", path: "/approvals?request=abc&next=//evil" }] });
  assert.doesNotMatch(odd.html, /Aprobar ahora/, "only a plain request link gets the approve button");
});

test("server-sent events stream a person's notifications and stop when the tab closes", () => {
  const userId = new mongoose.Types.ObjectId();
  const written = [];
  let onClose;
  const res = { status() { return this; }, set() { return this; }, flushHeaders() {}, write(chunk) { written.push(chunk); return true; } };
  const req = { user: { _id: userId }, on(event, callback) { if (event === "close") onClose = callback; } };
  streamUserEvents(req, res);
  assert.equal(liveListenerCount(userId), 1);
  publishToUser(userId, { type: "notification", notification: { _id: "n1", title: "Request approved" } });
  publishToUser(new mongoose.Types.ObjectId(), { type: "notification", notification: { _id: "other" } });
  const stream = written.join("");
  assert.match(stream, /^retry: 15000/);
  assert.match(stream, /event: notification\ndata: \{"type":"notification","notification":\{"_id":"n1"/);
  assert.doesNotMatch(stream, /"other"/, "another person's events never reach this stream");
  onClose();
  assert.equal(liveListenerCount(userId), 0);
});

test("lively platform services against the database", { timeout: 60000 }, async (t) => {
  const dbName = `erp_lively_platform_test_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${dbName}`, { serverSelectionTimeoutMS: 5000 });
  const files = [];
  try {
    await Promise.all([Notification.init(), RequestComment.init()]);
    const makeUser = (role, name, extra = {}) => User.create({ name, email: `${name.replace(/\s+/g, ".").toLowerCase()}@test.local`, passwordHash: "unused", role, area: "Salud", active: true, ...extra });
    const requester = await makeUser("Solicitor", "Rosa Requester");
    const approver = await makeUser("AreaDirector", "Dario Director");
    const accountant = await makeUser("Accounting", "Ana Accounting");
    const outsider = await makeUser("Solicitor", "Oscar Outsider");
    const req = { headers: {}, ip: "127.0.0.1" };
    const insertRequest = async (doc) => (await FinancialRequest.collection.insertOne({ requestNumber: `SOL-T-${Math.random().toString(36).slice(2, 8)}`, title: "Test", flowType: "B", requestType: "OPEX", currency: "PEN", totalAmount: 118, createdAt: new Date(), updatedAt: new Date(), ...doc })).insertedId;

    await t.test("comments: only people who can view the request read, write and get mentioned", async () => {
      const requestId = await insertRequest({ status: "PENDIENTE_APROBACION", requester: requester._id, solicitor: requester._id, approvalRouteSnapshot: [{ sequence: 1, status: "PENDING", approverUser: approver._id, source: "MANAGER_CHAIN", startedAt: new Date() }] });
      await assert.rejects(() => addRequestComment(requestId, outsider, { body: "Hello" }, req), (error) => error.statusCode === 403 || error.status === 403);
      await assert.rejects(() => addRequestComment(requestId, requester, { body: "   " }, req), /Write a comment first/);
      const mentionable = await mentionableUsers(requestId, requester, "a");
      assert.ok(mentionable.some((user) => String(user._id) === String(accountant._id)), "Accounting can view every request, so it can be mentioned");
      assert.ok(!mentionable.some((user) => String(user._id) === String(outsider._id)), "someone who cannot view the request is never suggested");
      const comment = await addRequestComment(requestId, requester, { body: "@Ana Accounting is the invoice date fine? @Oscar Outsider", mentions: [accountant._id, outsider._id] }, req);
      assert.deepEqual(comment.mentions.map((user) => user.name), ["Ana Accounting"], "a mention of someone who cannot view the request is dropped");
      const mention = await Notification.findOne({ user: accountant._id, type: "COMMENT_MENTION" });
      assert.equal(mention.path, `/requests/${requestId}#comments`);
      assert.equal(mention.messageKey, "{author} mentioned you on {requestNumber}: {excerpt}");
      assert.ok(await Notification.findOne({ user: approver._id, type: "REQUEST_COMMENT" }), "the pending approver hears about the question");
      assert.equal(await Notification.countDocuments({ user: outsider._id }), 0);
      assert.equal(await Notification.countDocuments({ user: requester._id }), 0, "the author is not notified of their own comment");
      const listed = await listRequestComments(requestId, approver);
      assert.equal(listed.length, 1);
      assert.equal(listed[0].author.name, "Rosa Requester");
      await assert.rejects(() => listRequestComments(requestId, outsider), (error) => error.statusCode === 403 || error.status === 403);
    });

    await t.test("personal dashboard: own requests, payments and decisions", async () => {
      const now = new Date("2026-10-14T15:00:00Z");
      const paidRequest = await insertRequest({ status: "PAGADO", requester: requester._id, flowType: "C", requestType: "ENTREGA_RENDIR", createdAt: new Date("2026-03-01T15:00:00Z") });
      const openRequest = await insertRequest({ status: "CONTABILIZADO", requester: requester._id, createdAt: new Date("2026-10-01T15:00:00Z") });
      await insertRequest({ status: "BORRADOR", requester: requester._id });
      await insertRequest({ status: "CERRADO", requester: requester._id, createdAt: new Date("2025-06-01T15:00:00Z"), approvalRouteSnapshot: [{ sequence: 1, status: "APPROVED", approverUser: approver._id, completedBy: approver._id, startedAt: new Date("2026-10-02T13:00:00Z"), completedAt: new Date("2026-10-02T16:00:00Z") }] });
      await AccountsPayable.collection.insertMany([
        { request: paidRequest, status: "PAID", outstandingAmount: 0, originalAmount: 600, penEquivalent: 600, currency: "PEN", updatedAt: new Date("2026-04-01T15:00:00Z") },
        { request: openRequest, status: "SCHEDULED", outstandingAmount: 118, originalAmount: 118, penEquivalent: 118, currency: "PEN", scheduledFor: new Date("2026-10-30T00:00:00Z"), updatedAt: now }
      ]);
      const mine = await personalDashboard(requester, { now });
      // The comment test's request (PENDIENTE_APROBACION) is the requester's too.
      assert.equal(mine.requests.inProgress, 3, "pending, accounted and paid requests are still moving; drafts and closed ones are not");
      assert.equal(mine.requests.drafts, 1);
      assert.equal(mine.payments.paidThisYearPen, 600);
      assert.equal(mine.payments.paidToMeThisYearPen, 600, "the Track C advance was paid to the requester");
      assert.deepEqual({ ...mine.payments.next, requestId: String(mine.payments.next.requestId) }, { requestId: String(openRequest), requestNumber: mine.payments.next.requestNumber, amount: 118, currency: "PEN", date: "2026-10-30", estimated: false });
      const director = await personalDashboard(approver, { now });
      assert.deepEqual(director.approvals, { decidedThisMonth: 1, averageHours: 3 });

      // Seen on 20 Oct: the payment scheduled for 15 Oct was not paid, so 15 Oct is not "next".
      const late = await makeUser("Solicitor", "Luis Late");
      const lateRequest = await insertRequest({ status: "PROGRAMADO", requester: late._id });
      const sentRequest = await insertRequest({ status: "TXT_GENERADO", requester: late._id });
      await AccountsPayable.collection.insertMany([
        { request: lateRequest, status: "SCHEDULED", outstandingAmount: 236, originalAmount: 236, penEquivalent: 236, currency: "PEN", scheduledFor: new Date("2026-10-15T00:00:00Z"), updatedAt: now },
        { request: sentRequest, status: "PAYMENT_FILE_CREATED", outstandingAmount: 59, originalAmount: 59, penEquivalent: 59, currency: "PEN", scheduledFor: new Date("2026-10-15T00:00:00Z"), updatedAt: now }
      ]);
      const after = await personalDashboard(late, { now: new Date("2026-10-20T15:00:00Z") });
      assert.deepEqual({ request: String(after.payments.next.requestId), date: after.payments.next.date, estimated: after.payments.next.estimated }, { request: String(lateRequest), date: "2026-10-30", estimated: true });
      assert.equal(after.payments.upcomingCount, 1, "the one already in a bank file waits for Treasury's confirmation, with no date");
    });

    await t.test("rendition reminders are sent once per stage", async () => {
      const due = new Date("2026-10-30T04:59:59.999Z");
      const requestId = await insertRequest({ status: "PAGADO", requester: requester._id, flowType: "C", requestType: "ENTREGA_RENDIR", rendition: { status: "PENDING", dueAt: due } });
      const now = new Date("2026-10-26T15:00:00Z");
      await remindRenditionDeadlines({ now });
      await remindRenditionDeadlines({ now });
      const reminders = await Notification.find({ user: requester._id, type: "RENDITION_REMINDER", entityId: requestId });
      assert.equal(reminders.length, 1, "running the scan again does not repeat the reminder");
      assert.equal(reminders[0].messageKey, "{requestNumber}: {days} working days left to submit your rendition (deadline {date}).");
      assert.equal(reminders[0].params.date, "29/10/2026");
      await remindRenditionDeadlines({ now: new Date("2026-10-31T15:00:00Z") });
      assert.equal(await Notification.countDocuments({ user: requester._id, type: "RENDITION_OVERDUE", entityId: requestId }), 1);
    });

    await t.test("notifications reach open tabs through the live event bus", async () => {
      const received = [];
      const unsubscribe = subscribeUser(accountant._id, (event) => received.push(event));
      await notifyUser({ userId: accountant._id, eventKey: "live:test", type: "TEST", title: "Live", message: "Now", path: "/requests" });
      await notifyUser({ userId: accountant._id, eventKey: "live:test", type: "TEST", title: "Live", message: "Reworded while unread", path: "/requests" });
      unsubscribe();
      assert.equal(received.length, 1, "a reworded alert that is still unread is not pushed twice");
      assert.equal(received[0].notification.title, "Live");
    });

    await t.test("a dropped factura is read and its registered supplier found", async () => {
      await Supplier.collection.insertOne({ rucDni: "20512345678", normalizedIdentifier: "20512345678", legalName: "Software Andino S.A.C.", homologationStatus: "HOMOLOGATED", active: true });
      await fs.mkdir(tempUploadDir, { recursive: true });
      const filePath = path.join(tempUploadDir, `preview-${process.pid}-${Date.now()}.xml`);
      files.push(filePath);
      await fs.writeFile(filePath, invoiceXml({ ruc: "20512345678", series: "F001", number: "00000123", issueDate: "2026-10-10", currency: "PEN", netAmount: 373.73, igvAmount: 67.27, totalAmount: 441 }));
      const preview = await previewInvoiceForRequest(filePath, { env: { SIRE_TAXPAYER_RUC: UMA_RUC } });
      assert.equal(preview.source, "XML");
      assert.equal(preview.invoice.totalAmount, 441);
      assert.equal(preview.supplier.legalName, "Software Andino S.A.C.");
      assert.deepEqual(preview.invoice.lines, [], "a factura without item lines gives none");
    });

    await t.test("a factura's item lines are read to fill the request line by line", () => {
      const xml = `<Invoice><ID>F001-9</ID><InvoiceLine><ID>1</ID><InvoicedQuantity unitCode="NIU">2</InvoicedQuantity><LineExtensionAmount currencyID="PEN">200.00</LineExtensionAmount><TaxTotal><TaxAmount currencyID="PEN">36.00</TaxAmount></TaxTotal><Item><Description>Toner HP 85A</Description></Item><Price><PriceAmount currencyID="PEN">100.00</PriceAmount></Price></InvoiceLine><InvoiceLine><ID>2</ID><InvoicedQuantity unitCode="ZZ">1</InvoicedQuantity><LineExtensionAmount currencyID="PEN">50</LineExtensionAmount><TaxTotal><TaxAmount currencyID="PEN">9</TaxAmount></TaxTotal><Item><Description>Delivery</Description></Item></InvoiceLine></Invoice>`;
      assert.deepEqual(invoiceXmlLines(xml), [
        { description: "Toner HP 85A", quantity: 2, unitCode: "NIU", netAmount: 200, igvAmount: 36, totalAmount: 236 },
        { description: "Delivery", quantity: 1, unitCode: "ZZ", netAmount: 50, igvAmount: 9, totalAmount: 59 }
      ]);
      assert.deepEqual(invoiceXmlLines("<!DOCTYPE x><Invoice/>"), []);
    });
  } finally {
    await Promise.all(files.map((file) => fs.rm(file, { force: true })));
    if (mongoose.connection.name === dbName) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
