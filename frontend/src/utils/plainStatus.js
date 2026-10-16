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

// The four main steps, in order, for the progress line.
export const PLAIN_STEPS = Object.freeze(["DRAFT", "WAITING", "IN_PROCESS", "PAID"]);

// Status filter options for "My requests": each plain status filters its workflow statuses.
export const plainStatusFilterOptions = Object.entries(PLAIN_STATUSES).map(([, item]) => ({ value: item.statuses.join(","), label: item.label }));

export function plainStatusKey(request) {
  const status = canonicalRequestStatus(request?.status);
  return Object.entries(PLAIN_STATUSES).find(([, item]) => item.statuses.includes(status))?.[0] || "IN_PROCESS";
}

const advanceOpen = (request) => request?.flowType === "C" && request?.requestType !== "REEMBOLSO_SIN_SUSTENTO" && ["PENDING", "OBSERVED"].includes(request?.rendition?.status);

// "What we need from you": one sentence, and whether the requester has something to do.
export function plainNextStep(request) {
  const key = plainStatusKey(request);
  const status = canonicalRequestStatus(request?.status);
  const pendingStep = [...(request?.approvalRouteSnapshot || [])].sort((a, b) => (a.sequence || 0) - (b.sequence || 0)).find((step) => step.status === "PENDING");
  if (key === "DRAFT") return { text: "Finish it and send it for approval.", yours: true };
  if (key === "NEEDS_CHANGES") return { text: "Make the changes asked for and send it again.", yours: true };
  if (key === "WAITING") return pendingStep?.approverSnapshot?.name ? { text: "Nothing. Waiting for {name}.", params: { name: pendingStep.approverSnapshot.name }, yours: false } : { text: "Nothing. Waiting for your jefe.", yours: false };
  if (request?.requestType === "REEMBOLSO_SIN_SUSTENTO" && status === "COMPROMISO_PRESUPUESTAL") return { text: "Sign and send your declaration to get paid.", yours: true };
  if (advanceOpen(request)) return { text: "Present your receipts (rendition) before the deadline.", yours: true };
  if (key === "IN_PROCESS") return { text: "Nothing. Finance is processing it.", yours: false };
  if (key === "PAID") return { text: "Nothing. It is paid.", yours: false };
  return { text: "Nothing. It will not continue.", yours: false };
}

// Plain statuses for the people who ask for money; everyone else keeps the workflow detail.
export const usesPlainStatuses = (user) => user?.role === "Solicitor";
