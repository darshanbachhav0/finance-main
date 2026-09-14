import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";

export default function OptionalSection({ title, description, initiallyOpen = false, children }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details className="optional-section" open={open} onToggle={(event) => setOpen(event.currentTarget.open)} onInvalidCapture={(event) => { event.currentTarget.open = true; setOpen(true); }}>
      <summary><span><strong>{t(title)}</strong><small>{t(description || "Optional details")}</small></span><ChevronDown size={18} aria-hidden="true" /></summary>
      <div className="optional-section-body">{children}</div>
    </details>
  );
}
