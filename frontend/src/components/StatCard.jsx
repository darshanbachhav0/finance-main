import { ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext.jsx";

export default function StatCard({ label, value, numericValue, formatter, tone = "neutral", icon: Icon, suffix, to, actionLabel }) {
  const { t } = useLanguage();
  const Container = to ? Link : "div";
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [animated, setAnimated] = useState(numericValue);
  useEffect(() => {
    if (!Number.isFinite(numericValue) || reduced) { setAnimated(numericValue); return; }
    let frame; const started = performance.now();
    const update = now => { const progress = Math.min(1, (now - started) / 220); setAnimated(numericValue * (1 - (1 - progress) ** 3)); if (progress < 1) frame = requestAnimationFrame(update); };
    frame = requestAnimationFrame(update); return () => cancelAnimationFrame(frame);
  }, [numericValue, reduced]);

  return (
    <Container className={`stat-card tone-${tone}${to ? " stat-card-link" : ""}`} {...(to ? { to } : {})}>
      <div className="stat-card-heading">
        <span>{t(label)}</span>
        {Icon && <Icon size={18} aria-hidden="true" />}
      </div>
      <strong aria-label={typeof value === "string" ? value : undefined}>{formatter && Number.isFinite(animated) ? formatter(animated) : value}{suffix ? <small> {t(suffix)}</small> : null}</strong>
      {to && <span className="stat-card-action">{t(actionLabel || "View details")}<ArrowUpRight size={15} aria-hidden="true" /></span>}
    </Container>
  );
}
