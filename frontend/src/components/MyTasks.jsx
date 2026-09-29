import { ArrowRight, CheckCircle2, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext.jsx";
import { buildTaskList } from "../utils/myTasks.js";

// The dashboard opens with the user's own to-do list (the /dashboard/tasks items): one sentence
// per task with its count and urgency, opening the exact record or a pre-filtered list. The
// role's primary action stays visible; with nothing to do it becomes the "All caught up" action.
export default function MyTasks({ items = [], action }) {
  const { t, language } = useLanguage();
  const rows = buildTaskList(items, { language, t });
  const actionLink = action && <Link className="primary-button" to={action.to}>{t(action.label)}<ArrowRight size={17} aria-hidden="true" /></Link>;

  return (
    <section className="workspace-panel my-tasks" aria-labelledby="my-tasks-title">
      <div className="my-tasks-heading">
        <div>
          <h2 id="my-tasks-title">{t("My tasks")}</h2>
          {rows.length > 0 && <p>{t("What needs your attention, most urgent first.")}</p>}
        </div>
        {rows.length > 0 && actionLink}
      </div>
      {rows.length > 0 ? (
        <ul className="my-tasks-list">
          {rows.map((row) => (
            <li key={row.key}>
              <Link className={`my-task tone-${row.tone}`} to={row.path}>
                <span className={`task-indicator tone-${row.tone}`} aria-hidden="true" />
                <span className="my-task-text">
                  <strong>{row.sentence}</strong>
                  <span className="my-task-meta">
                    <span className="sr-only">{row.toneLabel}. </span>
                    {row.due && <span className={`my-task-chip tone-${row.tone}`}>{row.due}</span>}
                    {row.details.map((detail) => <span key={detail.key} className={`my-task-chip tone-${detail.tone}`}>{detail.text}</span>)}
                  </span>
                </span>
                <ChevronRight className="my-task-arrow" size={18} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="my-tasks-empty" role="status">
          <CheckCircle2 size={28} aria-hidden="true" />
          <div>
            <strong>{t("All caught up")}</strong>
            <p>{t("Nothing needs your attention right now.")}</p>
          </div>
          {actionLink}
        </div>
      )}
    </section>
  );
}
