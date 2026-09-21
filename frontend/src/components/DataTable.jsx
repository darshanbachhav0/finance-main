import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FilterX,
  ListFilter,
  Search
} from "lucide-react";
import { LayoutList, Table2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../context/ToastContext.jsx";
import RequestStageIndicator from "./RequestStageIndicator.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import EmptyState from "./EmptyState.jsx";
import RowActionMenu from "./RowActionMenu.jsx";
import TableTools from "./TableTools.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";

function rawValue(column, row) {
  if (column.getValue) return column.getValue(row);
  return row[column.key];
}

function compare(left, right) {
  if (left === right) return 0;
  if (left === undefined || left === null || left === "") return 1;
  if (right === undefined || right === null || right === "") return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

export default function DataTable({
  className = "",
  columns,
  rows = [],
  rowKey = "_id",
  loading = false,
  controls = true,
  showResultCount = controls,
  pageSize: initialPageSize = 10,
  searchPlaceholder = "Search records...",
  filters = [],
  initialFilters = {},
  selection,
  rowActions,
  onRowClick,
  toolbarActions,
  tableId,
  exportable = false,
  onExport,
  emptyDescription = "Adjust filters or create a new record.",
  emptyAction,
  caption,
  remote
}) {
  const { t } = useLanguage();
  const { notify } = useToast();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState(initialFilters);
  const [sort, setSort] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [density, setDensity] = useState(() => localStorage.getItem("erp_table_density") || "comfortable");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobileCards, setMobileCards] = useState(true);
  const scrollRef = useRef(null);
  const primaryColumns = columns.filter((column, index) => index < 2 || column.primary === true || /amount|total|status|action|supplier|beneficiary/i.test(column.key));
  const secondaryColumns = columns.filter(column => !primaryColumns.includes(column));
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setScrolls(element.scrollWidth > element.clientWidth + 1);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    update();
    return () => observer.disconnect();
  }, [rows, columns, mobileCards, loading]);
  const tableIdentity = tableId || caption || searchPlaceholder || columns.map((column) => column.key).join("-");
  const preferenceKey = `erp_table_views:${user?._id || "local"}:${String(tableIdentity).replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}`;

  const isRemote = Boolean(remote?.onQueryChange);
  const activeSearch = isRemote ? remote.query?.search || "" : search;
  const activeFilters = isRemote ? remote.query?.filters || {} : filterValues;
  const activeSort = isRemote ? remote.query?.sort || null : sort;
  const activePageSize = isRemote ? remote.query?.pageSize || remote.pagination?.pageSize || initialPageSize : pageSize;

  useEffect(() => {
    if (!isRemote) setPage(1);
  }, [search, filterValues, pageSize, rows.length, isRemote]);

  const processed = useMemo(() => {
    if (isRemote) return rows;
    let next = [...rows];
    const needle = activeSearch.trim().toLowerCase();
    if (needle) {
      next = next.filter((row) => columns.some((column) => {
        if (column.searchable === false || column.key === "actions") return false;
        const value = rawValue(column, row);
        return value !== undefined && value !== null && String(value).toLowerCase().includes(needle);
      }));
    }
    for (const filter of filters) {
      const selected = activeFilters[filter.key];
      if (selected === undefined || selected === "") continue;
      next = next.filter((row) => {
        const value = filter.getValue ? filter.getValue(row) : row[filter.key];
        return String(value) === String(selected);
      });
    }
    if (activeSort) {
      const column = columns.find((item) => (item.sortKey || item.key) === activeSort.key);
      if (column) next.sort((left, right) => compare(rawValue(column, left), rawValue(column, right)) * (activeSort.direction === "asc" ? 1 : -1));
    }
    return next;
  }, [rows, columns, activeSearch, filters, activeFilters, activeSort, isRemote]);

  const pageCount = isRemote
    ? Math.max(1, remote.pagination?.totalPages || 1)
    : Math.max(1, Math.ceil(processed.length / activePageSize));
  const currentPage = isRemote ? remote.pagination?.page || remote.query?.page || 1 : page;
  const safePage = Math.min(currentPage, pageCount);
  const visibleRows = isRemote ? processed : processed.slice((safePage - 1) * activePageSize, safePage * activePageSize);
  const selectedIds = selection?.selected || [];
  const selectableVisible = visibleRows.filter((row) => !selection?.isRowSelectable || selection.isRowSelectable(row));
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((row) => selectedIds.includes(row[rowKey]));
  const hasFilters = Boolean(activeSearch) || Object.values(activeFilters).some(Boolean);
  const activeFilterCount = Object.values(activeFilters).filter(Boolean).length;

  function updateRemote(patch) {
    remote.onQueryChange({ ...remote.query, ...patch });
  }

  function toggleSort(column) {
    if (column.sortable === false || column.key === "actions") return;
    const key = column.sortKey || column.key;
    const current = activeSort;
    const next = !current || current.key !== key
      ? { key, direction: "asc" }
      : current.direction === "asc"
        ? { key, direction: "desc" }
        : null;
    if (isRemote) updateRemote({ sort: next, page: 1 });
    else setSort(next);
  }

  function toggleAllVisible() {
    const visibleIds = selectableVisible.map((row) => row[rowKey]);
    const next = allVisibleSelected
      ? selectedIds.filter((id) => !visibleIds.includes(id))
      : [...new Set([...selectedIds, ...visibleIds])];
    selection.onChange(next);
  }

  function clearFilters() {
    const previous = { search: activeSearch, filters: { ...activeFilters }, sort: activeSort, page: currentPage };
    notify("Filters cleared.", "info", { action: { label: "Undo", onClick: () => { if (isRemote) updateRemote(previous); else { setSearch(previous.search); setFilterValues(previous.filters); setSort(previous.sort); setPage(previous.page); } } } });
    if (isRemote) updateRemote({ search: "", filters: {}, sort: null, page: 1 });
    else {
      setSearch("");
      setFilterValues({});
      setSort(null);
    }
  }

  function changeDensity(value) {
    setDensity(value);
    localStorage.setItem("erp_table_density", value);
  }

  function applySavedView(view) {
    if (view.density) changeDensity(view.density);
    if (isRemote) {
      updateRemote({
        search: view.search || "",
        filters: view.filters || {},
        sort: view.sort || null,
        pageSize: view.pageSize || initialPageSize,
        page: 1
      });
    } else {
      setSearch(view.search || "");
      setFilterValues(view.filters || {});
      setSort(view.sort || null);
      setPageSize(view.pageSize || initialPageSize);
      setPage(1);
    }
  }

  function exportCurrentResults() {
    const exportColumns = columns.filter((column) => column.key !== "actions" && column.exportable !== false);
    const exportRows = isRemote ? rows : processed;
    const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [
      exportColumns.map((column) => escape(t(column.label))).join(","),
      ...exportRows.map((row) => exportColumns.map((column) => {
        const value = column.exportValue ? column.exportValue(row) : rawValue(column, row);
        return escape(typeof value === "object" ? JSON.stringify(value) : value);
      }).join(","))
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${String(tableIdentity).replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div aria-busy={loading} className={`data-table density-${density} ${mobileCards ? "mobile-cards" : ""} ${className}`.trim()}>
      {controls && (
        <div className="table-toolbar">
          <div className="table-toolbar-primary">
            <label className="table-search">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">{t("Search")}</span>
              <input value={activeSearch} onChange={(event) => isRemote ? updateRemote({ search: event.target.value, page: 1 }) : setSearch(event.target.value)} placeholder={t(searchPlaceholder)} />
            </label>
            {filters.length > 0 && <button type="button" className={`table-filter-toggle${activeFilterCount ? " has-active" : ""}`} aria-expanded={mobileFiltersOpen} onClick={() => setMobileFiltersOpen((current) => !current)}><ListFilter size={16} /><span>{t("More filters")}{activeFilterCount ? ` (${activeFilterCount})` : ""}</span><ChevronDown size={15} /></button>}
            <div className={`table-filter-fields simplified-filters${mobileFiltersOpen ? " is-open" : ""}`}>
              {filters.map((filter) => (
                <label hidden={!mobileFiltersOpen && !/^(status|area|date|period|accountingPeriod)$/.test(filter.key)} className="compact-field" key={filter.key}>
                  <span className="sr-only">{t(filter.label)}</span>
                  <select value={activeFilters[filter.key] || ""} onChange={(event) => isRemote ? updateRemote({ filters: { ...activeFilters, [filter.key]: event.target.value }, page: 1 }) : setFilterValues((current) => ({ ...current, [filter.key]: event.target.value }))}>
                    <option value="">{t(filter.allLabel || `All ${filter.label.toLowerCase()}`)}</option>
                    {filter.options.map((option) => (
                      <option key={option.value ?? option} value={option.value ?? option}>{t(option.label ?? option)}</option>
                    ))}
                  </select>
                </label>
              ))}
              {hasFilters && (
                <button type="button" className="text-button" onClick={clearFilters}>
                  <FilterX size={15} />
                  <span>{t("Clear filters")}</span>
                </button>
              )}
            </div>
          </div>
          <div className="table-toolbar-actions">
            <button type="button" className="secondary-button mobile-table-toggle" aria-pressed={mobileCards} onClick={() => setMobileCards((value) => !value)}>{mobileCards ? <Table2 size={16} /> : <LayoutList size={16} />}{t(mobileCards ? "Table view" : "Card view")}</button>
            {toolbarActions}
            <details className="compact-options"><summary>{t("Table options")}</summary><div className="compact-options-body">
            <div className="field"><span>{t("Sort by")}</span><select aria-label={t("Sort by")} value={activeSort?.key || ""} onChange={event => { const column = columns.find(item => (item.sortKey || item.key) === event.target.value); const next = column ? { key: column.sortKey || column.key, direction: "asc" } : null; if (isRemote) updateRemote({ sort: next, page: 1 }); else setSort(next); }}><option value="">{t("Sort by")}</option>{columns.filter(column => column.sortable !== false && column.key !== "actions").map(column => <option key={column.key} value={column.sortKey || column.key}>{t(column.label)}</option>)}</select></div>{activeSort && <button type="button" className="secondary-button" onClick={() => toggleSort(columns.find(column => (column.sortKey || column.key) === activeSort.key))}>{t(activeSort.direction === "asc" ? "Sort descending" : "Sort ascending")}</button>}
            <TableTools
              storageKey={preferenceKey}
              query={{ search: activeSearch, filters: activeFilters, sort: activeSort, pageSize: activePageSize, density }}
              onApplyView={applySavedView}
              density={density}
              onDensityChange={changeDensity}
              onExport={onExport ? () => onExport({ rows: visibleRows, query: { search: activeSearch, filters: activeFilters, sort: activeSort, pageSize: activePageSize } }) : exportable ? exportCurrentResults : undefined}
            />
            </div></details>
          </div>
        </div>
      )}

      {controls && hasFilters && <div className="active-filter-chips" aria-label={t("Active filters")}>
        {activeSearch && <span>{t("Search")}: {activeSearch}</span>}
        {filters.filter((filter) => activeFilters[filter.key]).map((filter) => {
          const value = activeFilters[filter.key];
          const option = filter.options.find((entry) => String(entry.value ?? entry) === String(value));
          return <span key={filter.key}>{t(filter.label)}: {t(option?.label ?? value)}</span>;
        })}
        <button type="button" className="text-button" onClick={clearFilters}><X size={14} />{t("Clear filters")}</button>
      </div>}

      {showResultCount && (
        <div className="table-result-bar">
          <span role="status">{loading ? t("Loading records...") : t("Showing {shown} of {total} results").replace("{shown}", visibleRows.length).replace("{total}", isRemote ? remote.pagination?.total || 0 : processed.length)}</span>
          {selection && selectedIds.length > 0 && <strong>{t("{count} selected").replace("{count}", selectedIds.length)}</strong>}
        </div>
      )}

      {scrolls && <p className="table-scroll-note">{t("Scroll horizontally to see all columns.")}</p>}
      <div ref={scrollRef} className="table-scroll" role="region" aria-busy={loading} aria-label={t(caption || "Scrollable results")} tabIndex={0}>
        <table role="table">
          {caption && <caption className="sr-only">{t(caption)}</caption>}
          <thead>
            <tr>
              {selection && (
                <th className="checkbox-column">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label={t("Select all visible rows")} />
                </th>
              )}
              {primaryColumns.map((column) => {
                const sorted = activeSort?.key === (column.sortKey || column.key);
                const SortIcon = !sorted ? ChevronsUpDown : activeSort.direction === "asc" ? ArrowUp : ArrowDown;
                return (
                  <th scope="col" aria-sort={sorted ? activeSort.direction === "asc" ? "ascending" : "descending" : undefined} key={column.key} className={column.align ? `align-${column.align}` : ""} style={column.width ? { width: column.width } : undefined}>
                    {column.sortable === false || column.key === "actions" ? t(column.label) : (
                      <button type="button" className="sort-button" onClick={() => toggleSort(column)}>
                        <span>{t(column.label)}</span>
                        <SortIcon size={14} aria-hidden="true" />
                      </button>
                    )}
                  </th>
                );
              })}
              {secondaryColumns.length > 0 && <th>{t("Details")}</th>}
              {rowActions && <th className="actions-column"><span className="sr-only">{t("Actions")}</span></th>}
            </tr>
          </thead>
          <tbody>
            {loading ? Array.from({ length: Math.min(activePageSize, 6) }).map((_, rowIndex) => (
              <tr key={`loading-${rowIndex}`} aria-hidden="true">
                {selection && <td><span className="skeleton skeleton-check" /></td>}
                {primaryColumns.map((column) => <td key={column.key}><span className="skeleton skeleton-line" /></td>)}
                {secondaryColumns.length > 0 && <td><span className="skeleton skeleton-line" /></td>}
                {rowActions && <td><span className="skeleton skeleton-check" /></td>}
              </tr>
            )) : visibleRows.map((row) => (
              <tr
                key={row[rowKey]}
                className={`${onRowClick ? "clickable-row" : ""}${selection && selectedIds.includes(row[rowKey]) ? " is-selected" : ""}`}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (event) => { if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); onRowClick(row); } } : undefined}
                onClick={onRowClick ? (event) => {
                  if (event.target.closest("a, button, input, select, textarea, details")) return;
                  onRowClick(row);
                } : undefined}
              >
                {selection && (
                  <td className="checkbox-column" data-label={t("Select row")}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(row[rowKey])}
                      disabled={selection.isRowSelectable && !selection.isRowSelectable(row)}
                      onChange={() => selection.onChange(selectedIds.includes(row[rowKey]) ? selectedIds.filter((id) => id !== row[rowKey]) : [...selectedIds, row[rowKey]])}
                      aria-label={t("Select row")}
                    />
                  </td>
                )}
                {primaryColumns.map((column) => {
                  const value = column.render ? column.render(row) : rawValue(column, row);
                  return <td key={column.key} className={column.align ? `align-${column.align}` : ""} data-label={t(column.label)}>{typeof value === "string" ? t(value) : value}</td>;
                })}
                {secondaryColumns.length > 0 && <td data-label={t("Details")}><details className="row-details" onClick={event => event.stopPropagation()}><summary>{t("Details")}</summary><dl>{secondaryColumns.map(column => { const value = column.render ? column.render(row) : rawValue(column, row); return <div key={column.key}><dt>{t(column.label)}</dt><dd>{typeof value === "string" ? t(value) : value}</dd></div>; })}</dl>{row.requestNumber && row.status && <RequestStageIndicator request={row} />}</details></td>}
                {rowActions && <td className="actions-column" data-label={t("Actions")}><RowActionMenu row={row} actions={rowActions} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !visibleRows.length && <EmptyState title={hasFilters ? "No matching results" : "No records yet"} filtered={hasFilters} onClear={hasFilters ? clearFilters : undefined} action={!hasFilters ? emptyAction : undefined} description={hasFilters ? "Try a different search or clear your filters." : emptyDescription} />}
      </div>

      {controls && (processed.length > 0 || (isRemote && (remote.pagination?.total || 0) > 0)) && (
        <div className="table-pagination">
          <label className="page-size">
            <span>{t("Rows per page")}</span>
            <select value={activePageSize} onChange={(event) => isRemote ? updateRemote({ pageSize: Number(event.target.value), page: 1 }) : setPageSize(Number(event.target.value))}>
              {[10, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <span>{t("Page {page} of {pages}").replace("{page}", safePage).replace("{pages}", pageCount)}</span>
          <div className="pagination-buttons">
            <button type="button" className="icon-button" disabled={safePage <= 1} onClick={() => isRemote ? updateRemote({ page: Math.max(1, safePage - 1) }) : setPage((current) => Math.max(1, current - 1))} aria-label={t("Previous page")}><ChevronLeft size={17} /></button>
            <button type="button" className="icon-button" disabled={safePage >= pageCount} onClick={() => isRemote ? updateRemote({ page: Math.min(pageCount, safePage + 1) }) : setPage((current) => Math.min(pageCount, current + 1))} aria-label={t("Next page")}><ChevronRight size={17} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
