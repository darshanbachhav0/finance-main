import { useEffect, useState } from "react";
import api from "../api/client.js";
import Message from "../components/Message.jsx";
import ResourceManager from "../components/ResourceManager.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { approvalLevels, permissions, roles } from "../utils/options.js";

export default function AdminUsers() {
  const { t } = useLanguage();
  const [costCenters, setCostCenters] = useState([]);
  const [supervisors, setSupervisors] = useState([]);
  const [error, setError] = useState("");
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
  const centerOptions = costCenters.map((item) => ({ value: item._id, label: `${item.code} - ${item.name}${item.organizationalUnitCode ? ` · ${item.organizationalUnitCode}` : ""}` }));

  return <>
    <Message type="error">{error}</Message>
    <ResourceManager
      title="User Administration"
      description="Users, roles and access."
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
        { name: "jefe", label: "Direct supervisor", type: "select", options: supervisors.map(user => ({ value: user._id, label: `${user.name}${user.jobTitle ? ` · ${user.jobTitle}` : ""}` })), getValue: row => row.jefe?._id || row.jefe || "", wide: true },
        { name: "substitute", label: "Substitute during leave", type: "select", options: supervisors.map(user => ({ value: user._id, label: `${user.name}${user.jobTitle ? ` · ${user.jobTitle}` : ""}` })), getValue: row => row.substitute?._id || row.substitute || "", wide: true, hint: "Approves on this person's behalf while they are on leave or inactive. Without one, their approvals go to their nearest available jefe." },
        { name: "jobTitle", label: "Job title" },
        { name: "organizationalUnit", label: "Organizational unit" },
        { name: "area", label: "Area", defaultValue: "General", required: true },
        { type: "section", label: "Access" },
        { name: "role", label: "Role", type: "toggle-group", required: true, options: roles, onSelect: (value) => value === "AreaDirector" ? { approvalLevel: "AREA_DIRECTOR" } : value === "ViceRector" ? { approvalLevel: "VICE_RECTOR" } : undefined },
        { name: "approvalLevel", label: "Approval level", type: "toggle-group", defaultValue: "AREA_DIRECTOR", options: approvalLevels },
        { name: "approvalAreas", label: "Approval areas", type: "tags", placeholder: "Area, or * for all", getValue: (row) => row.approvalAreas || [] },
        { name: "permissions", label: "Additional permissions", type: "toggle-list", defaultValue: [], options: permissions, getValue: (row) => row.permissions || [], hint: "Extras on top of the user's role. The role already includes its own access; department duties such as accounting, payments or budget management come only with the role." },
        { name: "active", label: "Active", type: "checkbox", defaultValue: true, hint: "Deactivating moves this user's pending approvals to their substitute, or without one to their nearest available jefe." },
        { name: "onLeave", label: "On leave", type: "checkbox", defaultValue: false, hint: "While on leave, this user's approvals go to their substitute (or nearest available jefe) and come back when the leave ends." },
        { name: "leaveUntil", label: "On leave until", type: "date" },
        { type: "section", label: "Cost centers" },
        { name: "costCenter", label: "Default Cost Center", type: "select", options: centerOptions, getValue: (row) => row.costCenter?._id || row.costCenter, wide: true },
        { name: "authorizedCostCenters", label: "Authorized Cost Centers", type: "multiselect", defaultValue: [], options: centerOptions, getValue: (row) => (row.authorizedCostCenters || []).map((item) => item._id || item) }
      ]}
      columns={[
        { key: "name", label: "Employee", render: (row) => <div className="primary-cell"><strong>{row.name}</strong><span>{row.dni ? `DNI ${row.dni}` : row.employeeCode || t("No DNI linked")}</span></div> }, { key: "email", label: "Email" }, { key: "role", label: "Role", render: (row) => t(row.role) },
        { key: "approvalLevel", label: "Approval level", render: (row) => ["AreaDirector", "ViceRector", "Management"].includes(row.role) ? t(row.approvalLevel) : "-" },
        { key: "costCenter", label: "Default Cost Center", render: (row) => row.costCenter ? <div className="primary-cell"><strong>{row.costCenter.code} - {row.costCenter.name}</strong><span>{row.costCenter.organizationalUnitCode ? `${row.costCenter.organizationalUnitCode} · ${row.costCenter.organizationalUnit}` : row.area}</span></div> : t("Manual review") },
        { key: "authorizedCostCenters", label: "Authorized CeCos", sortable: false, render: (row) => <div className="primary-cell"><strong>{row.authorizedCostCenters?.length || 0}</strong><span>{(row.authorizedCostCenters || []).slice(0, 3).map((item) => item.code || item).join(", ") || t("No additional CeCos")}{row.authorizedCostCenters?.length > 3 ? "…" : ""}</span></div> },
        { key: "active", label: "Status", render: (row) => <div className="primary-cell"><StatusBadge status={row.active ? "ACTIVE" : "INACTIVE"} />{row.onLeave && <span>{t("On leave")}{row.leaveUntil ? ` · ${String(row.leaveUntil).slice(0, 10)}` : ""}</span>}{row.substitute?.name && <span>{t("Substitute")}: {row.substitute.name}</span>}</div> }
      ]}
      transformSubmit={(form) => {
        const payload = { ...form, jefe: form.jefe || null, substitute: form.substitute || null };
        if (!payload.password) delete payload.password;
        if (!payload.costCenter) delete payload.costCenter;
        if (!payload.onLeave || !payload.leaveUntil) payload.leaveUntil = null;
        return payload;
      }}
    />
  </>;
}
