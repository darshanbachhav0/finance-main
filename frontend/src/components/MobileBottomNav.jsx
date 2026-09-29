import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext.jsx";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { counterBadgeText } from "../utils/navigationAccess.js";

export const PHONE_QUERY = "(max-width: 640px)";
const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';
const EDITABLE_SELECTOR = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="file"]):not([type="range"]):not([type="color"]), textarea, [contenteditable="true"]';

// The on-screen keyboard shrinks the visual viewport; a focused text field on a touch screen
// covers browsers that resize the layout viewport instead.
function useKeyboardOpen(enabled) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!enabled) { setOpen(false); return undefined; }
    const viewport = window.visualViewport;
    const coarse = window.matchMedia("(pointer: coarse)");
    const update = () => {
      const shrunk = viewport ? window.innerHeight - viewport.height * (viewport.scale || 1) > 150 : false;
      const active = document.activeElement;
      const typing = coarse.matches && active instanceof HTMLElement && active.matches(EDITABLE_SELECTOR);
      setOpen(shrunk || typing);
    };
    update();
    viewport?.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, [enabled]);
  return open;
}

// Any modal surface (confirm dialogs, drawers, action sheets, the command palette).
function useModalOpen(enabled) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!enabled) { setOpen(false); return undefined; }
    let frame = 0;
    const check = () => { frame = 0; setOpen(Boolean(document.querySelector(MODAL_SELECTOR))); };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(check); };
    check();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-modal", "role"] });
    return () => { observer.disconnect(); if (frame) window.cancelAnimationFrame(frame); };
  }, [enabled]);
  return open;
}

// Phone-only bottom bar: the role's main destinations and Search, with the menu counters.
export default function MobileBottomNav({ items, onSearch, suppressed = false, pendingLabel }) {
  const { t } = useLanguage();
  const phone = useMediaQuery(PHONE_QUERY);
  const keyboardOpen = useKeyboardOpen(phone);
  const modalOpen = useModalOpen(phone);
  if (!phone || items.length + (onSearch ? 1 : 0) < 2) return null;
  const hidden = suppressed || keyboardOpen || modalOpen;

  return (
    <nav className={`mobile-bottom-nav${hidden ? " is-hidden" : ""}`} aria-label={t("Quick navigation")} aria-hidden={hidden || undefined} inert={hidden ? "" : undefined}>
      {items.map((item) => {
        const Icon = item.icon;
        const badge = counterBadgeText(item.count);
        const name = badge ? `${t(item.label)} (${pendingLabel(item.count)})` : t(item.label);
        return (
          <NavLink key={item.path} to={item.path} end={["/", "/accounting", "/requests", "/treasury"].includes(item.path)} className="mobile-bottom-nav-item" aria-label={name}>
            <span className="mobile-bottom-nav-icon" aria-hidden="true">
              <Icon size={21} />
              {badge && <span className="nav-counter mobile-bottom-nav-counter">{badge}</span>}
            </span>
            <span className="mobile-bottom-nav-label" aria-hidden="true">{t(item.label)}</span>
          </NavLink>
        );
      })}
      {onSearch && (
        <button type="button" className="mobile-bottom-nav-item" onClick={onSearch} aria-label={t("Search the system")}>
          <span className="mobile-bottom-nav-icon" aria-hidden="true"><Search size={21} /></span>
          <span className="mobile-bottom-nav-label" aria-hidden="true">{t("Search")}</span>
        </button>
      )}
    </nav>
  );
}
