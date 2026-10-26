import { canonicalRequestStatus } from "../../../shared/workflowStatus.mjs";

// What a requester sees instead of the workflow codes: four steps - Draft, Waiting for approval,
// In process, Paid - plus "Needs your changes" when it came back to them, and Rejected / Cancelled.
// Finance roles keep the detailed statuses.

const NEEDS_CHANGES = ["OBSERVADO", "DEVUELTO", "OBSERVADO_MONTO_EXCEDIDO"];
const PAID = ["PAGADO", "CONCILIADO", "CERRADO"];

export const PLAIN_STATUSES = Object.freeze({
  DRAFT: { label: "Draft", tone: "neutral", statuses: ["BORRADOR"] },
  NEEDS_CHANGES: { label: "Needs your changes", tone: "warning", statuses: NEEDS_CHANGES },
  WAITING: { label: "Waiting for approval", tone: "info", statuses: ["PENDIENTE_APROBACION"] },
  IN_PROCESS: { label: "In process", tone: "info", statuses: ["APROBADO", "COMPROMISO_PRESUPUESTAL", "OBSERVADO_PRESUPUESTO", "OBSERVADO_SUNAT", "OBSERVADO_CARGA_MASIVA", "CONTABILIZADO", "PROGRAMADO", "TXT_GENERADO", "PAGO_REBOTADO"] },
  PAID: { label: "Paid", tone: "success", statuses: PAID },
  REJECTED: { label: "Rejected", tone: "danger", statuses: ["RECHAZADO"] },
  CANCELLED: { label: "Cancelled", tone: "danger", statuses: ["ANULADO"] }
});

// Status filter options for "My requests": each plain status filters its workflow statuses.
export const plainStatusFilterOptions = Object.entries(PLAIN_STATUSES).map(([, item]) => ({ value: item.statuses.join(","), label: item.label }));

export function plainStatusKey(request) {
  const status = canonicalRequestStatus(request?.status);
  return Object.entries(PLAIN_STATUSES).find(([, item]) => item.statuses.includes(status))?.[0] || "IN_PROCESS";
}

const advanceOpen = (request) => request?.flowType === "C" && request?.requestType !== "REEMBOLSO_SIN_SUSTENTO" && ["PENDING", "OBSERVED"].includes(request?.rendition?.status);

// "What we need from you": one sentence, and whether the requester has something to do.
// An approved advance waiting for the employee's verified bank account before it can be paid.
// An invoice the requester has to replace: issued by another supplier than the order's, or already
// registered. Any other invoice observation is Accounting's to resolve.
export const REQUESTER_INVOICE_PROBLEMS = Object.freeze(["RUC_MISMATCH", "DUPLICATE_VOUCHER"]);
export const requesterReplacesInvoice = (request) => canonicalRequestStatus(request?.status) === "OBSERVADO_SUNAT" && REQUESTER_INVOICE_PROBLEMS.includes(request?.observation?.code);

export const waitsForBankAccount = (request) => canonicalRequestStatus(request?.status) === "APROBADO"
  && request?.observation?.code === "REIMBURSEMENT_BANK_REQUIRED" && !request.observation.resolvedAt;

export function plainNextStep(request) {
  const key = plainStatusKey(request);
  const status = canonicalRequestStatus(request?.status);
  const pendingStep = [...(request?.approvalRouteSnapshot || [])].sort((a, b) => (a.sequence || 0) - (b.sequence || 0)).find((step) => step.status === "PENDING");
  if (key === "DRAFT") return { text: "Finish it and send it for approval.", yours: true };
  if (key === "NEEDS_CHANGES") return { text: "Make the changes asked for and send it again.", yours: true };
  if (key === "WAITING") return pendingStep?.approverSnapshot?.name ? { text: "Nothing. Waiting for {name}.", params: { name: pendingStep.approverSnapshot.name }, yours: false } : { text: "Nothing. Waiting for your jefe.", yours: false };
  if (request?.requestType === "REEMBOLSO_SIN_SUSTENTO" && status === "COMPROMISO_PRESUPUESTAL") return { text: "Sign and send your declaration to get paid.", yours: true };
  if (advanceOpen(request)) return { text: "Present your receipts (rendition) before the deadline.", yours: true };
  if (waitsForBankAccount(request)) return request.observation.resolver === "ACCOUNTING"
    ? { text: "Nothing. Accounting is verifying your bank account; then the advance is paid.", yours: false }
    : { text: "Register your bank account in {currency} under My bank account. The advance is paid once Accounting verifies it.", params: { currency: request.currency || "PEN" }, yours: true };
  if (requesterReplacesInvoice(request)) return request.observation.code === "RUC_MISMATCH"
    ? { text: "Upload the right invoice: the one uploaded is from another supplier.", yours: true }
    : { text: "Upload the right invoice: the one uploaded is already registered.", yours: true };
  if (key === "IN_PROCESS") return { text: "Nothing. Finance is processing it.", yours: false };
  if (key === "PAID") return { text: "Nothing. It is paid.", yours: false };
  return { text: "Nothing. It will not continue.", yours: false };
}

// Plain statuses for the people who ask for money; everyone else keeps the workflow detail.
// Solicitor, Legal and Human Resources (backend REQUESTER_ROLES) raise their area's requests.
export const usesPlainStatuses = (user) => ["Solicitor", "Legal", "HumanResources"].includes(user?.role);
