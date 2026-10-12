import { useLanguage } from "../../context/LanguageContext.jsx";
import { auditChanges, auditSubject, displayValue } from "../../utils/superAdmin.js";

// One audit record: who, where, what changed (before and after).
export default function AuditEntryDetails({ entry }) {
  const { t } = useLanguage();
  const changes = auditChanges(entry);
  return (
    <div className="form-grid">
      <dl className="detail-grid">
        <div><dt>{t("Who")}</dt><dd>{entry.actorName || t("System")}{entry.role ? ` · ${t(entry.role)}` : ""}</dd></div>
        <div><dt>{t("IP address")}</dt><dd>{entry.ip || "-"}</dd></div>
        <div><dt>{t("Module")}</dt><dd>{t(entry.module)}</dd></div>
        <div><dt>{t("Action")}</dt><dd>{t(entry.action)}</dd></div>
        <div className="wide"><dt>{t("Record")}</dt><dd>{[t(entry.entityType), auditSubject(entry)].filter(Boolean).join(" · ")}</dd></div>
        {(entry.statusFrom || entry.statusTo) && entry.statusFrom !== entry.statusTo && <div className="wide"><dt>{t("Status")}</dt><dd>{t(entry.statusFrom || "-")} → {t(entry.statusTo || "-")}</dd></div>}
        {(entry.comments || entry.message) && <div className="wide"><dt>{t("Comment")}</dt><dd>{entry.comments || t(entry.message)}</dd></div>}
        {entry.blocked && <div className="wide"><dt>{t("Blocked")}</dt><dd>{entry.blockReason ? t(entry.blockReason) : t("Yes")}</dd></div>}
      </dl>
      {changes.length > 0 && (
        <div className="table-scroll">
          <table className="super-admin-changes">
            <thead><tr><th scope="col">{t("Field")}</th><th scope="col">{t("Before")}</th><th scope="col">{t("After")}</th></tr></thead>
            <tbody>{changes.map((change) => <tr key={change.key}><th scope="row">{change.key}</th><td>{displayValue(change.before)}</td><td>{displayValue(change.after)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
