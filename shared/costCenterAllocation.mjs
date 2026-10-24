// Tipo de Centro de Costo. PROPIO: the request is charged to the requester's own CECO (or one their
// profile authorizes), as every request was before this field existed. POR_ENCARGO: the requester's
// department buys on behalf of another school or department, whose CECO bears the expense; it may be
// shared across several CECOs by percentage. Shared by the request model, budget, accounting and the
// request form, so the shares are computed the same way everywhere.
export const COST_CENTER_TYPE = Object.freeze({ OWN: "PROPIO", ON_BEHALF: "POR_ENCARGO" });
export const COST_CENTER_TYPES = Object.freeze(Object.values(COST_CENTER_TYPE));

const cents = (value) => Math.round(Number(value || 0) * 100);
const idOf = (value) => String(value?._id || value || "");
const blank = (value) => value === undefined || value === null || value === "";

export function percentageTotal(percentages = []) {
  return Math.round(percentages.reduce((sum, value) => sum + Number(value || 0) * 100, 0)) / 100;
}

// The percentage each allocation carries: one beneficiary alone is 100% when none was typed.
export function allocationPercentages(allocations = []) {
  return allocations.map((allocation) => (allocations.length === 1 && blank(allocation.percentage) ? 100 : Number(allocation.percentage)));
}

// Splits an amount by percentages, to the cent. When they add up to 100 the shares add up to the
// amount exactly: each share is rounded down and the cents left go to the largest remainders.
export function splitByPercentages(amount, percentages = []) {
  const total = cents(amount);
  const exact = percentages.map((percentage) => total * Number(percentage || 0) / 100);
  if (percentageTotal(percentages) !== 100) return exact.map((value) => Math.round(value) / 100);
  const shares = exact.map((value) => Math.floor(value + 1e-9));
  let left = total - shares.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, remainder: value - shares[index] })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    shares[index] += 1;
    left -= 1;
  }
  return shares.map((value) => value / 100);
}

// What is wrong with a Por Encargo distribution, first problem first. Each allocation is
// { costCenter, percentage }.
export function costAllocationProblems(allocations = []) {
  if (!allocations.length) return [{ field: "costAllocations", message: "Choose the school or department the request is for." }];
  const problems = [];
  const seen = new Set();
  const percentages = allocationPercentages(allocations);
  allocations.forEach((allocation, index) => {
    const id = idOf(allocation.costCenter);
    if (!id) problems.push({ field: `costAllocations.${index}.costCenter`, message: "Choose the school or department the request is for." });
    else if (seen.has(id)) problems.push({ field: `costAllocations.${index}.costCenter`, message: "Each cost center can be chosen only once." });
    seen.add(id);
    const percentage = percentages[index];
    const twoDecimals = Math.abs(percentage * 100 - Math.round(percentage * 100)) < 1e-6;
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100 || !twoDecimals) problems.push({ field: `costAllocations.${index}.percentage`, message: "Enter a percentage greater than 0 and up to 100, with at most two decimals." });
  });
  if (!problems.some((problem) => problem.field.endsWith(".percentage")) && percentageTotal(percentages) !== 100) problems.push({ field: "costAllocations", message: "The distribution must add up to 100%." });
  return problems;
}

// The beneficiary CECOs a Por Encargo request is shared across. One beneficiary (or a Propio
// request) has none: its lines already carry the CECO that bears the expense.
export function sharedCostAllocations(request) {
  if (request?.costCenterType !== COST_CENTER_TYPE.ON_BEHALF) return [];
  const allocations = request.costAllocations || [];
  return allocations.length > 1 ? allocations : [];
}

// Splits amount rows (budget dimensions, journal debits) across the shared CECOs: each row becomes
// one per CECO carrying its share of `field`, to the cent (a CECO whose share rounds to zero gets
// no row). Rows are returned unchanged when the request is not shared.
export function distributeAcrossCostCenters(rows, allocations, field) {
  if (!allocations?.length) return rows;
  const percentages = allocations.map((allocation) => allocation.percentage);
  return rows.flatMap((row) => {
    const parts = splitByPercentages(row[field], percentages)
      .map((amount, index) => ({ ...row, costCenter: allocations[index].costCenter?._id || allocations[index].costCenter, [field]: amount }));
    const nonZero = parts.filter((part) => part[field] !== 0);
    return nonZero.length ? nonZero : parts.slice(0, 1);
  });
}
