import { CornerDownLeft, FileText, Loader2, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import api from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { searchSources } from "../utils/searchSources.js";
import { useLanguage } from "../context/LanguageContext.jsx";
import useAnimatedPresence from "../hooks/useAnimatedPresence.js";

export default function CommandPalette({ open, onClose, pages }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [searchError, setSearchError] = useState("");
  const navigate = useNavigate();
  const titleId = useId();
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const previousFocus = useRef(null);
  const [query, setQuery] = useState("");
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const { shouldRender, phase } = useAnimatedPresence(open, 170);

  const matchingPages = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return pages.filter((item) => !needle || `${t(item.label)} ${t(item.group)}`.toLowerCase().includes(needle)).slice(0, 8);
  }, [pages, query, t]);
  const results = useMemo(() => [
    ...matchingPages.map((item) => ({ ...item, kind: "page", title: t(item.label), subtitle: t(item.group) })),
    ...requests.map(item => ({ ...item, subtitle: `${t(item.kind)} · ${item.subtitle || ""}` }))
  ], [matchingPages, requests, t]);

  useEffect(() => {
    if (!open) return undefined;
    previousFocus.current = document.activeElement;
    setQuery("");
    setRequests([]);
    setSearchError("");
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!shouldRender && !document.querySelector('[role="dialog"][aria-modal="true"]')) previousFocus.current?.focus?.({ preventScroll: true });
  }, [shouldRender]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setRequests([]);
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setRequests([]);
    setSearchError("");
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const sources = searchSources(user.role);
        const responses = await Promise.allSettled(sources.map(source => api.get(source.endpoint, { params: { search: query.trim(), pageSize: 5, page: 1 }, signal: controller.signal })));
        if (controller.signal.aborted) return;
        setRequests(responses.flatMap((result, index) => {
          if (result.status !== "fulfilled") return [];
          const source = sources[index];
          return (result.value.data.data || []).slice(0, 5).map(row => ({ key: `${source.kind}-${row._id}`, kind: source.kind, title: source.title(row), subtitle: source.subtitle(row), path: source.path(row) })).filter(item => item.title && !item.path.includes("undefined"));
        }));
        setSearchError(responses.some(result => result.status === "rejected") ? "Some search sources are unavailable. Try again." : "");
      } catch (error) {
        if (!controller.signal.aborted) { setRequests([]); setSearchError(error.message); }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, user.role]);

  useEffect(() => setActiveIndex((current) => Math.min(current, Math.max(0, results.length - 1))), [results.length]);

  useEffect(() => { dialogRef.current?.querySelector('[role="option"][aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [activeIndex]);

  function choose(item) {
    if (!item) return;
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
      const focusable = [...(dialogRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') || [])];
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

  return createPortal(
    <div className={`command-backdrop motion-${phase}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <h2 id={titleId} className="sr-only">{t("Search the system")}</h2>
        <div className="command-search">
          <Search size={19} aria-hidden="true" />
          <input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} placeholder={t("Search requests, suppliers, RUC, invoices...")} aria-label={t("Search requests, suppliers, RUC, invoices...")} />
          {loading ? <Loader2 className="spin" size={17} aria-label={t("Searching...")} /> : <button type="button" className="icon-button quiet" onClick={onClose} aria-label={t("Close search")}><X size={18} /></button>}
        </div>
        {searchError && <p role="status" className="command-empty">{t(searchError)}</p>}
        <div className="command-results" role="listbox" aria-label={t("Search results")}>
          {results.map((item, index) => {
            const Icon = item.icon || FileText;
            return (
              <button type="button" role="option" aria-selected={index === activeIndex} className={index === activeIndex ? "active" : ""} key={item.key || `${item.kind}-${item.path}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(item)}>
                <span className="command-result-icon"><Icon size={17} /></span>
                <span><strong>{item.title}</strong><small>{item.subtitle}</small></span>
                {index === activeIndex && <CornerDownLeft size={15} aria-hidden="true" />}
              </button>
            );
          })}
          {!results.length && !loading && <p className="command-empty">{t(query.trim() ? "No pages or requests match your search." : "Type a page name or request reference.")}</p>}
        </div>
        <footer className="command-footer"><span>{t("Navigate with arrow keys")}</span><span>{t("Enter to open")}</span><span>{t("Escape to close")}</span></footer>
      </section>
    </div>,
    document.body
  );
}
