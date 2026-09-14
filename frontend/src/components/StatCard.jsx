import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext.jsx";

export default function StatCard({ label, value, tone = "neutral", icon: Icon, suffix, to, actionLabel }) {
  const { t } = useLanguage();
  const Container = to ? Link : "div";

  return (
    <Container className={`stat-card tone-${tone}${to ? " stat-card-link" : ""}`} {...(to ? { to } : {})}>
      <div className="stat-card-heading">
        <span>{t(label)}</span>
        {Icon && <Icon size={18} aria-hidden="true" />}
      </div>
      <strong>{value}{suffix ? <small> {t(suffix)}</small> : null}</strong>
      {to && <span className="stat-card-action">{t(actionLabel || "View details")}<ArrowUpRight size={15} aria-hidden="true" /></span>}
    </Container>
  );
}
