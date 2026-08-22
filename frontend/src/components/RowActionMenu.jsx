import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingOverlay,
  FloatingPortal,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useTransitionStyles
} from "@floating-ui/react";
import { ChevronRight, MoreHorizontal, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { getMenuNavigationIndex } from "../utils/menuNavigation.js";

const OPEN_EVENT = "erp:row-action-menu-open";
const MOBILE_QUERY = "(max-width: 640px)";

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

export default function RowActionMenu({ row, actions }) {
  const { t } = useLanguage();
  const menuId = useId();
  const triggerId = useId();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [open, setOpen] = useState(false);
  const [returnFocus, setReturnFocus] = useState(true);
  const itemRefs = useRef([]);
  const pendingFocusIndex = useRef(-1);
  const wasOpen = useRef(false);

  const visible = useMemo(() => {
    const source = typeof actions === "function" ? actions(row) : actions;
    return (source || []).filter((action) => !action.hidden);
  }, [actions, row]);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange(nextOpen) {
      if (nextOpen) setReturnFocus(true);
      setOpen(nextOpen);
    },
    placement: "bottom-end",
    strategy: "fixed",
    middleware: [
      offset(6),
      flip({ fallbackPlacements: ["top-end"] }),
      shift({ padding: 8 })
    ],
    whileElementsMounted: autoUpdate
  });

  const click = useClick(context, { keyboardHandlers: false });
  const dismiss = useDismiss(context, { escapeKey: true, outsidePress: true, ancestorScroll: false });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);
  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: { open: 160, close: 130 },
    initial: isMobile
      ? { opacity: 0, transform: "translateY(12px)" }
      : { opacity: 0, transform: "translateY(-4px) scale(0.98)" }
  });

  useEffect(() => {
    const closeOtherMenu = (event) => {
      if (event.detail !== menuId) {
        setReturnFocus(false);
        setOpen(false);
      }
    };
    document.addEventListener(OPEN_EVENT, closeOtherMenu);
    return () => document.removeEventListener(OPEN_EVENT, closeOtherMenu);
  }, [menuId]);

  useEffect(() => {
    if (!open) return undefined;
    document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: menuId }));
    const frame = window.requestAnimationFrame(() => {
      const requested = pendingFocusIndex.current;
      const target = requested >= 0 ? requested : getMenuNavigationIndex(visible, -1, "Home");
      itemRefs.current[target]?.focus({ preventScroll: true });
      pendingFocusIndex.current = -1;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [menuId, open, visible]);

  useEffect(() => {
    let frame;
    if (wasOpen.current && !open && returnFocus) {
      frame = window.requestAnimationFrame(() => refs.reference.current?.focus({ preventScroll: true }));
    }
    wasOpen.current = open;
    return () => window.cancelAnimationFrame(frame);
  }, [open, refs.reference, returnFocus]);

  if (!visible.length) return null;

  function requestOpenFocus(key = "Home") {
    pendingFocusIndex.current = getMenuNavigationIndex(visible, -1, key);
  }

  function handleTriggerKeyDown(event) {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      requestOpenFocus(event.key);
      if (!open) {
        setReturnFocus(true);
        setOpen(true);
      } else {
        itemRefs.current[pendingFocusIndex.current]?.focus({ preventScroll: true });
        pendingFocusIndex.current = -1;
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) {
        setOpen(false);
      } else {
        requestOpenFocus();
        setReturnFocus(true);
        setOpen(true);
      }
    }
  }

  function handleMenuKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setReturnFocus(true);
      setOpen(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      const currentIndex = itemRefs.current.indexOf(document.activeElement);
      if (currentIndex >= 0 && !visible[currentIndex].disabled) {
        event.preventDefault();
        event.stopPropagation();
        runAction(visible[currentIndex]);
      }
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = itemRefs.current.indexOf(document.activeElement);
    const nextIndex = getMenuNavigationIndex(visible, currentIndex, event.key);
    itemRefs.current[nextIndex]?.focus({ preventScroll: true });
  }

  function runAction(action) {
    if (action.disabled) return;
    setReturnFocus(false);
    setOpen(false);
    window.setTimeout(() => action.onClick(row), 0);
  }

  const menuItems = (
    <div id={menuId} className="row-menu-items" role="menu" aria-labelledby={triggerId} onKeyDown={handleMenuKeyDown}>
      {visible.map((action, index) => {
        const Icon = action.icon || ChevronRight;
        const separated = action.tone === "danger" && index > 0 && visible[index - 1].tone !== "danger";
        return (
          <div className="row-menu-entry" key={`${action.label}-${index}`}>
            {separated && <div className="row-menu-separator" role="separator" />}
            <button
              ref={(element) => { itemRefs.current[index] = element; }}
              type="button"
              role="menuitem"
              className={`row-menu-item${action.tone === "danger" ? " danger" : ""}`}
              disabled={action.disabled}
              title={action.disabledReason ? t(action.disabledReason) : undefined}
              onClick={() => runAction(action)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>
                <strong>{t(action.label)}</strong>
                {action.disabledReason && <small>{t(action.disabledReason)}</small>}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="row-menu">
      <button
        ref={refs.setReference}
        id={triggerId}
        type="button"
        className="icon-button quiet"
        aria-label={t("Row actions")}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={isMounted ? menuId : undefined}
        {...getReferenceProps({
          onClick: () => !open && requestOpenFocus(),
          onKeyDown: handleTriggerKeyDown
        })}
      >
        <MoreHorizontal size={18} />
      </button>

      {isMounted && (
        <FloatingPortal>
          {isMobile ? (
            <FloatingOverlay
              lockScroll
              className="row-action-sheet-backdrop"
              style={{ opacity: open ? 1 : 0 }}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setReturnFocus(true);
                  setOpen(false);
                }
              }}
            >
              <FloatingFocusManager context={context} modal initialFocus={-1} returnFocus={returnFocus}>
                <section
                  ref={refs.setFloating}
                  className="row-action-sheet"
                  role="dialog"
                  aria-modal="true"
                  aria-label={t("Actions")}
                  style={transitionStyles}
                  {...getFloatingProps()}
                >
                  <header className="row-action-sheet-header">
                    <strong>{t("Actions")}</strong>
                    <button type="button" className="icon-button quiet" onClick={() => setOpen(false)} aria-label={t("Close actions")}>
                      <X size={18} />
                    </button>
                  </header>
                  {menuItems}
                </section>
              </FloatingFocusManager>
            </FloatingOverlay>
          ) : (
            <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus={returnFocus}>
              <div ref={refs.setFloating} className="row-action-floating" style={floatingStyles} {...getFloatingProps()}>
                <div className="row-action-popover" style={transitionStyles}>
                  {menuItems}
                </div>
              </div>
            </FloatingFocusManager>
          )}
        </FloatingPortal>
      )}
    </div>
  );
}
