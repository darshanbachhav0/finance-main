import { DatabaseBackup, RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import api from "../../api/client.js";
import ConfirmDialog from "../../components/ConfirmDialog.jsx";
import DataTable from "../../components/DataTable.jsx";
import Message from "../../components/Message.jsx";
import PageHeader from "../../components/PageHeader.jsx";
import StatusBadge from "../../components/StatusBadge.jsx";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { backupStatus, formatBytes, PLATFORM_STATUS_CHANGED_EVENT } from "../../utils/superAdmin.js";
import { formatDateTime, formatNumber } from "../../utils/formatters.js";
import "../../styles/superAdmin.css";

// While a backup runs, its row is re-read every few seconds.
const BACKUP_POLL_MS = 3000;

const numberFields = [
  ["passwordPolicy", "minLength", "Minimum password length", "Characters (10 to 72)."],
  ["passwordPolicy", "expiryDays", "Password expiry (days)", "0 means passwords never expire. An expired password must be changed at the next sign-in."],
  ["session", "userMinutes", "Session length (minutes)", "For everyone except the Super Admin (15 to 1440)."],
  ["session", "superAdminMinutes", "Super Admin session length (minutes)", "Shorter on purpose (10 to 240)."]
];

function formFrom(settings) {
  return {
    passwordPolicy: { ...settings.passwordPolicy },
    session: { ...settings.session },
    maintenance: { enabled: Boolean(settings.maintenance?.enabled), message: settings.maintenance?.message || "" },
    announcement: { enabled: Boolean(settings.announcement?.enabled), message: settings.announcement?.message || "", tone: settings.announcement?.tone || "info" }
  };
}

export default function SuperAdminSettings() {
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmMaintenance, setConfirmMaintenance] = useState(false);
  const [backups, setBackups] = useState({ data: [], location: "" });
  const [backupError, setBackupError] = useState("");
  const [startingBackup, setStartingBackup] = useState(false);
  const backupsRef = useRef(null);

  const loadSettings = useCallback(async () => {
    try {
      const response = await api.get("/superadmin/settings");
      setSaved(response.data.data);
      setForm(formFrom(response.data.data));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, []);
  const loadBackups = useCallback(async () => {
    try {
      setBackups((await api.get("/superadmin/backups")).data);
      setBackupError("");
    } catch (err) {
      setBackupError(err.message);
    }
  }, []);
  useEffect(() => { void loadSettings(); void loadBackups(); }, [loadSettings, loadBackups]);
  useEffect(() => { if (window.location.hash === "#backups") backupsRef.current?.scrollIntoView(); }, [backups.location]);

  const running = backups.data.some((run) => run.status === "RUNNING");
  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => { void loadBackups(); }, BACKUP_POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, loadBackups]);

  const setValue = (group, key, value) => setForm((current) => ({ ...current, [group]: { ...current[group], [key]: value } }));

  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await api.put("/superadmin/settings", form);
      setSaved(response.data.data);
      setForm(formFrom(response.data.data));
      window.dispatchEvent(new CustomEvent(PLATFORM_STATUS_CHANGED_EVENT));
      notify("Platform settings saved.");
      setConfirmMaintenance(false);
    } catch (err) {
      setError(err.message);
      setConfirmMaintenance(false);
    } finally {
      setSaving(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    // Turning maintenance on signs every non-administrator out: ask first.
    if (form.maintenance.enabled && !saved?.maintenance?.enabled) setConfirmMaintenance(true);
    else void save();
  }

  async function startBackup() {
    setStartingBackup(true);
    setBackupError("");
    try {
      await api.post("/superadmin/backups");
      notify("Backup started.");
      await loadBackups();
    } catch (err) {
      setBackupError(err.message);
    } finally {
      setStartingBackup(false);
    }
  }

  return (
    <section className="super-admin-page">
      <PageHeader title="Platform settings" description="Password and session rules, maintenance mode, the announcement banner and backups. None of these touch a financial process." />
      <Message type="error">{error}</Message>
      {form && <form className="super-admin-settings" onSubmit={submit}>
        <div className="workspace-panel">
          <div className="section-heading"><div><h3>{t("Passwords and sessions")}</h3><p>{t("Leave a value empty to use the server default.")}</p></div></div>
          <div className="form-grid two-column-form">
            {numberFields.map(([group, key, label, hint]) => (
              <label className="field" key={key}>
                <span>{t(label)}</span>
                <input type="number" min="0" step="1" value={form[group][key] ?? ""} onChange={(event) => setValue(group, key, event.target.value === "" ? "" : Number(event.target.value))} />
                <small className="field-hint">{t(hint)}</small>
              </label>
            ))}
          </div>
        </div>

        <div className="workspace-panel section-spacer">
          <div className="section-heading"><div><h3>{t("Maintenance mode")}</h3><p>{t("While it is on, only Admin and Super Admin accounts can sign in. Everyone else is signed out and sees the message below.")}</p></div><StatusBadge status={saved?.maintenance?.enabled ? "ACTIVE" : "INACTIVE"} /></div>
          <div className="form-grid">
            <label className="toggle-field"><input type="checkbox" checked={form.maintenance.enabled} onChange={(event) => setValue("maintenance", "enabled", event.target.checked)} /><span>{t("Turn on maintenance mode")}</span></label>
            <label className="field"><span>{t("Message for users")}</span><textarea rows="2" maxLength={500} value={form.maintenance.message} onChange={(event) => setValue("maintenance", "message", event.target.value)} placeholder={t("For example: closing the month, back at 18:00.")} /></label>
          </div>
        </div>

        <div className="workspace-panel section-spacer">
          <div className="section-heading"><div><h3>{t("Announcement")}</h3><p>{t("A banner every signed-in user sees at the top of each page, and on the sign-in page.")}</p></div><StatusBadge status={saved?.announcement?.enabled ? "ACTIVE" : "INACTIVE"} /></div>
          <div className="form-grid">
            <label className="toggle-field"><input type="checkbox" checked={form.announcement.enabled} onChange={(event) => setValue("announcement", "enabled", event.target.checked)} /><span>{t("Show the announcement")}</span></label>
            <label className="field"><span>{t("Announcement text")}</span><textarea rows="2" maxLength={500} value={form.announcement.message} onChange={(event) => setValue("announcement", "message", event.target.value)} /></label>
            <label className="field"><span>{t("Style")}</span><select value={form.announcement.tone} onChange={(event) => setValue("announcement", "tone", event.target.value)}><option value="info">{t("Information")}</option><option value="warning">{t("Warning")}</option></select></label>
          </div>
        </div>

        <div className="super-admin-form-actions">
          {saved?.updatedAt && <small>{t("Last saved")}: {formatDateTime(saved.updatedAt, language)}</small>}
          <button type="button" className="secondary-button" disabled={saving} onClick={() => setForm(formFrom(saved))}>{t("Discard changes")}</button>
          <button type="submit" className="primary-button" disabled={saving}><Save size={16} /><span>{t(saving ? "Saving..." : "Save settings")}</span></button>
        </div>
      </form>}

      <div className="workspace-panel section-spacer" id="backups" ref={backupsRef}>
        <div className="section-heading">
          <div><h3>{t("Backups")}</h3><p>{t("A copy of the database and the stored files, written on the server at {location}. Copy it somewhere safe: on a server without a persistent disk it is lost at the next restart.").replace("{location}", backups.location || "-")}</p></div>
          <div className="page-actions">
            <button type="button" className="secondary-button" onClick={loadBackups}><RefreshCw size={16} /><span>{t("Refresh")}</span></button>
            <button type="button" className="primary-button" onClick={startBackup} disabled={startingBackup || running}><DatabaseBackup size={16} /><span>{t(running ? "Backup running..." : "Start backup")}</span></button>
          </div>
        </div>
        <Message type="error">{backupError}</Message>
        <DataTable
          rows={backups.data}
          controls={false}
          emptyTitle="No backups yet"
          emptyDescription="Start the first backup, or run npm run backup on the server."
          columns={[
            { key: "startedAt", label: "Started", render: (row) => formatDateTime(row.startedAt, language) },
            { key: "status", label: "Status", render: (row) => <span className={`badge badge-${backupStatus[row.status]?.tone || "neutral"}`}><span className="badge-label">{t(backupStatus[row.status]?.label || row.status)}</span></span> },
            { key: "trigger", label: "Started by", render: (row) => row.triggeredByName || t(row.trigger === "COMMAND" ? "Server command" : "Super Admin") },
            { key: "documentCount", label: "Records", render: (row) => row.documentCount !== undefined ? formatNumber(row.documentCount, language) : "-" },
            { key: "sizeBytes", label: "Size", render: (row) => row.sizeBytes ? formatBytes(row.sizeBytes) : "-" },
            { key: "location", label: "Folder", render: (row) => row.status === "FAILED" ? row.error : row.location || "-" }
          ]}
        />
      </div>

      <ConfirmDialog
        open={confirmMaintenance}
        tone="danger"
        title="Turn on maintenance mode?"
        description="Everyone except administrators is signed out and cannot sign in until you turn it off."
        confirmLabel="Turn on maintenance"
        loading={saving}
        error={error}
        onClose={() => !saving && setConfirmMaintenance(false)}
        onConfirm={save}
      />
    </section>
  );
}
