import { useEffect, useState } from "react";
import api from "../api/client.js";
import Message from "../components/Message.jsx";
import ResourceManager from "../components/ResourceManager.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import Drawer from "../components/Drawer.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { approvalLevels, permissions, roles } from "../utils/options.js";
import { ROLE_CODES, rolesOf } from "../utils/access.js";
import { sodViolations } from "../../../shared/accessControl.mjs";
import { formatDateTime } from "../utils/formatters.js";

export default function AdminUsers() {
  const { t, language } = useLanguage();
  const [costCenters, setCostCenters] = useState([]);
  const [supervisors, setSupervisors] = useState([]);
  const [error, setError] = useState("");
  const [history, setHistory] = useState(null);
  useEffect(() => {
    api.get("/cost-centers", { params: { pageSize: 100 } }).then((response) => setCostCenters(response.data.data || [])).catch((err) => setError(err.message));
    let mounted = true;
    (async () => {
      const users = [];
      for (let page = 1; ; page++) {
        const response = await api.get("/users", { params: { page, pageSize: 100, active: true } });
        const rows = response.data.data || [];
        users.push(...rows);
        if (rows.length < 100) break;
      }
      if (mounted) setSupervisors(users);
    })().catch(err => mounted && setError(err.message));
    return () => { mounted = false; };
  }, []);
  // People who can supervise or cover someone: everyone active except the person being edited.
  const peopleOptions = (form, editing) => supervisors
    .filter((user) => String(user._id) !== String(editing?._id || ""))
    .map((user) => ({ value: user._id, label: `${user.name}${user.jobTitle ? ` · ${user.jobTitle}` : ""}${user.onLeave ? ` (${t("On leave")})` : ""}` }));
  const personById = (id) => supervisors.find((user) => String(user._id) === String(id || ""));
  // Where this person's approvals go while they are away, from the choices in the form.
  function coverageHint(form) {
    const substitute = personById(form.substitute);
    if (substitute && !substitute.onLeave) return t("While away, their approvals go to {name}, their substitute.").replace("{name}", substitute.name);
    const jefe = personById(form.jefe);
    if (jefe) return t("While away, their approvals go to their jefe ({name}) or the next available manager above. Set a substitute to choose who covers.").replace("{name}", jefe.name);
    return t("Nobody can take this person's approvals while they are away: set a substitute.");
  }
  // Segregation of duties for the roles being chosen (the server refuses "block" combinations).
  function sodHint(form) {
    const found = sodViolations([form.role, ...(form.roles || [])]);
    return found.length ? found.map((rule) => `${rule.severity === "block" ? t("Not allowed") : t("Review")}: ${rule.message}`).join(" ") : "One person, one account: add roles here instead of creating another account.";
  }
  async function showHistory(row) {
    setHistory({ row, rows: null });
    try { setHistory({ row, rows: (await api.get(`/users/${row._id}/history`)).data.data }); } catch (err) { setHistory({ row, rows: [], error: err.message }); }
  }
  const centerOptions = costCenters.map((item) => ({ value: item._id, label: `${item.code} - ${item.name}${item.organizationalUnitCode ? ` · ${item.organizationalUnitCode}` : ""}` }));

  return <>
    <Message type="error">{error}</Message>
    <ResourceManager
      title="Employees"

      endpoint="/users"
      deleteMode="deactivate"
      duplicateFields={["dni"]}
      fields={[
        { type: "section", label: "Identity" },
        { name: "name", label: "Name", required: true, wide: true },
        { name: "dni", label: "Employee DNI", placeholder: "8 digits", validate: (value) => value && !/^\d{8}$/.test(String(value)) ? "Enter an 8-digit DNI." : "" },
        { name: "employeeCode", label: "Employee code" },
        { name: "email", label: "Email", type: "email" },
        { name: "emailNotifications", label: "Email notifications", type: "checkbox", defaultValue: true, getValue: (row) => row.emailNotifications !== false, hint: "New notifications in the bell are also emailed to this address. The person can turn this off from their account menu." },
        { name: "password", label: "Password", type: "password", requiredOnCreate: true, hint: "Min. 10 characters. Not saved in drafts." },
        { type: "section", label: "Organization" },
        { name: "jefe", label: "Direct supervisor", type: "search-select", options: peopleOptions, searchPlaceholder: "Search by name or job title...", getValue: row => row.jefe?._id || row.jefe || "", wide: true },
        { name: "substitute", label: "Substitute during leave", type: "search-select", options: peopleOptions, searchPlaceholder: "Search by name or job title...", getValue: row => row.substitute?._id || row.substitute || "", wide: true, hint: (form) => form.substitute ? coverageHint(form) : "Approves on this person's behalf while they are on leave or inactive. Without one, their approvals go to their nearest available jefe." },
        { name: "jobTitle", label: "Job title" },
        { name: "jobCategory", label: "Job category (Portal de Personas)", type: "select", options: [1, 2, 3, 4, 5, 6, 7, 8].map((value) => ({ value: String(value), label: `Category ${value}` })), getValue: (row) => row.jobCategory ? String(row.jobCategory) : "", hint: "Only categories 3, 5 and 6 may charge a request to other cost centers (Por Encargo)." },
        { name: "organizationalUnit", label: "Organizational unit" },
        { name: "area", label: "Area", defaultValue: "General", required: true },
        { type: "section", label: "Access" },
        { name: "role", label: "Primary role", type: "toggle-group", required: true, options: roles, hint: "Their home workspace. Nobody changes their own roles; the last active administrator keeps the role.", onSelect: (value) => value === "AreaDirector" ? { approvalLevel: "AREA_DIRECTOR" } : value === "ViceRector" ? { approvalLevel: "VICE_RECTOR" } : undefined },
        { name: "roles", label: "Additional roles", type: "toggle-list", defaultValue: [], options: (form) => roles.filter((role) => role.value !== form.role), getValue: (row) => row.roles || [], hint: (form) => sodHint(form) },
        { name: "approvalLevel", label: "Approval level", type: "toggle-group", defaultValue: "AREA_DIRECTOR", options: approvalLevels },
        { name: "approvalAreas", label: "Approval areas", type: "tags", placeholder: "Area, or * for all", getValue: (row) => row.approvalAreas || [] },
        { name: "permissions", label: "Additional permissions", type: "toggle-list", defaultValue: [], options: permissions, getValue: (row) => row.permissions || [], hint: "Department duties (provisioning, payments, batches, budget) come only with a role." },
        { name: "accessReviewed", label: "Access confirmed", type: "checkbox", defaultValue: false, getValue: () => false, hint: (form, editing) => editing?.accessReview?.required ? (editing.accessReview.reasons || []).join(" ") : "Nothing waits for review." },
        { name: "active", label: "Active", type: "checkbox", defaultValue: true, hint: "Deactivating moves this user's pending approvals to their substitute, or without one to their nearest available jefe." },
        { name: "onLeave", label: "On leave", type: "checkbox", defaultValue: false, hint: (form) => form.onLeave ? coverageHint(form) : "While on leave, this user's approvals go to their substitute (or nearest available jefe) and come back when the leave ends." },
        { name: "leaveUntil", label: "On leave until", type: "date", hint: "Last day of leave. The day after, the leave ends by itself and the approvals come back." },
        { type: "section", label: "Cost centers" },
        { name: "costCenter", label: "Default Cost Center", type: "select", options: centerOptions, getValue: (row) => row.costCenter?._id || row.costCenter, wide: true },
        { name: "authorizedCostCenters", label: "Authorized Cost Centers", type: "multiselect", defaultValue: [], options: centerOptions, getValue: (row) => (row.authorizedCostCenters || []).map((item) => item._id || item) }
      ]}
      columns={[
        { key: "name", label: "Employee", render: (row) => <div className="primary-cell"><strong>{row.name}</strong><span>{row.dni ? `DNI ${row.dni}` : row.employeeCode || t("No DNI linked")}</span></div> }, { key: "email", label: "Email" }, { key: "role", label: "Roles", render: (row) => <div className="primary-cell"><strong>{rolesOf(row).map((role) => ROLE_CODES[role]).join(" · ")}</strong>{row.accessReview?.required && <span className="warning-text">{t("Access to review")}</span>}</div> },
        { key: "approvalLevel", label: "Approval level", render: (row) => ["AreaDirector", "ViceRector", "Management"].includes(row.role) ? t(row.approvalLevel) : "-" },
        { key: "costCenter", label: "Default Cost Center", render: (row) => row.costCenter ? <div className="primary-cell"><strong>{row.costCenter.code} - {row.costCenter.name}</strong><span>{row.costCenter.organizationalUnitCode ? `${row.costCenter.organizationalUnitCode} · ${row.costCenter.organizationalUnit}` : row.area}</span></div> : t("Manual review") },
        { key: "authorizedCostCenters", label: "Authorized CeCos", sortable: false, render: (row) => <div className="primary-cell"><strong>{row.authorizedCostCenters?.length || 0}</strong><span>{(row.authorizedCostCenters || []).slice(0, 3).map((item) => item.code || item).join(", ") || t("No additional CeCos")}{row.authorizedCostCenters?.length > 3 ? "…" : ""}</span></div> },
        { key: "active", label: "Status", render: (row) => <div className="primary-cell"><StatusBadge status={row.active ? "ACTIVE" : "INACTIVE"} />{row.onLeave && <span>{t("On leave")}{row.leaveUntil ? ` · ${String(row.leaveUntil).slice(0, 10)}` : ""}</span>}{row.substitute?.name && <span>{t("Substitute")}: {row.substitute.name}</span>}</div> }
      ]}
      renderDetails={(row) => <button type="button" className="secondary-button" onClick={() => showHistory(row)}>{t("Change history")}</button>}
      transformSubmit={(form) => {
        const payload = { ...form, jefe: form.jefe || null, substitute: form.substitute || null, jobCategory: form.jobCategory ? Number(form.jobCategory) : null };
        if (!payload.password) delete payload.password;
        if (!payload.costCenter) delete payload.costCenter;
        if (payload.jobCategory === "" || payload.jobCategory === null) delete payload.jobCategory;
        if (!payload.onLeave || !payload.leaveUntil) payload.leaveUntil = null;
        payload.roles = (payload.roles || []).filter((role) => role !== payload.role);
        if (!payload.accessReviewed) delete payload.accessReviewed;
        return payload;
      }}
    />
    <Drawer open={Boolean(history)} title={history ? `${t("Change history")} · ${history.row.name}` : ""} onClose={() => setHistory(null)}>
      <Message type="error">{history?.error}</Message>
      {history && !history.rows && <p>{t("Loading...")}</p>}
      {history?.rows && (history.rows.length ? <ul className="super-admin-list">{history.rows.map((entry) => <li key={entry._id}>
        <strong>{t(entry.action)}</strong> · {entry.actorName || t("System")} · {formatDateTime(entry.createdAt, language)}
        {entry.newValues?.roles && <small className="super-admin-note">{(entry.oldValues?.roles || []).map((role) => ROLE_CODES[role] || role).join(" · ") || "-"} → {entry.newValues.roles.map((role) => ROLE_CODES[role] || role).join(" · ")}</small>}
      </li>)}</ul> : <EmptyState compact title="No changes recorded." />)}
    </Drawer>
  </>;
}
