// A shared annual plan may appear on several request lines. Display it once,
// using the final cumulative projection returned by the budget service.
export function simulationSources(preview) {
  const sources = new Map();
  for (const line of preview?.lines || []) {
    const key = String(line.allocation?._id || line.allocation || line.costCenter?._id || line.costCenter);
    const previous = sources.get(key);
    sources.set(key, { ...line, key, requested: Math.round(((previous?.requested || 0) + Number(line.amount || 0)) * 100) / 100 });
  }
  return [...sources.values()];
}

export function budgetBar(available, requested) {
  const capacity = Math.max(0, Number(available) || 0);
  const demand = Math.max(0, Number(requested) || 0);
  const total = Math.max(capacity, demand, 1);
  return { request: Math.min(capacity, demand) / total * 100, remaining: Math.max(0, capacity - demand) / total * 100, shortfall: Math.max(0, demand - capacity) / total * 100 };
}
