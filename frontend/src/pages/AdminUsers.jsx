import { useEffect, useState } from "react";
import api from "../api/client.js";
import Message from "../components/Message.jsx";
import ResourceManager from "../components/ResourceManager.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { approvalLevels, permissions, roles } from "../utils/options.js";

export default function AdminUsers() {
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
      description="Manage development and institutional users, profiles, approval scope, Cost Center authorization, and active status."
      endpoint="/users"
      deleteMode="deactivate"
      duplicateFields={["dni"]}
      fields={[
        { name: "name", label: "Name", required: true },
        { name: "dni", label: "Employee DNI", placeholder: "8 digits", validate: (value) => value && !/^\d{8}$/.test(String(value)) ? "Enter an 8-digit DNI." : "" },
        { name: "employeeCode", label: "Employee code" },
        { name: "email", label: "Email", type: "email" },
        { name: "jefe", label: "Direct supervisor", type: "select", options: supervisors.map(user => ({ value: user._id, label: `${user.name}${user.jobTitle ? ` · ${user.jobTitle}` : ""}` })), getValue: row => row.jefe?._id || row.jefe || "" },
        { name: "jobTitle", label: "Job title" },
        { name: "organizationalUnit", label: "Organizational unit" },
        { name: "password", label: "Password", type: "password", requiredOnCreate: true, hint: "At least 10 characters; required only when creating a user." },
        { name: "role", label: "Role", type: "toggle-group", required: true, options: roles, onSelect: (value) => value === "AreaDirector" ? { approvalLevel: "AREA_DIRECTOR" } : value === "ViceRector" ? { approvalLevel: "VICE_RECTOR" } : undefined },
        { name: "approvalLevel", label: "Approval level", type: "toggle-group", defaultValue: "AREA_DIRECTOR", options: approvalLevels, hint: "Auto-set for Area Director/Vice-Rector. Only Management uses Rectorate or General Management." },
        { name: "area", label: "Area", defaultValue: "General", required: true },
        { name: "approvalAreas", label: "Approval areas", type: "textarea", rows: 2, getValue: (row) => (row.approvalAreas || []).join(", "), hint: "Comma-separated areas or * for all." },
        { name: "costCenter", label: "Default Cost Center", type: "select", options: centerOptions, getValue: (row) => row.costCenter?._id || row.costCenter },
        { name: "authorizedCostCenters", label: "Authorized Cost Centers", type: "multiselect", defaultValue: [], options: centerOptions, getValue: (row) => (row.authorizedCostCenters || []).map((item) => item._id || item), hint: "Use Ctrl or Command to select more than one." },
        { name: "permissions", label: "Additional permissions", type: "toggle-list", defaultValue: [], options: permissions, getValue: (row) => row.permissions || [] },
        { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ]}
      columns={[
        { key: "name", label: "Employee", render: (row) => <div className="primary-cell"><strong>{row.name}</strong><span>{row.dni ? `DNI ${row.dni}` : row.employeeCode || "No DNI linked"}</span></div> }, { key: "email", label: "Email" }, { key: "role", label: "Role" },
        { key: "approvalLevel", label: "Approval level", render: (row) => ["AreaDirector", "ViceRector", "Management"].includes(row.role) ? row.approvalLevel : "-" },
        { key: "costCenter", label: "Default Cost Center", render: (row) => row.costCenter ? <div className="primary-cell"><strong>{row.costCenter.code} - {row.costCenter.name}</strong><span>{row.costCenter.organizationalUnitCode ? `${row.costCenter.organizationalUnitCode} · ${row.costCenter.organizationalUnit}` : row.area}</span></div> : "Manual review" },
        { key: "authorizedCostCenters", label: "Authorized CeCos", sortable: false, render: (row) => <div className="primary-cell"><strong>{row.authorizedCostCenters?.length || 0}</strong><span>{(row.authorizedCostCenters || []).slice(0, 3).map((item) => item.code || item).join(", ") || "No additional CeCos"}{row.authorizedCostCenters?.length > 3 ? "…" : ""}</span></div> },
        { key: "active", label: "Status", render: (row) => <StatusBadge status={row.active ? "ACTIVE" : "INACTIVE"} /> }
      ]}
      transformSubmit={(form) => {
        const payload = {
          ...form,
          jefe: form.jefe || null,
          approvalAreas: String(form.approvalAreas || "").split(",").map((item) => item.trim()).filter(Boolean)
        };
        if (!payload.password) delete payload.password;
        if (!payload.costCenter) delete payload.costCenter;
        return payload;
      }}
    />
  </>;
}
