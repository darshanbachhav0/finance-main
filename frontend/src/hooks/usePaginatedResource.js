import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/client.js";
import { buildRemoteTableParams } from "../utils/tableQuery.js";

const emptyPagination = Object.freeze({ page: 1, pageSize: 10, total: 0, totalPages: 1 });

export default function usePaginatedResource(endpoint, {
  fixedParams = {},
  initialFilters = {},
  initialSearch = "",
  initialPageSize = 10,
  persistKey,
  enabled = true,
  debounceMs = 220
} = {}) {
  const storageKey = `erp_table_query:${persistKey || endpoint}`;
  const [query, setQuery] = useState(() => {
    const fallback = { page: 1, pageSize: initialPageSize, search: initialSearch, filters: initialFilters, sort: null };
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (!stored) return fallback;
      const explicitFilters = Object.fromEntries(Object.entries(initialFilters).filter(([, value]) => value !== "" && value !== undefined && value !== null));
      return { ...fallback, ...stored, ...(initialSearch ? { search: initialSearch } : {}), filters: { ...stored.filters, ...explicitFilters } };
    } catch {
      return fallback;
    }
  });
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ ...emptyPagination, pageSize: initialPageSize });
  const [payload, setPayload] = useState({});
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const fixedParamsKey = JSON.stringify(fixedParams);
  const requestParams = useMemo(() => buildRemoteTableParams(query, fixedParams), [query, fixedParamsKey]);

  useEffect(() => {
    sessionStorage.setItem(storageKey, JSON.stringify(query));
  }, [query, storageKey]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    let active = true;
    const controller = new AbortController();
    const delay = query.search?.trim() ? debounceMs : 0;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await api.get(endpoint, { params: requestParams, signal: controller.signal });
        if (!active) return;
        setRows(response.data.data || []);
        setPagination(response.data.pagination || {
          page: query.page,
          pageSize: query.pageSize,
          total: response.data.data?.length || 0,
          totalPages: 1
        });
        setPayload(response.data || {});
        setError("");
      } catch (requestError) {
        if (!active || requestError.code === "ERR_CANCELED") return;
        setError(requestError.message);
      } finally {
        if (active) setLoading(false);
      }
    }, delay);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [endpoint, requestParams, revision, enabled, debounceMs]);

  const reload = useCallback(() => setRevision((current) => current + 1), []);
  const remote = useMemo(() => ({ query, pagination, onQueryChange: setQuery }), [query, pagination]);

  return { rows, pagination, payload, query, setQuery, remote, loading, error, reload };
}
