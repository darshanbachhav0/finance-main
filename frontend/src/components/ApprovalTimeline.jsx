import { useLanguage } from "../context/LanguageContext.jsx";

export default function ApprovalTimeline({ history = [] }) {
  const { t } = useLanguage();

  if (!history.length) {
    return <div className="empty-state">{t("No workflow events yet.")}</div>;
  }

  return (
    <div className="timeline">
      {history.map((item) => (
        <div className="timeline-item" key={item._id || `${item.action}-${item.createdAt}`}>
          <div className="timeline-dot" />
          <div>
            <strong>{t(item.action === "CLOSED" ? "CLOSED_ACTION" : item.action)}</strong>
            <span>
              {t(item.statusFrom || "START")} → {t(item.statusTo)}
            </span>
            <p>{item.comments}</p>
            <small>
              {item.actor?.name || t("System")} · {new Date(item.createdAt).toLocaleString()}
            </small>
            {(item.stage || item.signature || item.ip) && <small className="timeline-evidence">{[item.stage && t(item.stage), item.signature, item.ip].filter(Boolean).join(" · ")}</small>}
          </div>
        </div>
      ))}
    </div>
  );
}
