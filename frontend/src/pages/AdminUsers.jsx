import { useEffect, useState } from "react";
import api from "../api/client.js";
import Message from "../components/Message.jsx";
import ResourceManager from "../components/ResourceManager.jsx";
import { approvalLevels, roles } from "../utils/options.js";

export default function AdminUsers() {
  const [costCenters, setCostCenters] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api.get("/cost-centers", { params: { pageSize: 100 } }).then((response) => setCostCenters(response.data.data || [])).catch((err) => setError(err.message));
  }, []);
  const centerOptions = costCenters.map((item) => ({ value: item._id, label: `${item.code} - ${item.name}` }));

  return <>
    <Message type="error">{error}</Message>
    <ResourceManager
      title="User Administration"
      description="Manage development and institutional users, profiles, approval scope, Cost Center authorization, and active status."
      endpoint="/users"
      deleteMode="deactivate"
      duplicateFields={["email"]}
      fields={[
        { name: "name", label: "Name", required: true },
        { name: "email", label: "Email", type: "email", required: true },
        { name: "password", label: "Password", type: "password", requiredOnCreate: true, hint: "At least 10 characters; required only when creating a user." },
        { name: "role", label: "Role", type: "select", required: true, options: roles },
        { name: "approvalLevel", label: "Approval level", type: "select", defaultValue: "AREA_DIRECTOR", options: approvalLevels, hint: "Used for Approver and configured Management approval profiles." },
        { name: "area", label: "Area", defaultValue: "General", required: true },
        { name: "approvalAreas", label: "Approval areas", type: "textarea", rows: 2, getValue: (row) => (row.approvalAreas || []).join(", "), hint: "Comma-separated areas or * for all." },
        { name: "costCenter", label: "Default Cost Center", type: "select", options: centerOptions, getValue: (row) => row.costCenter?._id || row.costCenter },
        { name: "authorizedCostCenters", label: "Authorized Cost Centers", type: "multiselect", defaultValue: [], options: centerOptions, getValue: (row) => (row.authorizedCostCenters || []).map((item) => item._id || item), hint: "Use Ctrl or Command to select more than one." },
        { name: "permissions", label: "Additional permissions", type: "textarea", rows: 2, getValue: (row) => (row.permissions || []).join(", "), hint: "Optional comma-separated permission keys." },
        { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ]}
      columns={[
        { key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "role", label: "Role" },
        { key: "approvalLevel", label: "Approval level", render: (row) => ["Approver", "Management"].includes(row.role) ? row.approvalLevel : "-" },
        { key: "area", label: "Area" }, { key: "costCenter", label: "Default Cost Center", render: (row) => row.costCenter ? `${row.costCenter.code} - ${row.costCenter.name}` : "-" },
        { key: "active", label: "Status" }
      ]}
      transformSubmit={(form) => {
        const payload = {
          ...form,
          approvalAreas: String(form.approvalAreas || "").split(",").map((item) => item.trim()).filter(Boolean),
          permissions: String(form.permissions || "").split(",").map((item) => item.trim()).filter(Boolean)
        };
        if (!payload.password) delete payload.password;
        if (!payload.costCenter) delete payload.costCenter;
        return payload;
      }}
    />
  </>;
}
