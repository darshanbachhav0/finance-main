import { useLanguage } from "../context/LanguageContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function ApprovalTimeline({ history = [] }) {
  const { t } = useLanguage();
  const { user } = useAuth();

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
            {item.stage && <small>{t(item.stage)}</small>}
            {["Admin", "Accounting"].includes(user.role) && (item.signature || item.ip) && <details><summary>{t("Technical evidence")}</summary><small className="timeline-evidence">{[item.signature, item.ip].filter(Boolean).join(" · ")}</small></details>}
          </div>
        </div>
      ))}
    </div>
  );
}
