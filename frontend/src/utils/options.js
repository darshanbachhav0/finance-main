export const requestTypes = [
  "OPEX",
  "CAPEX",
  "ENTREGA_RENDIR",
  "REEMBOLSO_CON_SUSTENTO",
  "REEMBOLSO_SIN_SUSTENTO",
  "PAGO_CON_COTIZACION"
];

export const flowTypes = ["A1", "A2", "B", "C"];

export const flowTypeLabels = {
  A1: "A1 - Formal purchase with PO",
  A2: "A2 - Batch invoices against PO",
  B: "B - Direct invoice / advance payment",
  C: "C - Advance to render / petty cash"
};

export const requestStatuses = [
  "BORRADOR",
  "EN_VALIDACION",
  "ENVIADO",
  "PENDIENTE_APROBACION",
  "APROBADO_DIRECTOR",
  "APROBADO_VICERRECTOR",
  "COMPROMISO_PRESUPUESTAL",
  "CONTABILIZADO",
  "PROVISIONADO_CXP",
  "PROGRAMADO",
  "TXT_GENERADO",
  "PAGADO",
  "CONCILIADO",
  "RENDICION_PENDIENTE",
  "CERRADO",
  "OBSERVADO",
  "OBSERVADO_PRESUPUESTO",
  "OBSERVADO_SUNAT",
  "OBSERVADO_MONTO_EXCEDIDO",
  "OBSERVADO_CARGA_MASIVA",
  "PAGO_REBOTADO",
  "PAGADO_CERRADO",
  "DEVUELTO",
  "RECHAZADO",
  "ANULADO"
];

export const currencies = ["PEN", "USD"];

export const expenseNatures = [
  "GOODS",
  "SERVICES",
  "PROFESSIONAL_FEES",
  "CONSULTING",
  "ADVERTISING",
  "TRAVEL",
  "EQUIPMENT",
  "TECHNOLOGY",
  "INFRASTRUCTURE",
  "LABORATORIES",
  "LIBRARY",
  "RESEARCH",
  "MAINTENANCE",
  "PETTY_CASH",
  "REIMBURSEMENT_LIQUIDATION"
];

export const requestPriorities = ["BAJA", "MEDIA", "ALTA"];
export const approvalLevels = ["AREA_DIRECTOR", "VICE_RECTOR", "RECTORATE", "GENERAL_MANAGEMENT"];
export const banks = ["BCP", "BBVA", "INTERBANK", "SCOTIABANK"];
export const roles = ["Admin", "Solicitor", "Approver", "Accounting", "Treasury", "Budget", "Management"];

export const requestTypeLabels = {
  OPEX: "OPEX",
  CAPEX: "CAPEX",
  ENTREGA_RENDIR: "Advance to account",
  REEMBOLSO_CON_SUSTENTO: "Supported reimbursement",
  REEMBOLSO_SIN_SUSTENTO: "Unsupported reimbursement",
  PAGO_CON_COTIZACION: "Quotation-based payment"
};

export const expenseNatureLabels = {
  GOODS: "Purchase of goods",
  SERVICES: "Services",
  PROFESSIONAL_FEES: "Professional fees",
  CONSULTING: "Consulting",
  ADVERTISING: "Advertising",
  TRAVEL: "Travel",
  EQUIPMENT: "Equipment",
  TECHNOLOGY: "Technology",
  INFRASTRUCTURE: "Infrastructure",
  LABORATORIES: "Laboratories",
  LIBRARY: "Library",
  RESEARCH: "Research",
  MAINTENANCE: "Maintenance",
  PETTY_CASH: "Petty cash",
  REIMBURSEMENT_LIQUIDATION: "Reimbursement / liquidation"
};

export function optionLabel(value, labels = {}) {
  return labels[value] || value;
}
