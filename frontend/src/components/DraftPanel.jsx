import { Cloud, CloudOff } from "lucide-react";
import { useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatDateTime } from "../utils/formatters.js";

const labels = { loading: "Loading saved work...", ready: "Progress saves automatically", waiting: "Unsaved changes", saving: "Saving draft...", saved: "Saved", restored: "Saved work restored", error: "Not saved — check your connection", "load-error": "Saved work could not be loaded", conflict: "This draft changed in another session", "source-changed": "The original record changed. Review restored values before submitting." };
export default function DraftPanel({ draft, onDiscard, children, busy = false }) {
  const { t } = useLanguage();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  async function discard() {
    try { await draft.discard(); setConfirm(false); onDiscard?.(); }
    catch (err) { setError(err.message); }
  }
  const warning = ["error", "load-error", "conflict"].includes(draft.status);
  return <>
    <div className={`work-draft-status${warning ? " work-draft-warning" : ""}`}>
      <div role="status" title={draft.updatedAt ? `${t("Last saved")}: ${formatDateTime(draft.updatedAt)}` : undefined}>{warning ? <CloudOff size={14} aria-hidden="true" /> : <Cloud size={14} aria-hidden="true" />}<strong>{t(labels[draft.status] || labels.ready)}</strong>
        {draft.error && <small>{t(draft.error)}</small>}
        {draft.session.sourceChanged && <small role="alert">{t("The original record changed. Review restored values before submitting.")}</small>}
        {draft.session.backupFailed && draft.status !== "saved" && <small role="alert">{t("Browser backup is unavailable. Keep this page open until your draft is saved to your account.")}</small>}
      </div>
      <details className="compact-options" open={warning ? true : undefined}><summary>{t("Draft options")}</summary><p>{t("Private draft · Closing keeps your progress · Submission is still required")}</p><div className="work-draft-actions">
        {draft.ready && draft.startAnother && draft.status !== "conflict" && <button type="button" className="text-button" disabled={busy} onClick={draft.startAnother}>{t("Start another draft")}</button>}
        {["error", "load-error"].includes(draft.status) && <button type="button" className="secondary-button" onClick={draft.retry}>{t("Retry")}</button>}
        {draft.status === "conflict" && <><button type="button" className="secondary-button" onClick={draft.reload}>{t("Load saved version")}</button><button type="button" className="secondary-button" onClick={draft.separateCopy}>{t("Keep as separate draft")}</button></>}
        {onDiscard && draft.ready && <button type="button" className="text-button" disabled={busy} onClick={() => setConfirm(true)}>{t("Discard draft")}</button>}
      </div>
      </details>
      {confirm && <div className="work-draft-confirm"><span>{t("Delete this unfinished draft and its attachments?")}</span><button type="button" className="danger-button" onClick={discard}>{t("Discard draft")}</button><button type="button" className="secondary-button" onClick={() => setConfirm(false)}>{t("Keep draft")}</button></div>}
      {error && <span role="alert">{error}</span>}
    </div>
    {children && <fieldset className="work-draft-fields" disabled={busy || !draft.ready || draft.status === "conflict"}>{children}</fieldset>}
  </>;
}
