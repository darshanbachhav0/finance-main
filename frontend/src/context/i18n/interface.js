// Interface polish: labels for workflow codes that reached the screen raw (charts, SLA badges).
// interfaceCodeLabels maps a code to its English label; the default export is the Spanish copy.
export const interfaceCodeLabels = {
  OPEN: "Open",
  SCHEDULED: "Scheduled",
  CANCELLED: "Cancelled",
  ENTREGA_RENDIR: "Advance to be rendered",
  REEMBOLSO_SIN_SUSTENTO: "Undocumented reimbursement",
  REEMBOLSO_CON_SUSTENTO: "Documented reimbursement",
  PAGO_CON_COTIZACION: "Payment with quotation",
  ON_TRACK: "On time",
  DUE_SOON: "Due soon",
  ESCALATED: "Escalated",
  SLA_DUE_SOON: "Due soon",
  SLA_OVERDUE: "Overdue",
  SLA_ESCALATION: "Escalated",
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High"
};

export default {
  "Open": "Abierto",
  "Advance to be rendered": "Entrega a rendir",
  "Undocumented reimbursement": "Reembolso sin sustento",
  "Documented reimbursement": "Reembolso con sustento",
  "Payment with quotation": "Pago con cotización",
  "On time": "En plazo",
  "Due soon": "Por vencer",
  "Escalated": "Escalado",
  "Overdue": "Vencido",
  "Formal purchase with quotations and PO.": "Compra formal con cotizaciones y orden de compra.",
  "Direct invoice / advance payment with mandatory XML + PDF.": "Comprobante directo o pago anticipado, con XML y PDF obligatorios.",
  "Advance to render / petty cash; expense budget is executed at rendition validation.": "Entrega a rendir o caja chica; el presupuesto se ejecuta al validar la rendición.",
  "All periods": "Todos los periodos",
  "{count} unread notification": "{count} notificación sin leer",
  "{count} unread notifications": "{count} notificaciones sin leer",
  "Decision": "Decisión",
  "Not certified": "No certificado",
  "No certification recorded": "Sin certificación registrada",
  "More actions": "Más acciones",
  "Reject": "Rechazar",
  "Requirement, CECO, quotations and conformity": "Requerimiento, CECO, cotizaciones y conformidad"
};
