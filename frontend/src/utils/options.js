export const requestTypes = [
  "OPEX",
  "CAPEX",
  "ENTREGA_RENDIR",
  "REEMBOLSO_CON_SUSTENTO",
  "REEMBOLSO_SIN_SUSTENTO",
  "PAGO_CON_COTIZACION"
];

/*
 * New-request classification policy:
 *
 * - A1 and B describe HOW the transaction is processed.
 * - OPEX / CAPEX describe WHAT kind of expenditure it is.
 * - C is an advance to render, so its internal request type remains
 *   ENTREGA_RENDIR until the rendition establishes the final expense.
 *
 * Keep requestTypes above for historical records, filters and master-data
 * configuration. New A1/B requests must use only the two values below.
 */
export const requestCreationClassifications = ["OPEX", "CAPEX"];

export const expenditureClassificationLabels = {
  OPEX: "OPEX - Operating expenditure",
  CAPEX: "CAPEX - Capital expenditure"
};

export function requestTypeForFlow(flowType, currentRequestType = "OPEX") {
  if (flowType === "C") return "ENTREGA_RENDIR";
  if (["A1", "B"].includes(flowType)) {
    return requestCreationClassifications.includes(currentRequestType)
      ? currentRequestType
      : "OPEX";
  }
  return currentRequestType;
}

export const flowTypes = ["A1", "A2", "B", "C"];

export const flowTypeLabels = {
  A1: "A1 - Formal purchase with PO",
  A2: "A2 - Batch invoices against PO",
  B: "B - Direct invoice / advance payment",
  C: "C - Advance to render / petty cash"
};

export const requestStatuses = [
  "BORRADOR",
  "PENDIENTE_APROBACION",
  "APROBADO",
  "COMPROMISO_PRESUPUESTAL",
  "CONTABILIZADO",
  "PROGRAMADO",
  "TXT_GENERADO",
  "PAGADO",
  "CONCILIADO",
  "CERRADO",
  "OBSERVADO",
  "OBSERVADO_PRESUPUESTO",
  "OBSERVADO_SUNAT",
  "OBSERVADO_MONTO_EXCEDIDO",
  "OBSERVADO_CARGA_MASIVA",
  "PAGO_REBOTADO",
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
export const roles = ["Admin", "Solicitor", "AreaDirector", "ViceRector", "Accounting", "Treasury", "Budget", "Procurement", "Management", "ManagementViewer"];

// Extra grants beyond a role's default set - an exception, not the everyday path.
export const permissions = [
  { value: "request:create", label: "Create requests" },
  { value: "request:view-all", label: "View all requests" },
  { value: "request:approve", label: "Approve requests" },
  { value: "request:void", label: "Void requests" },
  { value: "supplier:propose", label: "Propose suppliers" },
  { value: "supplier:homologate", label: "Homologate suppliers" },
  { value: "supplier:bank-view", label: "View supplier bank data" },
  { value: "budget:view", label: "View budget" },
  { value: "budget:manage", label: "Manage budget" },
  { value: "accounting:process", label: "Process accounting" },
  { value: "period:manage", label: "Manage periods" },
  { value: "treasury:schedule", label: "Schedule payments" },
  { value: "treasury:file", label: "Generate bank files" },
  { value: "payment:confirm", label: "Confirm payments" },
  { value: "payment:reconcile", label: "Reconcile payments" },
  { value: "payment:reprocess", label: "Reprocess payments" },
  { value: "report:view", label: "View reports" },
  { value: "management-portal:view", label: "View management portal" },
  { value: "audit:view", label: "View audit" },
  { value: "master-data:manage", label: "Manage master data" },
  { value: "user:manage", label: "Manage users" },
  { value: "employee-bank:manage-own", label: "Manage own bank account" },
  { value: "employee-bank:review", label: "Review employee bank accounts" },
  { value: "employee-bank:view-payment", label: "View payment bank data" },
  { value: "rendition:review", label: "Review renditions" },
  { value: "procurement-order:create", label: "Create purchase orders" },
  { value: "batch-invoice:upload", label: "Upload batch invoices" },
  { value: "batch-invoice:review", label: "Review batch invoices" },
  { value: "bank-format:certify", label: "Certify bank formats" }
];

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
