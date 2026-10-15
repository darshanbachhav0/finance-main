import assert from "node:assert/strict";
import fs from "node:fs";
import { invoiceMatchRows, lineFromInvoice } from "../src/utils/invoiceAutofill.js";
import { greetingName, greetingTemplate, pendingTaskCount } from "../src/utils/greeting.js";
import { expectedPayment, journeyMilestones, journeySummary, renditionCountdown } from "../src/utils/requestJourney.js";
import { parseServerEvent } from "../src/utils/serverEvents.js";
import { recommendTrack } from "../src/utils/trackRecommendation.js";
import { paymentDayState } from "../src/utils/paymentCycle.js";

const source = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const states = (steps) => Object.fromEntries(steps.map((step) => [step.key, step.state]));

// 1. A dropped factura becomes one line that reproduces it to the cent.
const taxed = lineFromInvoice({ netAmount: 373.73, igvAmount: 67.27, totalAmount: 441 }, { costCenter: "cc1", description: "Internet" });
assert.deepEqual([taxed.priceIncludesIGV, taxed.unitPrice, taxed.netAmount, taxed.igvAmount, taxed.totalAmount, taxed.legacyAmounts], [true, "441", 373.73, 67.27, 441, false]);
const exonerated = lineFromInvoice({ netAmount: 500, igvAmount: 0, totalAmount: 500 });
assert.deepEqual([exonerated.legacyAmounts, exonerated.netAmount, exonerated.igvAmount, exonerated.totalAmount], [true, 500, 0, 500], "an exonerated factura keeps its own amounts");
const rows = invoiceMatchRows({ invoice: { currency: "PEN", ruc: "20601694680", netAmount: 373.73, igvAmount: 67.27, totalAmount: 441 }, form: { currency: "PEN" }, totals: { net: 373.73, igv: 67.27, total: 441.01 }, supplier: { rucDni: "20601694680" } });
assert.deepEqual(rows.map((row) => [row.key, row.ok]), [["currency", true], ["supplier", true], ["netAmount", true], ["igvAmount", true], ["totalAmount", false]]);
assert.equal(rows.at(-1).difference, 0.01, "one céntimo is a difference, as on the server");

// 2. The request journey shows each track's own milestones and where it stands.
assert.deepEqual(states(journeyMilestones({ flowType: "B", status: "CONTABILIZADO" })), { submitted: "done", approved: "done", paid: "current", closed: "upcoming" });
assert.deepEqual(states(journeyMilestones({ flowType: "A1", status: "COMPROMISO_PRESUPUESTAL" })), { submitted: "done", approved: "done", order: "current", invoice: "upcoming", paid: "upcoming", closed: "upcoming" });
assert.deepEqual(Object.keys(states(journeyMilestones({ flowType: "A1", status: "COMPROMISO_PRESUPUESTAL" }, { orderApplies: false }))), ["submitted", "approved", "invoice", "paid", "closed"], "travel and research have no purchase order step");
assert.deepEqual(states(journeyMilestones({ flowType: "C", requestType: "ENTREGA_RENDIR", status: "PAGADO", rendition: { status: "PENDING" } })), { submitted: "done", approved: "done", advance: "done", rendition: "current", closed: "upcoming" });
assert.equal(states(journeyMilestones({ flowType: "A1", status: "OBSERVADO_MONTO_EXCEDIDO", purchaseOrder: { poNumber: "OC-1" } })).invoice, "attention");
assert.ok(Object.values(states(journeyMilestones({ flowType: "B", status: "RECHAZADO" }))).includes("stopped"));
const now = new Date("2026-10-14T15:00:00Z");
assert.deepEqual(expectedPayment({ status: "PROGRAMADO" }, [{ status: "SCHEDULED", scheduledFor: "2026-10-30T00:00:00.000Z" }], now), { state: "scheduled", date: "2026-10-30" });
assert.deepEqual(expectedPayment({ status: "CONTABILIZADO" }, [{ status: "OPEN" }], now), { state: "estimated", date: "2026-10-15" });
assert.equal(expectedPayment({ status: "PENDIENTE_APROBACION" }, [], now), null, "no date is promised before there is a payable");
assert.deepEqual(expectedPayment({ status: "PAGADO", payment: { paidAt: "2026-10-15T17:00:00Z" } }, [], now), { state: "paid", date: "2026-10-15" });
const waiting = journeySummary({ flowType: "B", status: "PENDIENTE_APROBACION", requester: { _id: "r1", name: "Rosa" } }, { activeStep: { approverSnapshot: { name: "Dario Director" }, startedAt: "2026-10-13T15:00:00Z" }, viewerId: "r1" });
assert.deepEqual([waiting.text, waiting.params, waiting.holder, waiting.since], ["Waiting for {name}'s approval.", { name: "Dario Director" }, { name: "Dario Director" }, "2026-10-13T15:00:00Z"]);
assert.equal(journeySummary({ flowType: "C", requestType: "ENTREGA_RENDIR", status: "PAGADO", requester: "r1", rendition: { status: "PENDING" } }, { viewerId: "r1" }).text, "Advance paid. Submit your rendition before the deadline.");
// Paid on Thursday 15 Oct, due 29 Oct: on Monday 26 Oct three working days remain.
const countdown = renditionCountdown({ dueAt: "2026-10-30T04:59:59.999Z" }, { now: new Date("2026-10-26T15:00:00Z"), openedAt: "2026-10-15T17:00:00Z" });
assert.equal(countdown.daysLeft, 3);
assert.ok(countdown.progress > 0.6 && countdown.progress < 0.8);
assert.equal(renditionCountdown({ dueAt: "2026-10-30T04:59:59.999Z" }, { now: new Date("2026-11-03T15:00:00Z") }).overdue, true);

// 3. Greeting, payment day, track recommendation, live event parsing.
// Names are stored first surname, second surname, first name, second name; greetings use
// their first name.
for (const [stored, greeted] of [
  ["QUISPE MAMANI MARÍA ELENA", "María"],
  ["QUISPE MAMANI, MARÍA ELENA", "María"],
  ["TORRES DIAZ ANA", "Ana"],
  ["DE LA CRUZ PEREZ JUAN CARLOS", "Juan"],
  ["QUISPE MAMANI MARÍA DE LOS ÁNGELES", "María"],
  ["TORRES ANA", "Ana"],
  ["  quispe   mamani   maría  ", "María"],
  ["O'BRIEN SMITH JOHN", "John"],
  ["Contabilidad UMA (Demo)", "Contabilidad"],
  ["", ""]
]) assert.equal(greetingName(stored), greeted, stored);
assert.equal(greetingTemplate(new Date("2026-10-14T13:00:00Z")), "Good morning, {name}", "08:00 in Lima");
assert.equal(greetingTemplate(new Date("2026-10-14T20:00:00Z")), "Good afternoon, {name}", "15:00 in Lima");
assert.equal(greetingTemplate(new Date("2026-10-15T02:00:00Z")), "Good evening, {name}", "21:00 in Lima the day before");
assert.equal(pendingTaskCount([{ count: 2 }, { count: 0 }, { count: 3 }]), 5);
assert.equal(paymentDayState(new Date("2026-10-15T15:00:00Z")), "today");
assert.equal(paymentDayState(new Date("2026-10-29T15:00:00Z")), "tomorrow");
assert.equal(paymentDayState(new Date("2026-10-20T15:00:00Z")), null);
assert.equal(recommendTrack({ payee: "employee", spent: "no" }), "C_ADVANCE");
assert.equal(recommendTrack({ payee: "employee", spent: "yes" }), "C_UNDOCUMENTED");
assert.equal(recommendTrack({ payee: "supplier", hasInvoice: "yes", needsOrder: "no" }), "B");
assert.equal(recommendTrack({ payee: "supplier", hasInvoice: "yes", needsOrder: "yes" }), "A1");
assert.equal(recommendTrack({ payee: "supplier", hasInvoice: "no" }), "A1");
assert.equal(recommendTrack({ payee: "supplier", hasInvoice: "yes" }), null, "no answer yet, no recommendation");
assert.deepEqual(parseServerEvent('event: notification\ndata: {"type":"notification","notification":{"_id":"1"}}'), { event: "notification", data: { type: "notification", notification: { _id: "1" } } });
assert.equal(parseServerEvent(": ping"), null);

// 4. The pieces are wired where people meet them.
const layout = source("../src/layouts/AppLayout.jsx");
for (const piece of ["<PaymentDayBanner", "<GuidedTour", "<WhatsNewPanel", "useLiveEvents(", "data-tour=\"navigation\"", "data-tour=\"notifications\"", "import \"../styles/lively.css\";"]) assert.ok(layout.includes(piece), `AppLayout: ${piece}`);
const detail = source("../src/pages/RequestDetail.jsx");
for (const piece of ["<RequestJourney", "<RenditionCountdown", "<RequestComments", "RECORD_CHANGED_EVENT", "/requests/new?from="]) assert.ok(detail.includes(piece), `RequestDetail: ${piece}`);
const create = source("../src/pages/RequestCreate.jsx");
for (const piece of ["<InvoiceDropZone", "<InvoiceMatchStrip", "<TrackPicker", "/requests/invoice-preview", "copiedRequestForm"]) assert.ok(create.includes(piece), `RequestCreate: ${piece}`);
assert.ok(source("../src/pages/ApprovalInbox.jsx").includes("rowSwipe={rowSwipe}"), "approvals can be swiped on phones");
assert.ok(source("../src/pages/Dashboard.jsx").includes("<PersonalStats"), "the dashboard greets with the person's own numbers");

console.log("PASS lively platform: invoice autofill and match, request journey, countdown, greeting, track picker, live events, wiring");

// 5. The tour card is always fully on screen: below, above, beside a tall element, or at the bottom.
const { cardPosition } = await import("../src/utils/tour.js");
const screen = { width: 1280, height: 800 };
assert.deepEqual(cardPosition({ top: 200, left: 300, width: 900, height: 100 }, 270, screen), { top: 312, left: 300 }, "below");
assert.deepEqual(cardPosition({ top: 600, left: 300, width: 400, height: 150 }, 270, screen), { top: 318, left: 300 }, "above");
assert.deepEqual(cardPosition({ top: 68, left: -8, width: 287, height: 690 }, 270, screen), { top: 68, left: 291 }, "beside the tall menu");
assert.deepEqual(cardPosition({ top: 10, left: 0, width: 1280, height: 780 }, 270, screen), { top: 514, left: 470 }, "bottom of the screen");
console.log("PASS tour card placement");
