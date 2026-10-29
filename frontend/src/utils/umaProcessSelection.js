import { userCan } from "./access.js";
/** UMA payment-process catalog. UI routing only: backend authorization is authoritative. */
export const UMA_PROCESSES = Object.freeze([
  {
    code: 'A1', title: 'Purchase with purchase order', subtitle: 'Compra nueva con OC',
    description: 'Requirement, quotations, approval, purchase order, receipt and invoice.',
    requirements: 'Proveedor, sustento/cotizaciones, CECO y detalle del gasto.',
    kind: 'request', permission: 'request.create'
  },
  {
    code: 'A2', title: 'Invoices linked to a PO', subtitle: 'Facturas de una OC existente',
    description: 'Register one or more invoices for an existing purchase order.',
    requirements: 'OC vigente, XML/PDF de la factura y validación SUNAT existente.',
    kind: 'batch', permission: 'batch_invoice.upload'
  },
  {
    code: 'B', title: 'Direct invoice', subtitle: 'Sin orden de compra',
    description: 'Direct payment request with an invoice and Accounting review.',
    requirements: 'Proveedor, comprobante y cuenta bancaria verificada.',
    kind: 'request', permission: 'request.create'
  },
  {
    code: 'C', title: 'Advance to render / petty cash', subtitle: 'Adelanto o reembolso',
    description: 'Employee funds with a subsequent rendition and supporting vouchers.',
    requirements: 'Colaborador, motivo, importe, CECO y rendición según corresponda.',
    kind: 'request', permission: 'request.create'
  },
  {
    code: 'D', title: 'Transfer between accounts', subtitle: 'Solo Tesorería',
    description: 'Transfer funds between UMA accounts with GAF approval.',
    requirements: 'Cuentas origen/destino, monto, sustento y aprobaciones.',
    kind: 'transfer', permission: 'treasury.transfer'
  },
  {
    code: 'M', title: 'Mobility', subtitle: 'Gastos de desplazamiento',
    description: 'Record employee trips with daily limits and non-deductible amounts.',
    requirements: 'Trabajador, fechas, trayectos, importes y sustento firmado.',
    kind: 'special', permission: 'request.create'
  },
  {
    code: 'H', title: 'Teacher fees', subtitle: 'Gestión de Personas',
    description: 'Fee receipts and fourth-category withholding.',
    requirements: 'Docentes, RxH, constancia de suspensión cuando corresponda y PDF.',
    kind: 'special', permission: 'honorarios.manage'
  },
  {
    code: 'E', title: 'Student refund', subtitle: 'Reclamo o devolución',
    description: 'Documented refund with income verification and Legal review.',
    requirements: 'Alumno, motivo, número de reclamo/evidencia, importe y PDF.',
    kind: 'special', permission: 'request.create'
  }
]);

export function processByCode(code) {
  return UMA_PROCESSES.find(process => process.code === String(code || '').toUpperCase()) || null;
}

// Who starts each process (Manual de usuario): the area registers A1, A2, B, C, M and E;
// Gestión de Personas uploads H; Tesorería registers D.
export function canStartUmaProcess(process, user, readOnly = false) {
  if (!process || !user || readOnly) return false;
  return userCan(user, process.permission);
}

export function processDestination(code) {
  const process = processByCode(code);
  if (!process) return null;
  if (process.kind === 'request') return `/requests/new/form?process=${process.code}`;
  if (process.kind === 'special') return `/special-expenses?type=${process.code}`;
  if (process.kind === 'batch') return '/batch-invoices';
  if (process.kind === 'transfer') return '/treasury/transfers';
  return null;
}

export function requestFlowFromProcess(code) {
  if (code === 'A1' || code === 'B') return {flowType: code, requestType: 'OPEX'};
  if (code === 'C') return {flowType: 'C', requestType: 'ENTREGA_RENDIR'};
  return null;
}

export function restrictedProcessLabel(code) {
  return ({D: 'Disponible para Tesorería', H: 'Disponible para Gestión de Personas', A2: 'Requiere acceso a facturas A2'})[code] || 'No habilitado para tu perfil';
}
