// One set of tones for badges, KPI cards, task rows and notices. A tone says what the state means,
// never just a colour:
//   neutral  not started, not applicable, or a category (drafts, track A1, inactive)
//   info     moving normally or waiting on the next person (submitted, pending approval, scheduled)
//   warning  needs a correction or attention before it can continue (observed, returned, due soon)
//   success  finished well (approved, paid, closed, verified)
//   danger   failed, refused or overdue (rejected, bounced, cancelled, overdue)
//   accent   UMA emphasis with no status meaning (a highlighted figure)
// Request statuses are looked up after canonicalRequestStatus(), so legacy aliases (ENVIADO,
// PAGADO_CERRADO...) take their current status's tone.
// The same word on screen always gets the same tone (test/tones.test.js checks this through the
// Spanish and English labels).
export const TONES = Object.freeze(["neutral", "info", "success", "warning", "danger", "accent"]);

// Colour names used before the tones had meanings; the dashboard API and older callers may still
// send them.
const LEGACY_TONES = Object.freeze({ gray: "neutral", navy: "neutral", dark: "neutral", blue: "info", indigo: "info", green: "success", amber: "warning", red: "danger", teal: "accent" });

export const toneOf = (tone) => (TONES.includes(tone) ? tone : LEGACY_TONES[tone] || "neutral");

export const STATUS_TONE_GROUPS = Object.freeze({
  neutral: [
    "BORRADOR", "TRANSITIONAL", "NO_BUDGET", "WITHOUT_BUDGET", "CLOSED_BUDGET", "LEGACY_ACCEPTED", "NOT_REVIEWED", "NOT_VERIFIED",
    "NOT_DECLARED", "INACTIVE", "DISMISSED", "NOT_REQUIRED", "NORMAL", "A1", "A2", "B", "C", "REIMBURSEMENT", "PAYROLL_DEDUCTION"
  ],
  info: [
    "SUBMITTED", "PENDIENTE_APROBACION", "PENDING", "PENDING_VALIDATION", "APROBADO_DIRECTOR", "APROBADO_VICERRECTOR",
    "COMPROMISO_PRESUPUESTAL", "RESERVED", "COMMITTED", "RELEASED", "CONTABILIZADO", "PROGRAMADO", "SCHEDULED",
    "TXT_GENERADO", "PAYMENT_FILE_CREATED", "GENERATED", "QUEUED", "PROCESSING", "OPEN", "PARTIALLY_EXECUTED", "PARTIALLY_PAID", "PARTIALLY_CONFIRMED"
  ],
  warning: [
    "OBSERVADO", "OBSERVADO_PRESUPUESTO", "OBSERVADO_SUNAT", "OBSERVADO_MONTO_EXCEDIDO", "OBSERVADO_CARGA_MASIVA", "OBSERVED", "OBSERVED_SUNAT",
    "OBSERVED_DUPLICATE", "OBSERVED_AMOUNT_EXCEEDED", "OBSERVED_BATCH", "DEVUELTO", "RENDICION_PENDIENTE", "MANUAL_REVIEW", "COMPLETED_WITH_OBSERVATIONS",
    "PRIORITY", "SLA_DUE_SOON", "YES", "DEMO"
  ],
  success: [
    "APROBADO", "APPROVED", "PAGADO", "PAID", "CERRADO", "CONCILIADO", "COMPLETED", "CONFIRMED", "RESOLVED", "EXECUTED", "PROVISIONED",
    "EXPORTED", "ACTIVE", "AVAILABLE", "HOMOLOGATED", "VERIFIED", "VALIDATED", "VALID", "MATCH", "MANUAL_ACCEPTED", "COMPLIANT", "NO"
  ],
  danger: [
    "RECHAZADO", "REJECTED", "ANULADO", "CANCELLED", "PAGO_REBOTADO", "PAYMENT_BOUNCED", "MISMATCH", "NON_COMPLIANT", "BLOCKED", "MISSING_VOUCHER_LINK",
    "OVERDUE", "SLA_OVERDUE", "SLA_ESCALATION"
  ]
});

export const STATUS_TONES = Object.freeze(Object.fromEntries(Object.entries(STATUS_TONE_GROUPS).flatMap(([tone, statuses]) => statuses.map((status) => [status, tone]))));

export const statusTone = (status) => STATUS_TONES[status] || "neutral";
