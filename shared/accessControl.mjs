// UMA role and permission catalog: the one source of truth for who may do what. The backend
// enforces it on every route and query (backend/src/utils/permissions.js, middleware/auth.js);
// the frontend reads the same catalog to build each person's menu. A hidden button is never the
// control.
//
// Eleven canonical roles (Manual de usuario, "Perfiles"; Manual técnico, "Seguridad, perfiles y
// auditoría"). The stored value of each role is kept from earlier versions so approval history,
// audit logs and notifications that name a role stay readable; the code (SOL, JEF...) is what
// people see.

export const ROLES = Object.freeze({
  SOLICITOR: "Solicitor",
  AREA_DIRECTOR: "AreaDirector",
  VICE_RECTOR: "ViceRector",
  GAF: "GAF",
  MANAGEMENT: "Management",
  ACCOUNTING: "Accounting",
  TREASURY: "Treasury",
  LEGAL: "Legal",
  HUMAN_RESOURCES: "HumanResources",
  AUDITOR: "Auditor",
  ADMIN: "Admin"
});

export const CANONICAL_ROLES = Object.freeze(Object.values(ROLES));

export const ROLE_CODES = Object.freeze({
  [ROLES.SOLICITOR]: "SOL",
  [ROLES.AREA_DIRECTOR]: "JEF",
  [ROLES.VICE_RECTOR]: "VIC",
  [ROLES.GAF]: "GAF",
  [ROLES.MANAGEMENT]: "GG",
  [ROLES.ACCOUNTING]: "CON",
  [ROLES.TREASURY]: "TES",
  [ROLES.LEGAL]: "LEG",
  [ROLES.HUMAN_RESOURCES]: "GP",
  [ROLES.AUDITOR]: "AUD",
  [ROLES.ADMIN]: "ADMIN"
});

export const ROLE_LABELS = Object.freeze({
  [ROLES.SOLICITOR]: "Solicitante",
  [ROLES.AREA_DIRECTOR]: "Responsable del Centro de Costo",
  [ROLES.VICE_RECTOR]: "Vicerrector / Gerente",
  [ROLES.GAF]: "Gerencia de Administración Financiera",
  [ROLES.MANAGEMENT]: "Gerencia General",
  [ROLES.ACCOUNTING]: "Contabilidad",
  [ROLES.TREASURY]: "Tesorería",
  [ROLES.LEGAL]: "Legal",
  [ROLES.HUMAN_RESOURCES]: "Gestión de Personas",
  [ROLES.AUDITOR]: "Auditoría",
  [ROLES.ADMIN]: "Administrador del sistema"
});

// Roles that no longer exist and the canonical role that takes their place. Stored values are
// read through this map (so a not-yet-migrated account keeps working with the new role's access,
// never the old one's) and rewritten by scripts/migrateCanonicalRoles.js.
//   Budget           -> Tesorería (folded earlier).
//   Procurement      -> Solicitante; the purchase-order duty survives as the grantable
//                       purchase_order.issue permission (the standalone Contracts & Supplies module
//                       is out of scope).
//   ManagementViewer -> Auditoría (read-only); flagged for the administrator to confirm.
//   SuperAdmin       -> Administrador del sistema (one administrator role).
export const RETIRED_ROLES = Object.freeze({
  Budget: ROLES.TREASURY,
  Procurement: ROLES.SOLICITOR,
  ManagementViewer: ROLES.AUDITOR,
  SuperAdmin: ROLES.ADMIN
});
// Grants a retired role carried that the migration keeps as an explicit, reviewable permission.
export const RETIRED_ROLE_GRANTS = Object.freeze({ Procurement: ["purchase_order.issue"] });

export function canonicalRole(role) {
  if (!role) return undefined;
  return RETIRED_ROLES[role] || (CANONICAL_ROLES.includes(role) ? role : undefined);
}

// Data scope of a permission (Manual técnico, "Alcance de lectura").
export const SCOPES = Object.freeze({
  OWN: "OWN",
  COST_CENTER: "COST_CENTER",
  APPROVAL_HIERARCHY: "APPROVAL_HIERARCHY",
  UNIVERSITY: "UNIVERSITY"
});
const SCOPE_RANK = Object.freeze({ OWN: 1, COST_CENTER: 2, APPROVAL_HIERARCHY: 3, UNIVERSITY: 4 });

export const PERMISSIONS = Object.freeze({
  REQUEST_CREATE: "request.create",
  REQUEST_VIEW: "request.view",
  REQUEST_EDIT: "request.edit",
  REQUEST_APPROVE: "request.approve",
  REQUEST_OBSERVE: "request.observe",
  REQUEST_REJECT: "request.reject",
  REQUEST_VOID: "request.void",
  ACTA_ISSUE: "acta.issue",
  ACTA_SIGN: "acta.sign",
  SUPPLIER_CREATE: "supplier.create",
  SUPPLIER_VALIDATE: "supplier.validate",
  SUPPLIER_VIEW: "supplier.view",
  SUPPLIER_BANK_VIEW: "supplier.bank_view",
  BUDGET_VIEW: "budget.view",
  BUDGET_MANAGE: "budget.manage",
  ACCOUNTING_PROVISION: "accounting.provision",
  ACCOUNTING_CLOSE_PERIOD: "accounting.close_period",
  ACCOUNTING_REOPEN_PERIOD: "accounting.reopen_period",
  ACCOUNTING_EXPORT: "accounting.export",
  ACCOUNTING_CODES_MANAGE: "accounting.codes_manage",
  TREASURY_SCHEDULE: "treasury.schedule",
  TREASURY_GENERATE_BATCH: "treasury.generate_batch",
  TREASURY_EXECUTE_PAYMENT: "treasury.execute_payment",
  TREASURY_TRANSFER: "treasury.transfer",
  TREASURY_INVESTMENT: "treasury.investment",
  BATCH_APPROVE: "batch.approve",
  INVESTMENT_APPROVE: "investment.approve",
  RECONCILIATION_PREPARE: "reconciliation.prepare",
  RECONCILIATION_SIGN: "reconciliation.sign",
  BANK_FORMAT_CERTIFY: "bank_format.certify",
  RENDITION_REVIEW: "rendition.review",
  LEGAL_REVIEW: "legal.review",
  HONORARIOS_MANAGE: "honorarios.manage",
  PURCHASE_ORDER_ISSUE: "purchase_order.issue",
  BATCH_INVOICE_UPLOAD: "batch_invoice.upload",
  BATCH_INVOICE_REVIEW: "batch_invoice.review",
  EMPLOYEE_BANK_MANAGE_OWN: "employee_bank.manage_own",
  EMPLOYEE_BANK_REVIEW: "employee_bank.review",
  EMPLOYEE_BANK_VIEW_PAYMENT: "employee_bank.view_payment",
  REPORT_VIEW: "report.view",
  INSIGHTS_VIEW: "insights.view",
  FINANCE_PARAMETERS_MANAGE: "finance_parameters.manage",
  EMPLOYEE_MANAGE: "employee.manage",
  ROLE_MANAGE: "role.manage",
  PERMISSION_MANAGE: "permission.manage",
  COST_CENTER_MANAGE: "cost_center.manage",
  PLATFORM_MANAGE: "platform.manage",
  AUDIT_READ: "audit.read"
});

export const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

// Values stored before this catalog. Read through this map (extra grants on old user records) and
// rewritten by the migration. null: the grant no longer opens anything and is dropped.
export const LEGACY_PERMISSIONS = Object.freeze({
  "request:create": PERMISSIONS.REQUEST_CREATE,
  "request:view-all": PERMISSIONS.REQUEST_VIEW,
  "request:approve": PERMISSIONS.REQUEST_APPROVE,
  "request:void": PERMISSIONS.REQUEST_VOID,
  "supplier:propose": PERMISSIONS.SUPPLIER_CREATE,
  "supplier:homologate": null,
  "supplier:bank-view": PERMISSIONS.SUPPLIER_BANK_VIEW,
  "budget:view": PERMISSIONS.BUDGET_VIEW,
  "budget:manage": PERMISSIONS.BUDGET_MANAGE,
  "accounting:process": PERMISSIONS.ACCOUNTING_PROVISION,
  "period:manage": PERMISSIONS.ACCOUNTING_CLOSE_PERIOD,
  "treasury:schedule": PERMISSIONS.TREASURY_SCHEDULE,
  "treasury:file": PERMISSIONS.TREASURY_GENERATE_BATCH,
  "payment:confirm": PERMISSIONS.TREASURY_EXECUTE_PAYMENT,
  "payment:reconcile": PERMISSIONS.RECONCILIATION_PREPARE,
  "payment:reprocess": PERMISSIONS.TREASURY_EXECUTE_PAYMENT,
  "report:view": PERMISSIONS.REPORT_VIEW,
  "management-portal:view": PERMISSIONS.INSIGHTS_VIEW,
  "audit:view": PERMISSIONS.AUDIT_READ,
  "master-data:manage": PERMISSIONS.ACCOUNTING_CODES_MANAGE,
  "user:manage": PERMISSIONS.EMPLOYEE_MANAGE,
  "employee-bank:manage-own": PERMISSIONS.EMPLOYEE_BANK_MANAGE_OWN,
  "employee-bank:review": PERMISSIONS.EMPLOYEE_BANK_REVIEW,
  "employee-bank:view-payment": PERMISSIONS.EMPLOYEE_BANK_VIEW_PAYMENT,
  "rendition:review": PERMISSIONS.RENDITION_REVIEW,
  "procurement-order:create": PERMISSIONS.PURCHASE_ORDER_ISSUE,
  "batch-invoice:upload": PERMISSIONS.BATCH_INVOICE_UPLOAD,
  "batch-invoice:review": PERMISSIONS.BATCH_INVOICE_REVIEW,
  "bank-format:certify": PERMISSIONS.BANK_FORMAT_CERTIFY,
  "bank-file:verify": PERMISSIONS.BATCH_APPROVE
});

export function canonicalPermission(permission) {
  if (ALL_PERMISSIONS.includes(permission)) return permission;
  return Object.hasOwn(LEGACY_PERMISSIONS, permission) ? LEGACY_PERMISSIONS[permission] : null;
}

export const PERMISSION_LABELS = Object.freeze({
  [PERMISSIONS.REQUEST_CREATE]: "Registrar requerimientos",
  [PERMISSIONS.REQUEST_VIEW]: "Ver requerimientos",
  [PERMISSIONS.REQUEST_EDIT]: "Corregir requerimientos propios",
  [PERMISSIONS.REQUEST_APPROVE]: "Aprobar requerimientos",
  [PERMISSIONS.REQUEST_OBSERVE]: "Observar requerimientos",
  [PERMISSIONS.REQUEST_REJECT]: "Rechazar requerimientos",
  [PERMISSIONS.REQUEST_VOID]: "Anular requerimientos",
  [PERMISSIONS.ACTA_ISSUE]: "Emitir actas digitales",
  [PERMISSIONS.ACTA_SIGN]: "Firmar actas digitales",
  [PERMISSIONS.SUPPLIER_CREATE]: "Registrar proveedores",
  [PERMISSIONS.SUPPLIER_VALIDATE]: "Validar proveedores y cuentas bancarias",
  [PERMISSIONS.SUPPLIER_VIEW]: "Ver proveedores",
  [PERMISSIONS.SUPPLIER_BANK_VIEW]: "Ver cuentas bancarias de proveedores",
  [PERMISSIONS.BUDGET_VIEW]: "Ver presupuestos",
  [PERMISSIONS.BUDGET_MANAGE]: "Gestionar presupuestos",
  [PERMISSIONS.ACCOUNTING_PROVISION]: "Provisionar cuentas por pagar",
  [PERMISSIONS.ACCOUNTING_CLOSE_PERIOD]: "Cerrar periodos contables",
  [PERMISSIONS.ACCOUNTING_REOPEN_PERIOD]: "Reabrir periodos contables",
  [PERMISSIONS.ACCOUNTING_EXPORT]: "Exportaciones contables (SIRE)",
  [PERMISSIONS.ACCOUNTING_CODES_MANAGE]: "Cuentas, mapeos y detracciones",
  [PERMISSIONS.TREASURY_SCHEDULE]: "Programar pagos",
  [PERMISSIONS.TREASURY_GENERATE_BATCH]: "Generar lotes y archivos bancarios",
  [PERMISSIONS.TREASURY_EXECUTE_PAYMENT]: "Ejecutar pagos y registrar resultados",
  [PERMISSIONS.TREASURY_TRANSFER]: "Traspasos entre cuentas (proceso D)",
  [PERMISSIONS.TREASURY_INVESTMENT]: "Registrar inversiones",
  [PERMISSIONS.BATCH_APPROVE]: "Aprobar lotes de pago y detracciones",
  [PERMISSIONS.INVESTMENT_APPROVE]: "Aprobar inversiones",
  [PERMISSIONS.RECONCILIATION_PREPARE]: "Preparar conciliaciones",
  [PERMISSIONS.RECONCILIATION_SIGN]: "Revisar y firmar conciliaciones",
  [PERMISSIONS.BANK_FORMAT_CERTIFY]: "Certificar formatos bancarios",
  [PERMISSIONS.RENDITION_REVIEW]: "Revisar rendiciones",
  [PERMISSIONS.LEGAL_REVIEW]: "Validar sustento legal (proceso E)",
  [PERMISSIONS.HONORARIOS_MANAGE]: "Honorarios (proceso H)",
  [PERMISSIONS.PURCHASE_ORDER_ISSUE]: "Emitir órdenes de compra",
  [PERMISSIONS.BATCH_INVOICE_UPLOAD]: "Carga masiva de facturas (A2)",
  [PERMISSIONS.BATCH_INVOICE_REVIEW]: "Revisar carga masiva de facturas",
  [PERMISSIONS.EMPLOYEE_BANK_MANAGE_OWN]: "Mi cuenta bancaria de reembolsos",
  [PERMISSIONS.EMPLOYEE_BANK_REVIEW]: "Validar cuentas de reembolso",
  [PERMISSIONS.EMPLOYEE_BANK_VIEW_PAYMENT]: "Ver cuentas de reembolso para pago",
  [PERMISSIONS.REPORT_VIEW]: "Reportes",
  [PERMISSIONS.INSIGHTS_VIEW]: "Consultas e indicadores institucionales",
  [PERMISSIONS.FINANCE_PARAMETERS_MANAGE]: "Parámetros financieros y umbrales",
  [PERMISSIONS.EMPLOYEE_MANAGE]: "Gestionar empleados",
  [PERMISSIONS.ROLE_MANAGE]: "Asignar roles",
  [PERMISSIONS.PERMISSION_MANAGE]: "Conceder permisos",
  [PERMISSIONS.COST_CENTER_MANAGE]: "Centros de costo y jerarquías",
  [PERMISSIONS.PLATFORM_MANAGE]: "Configuración de acceso de la plataforma",
  [PERMISSIONS.AUDIT_READ]: "Auditoría (solo lectura)"
});

const { OWN, COST_CENTER, APPROVAL_HIERARCHY, UNIVERSITY } = SCOPES;
const P = PERMISSIONS;
const grant = (scope, ...permissions) => Object.fromEntries(permissions.map((permission) => [permission, scope]));

// Role -> { permission: scope } (Manual técnico, "Perfiles y alcance"). Tesorería validates suppliers
// and their bank accounts (Manual de usuario: "Tesorería lo valida antes del pago"); Contabilidad
// provisions and signs reconciliations; the requester issues the acta and the responsible signs it.
// Approval authority itself is contextual: request.approve lets a
// person decide only the steps assigned to them (as the cost center's responsible, as the
// superior in the cascade, or as the GAF/Gerencia General for an amount tier), never every request.
export const ROLE_GRANTS = Object.freeze({
  [ROLES.SOLICITOR]: Object.freeze({
    ...grant(OWN, P.REQUEST_CREATE, P.REQUEST_EDIT, P.ACTA_ISSUE, P.EMPLOYEE_BANK_MANAGE_OWN, P.BATCH_INVOICE_UPLOAD),
    ...grant(COST_CENTER, P.REQUEST_VIEW, P.SUPPLIER_CREATE, P.SUPPLIER_VIEW)
  }),
  [ROLES.AREA_DIRECTOR]: Object.freeze({
    ...grant(APPROVAL_HIERARCHY, P.REQUEST_VIEW, P.REQUEST_APPROVE, P.REQUEST_OBSERVE, P.REQUEST_REJECT, P.ACTA_SIGN, P.BUDGET_VIEW, P.REPORT_VIEW),
    ...grant(COST_CENTER, P.SUPPLIER_CREATE, P.SUPPLIER_VIEW)
  }),
  [ROLES.VICE_RECTOR]: Object.freeze({
    ...grant(APPROVAL_HIERARCHY, P.REQUEST_VIEW, P.REQUEST_APPROVE, P.REQUEST_OBSERVE, P.REQUEST_REJECT, P.ACTA_SIGN, P.BUDGET_VIEW, P.REPORT_VIEW),
    ...grant(COST_CENTER, P.SUPPLIER_CREATE, P.SUPPLIER_VIEW)
  }),
  [ROLES.GAF]: Object.freeze({
    ...grant(UNIVERSITY, P.REQUEST_VIEW, P.REQUEST_APPROVE, P.REQUEST_OBSERVE, P.REQUEST_REJECT, P.ACTA_SIGN, P.BATCH_APPROVE, P.INVESTMENT_APPROVE,
      P.FINANCE_PARAMETERS_MANAGE, P.ACCOUNTING_REOPEN_PERIOD, P.SUPPLIER_VIEW, P.SUPPLIER_BANK_VIEW, P.BUDGET_VIEW, P.REPORT_VIEW, P.INSIGHTS_VIEW, P.AUDIT_READ)
  }),
  [ROLES.MANAGEMENT]: Object.freeze({
    ...grant(UNIVERSITY, P.REQUEST_VIEW, P.REQUEST_APPROVE, P.REQUEST_OBSERVE, P.REQUEST_REJECT, P.ACTA_SIGN, P.BUDGET_VIEW, P.REPORT_VIEW, P.INSIGHTS_VIEW)
  }),
  [ROLES.ACCOUNTING]: Object.freeze({
    ...grant(UNIVERSITY, P.REQUEST_VIEW, P.REQUEST_VOID, P.ACCOUNTING_PROVISION, P.ACCOUNTING_CLOSE_PERIOD, P.ACCOUNTING_EXPORT, P.ACCOUNTING_CODES_MANAGE,
      P.RECONCILIATION_SIGN, P.RENDITION_REVIEW, P.SUPPLIER_CREATE, P.SUPPLIER_VIEW, P.SUPPLIER_BANK_VIEW, P.BUDGET_VIEW, P.REPORT_VIEW,
      P.INSIGHTS_VIEW, P.EMPLOYEE_BANK_REVIEW, P.EMPLOYEE_BANK_VIEW_PAYMENT, P.BATCH_INVOICE_UPLOAD, P.BATCH_INVOICE_REVIEW)
  }),
  [ROLES.TREASURY]: Object.freeze({
    ...grant(UNIVERSITY, P.REQUEST_VIEW, P.TREASURY_SCHEDULE, P.TREASURY_GENERATE_BATCH, P.TREASURY_EXECUTE_PAYMENT, P.TREASURY_TRANSFER, P.TREASURY_INVESTMENT,
      P.RECONCILIATION_PREPARE, P.BANK_FORMAT_CERTIFY, P.SUPPLIER_CREATE, P.SUPPLIER_VALIDATE, P.SUPPLIER_VIEW, P.SUPPLIER_BANK_VIEW, P.BUDGET_VIEW, P.BUDGET_MANAGE,
      P.REPORT_VIEW, P.INSIGHTS_VIEW, P.EMPLOYEE_BANK_VIEW_PAYMENT)
  }),
  [ROLES.LEGAL]: Object.freeze({
    ...grant(OWN, P.REQUEST_VIEW, P.LEGAL_REVIEW)
  }),
  [ROLES.HUMAN_RESOURCES]: Object.freeze({
    ...grant(OWN, P.REQUEST_VIEW, P.HONORARIOS_MANAGE)
  }),
  [ROLES.AUDITOR]: Object.freeze({
    ...grant(UNIVERSITY, P.REQUEST_VIEW, P.SUPPLIER_VIEW, P.BUDGET_VIEW, P.REPORT_VIEW, P.INSIGHTS_VIEW, P.AUDIT_READ)
  }),
  [ROLES.ADMIN]: Object.freeze({
    ...grant(UNIVERSITY, P.EMPLOYEE_MANAGE, P.ROLE_MANAGE, P.PERMISSION_MANAGE, P.COST_CENTER_MANAGE, P.PLATFORM_MANAGE, P.AUDIT_READ)
  })
});

// What an administrator may grant one person on top of their roles. Department duties
// (provisioning, paying, generating or approving batches, closing periods, managing employees)
// come only with a role, so separation of duties stays visible in the role assignment.
export const GRANTABLE_PERMISSIONS = Object.freeze([
  P.REQUEST_CREATE,
  P.BUDGET_VIEW,
  P.REPORT_VIEW,
  P.SUPPLIER_BANK_VIEW,
  P.EMPLOYEE_BANK_MANAGE_OWN,
  P.EMPLOYEE_BANK_REVIEW,
  P.RENDITION_REVIEW,
  P.PURCHASE_ORDER_ISSUE,
  P.BATCH_INVOICE_UPLOAD,
  P.BATCH_INVOICE_REVIEW,
  P.BANK_FORMAT_CERTIFY
]);

// Read-only roles: they never change financial work (the API refuses their writes).
export const READ_ONLY_ROLES = Object.freeze([ROLES.AUDITOR]);

// Segregation of duties between roles held by the same person. "block" combinations cannot be
// saved; "review" ones are allowed but listed in the administrator's access review, and the
// per-record rules (no self-approval, batch generator != batch approver, Treasury prepares /
// Accounting signs a reconciliation) still apply at run time.
export const SOD_RULES = Object.freeze([
  { id: "AUDIT_INDEPENDENCE", severity: "block", roles: [ROLES.AUDITOR], exclusive: true, message: "Auditoría es independiente: no puede combinarse con otro rol." },
  { id: "BATCH_GENERATE_APPROVE", severity: "block", roles: [ROLES.TREASURY, ROLES.GAF], message: "Tesorería genera los lotes y la GAF los aprueba: una misma persona no puede tener ambos roles." },
  { id: "PROVISION_PAY", severity: "block", roles: [ROLES.ACCOUNTING, ROLES.TREASURY], message: "Contabilidad provisiona y firma conciliaciones; Tesorería paga y las prepara: no pueden recaer en la misma persona." },
  { id: "ACCOUNTING_GAF", severity: "review", roles: [ROLES.ACCOUNTING, ROLES.GAF], message: "Contabilidad y GAF en la misma persona: revise que no apruebe lo que provisiona." },
  { id: "ADMIN_BUSINESS_ROLE", severity: "review", roles: [ROLES.ADMIN], withAnyOf: [ROLES.GAF, ROLES.MANAGEMENT, ROLES.ACCOUNTING, ROLES.TREASURY], message: "Un administrador con un rol financiero puede asignarse accesos: revise la asignación." }
]);

export function sodViolations(roles = []) {
  const held = new Set(roles.map(canonicalRole).filter(Boolean));
  const violations = [];
  for (const rule of SOD_RULES) {
    if (rule.exclusive) {
      if (rule.roles.some((role) => held.has(role)) && held.size > 1) violations.push(rule);
    } else if (rule.withAnyOf) {
      if (rule.roles.every((role) => held.has(role)) && rule.withAnyOf.some((role) => held.has(role))) violations.push(rule);
    } else if (rule.roles.every((role) => held.has(role))) violations.push(rule);
  }
  return violations;
}

// Every canonical role a person holds: their primary role plus any additional roles. The primary
// role decides their home workspace and data scope where a single answer is needed; the others
// add permissions and menu entries.
export function rolesOf(user) {
  if (!user) return [];
  if (typeof user === "string") return [canonicalRole(user)].filter(Boolean);
  return [...new Set([user.role, ...(user.roles || [])].map(canonicalRole).filter(Boolean))];
}

export function primaryRole(user) {
  return rolesOf(user)[0];
}

export function hasRole(user, ...roles) {
  const held = rolesOf(user);
  return roles.flat().some((role) => held.includes(role));
}

// Extra grants in force for a person: only grantable permissions (legacy values are read through
// LEGACY_PERMISSIONS), so a stored department duty never widens access.
export function extraGrants(user) {
  if (!user || typeof user !== "object") return [];
  return [...new Set((user.permissions || []).map(canonicalPermission).filter((permission) => GRANTABLE_PERMISSIONS.includes(permission)))];
}

// { permission: broadest scope } over every role the person holds, plus their extra grants
// (scope OWN, or COST_CENTER for viewing).
export function permissionScopes(user) {
  const scopes = {};
  const widen = (permission, scope) => {
    if (!scopes[permission] || SCOPE_RANK[scope] > SCOPE_RANK[scopes[permission]]) scopes[permission] = scope;
  };
  for (const role of rolesOf(user)) for (const [permission, scope] of Object.entries(ROLE_GRANTS[role] || {})) widen(permission, scope);
  for (const permission of extraGrants(user)) widen(permission, [P.BUDGET_VIEW, P.REPORT_VIEW].includes(permission) ? COST_CENTER : OWN);
  return scopes;
}

export function effectivePermissions(user) {
  return Object.keys(permissionScopes(user));
}

export function permissionScope(user, permission) {
  return permissionScopes(user)[permission] || null;
}

export function can(user, permission) {
  return Boolean(permissionScope(user, permission));
}

export function canAny(user, ...permissions) {
  return permissions.flat().some((permission) => can(user, permission));
}
