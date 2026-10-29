import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../api/client.js";
import Message from "../../components/Message.jsx";
import PageHeader from "../../components/PageHeader.jsx";
import StatCard from "../../components/StatCard.jsx";
import Tabs, { tabPanelProps } from "../../components/Tabs.jsx";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { PERMISSION_LABELS, ROLE_GRANTS, SOD_RULES } from "../../../../shared/accessControl.mjs";
import { ROLE_CODES, ROLE_LABELS, ROLES } from "../../utils/access.js";
import "../../styles/superAdmin.css";

const ROLE_ORDER = [ROLES.SOLICITOR, ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR, ROLES.GAF, ROLES.MANAGEMENT, ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.LEGAL, ROLES.HUMAN_RESOURCES, ROLES.AUDITOR, ROLES.ADMIN];
const SCOPE_SHORT = { OWN: "Propio", COST_CENTER: "CeCo", APPROVAL_HIERARCHY: "Jerarquía", UNIVERSITY: "UMA" };

function PersonLink({ person }) {
  return <Link className="text-link" to={`/users?search=${encodeURIComponent(person.dni || person.name)}`}>{person.name}</Link>;
}

function PeopleList({ rows, empty, detail }) {
  const { t } = useLanguage();
  if (!rows?.length) return <p className="muted">{t(empty)}</p>;
  return <ul className="super-admin-list">{rows.map((row, index) => <li key={`${row.person?._id || row._id}-${index}`}>
    {row.person ? <PersonLink person={row.person} /> : row.code ? <span>{row.code} · {row.name}</span> : <PersonLink person={row} />}
    <small className="super-admin-note">{detail ? detail(row) : (row.roles || row.person?.roles || []).map((role) => ROLE_CODES[role]).join(" · ")}</small>
  </li>)}</ul>;
}

// Administración > Roles y permisos: what each role may do (the catalog the server enforces) and
// what needs the administrator's attention in today's assignments.
export default function AccessReview() {
  const { t } = useLanguage();
  const [tab, setTab] = useState("review");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try { setData((await api.get("/users/access-review")).data.data); } catch (err) { setError(err.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const summary = data?.summary || {};
  const permissions = Object.keys(PERMISSION_LABELS);

  return (
    <section className="super-admin-page">
      <PageHeader
        title="Roles and permissions"
        actions={<button type="button" className="secondary-button" onClick={load} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button>}
      />
      <Message type="error">{error}</Message>
      <Tabs idPrefix="access" label={t("Roles and permissions")} value={tab} onChange={setTab} panels tabs={[
        { id: "review", label: "Access review", count: (summary.conflicts || 0) + (summary.flagged || 0) },
        { id: "matrix", label: "Permission matrix" }
      ]} />
      {tab === "review" && <div {...tabPanelProps("access", "review")}>
        <div className="stats-grid">
          <StatCard label="Segregation conflicts" value={summary.conflicts ?? 0} tone={summary.blockingConflicts ? "danger" : summary.conflicts ? "warning" : "neutral"} />
          <StatCard label="Access to review" value={summary.flagged ?? 0} tone={summary.flagged ? "warning" : "neutral"} />
          <StatCard label="Without supervisor" value={summary.noSupervisor ?? 0} tone={summary.noSupervisor ? "warning" : "neutral"} />
          <StatCard label="Cost centers without responsible" value={summary.noResponsible ?? 0} tone={summary.noResponsible ? "warning" : "neutral"} />
        </div>
        <div className="super-admin-grid">
          <div className="workspace-panel"><h3>{t("Segregation conflicts")}</h3>
            <PeopleList rows={data?.conflicts} empty="No conflicting roles." detail={(row) => `${row.severity === "block" ? t("Blocked") : t("Review")}: ${row.message}`} /></div>
          <div className="workspace-panel"><h3>{t("Access to review")}</h3>
            <PeopleList rows={data?.flagged} empty="Nothing flagged." detail={(row) => row.reasons.join(" ")} /></div>
          <div className="workspace-panel"><h3>{t("Without supervisor")}</h3>
            <PeopleList rows={data?.noSupervisor} empty="Everyone has a supervisor." /></div>
          <div className="workspace-panel"><h3>{t("Requesters without cost center")}</h3>
            <PeopleList rows={data?.noCostCenter} empty="Everyone has a cost center." /></div>
          <div className="workspace-panel"><h3>{t("Cost centers without responsible")}</h3>
            <PeopleList rows={data?.noResponsible} empty="Every cost center has a responsible." detail={(row) => row.area || ""} /></div>
          <div className="workspace-panel"><h3>{t("Active administrators")}</h3>
            <PeopleList rows={data?.administrators} empty="No active administrator." /></div>
        </div>
      </div>}
      {tab === "matrix" && <div {...tabPanelProps("access", "matrix")} className="workspace-panel">
        <div className="access-matrix-wrap"><table className="data-table access-matrix">
          <thead><tr><th>{t("Permission")}</th>{ROLE_ORDER.map((role) => <th key={role} title={ROLE_LABELS[role]}>{ROLE_CODES[role]}</th>)}</tr></thead>
          <tbody>{permissions.map((permission) => <tr key={permission}>
            <td><strong>{PERMISSION_LABELS[permission]}</strong><br /><small className="muted">{permission}</small></td>
            {ROLE_ORDER.map((role) => <td key={role}>{ROLE_GRANTS[role]?.[permission] ? SCOPE_SHORT[ROLE_GRANTS[role][permission]] : ""}</td>)}
          </tr>)}</tbody>
        </table></div>
        <h3>{t("Segregation of duties")}</h3>
        <ul>{SOD_RULES.map((rule) => <li key={rule.id}><strong>{rule.severity === "block" ? t("Blocked") : t("Review")}</strong> · {rule.message}</li>)}</ul>
      </div>}
    </section>
  );
}
