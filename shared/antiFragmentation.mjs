// Independent, testable calculation of spending charged to each cost center.
export function chargedCostCenterAmounts(request) {
  const amount = Number(request.totalPENEquivalent ?? request.penEquivalent ?? 0);
  const allocations = request.costCenterType === "POR_ENCARGO" ? (request.costAllocations || []) : [];
  if (allocations.length) {
    return allocations.map((allocation) => ({
      id: String(allocation.costCenter?._id || allocation.costCenter || ""),
      amount: amount * Number(allocations.length === 1 && allocation.percentage == null ? 100 : allocation.percentage || 0) / 100
    })).filter((allocation) => allocation.id && allocation.amount > 0);
  }
  const centerId = String(request.requesterCostCenter?._id || request.requesterCostCenter || "");
  return centerId ? [{ id: centerId, amount }] : [];
}

