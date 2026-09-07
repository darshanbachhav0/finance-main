import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../context/LanguageContext.jsx";
import useAnimatedPresence from "../hooks/useAnimatedPresence.js";

export default function Drawer({ open, title, description, size = "medium", children, footer, onClose }) {
  const { t } = useLanguage();
  const closeRef = useRef(null);
  const drawerRef = useRef(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  const previousFocusRef = useRef(null);
  const contentRef = useRef({ title, description, children, footer });
  const { shouldRender, phase } = useAnimatedPresence(open, 180);

  onCloseRef.current = onClose;
  if (open) contentRef.current = { title, description, children, footer };
  const content = open ? { title, description, children, footer } : contentRef.current;

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    const onKeyDown = (event) => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== drawerRef.current) return;
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); }
      if (event.key !== "Tab") return;
      const items = [...drawerRef.current.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter((item) => item.getClientRects().length && !item.closest('[inert]'));
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!shouldRender) previousFocusRef.current?.focus?.({ preventScroll: true });
  }, [shouldRender]);

  if (!shouldRender) return null;

  return createPortal(
    <div className={`drawer-backdrop motion-${phase}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && open && onClose()}>
      <aside ref={drawerRef} className={`drawer drawer-${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="drawer-header">
          <div>
            <h2 id={titleId}>{t(content.title)}</h2>
            {content.description && <p>{t(content.description)}</p>}
          </div>
          <button ref={closeRef} type="button" className="icon-button quiet" onClick={onClose} aria-label={t("Close panel")}>
            <X size={19} />
          </button>
        </header>
        <div className="drawer-body">{content.children}</div>
        {content.footer && <footer className="drawer-footer">{content.footer}</footer>}
      </aside>
    </div>, document.body
  );
}
