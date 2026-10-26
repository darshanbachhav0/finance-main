import { Activity, BellRing, Lock, RefreshCw, ShieldAlert, UserCog } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../api/client.js";
import EmptyState from "../../components/EmptyState.jsx";
import Message from "../../components/Message.jsx";
import PageHeader from "../../components/PageHeader.jsx";
import StatCard from "../../components/StatCard.jsx";
import StatusBadge from "../../components/StatusBadge.jsx";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { formatBytes } from "../../utils/superAdmin.js";
import { formatDateTime, formatNumber } from "../../utils/formatters.js";
import "../../styles/superAdmin.css";

// The Super Admin's home: its accounts, security signals and the platform's health, for monitoring.
export default function SuperAdminOverview() {
  const { t, language } = useLanguage();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData((await api.get("/superadmin/overview")).data.data);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const admins = data?.administrators || {};
  const email = data?.email;
  const sunat = data?.sunat;
  const issues = data?.health?.issues || [];
  const workload = (data?.workload || []).filter((item) => item.count > 0);

  return (
    <section className="super-admin-page">
      <PageHeader
        title="Platform overview"
        description="Administrator accounts, security signals and the health of the platform. Everything here is for monitoring."
        actions={<>
          <span className="last-updated">{t("Last updated")}: {data?.checkedAt ? formatDateTime(data.checkedAt, language) : "-"}</span>
          <button type="button" className="icon-button" onClick={load} disabled={loading} aria-label={t("Refresh")} title={t("Refresh")}><RefreshCw className={loading ? "spin" : ""} size={16} /></button>
        </>}
      />
      <Message type="error">{error}</Message>
      {data && <>
        <div className="stats-grid">
          <StatCard label="Active administrators" value={admins.activeAdmins ?? 0} tone="success" icon={UserCog} to="/super-admin/administrators" actionLabel="Manage administrators" />
          <StatCard label="Locked administrators" value={admins.lockedAdmins ?? 0} tone={admins.lockedAdmins ? "danger" : "neutral"} icon={Lock} to="/super-admin/administrators" />
          <StatCard label="Security alerts (7 days)" value={data.alerts?.lastSevenDays ?? 0} tone={data.alerts?.lastSevenDays ? "warning" : "neutral"} icon={BellRing} to="/super-admin/alerts" actionLabel="Review alerts" />
          <StatCard label="Blocked sign-ins (24 hours)" value={data.signIns?.blockedLast24h ?? 0} tone={data.signIns?.blockedLast24h ? "warning" : "neutral"} icon={ShieldAlert} to="/super-admin/audit?module=AUTH&blocked=true" actionLabel="Open audit log" />
        </div>

        {(data.maintenance?.enabled || data.announcement?.enabled) && (
          <div className="inline-alert alert-warning" role="status">
            <ShieldAlert size={18} aria-hidden="true" />
            <div>
              {data.maintenance?.enabled && <strong>{t("Maintenance mode is on")}</strong>}
              {data.announcement?.enabled && <span>{t("Announcement shown to everyone")}: {data.announcement.message}</span>}
              <Link className="text-link" to="/super-admin/settings">{t("Platform settings")}</Link>
            </div>
          </div>
        )}

        <div className="super-admin-grid">
          <div className="workspace-panel">
            <div className="section-heading"><div><h3>{t("Pending work across departments")}</h3><p>{t("What each queue holds right now. The departments and the Admin act on it; this view only counts.")}</p></div><Activity size={18} aria-hidden="true" /></div>
            {workload.length ? (
              <ul className="super-admin-list">
                {workload.map((item) => (
                  <li key={item.key}>
                    <span>{t(item.label)}</span>
                    <strong className={item.overdue ? "super-admin-count is-overdue" : "super-admin-count"}>{formatNumber(item.count, language)}{item.overdue ? ` · ${t("{count} overdue").replace("{count}", formatNumber(item.overdue, language))}` : ""}</strong>
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact title="No pending work in any queue." />}
          </div>

          <div className="workspace-panel">
            <div className="section-heading"><div><h3>{t("System health")}</h3><p>{t("Configuration checks and integrations.")}</p></div></div>
            <dl className="detail-grid">
              <div className="wide">
                <dt>{t("Configuration checks")}</dt>
                <dd>
                  {data.health?.error ? t(data.health.error) : issues.length ? (
                    <ul className="super-admin-issues">{issues.map((issue, index) => <li key={index}>{t(issue.message)} <small>· {t(issue.owner)}</small></li>)}</ul>
                  ) : t("No configuration problems found.")}
                </dd>
              </div>
              <div>
                <dt>{t("Notification emails")}</dt>
                <dd>
                  <StatusBadge status={email?.enabled ? "ACTIVE" : "INACTIVE"} /> {email?.mode}
                  {(email?.problems || []).map((problem) => <small className="super-admin-note" key={problem}>{problem}</small>)}
                  <small className="super-admin-note">{t("Last 24 hours")}: {t("{sent} sent, {failed} failed").replace("{sent}", email?.last24h?.SENT || 0).replace("{failed}", email?.last24h?.FAILED || 0)}</small>
                </dd>
              </div>
              <div>
                <dt>{t("SUNAT data")}</dt>
                <dd>
                  {sunat?.mode}
                  {sunat?.mode === "PADRON" && <small className="super-admin-note">{t(sunat.ready && sunat.fresh ? "Padrón up to date" : sunat.ready ? "Padrón loaded but stale" : "Padrón missing")}</small>}
                  {sunat?.mode === "CONSULTA_RUC" && <small className="super-admin-note">{t("Supplier RUCs are verified on SUNAT Consulta RUC")}</small>}
                  {sunat?.error && <small className="super-admin-note">{sunat.error}</small>}
                </dd>
              </div>
              <div>
                <dt>{t("Last backup")}</dt>
                <dd>
                  {data.backup ? <>{formatDateTime(data.backup.finishedAt, language)} <small className="super-admin-note">{formatBytes(data.backup.sizeBytes)}</small></> : t("No backup recorded yet.")}
                  <span className="super-admin-note"><Link className="text-link" to="/super-admin/settings#backups">{t("Backups")}</Link></span>
                </dd>
              </div>
              <div>
                <dt>{t("Super Admin accounts")}</dt>
                <dd>{admins.superAdmins ?? 0}</dd>
              </div>
            </dl>
          </div>
        </div>
      </>}
    </section>
  );
}
