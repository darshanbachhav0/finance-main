import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";
import useAnimatedPresence from "../hooks/useAnimatedPresence.js";

export default function Drawer({ open, title, description, size = "medium", children, footer, onClose }) {
  const { t } = useLanguage();
  const closeRef = useRef(null);
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
    window.setTimeout(() => closeRef.current?.focus(), 0);
    const onKeyDown = (event) => event.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!shouldRender) previousFocusRef.current?.focus?.({ preventScroll: true });
  }, [shouldRender]);

  if (!shouldRender) return null;

  return (
    <div className={`drawer-backdrop motion-${phase}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && open && onClose()}>
      <aside className={`drawer drawer-${size}`} role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className="drawer-header">
          <div>
            <h2 id="drawer-title">{t(content.title)}</h2>
            {content.description && <p>{t(content.description)}</p>}
          </div>
          <button ref={closeRef} type="button" className="icon-button quiet" onClick={onClose} aria-label={t("Close panel")}>
            <X size={19} />
          </button>
        </header>
        <div className="drawer-body">{content.children}</div>
        {content.footer && <footer className="drawer-footer">{content.footer}</footer>}
      </aside>
    </div>
  );
}
