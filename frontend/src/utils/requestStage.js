import { canonicalRequestStatus } from "../../../shared/workflowStatus.mjs";
export const requestStages = ["Request", "Approval", "Budget", "Accounting", "Payment", "Reconciliation"];
export function requestStage(status) {
  const stages = { BORRADOR: 0, EN_VALIDACION: 0, PENDIENTE_APROBACION: 1, APROBADO_DIRECTOR: 1, APROBADO_VICERRECTOR: 2, COMPROMISO_PRESUPUESTAL: 3, CONTABILIZADO: 4, PROGRAMADO: 4, TXT_GENERADO: 4, PAGADO: 5, CONCILIADO: 5, CERRADO: 6 };
  return stages[canonicalRequestStatus(status)] ?? -1;
}
