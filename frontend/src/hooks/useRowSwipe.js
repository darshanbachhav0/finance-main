import { useRef, useState } from "react";

const THRESHOLD = 90;
const MAX_TRAVEL = 160;
// Without an action in that direction the row only gives a little, so it is clear nothing happens.
const RESISTANCE = 24;

// Swipe gestures on table rows, touch only (mouse and pen are left alone): `config.right` and
// `config.left` are { label, enabled(row), onSwipe(row) }. The row follows the finger, says what
// letting go will do, and runs the action past the threshold. The action itself should still ask
// for confirmation (approvals open their usual dialog).
export default function useRowSwipe(config, t) {
  const [active, setActive] = useState(null);
  const start = useRef(null);
  const swiped = useRef(false);

  const actionFor = (row, dx) => {
    const action = dx > 0 ? config?.right : config?.left;
    return action && action.enabled?.(row) !== false ? action : null;
  };

  function rowProps(row, key) {
    if (!config) return {};
    const dx = active?.key === key ? active.dx : 0;
    const action = dx ? actionFor(row, dx) : null;
    return {
      className: "swipeable-row",
      style: dx ? { transform: `translateX(${dx}px)` } : undefined,
      "data-swipe": dx ? (dx > 0 ? "right" : "left") : undefined,
      "data-swipe-ready": action && Math.abs(dx) >= THRESHOLD ? "true" : undefined,
      "data-swipe-label": action ? t(action.label) : undefined,
      onPointerDown: (event) => {
        if (event.pointerType !== "touch") return;
        start.current = { key, x: event.clientX, y: event.clientY, horizontal: null };
      },
      onPointerMove: (event) => {
        const origin = start.current;
        if (!origin || origin.key !== key) return;
        const distance = event.clientX - origin.x;
        const vertical = event.clientY - origin.y;
        if (origin.horizontal === null && (Math.abs(distance) > 10 || Math.abs(vertical) > 10)) origin.horizontal = Math.abs(distance) > Math.abs(vertical);
        if (!origin.horizontal) return;
        const limit = actionFor(row, distance) ? MAX_TRAVEL : RESISTANCE;
        setActive({ key, dx: Math.max(-limit, Math.min(limit, distance)) });
      },
      onPointerUp: () => {
        const origin = start.current;
        start.current = null;
        if (!origin || origin.key !== key) return;
        const action = actionFor(row, dx);
        setActive(null);
        if (action && Math.abs(dx) >= THRESHOLD) {
          swiped.current = true;
          action.onSwipe(row);
        }
      },
      onPointerCancel: () => { start.current = null; setActive(null); }
    };
  }

  // The click that ends a swipe must not also open the row.
  function consumeClick() {
    if (!swiped.current) return false;
    swiped.current = false;
    return true;
  }

  return { rowProps, consumeClick };
}
