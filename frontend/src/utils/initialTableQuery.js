// Initial query state for a remote table (usePaginatedResource).
//
// A drill-down link (filters or a search in the URL) defines the whole query: merging it with
// filters saved from an earlier visit would show a different, narrower list than the dashboard
// card promised. Only the viewer's page size and sort survive. Without URL filters the saved
// query (sessionStorage) is restored as before.
export function initialTableQuery(stored, { initialFilters = {}, initialSearch = "", initialPageSize = 10 } = {}) {
  const fallback = { page: 1, pageSize: initialPageSize, search: initialSearch, filters: initialFilters, sort: null };
  if (!stored || typeof stored !== "object") return fallback;
  const explicitFilters = Object.entries(initialFilters).filter(([, value]) => value !== "" && value !== undefined && value !== null);
  if (explicitFilters.length || initialSearch) {
    return { ...fallback, pageSize: stored.pageSize || fallback.pageSize, sort: stored.sort ?? null, filters: { ...initialFilters } };
  }
  return { ...fallback, ...stored, filters: { ...initialFilters, ...(stored.filters || {}) } };
}
