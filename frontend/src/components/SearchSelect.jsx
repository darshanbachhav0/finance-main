import { Check, ChevronDown, Search, X } from "lucide-react";
import { autoUpdate, flip, FloatingPortal, offset, shift, size, useFloating } from "@floating-ui/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";

// "credito" finds "Crédito": search ignores case and accents.
const searchable = (text) => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function SearchSelect({
  label,
  value,
  options = [],
  onChange,
  placeholder = "Select",
  searchPlaceholder = "Search options...",
  required = false,
  disabled = false,
  error,
  hint,
  getOptionValue = (option) => option.value ?? option._id,
  getOptionLabel = (option) => option.label ?? option.name,
  // Called with the typed text, 300 ms after typing stops, so a long list can be searched on the
  // server; the options passed in are still filtered locally meanwhile.
  onSearch,
  searching = false
}) {
  const { t } = useLanguage();
  const id = useId();
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const { refs, floatingStyles } = useFloating({
    open,
    placement: "bottom-start",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 12 }), shift({ padding: 12 }), size({
      padding: 12,
      apply({ availableWidth, availableHeight, rects, elements }) {
        Object.assign(elements.floating.style, {
          width: `${Math.min(rects.reference.width, availableWidth)}px`,
          maxHeight: `${Math.max(0, availableHeight)}px`
        });
      }
    })]
  });

  const selected = options.find((option) => String(getOptionValue(option)) === String(value));
  const filtered = useMemo(() => options.filter((option) => searchable(getOptionLabel(option)).includes(searchable(query))), [options, query, getOptionLabel]);

  useEffect(() => {
    if (!onSearch || !open) return undefined;
    const timer = window.setTimeout(() => onSearch(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  useEffect(() => {
    const close = (event) => !rootRef.current?.contains(event.target) && !refs.floating.current?.contains(event.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, id]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  function choose(option) {
    onChange(getOptionValue(option), option);
    setOpen(false);
    setQuery("");
    refs.domReference.current?.focus({ preventScroll: true });
  }

  function onKeyDown(event) {
    if (!open && ["Enter", "ArrowDown", " "].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, Math.min(index + 1, filtered.length - 1)));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (filtered[activeIndex]) choose(filtered[activeIndex]);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      refs.domReference.current?.focus({ preventScroll: true });
    }
    if (event.key === "Tab") {
      setOpen(false);
      // Resume the form's tab order even when the popup is rendered in a portal.
      refs.domReference.current?.focus({ preventScroll: true });
    }
  }

  return (
    <div className={`field search-select-field${error ? " field-error" : ""}`} ref={rootRef}>
      {label && <label id={`${id}-label`}>{t(label)}{required ? " *" : ""}</label>}
      <div className="search-select">
        <button
          ref={refs.setReference}
          type="button"
          className="search-select-trigger"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={label ? `${id}-label` : undefined}
          aria-label={!label ? t(placeholder) : undefined}
          aria-controls={open ? `${id}-listbox` : undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={error || hint ? `${id}-help` : undefined}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={onKeyDown}
        >
          <span className={selected ? "" : "placeholder"}>{selected ? getOptionLabel(selected) : t(placeholder)}</span>
          <ChevronDown size={16} />
        </button>
        {selected && !disabled && (
          <button type="button" className="search-select-clear" aria-label={t("Clear selection")} onClick={() => { onChange("", null); refs.domReference.current?.focus({ preventScroll: true }); }}>
            <X size={14} />
          </button>
        )}
        {/* Keep dialog popups within its focus boundary, outside its scrolling body. */}
        {open && (
          <FloatingPortal root={refs.domReference.current?.closest('[role="dialog"]') || undefined}>
            <div ref={refs.setFloating} style={floatingStyles} className="search-select-popover">
              <div className="search-select-search">
                <Search size={15} />
                <input
                  autoFocus
                  value={query}
                  placeholder={t(searchPlaceholder)}
                  role="combobox"
                  aria-label={t(searchPlaceholder)}
                  aria-expanded="true"
                  aria-autocomplete="list"
                  aria-activedescendant={filtered[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
                  onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
                  onKeyDown={onKeyDown}
                  aria-controls={`${id}-listbox`}
                />
              </div>
              <ul id={`${id}-listbox`} role="listbox" aria-label={t(label || placeholder)}>
                {filtered.map((option, index) => {
                  const optionValue = getOptionValue(option);
                  const isSelected = String(optionValue) === String(value);
                  return (
                    <li
                      key={optionValue}
                      id={`${id}-option-${index}`}
                      role="option"
                      aria-selected={isSelected}
                      className={index === activeIndex ? "active" : ""}
                      onMouseDown={(event) => { event.preventDefault(); choose(option); }}
                    >
                      <span>{getOptionLabel(option)}</span>
                      {isSelected && <Check size={15} />}
                    </li>
                  );
                })}
                {!filtered.length && <li role="presentation" className="search-select-empty">{t(searching ? "Searching..." : "No matching options")}</li>}
              </ul>
            </div>
          </FloatingPortal>
        )}
      </div>
      {error ? <small id={`${id}-help`} className="field-error-text">{t(error)}</small> : hint ? <small id={`${id}-help`} className="field-hint">{t(hint)}</small> : null}
    </div>
  );
}
