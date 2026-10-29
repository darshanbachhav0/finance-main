import { businessDaysBetween, limaDateKey, nextPaymentCycleDate } from "../../../shared/businessCalendar.mjs";
import { canonicalRequestStatus } from "../../../shared/workflowStatus.mjs";
import { requesterReplacesInvoice, waitsForBankAccount } from "./plainStatus.js";

// "Where is my request?": the milestones of the request's own track, who has it now and when the
// payment is expected - in plain words, from the data the request page already loads.

const RANK = { BORRADOR: 0, PENDIENTE_APROBACION: 1, APROBADO: 2, COMPROMISO_PRESUPUESTAL: 3, CONTABILIZADO: 4, PROGRAMADO: 5, TXT_GENERADO: 6, PAGADO: 7, CONCILIADO: 8, CERRADO: 9 };
// Side statuses sit where the request stopped: returned ones go back to the requester, invoice
// problems happen after budget commitment, a bounce before the payment is done.
const SIDE_RANK = { OBSERVADO: 0, DEVUELTO: 0, OBSERVADO_PRESUPUESTO: 2, OBSERVADO_SUNAT: 3, OBSERVADO_MONTO_EXCEDIDO: 3, OBSERVADO_CARGA_MASIVA: 3, PAGO_REBOTADO: 6 };
const STOPPED = ["RECHAZADO", "ANULADO"];
const UNPAID_PAYABLE = ["OPEN", "SCHEDULED", "PAYMENT_FILE_CREATED", "PARTIALLY_PAID", "PAYMENT_BOUNCED"];

export function journeyRank(status) {
  const canonical = canonicalRequestStatus(status);
  return RANK[canonical] ?? SIDE_RANK[canonical] ?? 0;
}

const isAdvance = (request) => request.flowType === "C" && request.requestType !== "REEMBOLSO_SIN_SUSTENTO";
const renditionSettled = (request) => request.rendition?.status === "VALIDATED" || (request.rendition?.status === "REJECTED" && ["RECOVERED", "NOT_APPLICABLE"].includes(request.rendition?.recovery?.status));

export function journeyMilestones(request, { orderApplies = true } = {}) {
  const rank = journeyRank(request.status);
  const steps = [{ key: "submitted", label: "Submitted", done: rank >= 1 }, { key: "approved", label: "Approved", done: rank >= 2 }];
  if (request.flowType === "D") {
    steps.push({ key: "transferred", label: "Transferred", done: rank >= 7 }, { key: "reconciled", label: "Reconciled", done: rank >= 8 });
  } else if (request.flowType === "C") {
    if (isAdvance(request)) steps.push({ key: "advance", label: "Advance paid", done: rank >= 7 }, { key: "rendition", label: "Rendition validated", done: renditionSettled(request) });
    else steps.push({ key: "declaration", label: "Declaration approved", done: rank >= 4 }, { key: "paid", label: "Paid", done: rank >= 7 });
  } else if (request.flowType === "B") {
    steps.push({ key: "budget", label: "Budget committed", done: rank >= 3 }, { key: "invoice", label: "Invoice booked", done: rank >= 4 });
    steps.push({ key: "paid", label: "Paid", done: rank >= 7 });
  } else {
    if (orderApplies) steps.push({ key: "order", label: "Purchase order", done: Boolean(request.purchaseOrder) || rank >= 4 });
    steps.push({ key: "invoice", label: "Invoice booked", done: rank >= 4 }, { key: "paid", label: "Paid", done: rank >= 7 });
  }
  steps.push({ key: "closed", label: "Closed", done: canonicalRequestStatus(request.status) === "CERRADO" });
  const stopped = STOPPED.includes(canonicalRequestStatus(request.status));
  const current = stopped ? -1 : steps.findIndex((step) => !step.done);
  return steps.map((step, index) => ({ ...step, state: step.done ? "done" : index === current ? (SIDE_RANK[canonicalRequestStatus(request.status)] !== undefined ? "attention" : "current") : stopped ? "stopped" : "upcoming" }));
}

// When the money is expected: the scheduled date of the first unpaid payable, else the next
// payment cycle (15th / last working day) once a payable exists, else nothing yet. A paid request shows when.
export function expectedPayment(request, payables = [], now = new Date()) {
  // A transfer between UMA's own accounts pays nobody: its execution shows in its milestones.
  if (request.flowType === "D") return null;
  const rank = journeyRank(request.status);
  if (rank >= 7) {
    const paidAt = request.payment?.paidAt || request.payment?.confirmations?.at?.(-1)?.paidAt;
    return paidAt ? { state: "paid", date: limaDateKey(paidAt) } : { state: "paid" };
  }
  const unpaid = payables.filter((payable) => UNPAID_PAYABLE.includes(payable.status));
  const scheduled = unpaid.filter((payable) => payable.scheduledFor).map((payable) => new Date(payable.scheduledFor).toISOString().slice(0, 10)).sort()[0];
  if (scheduled) return { state: "scheduled", date: scheduled };
  // An advance is paid the same working day: on its pay date, or today once that has come.
  if (isAdvance(request) && unpaid.length) {
    const today = limaDateKey(now);
    const due = unpaid.map((payable) => payable.dueDate && limaDateKey(payable.dueDate)).filter(Boolean).sort()[0] || today;
    return { state: "estimated", date: due > today ? due : today };
  }
  if (unpaid.length || rank >= 4) return { state: "estimated", date: nextPaymentCycleDate(now) };
  return null;
}

// The sentence at the top of the request and who holds it now. Returns English templates with
// {placeholders}; the component translates and fills them.
export function journeySummary(request, { activeStep, orderApplies = true, payment, viewerId } = {}) {
  const status = canonicalRequestStatus(request.status);
  const mine = viewerId && String(request.requester?._id || request.requester) === String(viewerId);
  const lastEvent = [...(request.approvalHistory || [])].pop();
  const since = lastEvent?.createdAt || request.updatedAt;
  const person = (name) => (name ? { name } : null);
  const requester = person(request.requester?.name || request.solicitor?.name);
  const team = (name) => ({ name, team: true });

  if (status === "BORRADOR") return { text: mine ? "Draft: only you can see it. Submit it when it is ready." : "Draft, not submitted yet.", holder: requester, since };
  // A step decided by role (Head of Treasury, GAF, General Management) waits on that whole team.
  const tierTeam = { TREASURY_HEAD: "Treasury", GAF: "GAF", GENERAL_MANAGEMENT: "Management" }[activeStep?.tier || (!activeStep?.approverSnapshot?.name && activeStep?.approvalLevel)];
  const tierText = { TREASURY_HEAD: "Waiting for the Head of Treasury's approval.", GAF: "Waiting for the approval of the Financial Administration Management (GAF).", GENERAL_MANAGEMENT: "Waiting for General Management's approval." };
  if (status === "PENDIENTE_APROBACION" && tierTeam) return { text: tierText[activeStep.tier || activeStep.approvalLevel], holder: team(tierTeam), since: activeStep?.startedAt || since };
  if (status === "PENDIENTE_APROBACION") return { text: "Waiting for {name}'s approval.", params: { name: activeStep?.approverSnapshot?.name || "-" }, holder: person(activeStep?.approverSnapshot?.name), since: activeStep?.startedAt || since };
  if (waitsForBankAccount(request)) return request.observation.resolver === "ACCOUNTING"
    ? { text: "A verified employee bank account is required before Accounting can provision the advance.", holder: team("Accounting"), since, tone: "attention" }
    : { text: mine ? "Approved. Register your bank account so the advance can be paid." : "Approved. Waiting for the requester's verified bank account.", holder: requester, since, tone: "attention" };
  if (status === "APROBADO" && request.flowType === "D") return { text: "Approved. Treasury makes the transfer at the bank and records its operation number.", holder: team("Treasury"), since };
  if (status === "PAGADO" && request.flowType === "D") return { text: "Transferred. Treasury reconciles it with the bank statement.", holder: team("Treasury"), since };
  if (["OBSERVADO", "DEVUELTO"].includes(status) && request.flowType === "D") return { text: mine ? "Returned to you for corrections. Correct it in Transfers and send it again." : "Returned to Treasury for corrections.", holder: requester, since, tone: "attention" };
  if (status === "APROBADO") return { text: "Approvals completed. Financial Control must finish the budget commitment before Accounting or Treasury can proceed.", holder: team("Financial Control"), since, tone: "attention" };
  if (["OBSERVADO", "DEVUELTO"].includes(status)) return { text: mine ? "Returned to you for corrections. Fix it and submit it again." : "Returned to the requester for corrections.", holder: requester, since, tone: "attention" };
  if (status === "OBSERVADO_PRESUPUESTO") return { text: "Waiting for a budget decision.", holder: team("Treasury"), since, tone: "attention" };
  // An invoice from another supplier, or one already registered, waits for the requester; only a
  // SUNAT check that could not be completed waits for Accounting.
  if (requesterReplacesInvoice(request) && request.observation.code === "RUC_MISMATCH") return { text: mine ? "Waiting for the right invoice: the one uploaded is from another supplier." : "Waiting for the requester's right invoice: the one uploaded is from another supplier.", holder: requester, since, tone: "attention" };
  if (requesterReplacesInvoice(request)) return { text: mine ? "Waiting for the right invoice: the one uploaded is already registered." : "Waiting for the requester's right invoice: the one uploaded is already registered.", holder: requester, since, tone: "attention" };
  if (status === "OBSERVADO_SUNAT") return { text: "The invoice needs attention: SUNAT could not verify it yet.", holder: team("Accounting"), since, tone: "attention" };
  if (status === "OBSERVADO_MONTO_EXCEDIDO") return { text: "The invoice is above what the purchase order allows.", holder: requester, since, tone: "attention" };
  if (status === "OBSERVADO_CARGA_MASIVA") return { text: "A batch of invoices needs attention.", holder: team("Accounting"), since, tone: "attention" };
  if (status === "PAGO_REBOTADO") return { text: "The payment bounced. Treasury will send it again.", holder: team("Treasury"), since, tone: "attention" };
  if (status === "RECHAZADO") return { text: "Rejected. No further steps.", holder: null, since, tone: "stopped" };
  if (status === "ANULADO") return { text: "Annulled. No further steps.", holder: null, since, tone: "stopped" };
  if (status === "COMPROMISO_PRESUPUESTAL") {
    if (request.flowType === "C" && request.requestType === "ENTREGA_RENDIR") return { text: "Advance approved and budget committed. Accounting must provision it to Account 14 before Treasury can pay.", holder: team("Accounting"), since };
    if (request.flowType === "C" && request.requestType === "REEMBOLSO_SIN_SUSTENTO") return { text: "Budget committed. Complete the required expense declaration and Finance review before payment.", holder: requester, since };
    if (request.flowType === "A1" && orderApplies && !request.purchaseOrder) return { text: "Approved and budgeted. Procurement issues the purchase order next.", holder: team("Procurement"), since };
    if (request.flowType === "A1" && request.purchaseOrder) return { text: "Purchase order {order} issued. Next: register the supplier's invoice.", params: { order: request.purchaseOrder?.poNumber || "" }, holder: requester, since };
    return { text: "Approved and budgeted. Accounting books the invoice next.", holder: team("Accounting"), since };
  }
  if (status === "CONTABILIZADO" && isAdvance(request)) return payment?.date
    ? { text: mine ? "Approved. Treasury sends your advance on {date}." : "Approved. Treasury sends the advance on {date}.", params: { date: payment.date }, holder: team("Treasury"), since }
    : { text: mine ? "Approved. Treasury sends your advance next." : "Approved. Treasury sends the advance next.", holder: team("Treasury"), since };
  if (status === "CONTABILIZADO") return { text: payment?.date ? "Booked by Accounting. Treasury pays it on the next payment day, {date}." : "Booked by Accounting. Treasury pays it next.", params: { date: payment?.date }, holder: team("Treasury"), since };
  if (status === "PROGRAMADO") return { text: "Scheduled for payment on {date}.", params: { date: payment?.date }, holder: team("Treasury"), since };
  if (status === "TXT_GENERADO") return { text: "In the bank file. Treasury confirms the payment.", holder: team("Treasury"), since };
  const renditionDue = isAdvance(request) && ["PENDING", "OBSERVED"].includes(request.rendition?.status);
  if (renditionDue) return { text: mine ? "Advance paid. Submit your rendition before the deadline." : "Advance paid. Waiting for the requester's rendition.", holder: requester, since };
  if (isAdvance(request) && request.rendition?.status === "SUBMITTED") return { text: "Rendition submitted. Accounting is reviewing it.", holder: team("Accounting"), since };
  if (status === "PAGADO") return { text: "Paid. Treasury reconciles it with the bank statement.", holder: team("Treasury"), since };
  if (status === "CONCILIADO") return { text: "Paid and reconciled. Accounting closes it.", holder: team("Accounting"), since };
  if (status === "CERRADO") return { text: "Closed. Everything is settled.", holder: null, since, tone: "done" };
  return { text: "In progress.", holder: null, since };
}

// Working days left to submit an advance's rendition (negative once overdue), and how far along
// the deadline window is (0..1), for the countdown ring. The window opens when the advance is paid.
export function renditionCountdown(rendition, { now = new Date(), openedAt, options } = {}) {
  if (!rendition?.dueAt) return null;
  const due = new Date(rendition.dueAt);
  if (now > due) return { overdue: true, daysLeft: -businessDaysBetween(due, now, options), progress: 1, dueAt: due };
  const daysLeft = businessDaysBetween(now, due, options);
  const total = openedAt ? Math.max(daysLeft, businessDaysBetween(openedAt, due, options)) : Math.max(daysLeft, 10);
  return { overdue: false, daysLeft, progress: total ? Math.min(1, Math.max(0, (total - daysLeft) / total)) : 0, dueAt: due };
}
