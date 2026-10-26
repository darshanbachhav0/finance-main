import { ArrowDownToLine, Copy, History, KeyRound, LogOut, Pencil, Power, RefreshCw, Save, UserPlus, UserRoundCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import api from "../../api/client.js";
import ConfirmDialog from "../../components/ConfirmDialog.jsx";
import DataTable from "../../components/DataTable.jsx";
import Drawer from "../../components/Drawer.jsx";
import EmptyState from "../../components/EmptyState.jsx";
import Message from "../../components/Message.jsx";
import PageHeader from "../../components/PageHeader.jsx";
import StatusBadge from "../../components/StatusBadge.jsx";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { auditSubject } from "../../utils/superAdmin.js";
import { formatDateTime } from "../../utils/formatters.js";
import "../../styles/superAdmin.css";

const emptyForm = { name: "", dni: "", email: "", area: "", jobTitle: "", organizationalUnit: "", employeeCode: "" };
const identityFields = [
  ["name", "Name", { required: true }],
  ["dni", "Employee DNI", { required: true, inputMode: "numeric", pattern: "[0-9]{8}", placeholder: "8 digits" }],
  ["email", "Email", { type: "email" }],
  ["area", "Area"],
  ["jobTitle", "Job title"],
  ["organizationalUnit", "Organizational unit"],
  ["employeeCode", "Employee code"]
];

// Super Admin > Administrators: the only place where Admin accounts are created and maintained.
// Super Admin accounts are listed read-only (they are managed from the server).
export default function SuperAdminAdministrators() {
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [demotionRoles, setDemotionRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [demote, setDemote] = useState(null);
  const [promote, setPromote] = useState(null);
  const [activity, setActivity] = useState(null);
  const [password, setPassword] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/superadmin/administrators");
      setRows(response.data.data || []);
      setSummary(response.data.summary || {});
      setDemotionRoles(response.data.demotionRoles || []);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(action, { success, keepOpen } = {}) {
    setProcessing(true);
    setActionError("");
    try {
      const response = await action();
      if (response?.data?.temporaryPassword) setPassword({ name: response.data.data?.name, value: response.data.temporaryPassword });
      if (success) notify(success);
      if (!keepOpen) { setForm(null); setConfirm(null); setDemote(null); setPromote(null); }
      await load();
      return response;
    } catch (err) {
      setActionError(err.message);
      return null;
    } finally {
      setProcessing(false);
    }
  }

  function saveForm(event) {
    event.preventDefault();
    const payload = Object.fromEntries(Object.entries(form.values).map(([key, value]) => [key, String(value || "").trim()]));
    if (form.id) void run(() => api.put(`/superadmin/administrators/${form.id}`, payload), { success: "Administrator updated." });
    else void run(() => api.post("/superadmin/administrators", payload), { success: "Administrator created." });
  }

  async function openActivity(row) {
    setActivity({ row, loading: true });
    try {
      const response = await api.get(`/superadmin/administrators/${row._id}/activity`);
      setActivity({ row, ...response.data.data });
    } catch (err) {
      setActivity({ row, error: err.message });
    }
  }

  async function searchCandidates(search) {
    setPromote((current) => ({ ...current, search, loading: true }));
    try {
      const response = await api.get("/superadmin/administrators/promotion-candidates", { params: { search } });
      setPromote((current) => current && ({ ...current, candidates: response.data.data || [], loading: false }));
    } catch (err) {
      setPromote((current) => current && ({ ...current, error: err.message, loading: false }));
    }
  }

  const askConfirm = (row, action) => {
    setActionError("");
    const options = {
      "reset-password": { title: "Reset this administrator's password?", description: "A new temporary password is created and shown once. Their sessions end, and they must choose a new password at the next sign-in.", confirmLabel: "Reset password", tone: "danger", success: "Password reset." },
      "sign-out": { title: "Sign this administrator out everywhere?", description: "Every open session of the account ends. Their password does not change.", confirmLabel: "Sign out everywhere", tone: "danger", success: "Sessions ended." },
      deactivate: { title: "Deactivate this administrator?", description: "They can no longer sign in. Any approvals waiting on them move to their substitute or jefe. At least one active administrator must remain.", confirmLabel: "Deactivate", tone: "danger", success: "Administrator deactivated." },
      activate: { title: "Activate this administrator?", description: "They can sign in again with their current password.", confirmLabel: "Activate", success: "Administrator activated." }
    }[action];
    setConfirm({ row, action, ...options });
  };

  const rowActions = (row) => [
    { label: "View activity", icon: History, onClick: () => openActivity(row) },
    { label: "Edit details", icon: Pencil, primary: true, hidden: !row.manageable, onClick: () => { setActionError(""); setForm({ id: row._id, values: Object.fromEntries(Object.keys(emptyForm).map((key) => [key, row[key] || ""])) }); } },
    { label: "Reset password", icon: KeyRound, hidden: !row.manageable, onClick: () => askConfirm(row, "reset-password") },
    { label: "Sign out everywhere", icon: LogOut, hidden: !row.manageable || !row.active, onClick: () => askConfirm(row, "sign-out") },
    { label: "Return to a previous role", icon: ArrowDownToLine, hidden: !row.manageable, onClick: () => { setActionError(""); setDemote({ row, role: row.previousRole || demotionRoles[0] || "Solicitor" }); } },
    { label: row.active ? "Deactivate" : "Activate", icon: Power, tone: row.active ? "danger" : "default", hidden: !row.manageable, onClick: () => askConfirm(row, row.active ? "deactivate" : "activate") }
  ];

  const columns = [
    { key: "name", label: "Administrator", render: (row) => <div className="primary-cell"><strong>{row.name}</strong><span>{row.dni ? `DNI ${row.dni}` : t("No DNI linked")}{row.role === "SuperAdmin" ? ` · ${t("SuperAdmin")}` : ""}</span></div> },
    { key: "status", label: "Status", render: (row) => <div className="primary-cell"><StatusBadge status={row.active ? "ACTIVE" : "INACTIVE"} />
      <span className="super-admin-flags">
        {row.passwordResetRequired && <span className="badge badge-warning">{t("Password change pending")}</span>}
        {row.twoFactorEnabled && <span className="badge badge-success">{t("Authenticator on")}</span>}
      </span></div> },
    { key: "email", label: "Email", render: (row) => row.email || "-" },
    { key: "lastLoginAt", label: "Last sign-in", render: (row) => row.lastLoginAt ? <div className="primary-cell"><strong>{formatDateTime(row.lastLoginAt, language)}</strong>{row.lastLoginIp && <span>{row.lastLoginIp}</span>}</div> : t("Never") },
    { key: "activity", label: "Activity (30 days)", sortable: false, render: (row) => <div className="primary-cell"><strong>{t("{count} changes").replace("{count}", row.activity.changes)}</strong><span>{t("{signIns} sign-ins, {failed} failed").replace("{signIns}", row.activity.signIns).replace("{failed}", row.activity.failedSignIns)}</span></div> },
    { key: "area", label: "Area", render: (row) => row.area || "-" }
  ];

  const pendingRow = confirm?.row;
  return (
    <section className="super-admin-page">
      <PageHeader
        title="Administrators"
        description="Create and maintain the Admin accounts. Admins run the platform; you decide who they are."
        actions={<>
          <button type="button" className="secondary-button" onClick={load} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button>
          <button type="button" className="secondary-button" onClick={() => { setActionError(""); setPromote({ search: "", candidates: [], selected: null }); void searchCandidates(""); }}><UserRoundCheck size={16} /><span>{t("Promote a user")}</span></button>
          <button type="button" className="primary-button" onClick={() => { setActionError(""); setForm({ values: { ...emptyForm } }); }}><UserPlus size={16} /><span>{t("New administrator")}</span></button>
        </>}
      />
      <Message type="error">{error}</Message>
      <p className="super-admin-summary">{t("{active} active, {inactive} inactive. Activity counts cover the last {days} days.").replace("{active}", summary.activeAdmins ?? 0).replace("{inactive}", summary.inactiveAdmins ?? 0).replace("{days}", summary.activityDays ?? 30)}</p>
      <div className="workspace-panel">
        <DataTable rows={rows} loading={loading} columns={columns} rowActions={rowActions} searchPlaceholder="Search name, DNI or email..." filters={[{ key: "role", label: "Role", allLabel: "All roles", options: ["Admin", "SuperAdmin"] }]} emptyTitle="No administrators yet" emptyDescription="Create the first Admin account." />
      </div>

      <Drawer
        open={Boolean(form)}
        error={actionError}
        title={form?.id ? "Edit administrator" : "New administrator"}
        description={form?.id ? "Identity and contact details. Their organization (jefe, cost centers) is kept on the Users page." : "A temporary password is created and shown once. They change it at the first sign-in."}
        onClose={() => !processing && setForm(null)}
        footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setForm(null)}>{t("Cancel")}</button><button type="submit" form="administrator-form" className="primary-button" disabled={processing}><Save size={16} /><span>{t(processing ? "Saving..." : form?.id ? "Save changes" : "Create administrator")}</span></button></>}
      >
        {form && <form id="administrator-form" className="form-grid two-column-form" onSubmit={saveForm}>
          {identityFields.map(([key, label, options = {}]) => (
            <label className="field" key={key}>
              <span>{t(label)}{options.required ? " *" : ""}</span>
              <input type={options.type || "text"} required={options.required} inputMode={options.inputMode} pattern={options.pattern} placeholder={options.placeholder ? t(options.placeholder) : undefined} value={form.values[key]} onChange={(event) => setForm({ ...form, values: { ...form.values, [key]: event.target.value } })} />
            </label>
          ))}
        </form>}
      </Drawer>

      <Drawer
        open={Boolean(promote)}
        error={actionError || promote?.error}
        title="Promote a user to Admin"
        description="Choose an active internal user. Their current role is remembered, so you can return them to it later."
        onClose={() => !processing && setPromote(null)}
        footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setPromote(null)}>{t("Cancel")}</button><button type="button" className="primary-button" disabled={processing || !promote?.selected} onClick={() => run(() => api.post("/superadmin/administrators/promote", { userId: promote.selected._id }), { success: "The user is now an administrator." })}><UserRoundCheck size={16} /><span>{t("Make administrator")}</span></button></>}
      >
        {promote && <div className="form-grid">
          <label className="field"><span>{t("Search")}</span><input type="search" value={promote.search} placeholder={t("Name, DNI or email...")} onChange={(event) => void searchCandidates(event.target.value)} /></label>
          <ul className="super-admin-candidates" aria-busy={promote.loading}>
            {(promote.candidates || []).map((candidate) => (
              <li key={candidate._id}>
                <label className={promote.selected?._id === candidate._id ? "is-selected" : ""}>
                  <input type="radio" name="promotion-candidate" checked={promote.selected?._id === candidate._id} onChange={() => setPromote({ ...promote, selected: candidate })} />
                  <span><strong>{candidate.name}</strong><small>{[candidate.dni && `DNI ${candidate.dni}`, t(candidate.role), candidate.area].filter(Boolean).join(" · ")}</small></span>
                </label>
              </li>
            ))}
            {!promote.loading && !(promote.candidates || []).length && <li><EmptyState compact title="No matching users." /></li>}
          </ul>
        </div>}
      </Drawer>

      <Drawer
        open={Boolean(demote)}
        error={actionError}
        title="Return to a previous role"
        description="The person stops being an administrator and works with the role you choose. At least one active administrator must remain."
        onClose={() => !processing && setDemote(null)}
        footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setDemote(null)}>{t("Cancel")}</button><button type="button" className="danger-button" disabled={processing} onClick={() => run(() => api.post(`/superadmin/administrators/${demote.row._id}/demote`, { role: demote.role }), { success: "The administrator role was removed." })}><ArrowDownToLine size={16} /><span>{t("Remove Admin role")}</span></button></>}
      >
        {demote && <div className="form-grid">
          <p><strong>{demote.row.name}</strong>{demote.row.previousRole ? ` · ${t("Role before becoming Admin")}: ${t(demote.row.previousRole)}` : ""}</p>
          <label className="field"><span>{t("New role")}</span><select value={demote.role} onChange={(event) => setDemote({ ...demote, role: event.target.value })}>{demotionRoles.map((role) => <option key={role} value={role}>{t(role)}</option>)}</select></label>
        </div>}
      </Drawer>

      <Drawer open={Boolean(activity)} size="large" title={activity?.row ? activity.row.name : "Activity"} description="Their latest changes and sign-ins, from the audit log." onClose={() => setActivity(null)}>
        {activity?.loading && <p role="status">{t("Loading...")}</p>}
        <Message type="error">{activity?.error}</Message>
        {activity?.changes && <>
          <h3>{t("Recent changes")}</h3>
          {activity.changes.length ? <ul className="super-admin-timeline">{activity.changes.map((row) => <li key={row._id}><strong>{t(row.action)}</strong><span>{[t(row.module), auditSubject(row)].filter(Boolean).join(" · ")}</span><small>{formatDateTime(row.createdAt, language)}</small></li>)}</ul> : <EmptyState compact title="No changes recorded." />}
          <h3>{t("Sign-in history")}</h3>
          {activity.signIns.length ? <ul className="super-admin-timeline">{activity.signIns.map((row) => <li key={row._id} className={row.blocked ? "is-blocked" : ""}><strong>{t(row.action)}</strong><span>{[row.ip, row.message && t(row.message)].filter(Boolean).join(" · ")}</span><small>{formatDateTime(row.createdAt, language)}</small></li>)}</ul> : <EmptyState compact title="No sign-ins recorded." />}
        </>}
      </Drawer>

      <Drawer open={Boolean(password)} title="Temporary password" description="Shown only now. Give it to the person privately; they must change it at their first sign-in." onClose={() => setPassword(null)} footer={<button type="button" className="primary-button" onClick={() => setPassword(null)}>{t("Done")}</button>}>
        {password && <div className="form-grid">
          <p><strong>{password.name}</strong></p>
          <code className="super-admin-secret">{password.value}</code>
          <button type="button" className="secondary-button" onClick={() => navigator.clipboard?.writeText(password.value).then(() => notify("Copied."), () => notify("Copy it by hand: the browser blocked the clipboard.", "warning"))}><Copy size={16} /><span>{t("Copy password")}</span></button>
        </div>}
      </Drawer>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title}
        description={confirm?.description}
        confirmLabel={confirm?.confirmLabel}
        tone={confirm?.tone || "primary"}
        details={pendingRow ? [{ label: "Administrator", value: `${pendingRow.name}${pendingRow.dni ? ` · DNI ${pendingRow.dni}` : ""}` }] : []}
        loading={processing}
        error={actionError}
        onClose={() => !processing && setConfirm(null)}
        onConfirm={() => run(() => api.post(`/superadmin/administrators/${confirm.row._id}/${confirm.action}`), { success: confirm.success })}
      />
    </section>
  );
}
