// Tipo de Centro de Costo of a saved request (shared/costCenterAllocation.mjs has the rules).
export const costCenterTypeLabels = { PROPIO: "Own cost center", POR_ENCARGO: "On behalf of another area" };

export const isOnBehalf = (request) => request?.costCenterType === "POR_ENCARGO" && (request.costAllocations || []).length > 0;

// "Escuela de Medicina, Escuela de Enfermería": who a Por Encargo request is for; "" otherwise.
export function beneficiaryNames(request) {
  if (!isOnBehalf(request)) return "";
  return request.costAllocations.map((allocation) => allocation.costCenterSnapshot?.name || allocation.costCenterSnapshot?.code || "").filter(Boolean).join(", ");
}
