import { Info } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";

export default function InfoPopover({ label, children, align = "start" }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <span className="info-popover" ref={ref}>
      <button type="button" className="info-popover-trigger" aria-label={t(label)} title={t(label)} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
        <Info size={15} aria-hidden="true" />
      </button>
      {open && <div id={panelId} role="dialog" aria-label={t(label)} className={`info-popover-panel align-${align}`}>{children}</div>}
    </span>
  );
}
