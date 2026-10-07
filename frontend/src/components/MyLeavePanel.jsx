import { AlertTriangle, CalendarClock, CheckCircle2, UserCheck } from "lucide-react";
import { useEffect, useState } from "react";
import api from "../api/client.js";
import DateInput from "./DateInput.jsx";
import Drawer from "./Drawer.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { limaDateKey } from "../../../shared/businessCalendar.mjs";
import { formatDate } from "../utils/formatters.js";

// "My leave": record your own leave and see, before and while you are away, who takes your
// approvals (your substitute, or your jefe without one) and what moves to them.
export default function MyLeavePanel({ open, onClose }) {
  const { refreshUser } = useAuth();
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const [summary, setSummary] = useState(null);
  const [leaveUntil, setLeaveUntil] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const today = limaDateKey(new Date());
  const day = (value) => (value ? formatDate(`${value}T12:00:00Z`, language) : "");

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoading(true);
    setError("");
    api.get("/users/me/leave")
      .then((response) => { if (!active) return; setSummary(response.data.data); setLeaveUntil(response.data.data.leaveUntil || ""); })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [open]);

  async function save(onLeave) {
    setSaving(true);
    setError("");
    try {
      const response = await api.put("/users/me/leave", { onLeave, leaveUntil: onLeave ? leaveUntil || null : null });
      setSummary(response.data.leave);
      await refreshUser();
      const moved = response.data.approvalReassignment?.reassigned || 0;
      const wasOnLeave = summary?.onLeave;
      notify(onLeave
        ? (wasOnLeave ? t("Leave updated.") : t(moved ? "You are on leave. {count} approval(s) moved to {name}." : "You are on leave.").replace("{count}", moved).replace("{name}", summary?.coverage?.person?.name || ""))
        : t(moved ? "Welcome back. {count} approval(s) returned to you." : "Welcome back.").replace("{count}", moved));
      if (!onLeave || !wasOnLeave) onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const coverage = summary?.coverage;
  const coveredBy = coverage?.person
    ? <><strong>{coverage.person.name}</strong>{coverage.person.jobTitle ? ` · ${coverage.person.jobTitle}` : ""} <small>({t(coverage.via === "SUBSTITUTE" ? "your substitute" : "your jefe")})</small></>
    : null;
  const onLeave = Boolean(summary?.onLeave);

  return (
    <Drawer
      open={open}
      title="My leave"
      description={onLeave ? (summary?.leaveUntil ? t("On leave until {date}").replace("{date}", day(summary.leaveUntil)) : t("On leave")) : t("Available")}
      error={error}
      onClose={() => !saving && onClose()}
      footer={summary && (onLeave
        ? <>
          <button type="button" className="secondary-button" disabled={saving || (leaveUntil || "") === (summary.leaveUntil || "")} onClick={() => save(true)}><CalendarClock size={16} />{t("Change last day")}</button>
          <button type="button" className="primary-button" disabled={saving} onClick={() => save(false)}><CheckCircle2 size={16} />{t("I'm back")}</button>
        </>
        : <>
          <button type="button" className="secondary-button" disabled={saving} onClick={onClose}>{t("Cancel")}</button>
          <button type="button" className="primary-button" disabled={saving || !coverage?.person} onClick={() => save(true)}><CalendarClock size={16} />{t("Start leave")}</button>
        </>)}
    >
      {loading && !summary ? <p className="muted-text">{t("Loading...")}</p> : summary && <div className="form-grid leave-panel">
        <div className={`document-requirement${coverage?.person ? "" : " required"}`}>
          {coverage?.person ? <UserCheck size={20} /> : <AlertTriangle size={20} />}
          <div>
            <strong>{t(onLeave ? "Your approvals are with" : "While you are away, your approvals go to")}</strong>
            <p>{coveredBy || t("Nobody can take your approvals: ask the Admin to set your substitute before you leave.")}</p>
            {!onLeave && summary.pendingApprovals > 0 && coverage?.person && <p>{t("{count} approval(s) waiting on you will move to them now, and come back when you return.").replace("{count}", summary.pendingApprovals)}</p>}
            {!summary.substitute && coverage?.via === "SUPERVISOR" && <p className="field-hint">{t("You have no substitute. The Admin can set one in Users.")}</p>}
          </div>
        </div>
        <label className="field">
          <span>{t("Last day of leave")}</span>
          <DateInput min={today} value={leaveUntil} onChange={(event) => setLeaveUntil(event.target.value)} />
          <small className="field-hint">{t("Optional. The day after, your leave ends by itself and your approvals come back to you.")}</small>
        </label>
        {summary.covering.length > 0 && <div className="document-requirement">
          <UserCheck size={20} />
          <div>
            <strong>{t("You are covering")}</strong>
            <ul className="leave-covering">{summary.covering.map((item) => <li key={item._id}>{item.name} · {t("{count} approval(s)").replace("{count}", item.count)}</li>)}</ul>
          </div>
        </div>}
      </div>}
    </Drawer>
  );
}
