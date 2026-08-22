import { useLanguage } from "../context/LanguageContext.jsx";

export default function StatCard({ label, value, tone = "neutral", icon: Icon, suffix }) {
  const { t } = useLanguage();

  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-card-heading">
        <span>{t(label)}</span>
        {Icon && <Icon size={18} aria-hidden="true" />}
      </div>
      <strong>{value}{suffix ? <small> {t(suffix)}</small> : null}</strong>
    </div>
  );
}
