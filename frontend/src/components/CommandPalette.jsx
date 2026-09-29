import { Building2, ClipboardList, CornerDownLeft, FileText, Loader2, Receipt, Search, UserRound, Wallet, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import api from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import useAnimatedPresence from "../hooks/useAnimatedPresence.js";
import { formatCurrency } from "../utils/formatters.js";

// Record search (GET /api/search) starts at this many characters; the server applies the same
// minimum, escapes the term and scopes every group to what the caller may open.
const MIN_RECORD_QUERY = 2;
const SEARCH_DEBOUNCE_MS = 220;

// Groups in display order. `typeLabel` is the per-row badge.
const RECORD_TYPES = {
  requests: { label: "Requests", typeLabel: "Request", icon: ClipboardList },
  suppliers: { label: "Suppliers", typeLabel: "Supplier", icon: Building2 },
  vouchers: { label: "Invoices and vouchers", typeLabel: "Voucher", icon: Receipt },
  payables: { label: "Accounts payable", typeLabel: "CXP", icon: Wallet },
  users: { label: "People", typeLabel: "Person", icon: UserRound }
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Wraps every case-insensitive occurrence of the query in <mark>.
function Highlight({ text, query }) {
  const value = String(text ?? "");
  const needle = query.trim();
  if (!needle || !value) return value;
  return value.split(new RegExp(`(${escapeRegExp(needle)})`, "ig")).map((part, index) => (index % 2 ? <mark key={index} className="command-match">{part}</mark> : part));
}

function recordSubtitle(type, item, t, language) {
  const money = (amount, currency) => formatCurrency(amount, currency, language);
  const parts = {
    requests: [item.description, item.supplierName || t("Unknown supplier"), money(item.amount, item.currency), t(item.status)],
    suppliers: [item.ruc && `RUC ${item.ruc}`, item.code, item.commercialName, t(item.status), !item.active && t("Inactive")],
    vouchers: [t(item.voucherType), item.ruc && `RUC ${item.ruc}`, item.requestNumber, money(item.amount, item.currency), t(item.status)],
    payables: [item.supplierName, item.voucher && item.requestNumber, `${t("Outstanding")} ${money(item.amount, item.currency)}`, t(item.status)],
    users: [item.dni && `DNI ${item.dni}`, item.email, t(item.role), !item.active && t("Inactive")]
  }[type] || [];
  return parts.filter(Boolean).join(" · ");
}

// The Users screen has no single-record link: open it with its table search set to the person.
function openUserFilter(filter) {
  const key = "erp_table_query:/users";
  let stored = {};
  try { stored = JSON.parse(sessionStorage.getItem(key) || "{}") || {}; } catch { stored = {}; }
  try { sessionStorage.setItem(key, JSON.stringify({ page: 1, pageSize: stored.pageSize || 10, search: filter, filters: {}, sort: stored.sort ?? null })); } catch { /* storage unavailable: the list opens unfiltered */ }
}

export default function CommandPalette({ open, onClose, pages }) {
  const { t, language } = useLanguage();
  const { user } = useAuth() || {};
  const navigate = useNavigate();
  const titleId = useId();
  const listId = useId();
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const previousFocus = useRef(null);
  const [query, setQuery] = useState("");
  const [recordGroups, setRecordGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const { shouldRender, phase } = useAnimatedPresence(open, 170);
  const trimmed = query.trim();
  const canSearchRecords = Boolean(user) && user.role !== "ManagementViewer";
  const searchesRecords = canSearchRecords && trimmed.length >= MIN_RECORD_QUERY;

  const sections = useMemo(() => {
    const needle = trimmed.toLowerCase();
    const pageItems = pages
      .filter((item) => !needle || `${t(item.label)} ${t(item.group)}`.toLowerCase().includes(needle))
      .slice(0, 8)
      .map((item) => ({ ...item, kind: "page", key: `page-${item.path}`, title: t(item.label), subtitle: t(item.group), typeLabel: "Page" }));
    const list = pageItems.length ? [{ key: "pages", label: "Pages", items: pageItems }] : [];
    for (const group of recordGroups) {
      const config = RECORD_TYPES[group.type];
      if (!config || !group.items?.length) continue;
      list.push({
        key: group.type,
        label: config.label,
        items: group.items.map((item) => ({ ...item, kind: group.type, key: `${group.type}-${item.id}`, icon: config.icon, typeLabel: config.typeLabel, subtitle: recordSubtitle(group.type, item, t, language) }))
      });
    }
    return list;
  }, [pages, recordGroups, trimmed, t, language]);
  const results = useMemo(() => sections.flatMap((section) => section.items), [sections]);

  useEffect(() => {
    if (!open) return undefined;
    previousFocus.current = document.activeElement;
    setQuery("");
    setRecordGroups([]);
    setSearchFailed(false);
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!shouldRender) previousFocus.current?.focus?.({ preventScroll: true });
  }, [shouldRender]);

  // Debounced record search; a newer keystroke cancels the pending request.
  useEffect(() => {
    if (!open || !searchesRecords) {
      setRecordGroups([]);
      setLoading(false);
      setSearchFailed(false);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.get("/search", { params: { q: trimmed }, signal: controller.signal });
        setRecordGroups(response.data.groups || []);
        setSearchFailed(false);
      } catch (error) {
        if (error.code === "ERR_CANCELED") return;
        setRecordGroups([]);
        setSearchFailed(true);
      }
      setLoading(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, searchesRecords, trimmed]);

  useEffect(() => setActiveIndex((current) => Math.min(current, Math.max(0, results.length - 1))), [results.length]);

  useEffect(() => {
    dialogRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  function choose(item) {
    if (!item) return;
    if (item.kind === "users" && item.filter) openUserFilter(item.filter);
    onClose();
    navigate(item.path);
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => results.length ? (current + 1) % results.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => results.length ? (current - 1 + results.length) % results.length : 0);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, results.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[activeIndex]);
    } else if (event.key === "Tab") {
      const focusable = [...(dialogRef.current?.querySelectorAll('button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  if (!shouldRender) return null;

  const optionId = (index) => `${listId}-option-${index}`;
  const hasRecordResults = sections.some((section) => section.key !== "pages");
  let status = "";
  if (searchesRecords && loading && !hasRecordResults) status = "Searching records...";
  else if (searchFailed) status = "Records could not be searched. Pages are still available.";
  else if (canSearchRecords && trimmed.length > 0 && trimmed.length < MIN_RECORD_QUERY) status = "Type at least 2 characters to search records.";
  let runningIndex = 0;

  return createPortal(
    <div className={`command-backdrop motion-${phase}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <h2 id={titleId} className="sr-only">{t("Search the system")}</h2>
        <div className="command-search">
          <Search size={19} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            placeholder={t(canSearchRecords ? "Search pages, requests, suppliers, invoices..." : "Search pages...")}
            aria-label={t(canSearchRecords ? "Search pages, requests, suppliers, invoices..." : "Search pages...")}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results.length ? optionId(activeIndex) : undefined}
          />
          {loading ? <Loader2 className="spin" size={17} aria-label={t("Searching...")} /> : <button type="button" className="icon-button quiet" onClick={onClose} aria-label={t("Close search")}><X size={18} /></button>}
        </div>
        <div id={listId} className="command-results" role="listbox" aria-label={t("Search results")} aria-busy={loading}>
          {sections.map((section) => (
            <div key={section.key} className="command-group" role="group" aria-labelledby={`${listId}-${section.key}`}>
              <p id={`${listId}-${section.key}`} className="command-group-label" role="presentation">{t(section.label)}</p>
              {section.items.map((item) => {
                const index = runningIndex++;
                const Icon = item.icon || FileText;
                return (
                  <button type="button" role="option" id={optionId(index)} data-index={index} tabIndex={-1} aria-selected={index === activeIndex} className={index === activeIndex ? "active" : ""} key={item.key} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(item)}>
                    <span className="command-result-icon"><Icon size={17} aria-hidden="true" /></span>
                    <span className="command-result-text">
                      <strong><Highlight text={item.title} query={trimmed} /></strong>
                      {item.subtitle && <small><Highlight text={item.subtitle} query={trimmed} /></small>}
                    </span>
                    <span className="command-result-type">{t(item.typeLabel)}</span>
                    {index === activeIndex ? <CornerDownLeft size={15} aria-hidden="true" /> : <span aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          ))}
          {status && <p className="command-status" role="status">{status === "Searching records..." && <Loader2 className="spin" size={14} aria-hidden="true" />}{t(status)}</p>}
          {!results.length && !loading && !searchFailed && !(trimmed && status) && <p className="command-empty">{t(trimmed ? "No pages or records match your search." : canSearchRecords ? "Type a page name, request number, supplier, RUC or invoice." : "Type a page name.")}</p>}
        </div>
        <footer className="command-footer"><span>{t("Navigate with arrow keys")}</span><span>{t("Enter to open")}</span><span>{t("Escape to close")}</span></footer>
      </section>
    </div>,
    document.body
  );
}
