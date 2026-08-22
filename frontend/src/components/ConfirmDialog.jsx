import { AlertTriangle, Loader2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../context/LanguageContext.jsx";
import useAnimatedPresence from "../hooks/useAnimatedPresence.js";

export default function ConfirmDialog({
  open,
  title,
  description,
  details = [],
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  inputLabel,
  inputType = "textarea",
  inputRequired = false,
  inputPlaceholder,
  loading = false,
  onConfirm,
  onClose
}) {
  const { t } = useLanguage();
  const titleId = useId();
  const descriptionId = useId();
  const [inputValue, setInputValue] = useState("");
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const confirmRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const previousFocusRef = useRef(null);
  const contentRef = useRef({ title, description, details, confirmLabel, cancelLabel, tone, inputLabel, inputType, inputRequired, inputPlaceholder });
  const { shouldRender, phase } = useAnimatedPresence(open, 170);

  onCloseRef.current = onClose;
  if (open) contentRef.current = { title, description, details, confirmLabel, cancelLabel, tone, inputLabel, inputType, inputRequired, inputPlaceholder };
  const content = open
    ? { title, description, details, confirmLabel, cancelLabel, tone, inputLabel, inputType, inputRequired, inputPlaceholder }
    : contentRef.current;

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement;
    setInputValue("");
    const frame = window.requestAnimationFrame(() => {
      (content.inputLabel ? inputRef.current : confirmRef.current)?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, content.inputLabel]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !loading) {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [...(dialogRef.current?.querySelectorAll(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      ) || [])].filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
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
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, loading]);

  useEffect(() => {
    if (!shouldRender) previousFocusRef.current?.focus?.({ preventScroll: true });
  }, [shouldRender]);

  if (!shouldRender) return null;

  const disabled = loading || (content.inputRequired && !inputValue.trim());

  return createPortal(
    <div className={`modal-backdrop motion-${phase}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && open && !loading && onClose()}>
      <section ref={dialogRef} className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={content.description ? descriptionId : undefined}>
        <header className="dialog-header">
          <div className={`dialog-icon tone-${content.tone}`}><AlertTriangle size={20} /></div>
          <div>
            <h2 id={titleId}>{t(content.title)}</h2>
            {content.description && <p id={descriptionId}>{t(content.description)}</p>}
          </div>
          <button type="button" className="icon-button quiet dialog-close" onClick={onClose} disabled={loading} aria-label={t("Close dialog")}>
            <X size={18} />
          </button>
        </header>
        {content.details.length > 0 && (
          <dl className="confirmation-summary">
            {content.details.map((detail) => (
              <div key={detail.label}>
                <dt>{t(detail.label)}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {content.inputLabel && (
          <label className="field">
            <span>{t(content.inputLabel)}{content.inputRequired ? " *" : ""}</span>
            {content.inputType === "text" ? (
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                placeholder={t(content.inputPlaceholder || "Enter a value")}
                onChange={(event) => setInputValue(event.target.value)}
                required={content.inputRequired}
              />
            ) : (
              <textarea
                ref={inputRef}
                rows="3"
                value={inputValue}
                placeholder={t(content.inputPlaceholder || "Add comments")}
                onChange={(event) => setInputValue(event.target.value)}
                required={content.inputRequired}
              />
            )}
            {content.inputRequired && !inputValue.trim() && <small className="field-hint">{t("A comment is required to continue.")}</small>}
          </label>
        )}
        <footer className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={loading}>{t(content.cancelLabel)}</button>
          <button
            ref={confirmRef}
            type="button"
            className={content.tone === "danger" ? "danger-button" : "primary-button"}
            disabled={disabled}
            onClick={() => onConfirm(inputValue.trim())}
          >
            {loading && <Loader2 className="spin" size={16} />}
            <span>{t(loading ? "Processing..." : content.confirmLabel)}</span>
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
