import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";

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
  getOptionLabel = (option) => option.label ?? option.name
}) {
  const { t } = useLanguage();
  const id = useId();
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = options.find((option) => String(getOptionValue(option)) === String(value));
  const filtered = useMemo(() => options.filter((option) => getOptionLabel(option).toLowerCase().includes(query.toLowerCase())), [options, query, getOptionLabel]);

  useEffect(() => {
    const close = (event) => !rootRef.current?.contains(event.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function choose(option) {
    onChange(getOptionValue(option), option);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(event) {
    if (!open && ["Enter", "ArrowDown", " "].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
      window.setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    }
    if (event.key === "Enter" && filtered[activeIndex]) {
      event.preventDefault();
      choose(filtered[activeIndex]);
    }
    if (event.key === "Escape") setOpen(false);
  }

  return (
    <div className={`field search-select-field${error ? " field-error" : ""}`} ref={rootRef}>
      {label && <label id={`${id}-label`}>{t(label)}{required ? " *" : ""}</label>}
      <div className="search-select">
        <button
          type="button"
          className="search-select-trigger"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={`${id}-label`}
          onClick={() => { setOpen((current) => !current); window.setTimeout(() => inputRef.current?.focus(), 0); }}
          onKeyDown={onKeyDown}
        >
          <span className={selected ? "" : "placeholder"}>{selected ? getOptionLabel(selected) : t(placeholder)}</span>
          <ChevronDown size={16} />
        </button>
        {selected && !disabled && (
          <button type="button" className="search-select-clear" aria-label={t("Clear selection")} onClick={() => onChange("", null)}>
            <X size={14} />
          </button>
        )}
        {open && (
          <div className="search-select-popover">
            <div className="search-select-search">
              <Search size={15} />
              <input
                ref={inputRef}
                value={query}
                placeholder={t(searchPlaceholder)}
                onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
                onKeyDown={onKeyDown}
                aria-controls={`${id}-listbox`}
              />
            </div>
            <ul id={`${id}-listbox`} role="listbox">
              {filtered.map((option, index) => {
                const optionValue = getOptionValue(option);
                const isSelected = String(optionValue) === String(value);
                return (
                  <li
                    key={optionValue}
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
              {!filtered.length && <li className="search-select-empty">{t("No matching options")}</li>}
            </ul>
          </div>
        )}
      </div>
      {error ? <small className="field-error-text">{t(error)}</small> : hint ? <small className="field-hint">{t(hint)}</small> : null}
    </div>
  );
}
