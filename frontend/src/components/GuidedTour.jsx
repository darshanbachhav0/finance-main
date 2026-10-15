import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext.jsx";
import { CARD_HEIGHT, START_TOUR_EVENT, cardPosition, markTourDone, tourStepsFor } from "../utils/tour.js";

const PADDING = 8;

function visibleTarget(name) {
  const element = document.querySelector(`[data-tour="${name}"]`);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? element : null;
}

// A spotlight over one element at a time with a short explanation. Starts on the first visit to
// the dashboard (once per person and browser) and again from the account menu.
export default function GuidedTour({ user }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [steps, setSteps] = useState(null);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const cardRef = useRef(null);
  const returnFocus = useRef(null);

  const close = useCallback(() => {
    markTourDone(user._id);
    setSteps(null);
    setIndex(0);
    window.requestAnimationFrame(() => returnFocus.current?.focus?.({ preventScroll: true }));
  }, [user._id]);

  useEffect(() => {
    const start = () => {
      returnFocus.current = document.activeElement;
      if (location.pathname !== "/") navigate("/");
      // The dashboard renders its targets after loading; wait for them before measuring.
      window.setTimeout(() => {
        const available = tourStepsFor(user.role).filter((step) => visibleTarget(step.target));
        if (available.length) { setSteps(available); setIndex(0); }
      }, location.pathname === "/" ? 50 : 900);
    };
    window.addEventListener(START_TOUR_EVENT, start);
    return () => window.removeEventListener(START_TOUR_EVENT, start);
  }, [user.role, location.pathname, navigate]);

  const step = steps?.[index];

  useLayoutEffect(() => {
    if (!step) return undefined;
    const element = visibleTarget(step.target);
    if (!element) return undefined;
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    // Follow the element every frame while the step is open: the page may still be loading, be
    // scrolling or change size, and the spotlight must stay on it. State changes only on a move.
    let frame;
    let last = "";
    const measure = () => {
      const box = element.getBoundingClientRect();
      const next = { top: box.top - PADDING, left: box.left - PADDING, width: box.width + PADDING * 2, height: box.height + PADDING * 2 };
      const key = `${Math.round(next.top)}:${Math.round(next.left)}:${Math.round(next.width)}:${Math.round(next.height)}`;
      if (key !== last) { last = key; setRect(next); }
      frame = window.requestAnimationFrame(measure);
    };
    measure();
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  useEffect(() => {
    if (!step) return undefined;
    cardRef.current?.focus({ preventScroll: true });
    const keys = (event) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "ArrowRight") setIndex((value) => Math.min(value + 1, steps.length - 1));
      if (event.key === "ArrowLeft") setIndex((value) => Math.max(value - 1, 0));
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, [step, steps, close]);

  if (!step || !rect) return null;
  const last = index === steps.length - 1;
  const cardStyle = cardPosition(rect, cardRef.current?.offsetHeight || CARD_HEIGHT);

  return createPortal(
    <div className="tour-layer">
      <div className="tour-spotlight" style={rect} aria-hidden="true" />
      <div ref={cardRef} className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body" tabIndex={-1} style={cardStyle}>
        <div className="tour-card-head">
          <span className="tour-progress">{t("Step {step} of {total}").replace("{step}", index + 1).replace("{total}", steps.length)}</span>
          <button type="button" className="icon-button quiet" onClick={close} aria-label={t("Close tour")} title={t("Close tour")}><X size={16} /></button>
        </div>
        <h2 id="tour-title">{t(step.title)}</h2>
        <p id="tour-body">{t(step.body)}</p>
        <div className="tour-dots" aria-hidden="true">{steps.map((item, position) => <span key={item.key} className={position === index ? "active" : ""} />)}</div>
        <div className="tour-actions">
          <button type="button" className="text-button" onClick={close}>{t("Skip tour")}</button>
          <div>
            {index > 0 && <button type="button" className="secondary-button" onClick={() => setIndex(index - 1)}><ChevronLeft size={16} /><span>{t("Back")}</span></button>}
            <button type="button" className="primary-button" onClick={() => (last ? close() : setIndex(index + 1))}><span>{t(last ? "Done" : "Next")}</span>{!last && <ChevronRight size={16} />}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
