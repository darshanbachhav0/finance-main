import { autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../context/LanguageContext.jsx";
import {
  addDays, addMonths, calendarWeeks, capitalize, completeDateText, completeMonthText, dateMessage, datePlaceholder,
  formatIsoDate, formatIsoMonth, longDateLabel, maskDateText, maskMonthText, MONTH_NAMES, MONTH_SHORT,
  monthYearLabel, parseDisplayDate, parseDisplayMonth, rangeError, todayIso, toIsoDate, toIsoMonth,
  WEEKDAY_NAMES, WEEKDAY_SHORT, weekdayIndex
} from "../utils/dateInput.js";

const KINDS = {
  date: { normalize: toIsoDate, format: formatIsoDate, mask: maskDateText, complete: completeDateText, parse: parseDisplayDate, length: 10 },
  month: { normalize: toIsoMonth, format: formatIsoMonth, mask: maskMonthText, complete: completeMonthText, parse: parseDisplayMonth, length: 7 }
};
const FOCUSABLE = "button:not([disabled]), [tabindex=\"0\"]";

function clampIso(iso, min, max) {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

/**
 * Text field + calendar popover that always reads day-first (dd/mm/aaaa, or mm/aaaa for
 * kind="month") and emits the ISO value the forms already use. `onChange` and `onBlur`
 * receive an event-like object ({ target: { value, name } }) so it drops in for the
 * native date input. Invalid days emit "" like the native input; out-of-range dates are
 * emitted but flagged, and the field reports itself invalid to native form validation.
 */
function CalendarField({ kind = "date", value, onChange, onBlur, min, max, required = false, disabled = false, readOnly = false, clearable = false, placeholder, id, name, className = "", title, ...rest }) {
  const { t, language } = useLanguage();
  const config = KINDS[kind];
  const normalized = config.normalize(value);
  const minIso = config.normalize(min);
  const maxIso = config.normalize(max);
  const generatedId = useId();
  const inputId = id || `${generatedId}-input`;
  const errorId = `${generatedId}-error`;
  const popoverId = `${generatedId}-picker`;
  const inputRef = useRef(null);
  const rootRef = useRef(null);
  const floatingRef = useRef(null);
  const lastEmitted = useRef(normalized);
  const focusPending = useRef(false);
  const [text, setText] = useState(() => config.format(normalized));
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => normalized || todayIso().slice(0, config.length));

  const { refs, floatingStyles } = useFloating({
    open,
    placement: "bottom-start",
    strategy: "fixed",
    // top/left positioning, so the entry animation can use transform.
    transform: false,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate
  });

  // A new value from the parent (reset, draft restore, derived field) replaces the text;
  // the echo of our own emission does not, so partial typing is never overwritten.
  useEffect(() => {
    if (normalized === lastEmitted.current) return;
    lastEmitted.current = normalized;
    setText(config.format(normalized));
    setTouched(false);
  }, [normalized]);

  const parsed = config.parse(text);
  const code = parsed.error || rangeError(parsed.iso, minIso, maxIso);
  const message = dateMessage(code, { kind, min: minIso, max: maxIso });
  const messageText = !message ? "" : typeof message === "string" ? t(message) : t(message.key).replace("{date}", message.date);
  const showError = Boolean(code) && touched && !(focused && code === "incomplete");

  useEffect(() => { inputRef.current?.setCustomValidity(code ? messageText : ""); }, [code, messageText]);

  function eventFor(nextValue) {
    const target = { value: nextValue, name, id: inputId };
    return { target, currentTarget: target, type: "change" };
  }

  function emit(nextValue) {
    if (nextValue === lastEmitted.current) return;
    lastEmitted.current = nextValue;
    onChange?.(eventFor(nextValue));
  }

  function handleText(event) {
    const next = config.mask(event.target.value, text);
    setText(next);
    // Partial typing keeps the last value (no reload of filters on every keystroke); a
    // complete date or an emptied field is emitted at once.
    const result = config.parse(next);
    if (!result.error) emit(result.iso);
  }

  function leave() {
    const completed = config.complete(text);
    if (completed !== text) setText(completed);
    const result = config.parse(completed);
    // Like the native input, text that is not a real date leaves the value empty.
    const current = result.error ? "" : result.iso;
    emit(current);
    setTouched(true);
    setFocused(false);
    onBlur?.({ ...eventFor(current), type: "blur" });
  }

  const inside = (node) => Boolean(node && (rootRef.current?.contains(node) || floatingRef.current?.contains(node)));

  function handleBlur(event) {
    if (inside(event.relatedTarget)) return;
    if (open) setOpen(false);
    leave();
  }

  function openPicker() {
    if (disabled || readOnly) return;
    const start = parsed.iso || lastEmitted.current || todayIso().slice(0, config.length);
    setCursor(clampIso(start, minIso, maxIso));
    focusPending.current = true;
    setOpen(true);
  }

  function closePicker(returnFocus = true) {
    setOpen(false);
    if (returnFocus) window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }

  function choose(iso) {
    if (rangeError(iso, minIso, maxIso)) return;
    setText(config.format(iso));
    emit(iso);
    setTouched(true);
    closePicker(true);
  }

  function clear() {
    setText("");
    emit("");
    closePicker(true);
  }

  useEffect(() => {
    if (!open) return undefined;
    // Leaving the field itself is handled by the blur that follows the click.
    const close = (event) => { if (!inside(event.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (!open || !focusPending.current) return;
    focusPending.current = false;
    floatingRef.current?.querySelector(`[data-value="${cursor}"]`)?.focus({ preventScroll: true });
  }, [open, cursor]);

  function moveCursor(next) {
    focusPending.current = true;
    setCursor(next);
  }

  function onInputKeyDown(event) {
    if ((event.key === "ArrowDown" && (event.altKey || !open)) || (event.key === "Enter" && event.altKey)) {
      event.preventDefault();
      openPicker();
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      closePicker(true);
    }
  }

  function onGridKeyDown(event) {
    const step = kind === "date"
      ? { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
      : { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 };
    let next = null;
    if (step[event.key] !== undefined) next = kind === "date" ? addDays(cursor, step[event.key]) : addMonths(`${cursor}-01`, step[event.key]).slice(0, 7);
    else if (event.key === "PageUp" || event.key === "PageDown") {
      const direction = event.key === "PageUp" ? -1 : 1;
      next = kind === "date" ? addMonths(cursor, direction * (event.shiftKey ? 12 : 1)) : addMonths(`${cursor}-01`, direction * 12).slice(0, 7);
    } else if (kind === "date" && event.key === "Home") next = addDays(cursor, -weekdayIndex(cursor));
    else if (kind === "date" && event.key === "End") next = addDays(cursor, 6 - weekdayIndex(cursor));
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(cursor);
      return;
    }
    if (next) {
      event.preventDefault();
      moveCursor(next);
    }
  }

  function onPopoverKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePicker(true);
      return;
    }
    if (event.key !== "Tab") return;
    // Keep Tab inside the picker while it is open; Escape or a choice returns to the field.
    const items = [...floatingRef.current.querySelectorAll(FOCUSABLE)];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    event.preventDefault();
    event.stopPropagation();
    const nextIndex = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index + 1) % items.length;
    items[nextIndex].focus();
  }

  const today = todayIso().slice(0, config.length);
  const selected = parsed.error ? "" : parsed.iso;
  const code2 = language === "en" ? "en" : "es";
  const viewYear = Number(cursor.slice(0, 4));
  const viewMonth = Number(cursor.slice(5, 7));
  const shiftView = (amount) => {
    // Keep keyboard focus in the grid when the focused day is replaced by the new month.
    if (document.activeElement?.dataset?.value) focusPending.current = true;
    const next = kind === "date" ? addMonths(cursor, amount) : addMonths(`${cursor}-01`, amount).slice(0, 7);
    setCursor(next);
  };

  const picker = open && createPortal(
    <div
      ref={(node) => { floatingRef.current = node; refs.setFloating(node); }}
      id={popoverId}
      style={floatingStyles}
      className={`date-picker-popover date-picker-${kind}`}
      role="dialog"
      aria-label={t(kind === "month" ? "Choose a month" : "Choose a date")}
      onKeyDown={onPopoverKeyDown}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="date-picker-head">
        <button type="button" className="icon-button quiet" onClick={() => shiftView(kind === "date" ? -1 : -12)} aria-label={t(kind === "date" ? "Previous month" : "Previous year")}><ChevronLeft size={16} aria-hidden="true" /></button>
        <strong aria-live="polite">{kind === "date" ? monthYearLabel(viewYear, viewMonth, language) : viewYear}</strong>
        <button type="button" className="icon-button quiet" onClick={() => shiftView(kind === "date" ? 1 : 12)} aria-label={t(kind === "date" ? "Next month" : "Next year")}><ChevronRight size={16} aria-hidden="true" /></button>
      </div>
      {kind === "date" ? (
        <table className="date-picker-grid" role="grid" aria-label={monthYearLabel(viewYear, viewMonth, language)} onKeyDown={onGridKeyDown}>
          <thead><tr>{WEEKDAY_SHORT[code2].map((day, index) => <th key={day} scope="col" abbr={WEEKDAY_NAMES[code2][index]}>{capitalize(day)}</th>)}</tr></thead>
          <tbody>{calendarWeeks(viewYear, viewMonth).map((week) => <tr key={week[0].iso}>{week.map((day) => {
            const outOfRange = Boolean(rangeError(day.iso, minIso, maxIso));
            return <td key={day.iso} role="gridcell" aria-selected={day.iso === selected}>
              <button
                type="button"
                data-value={day.iso}
                tabIndex={day.iso === cursor ? 0 : -1}
                className={`date-picker-day${day.inMonth ? "" : " is-outside"}${day.iso === selected ? " is-selected" : ""}${day.iso === today ? " is-today" : ""}`}
                aria-label={longDateLabel(day.iso, language)}
                aria-current={day.iso === today ? "date" : undefined}
                aria-disabled={outOfRange || undefined}
                onClick={() => choose(day.iso)}
              >{day.day}</button>
            </td>;
          })}</tr>)}</tbody>
        </table>
      ) : (
        <div className="date-picker-months" role="grid" aria-label={String(viewYear)} onKeyDown={onGridKeyDown}>
          {[0, 1, 2, 3].map((row) => <div role="row" key={row}>{[0, 1, 2].map((column) => {
            const month = row * 3 + column + 1;
            const iso = `${viewYear}-${String(month).padStart(2, "0")}`;
            const outOfRange = Boolean(rangeError(iso, minIso, maxIso));
            return <span role="gridcell" key={iso} aria-selected={iso === selected}>
              <button
                type="button"
                data-value={iso}
                tabIndex={iso === cursor ? 0 : -1}
                className={`date-picker-day${iso === selected ? " is-selected" : ""}${iso === today ? " is-today" : ""}`}
                aria-label={`${capitalize(MONTH_NAMES[code2][month - 1])} ${viewYear}`}
                aria-current={iso === today ? "date" : undefined}
                aria-disabled={outOfRange || undefined}
                onClick={() => choose(iso)}
              >{capitalize(MONTH_SHORT[code2][month - 1])}</button>
            </span>;
          })}</div>)}
        </div>
      )}
      <div className="date-picker-foot">
        <button type="button" className="text-button" disabled={Boolean(rangeError(today, minIso, maxIso))} onClick={() => choose(today)}>{t(kind === "month" ? "This month" : "Today")}</button>
        {(!required || clearable) && <button type="button" className="text-button" onClick={clear}>{t("Clear")}</button>}
      </div>
    </div>,
    document.body
  );

  const describedBy = [showError ? errorId : "", rest["aria-describedby"] || ""].filter(Boolean).join(" ") || undefined;
  const placeholderText = placeholder ? t(placeholder) : datePlaceholder(language, kind);
  const formatHint = datePlaceholder(language, kind);

  return <span ref={(node) => { rootRef.current = node; refs.setReference(node); }} className={`date-input date-input-${kind}${showError ? " is-invalid" : ""}${className ? ` ${className}` : ""}`} onBlur={handleBlur}>
    <span className="date-input-control">
      <input
        {...rest}
        ref={inputRef}
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={config.length}
        value={text}
        placeholder={placeholderText}
        title={title || formatHint}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={showError || rest["aria-invalid"] || undefined}
        aria-describedby={describedBy}
        onChange={handleText}
        onFocus={() => setFocused(true)}
        onKeyDown={onInputKeyDown}
      />
      {clearable && normalized && !disabled && !readOnly && <button type="button" className="date-input-clear" onClick={clear} aria-label={t("Clear")}><X size={14} aria-hidden="true" /></button>}
      {!readOnly && <button type="button" className="date-input-trigger" onClick={() => (open ? closePicker(true) : openPicker())} disabled={disabled} aria-label={t(kind === "month" ? "Open month picker" : "Open calendar")} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popoverId : undefined}><CalendarDays size={16} aria-hidden="true" /></button>}
      {name && <input type="hidden" name={name} value={lastEmitted.current} />}
    </span>
    {showError && <small id={errorId} className="field-error-text">{messageText}</small>}
    {picker}
  </span>;
}

export default function DateInput(props) {
  return <CalendarField {...props} kind="date" />;
}

export function MonthInput(props) {
  return <CalendarField {...props} kind="month" />;
}
