import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api/client.js";
import { initialTableQuery } from "../utils/initialTableQuery.js";
import { buildRemoteTableParams } from "../utils/tableQuery.js";

const emptyPagination = Object.freeze({ page: 1, pageSize: 10, total: 0, totalPages: 1 });

export default function usePaginatedResource(endpoint, {
  fixedParams = {},
  initialFilters = {},
  initialSearch = "",
  initialPageSize = 10,
  persistKey,
  enabled = true,
  debounceMs = 220,
  // True while fixedParams carry a notification deep link (?record= / ?request=): the table then
  // starts from page 1 without the saved search/filters, which could hide the linked record.
  deepLink = false
} = {}) {
  const storageKey = `erp_table_query:${persistKey || endpoint}`;
  const [query, setQuery] = useState(() => {
    const options = { initialFilters, initialSearch, initialPageSize };
    try {
      return initialTableQuery(deepLink ? null : JSON.parse(sessionStorage.getItem(storageKey) || "null"), options);
    } catch {
      return initialTableQuery(null, options);
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

  // A changed fixed filter (another currency, a new or cleared deep link) restarts at page 1: the
  // old page number may not exist in the new result.
  const previousFixedParams = useRef(fixedParamsKey);
  useEffect(() => {
    if (previousFixedParams.current === fixedParamsKey) return;
    previousFixedParams.current = fixedParamsKey;
    setQuery((current) => deepLink
      ? { ...current, page: 1, search: "", filters: { ...initialFilters } }
      : current.page === 1 ? current : { ...current, page: 1 });
  }, [fixedParamsKey]);

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
