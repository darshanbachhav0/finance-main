export function buildRemoteTableParams(query, fixedParams = {}) {
  const params = {
    ...fixedParams,
    page: query.page,
    pageSize: query.pageSize
  };
  if (query.search?.trim()) params.search = query.search.trim();
  for (const [key, value] of Object.entries(query.filters || {})) {
    if (value !== "" && value !== undefined && value !== null) params[key] = value;
  }
  if (query.sort?.key) {
    params.sortBy = query.sort.key;
    params.sortDirection = query.sort.direction;
  }
  return params;
}
