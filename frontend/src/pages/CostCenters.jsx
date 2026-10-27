import { useEffect, useState } from "react";
import api from "../api/client.js";
import ResourceManager from "../components/ResourceManager.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency } from "../utils/formatters.js";

const numberPayload = (form) => ({
  ...form,
  annualBudget: Number(form.annualBudget || 0),
  level: form.level ? Number(form.level) : undefined,
  parentCode: form.parentCode || null,
  line: form.line || undefined,
  responsible: form.responsible || null
});

const LEVELS = [
  { value: "2", label: "2 · School" }, { value: "3", label: "3 · Faculty" }, { value: "4", label: "4 · Vice-rectorate" },
  { value: "5", label: "5 · Cross-cutting academic" }, { value: "6", label: "6 · Administration / Marketing" }, { value: "7", label: "7 · Governance" }
];
const LINES = [
  { value: "COST_OF_SERVICE", label: "Cost of service" }, { value: "ADMINISTRATION", label: "Administrative expenses" }, { value: "SALES", label: "Sales expenses" }
];

// Everyone active, to choose a cost center's responsible.
function usePeople() {
  const [people, setPeople] = useState([]);
  useEffect(() => {
    let mounted = true;
    (async () => {
      const users = [];
      for (let page = 1; ; page++) {
        const response = await api.get("/users", { params: { page, pageSize: 100, active: true } });
        const rows = response.data.data || [];
        users.push(...rows);
        if (rows.length < 100) break;
      }
      if (mounted) setPeople(users);
    })().catch(() => undefined);
    return () => { mounted = false; };
  }, []);
  return people;
}

export default function CostCenters() {
  const { language } = useLanguage();
  const people = usePeople();
  const personOptions = people.map((user) => ({ value: user._id, label: `${user.name}${user.jobTitle ? ` · ${user.jobTitle}` : ""}` }));
  const personName = (id) => people.find((user) => String(user._id) === String(id?._id || id || ""))?.name;
  return (
    <ResourceManager
      title="Cost Centers"
      description="UMA Cost Centers with their area, organizational hierarchy, import source, and budget controls."
      endpoint="/cost-centers"
      deleteMode="deactivate"
      duplicateFields={["code"]}
      transformSubmit={numberPayload}
      fields={[
        { type: "section", label: "Identity" },
        { name: "code", label: "Code", required: true },
        { name: "name", label: "Name", required: true },
        { name: "area", label: "Area", required: true, wide: true },
        { name: "organizationalUnit", label: "Organizational unit" },
        { name: "organizationalUnitCode", label: "Organizational unit code" },
        { type: "section", label: "Cascade and approval" },
        { name: "parentCode", label: "Parent cost center (code)", placeholder: "20009", hint: "The cost center above this one in the Motor de Ingresos cascade." },
        { name: "level", label: "Cascade level", type: "select", options: LEVELS, getValue: (row) => row.level ? String(row.level) : "" },
        { name: "line", label: "Cost or expense line", type: "select", options: LINES },
        { name: "responsible", label: "Responsible", type: "search-select", options: personOptions, searchPlaceholder: "Search by name or job title...", getValue: (row) => row.responsible?._id || row.responsible || "", wide: true, hint: "Approves every request of this cost center and gives the visto when a Por Encargo request is charged to it. The superior after them is the Vice-rectorate (level 4) above in the cascade, otherwise the parent's responsible. Without a responsible, the requester's jefe chain approves." },
        { type: "section", label: "Budget" },
        { name: "annualBudget", label: "Annual assigned budget", type: "number", step: "0.01", defaultValue: 0 },
        { name: "budgetMode", label: "Budget mode", type: "select", defaultValue: "TRANSITIONAL", options: ["TRANSITIONAL", "ACTIVE"] },
        { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ]}
      columns={[
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
        { key: "area", label: "Area" },
        { key: "parentCode", label: "Cascade", render: (row) => <div className="primary-cell"><strong>{row.level ? `L${row.level}` : "-"}</strong><span>{row.parentCode ? `↑ ${row.parentCode}` : "-"}</span></div> },
        { key: "responsible", label: "Responsible", sortable: false, render: (row) => personName(row.responsible) || "-" },
        { key: "organizationalUnit", label: "Organizational unit", render: (row) => <div className="primary-cell"><strong>{row.organizationalUnitCode || "-"}</strong><span>{row.organizationalUnit || "-"}</span></div> },
        { key: "annualBudget", label: "Budget", render: (row) => formatCurrency(row.annualBudget || 0, "PEN", language) },
        { key: "committedAmount", label: "Committed", render: (row) => formatCurrency(row.committedAmount || 0, "PEN", language) },
        { key: "executedAmount", label: "Executed", render: (row) => formatCurrency(row.executedAmount || 0, "PEN", language) },
        { key: "paidAmount", label: "Paid", render: (row) => formatCurrency(row.paidAmount || 0, "PEN", language) },
        { key: "availableAmount", label: "Available", render: (row) => formatCurrency(row.availableAmount || 0, "PEN", language) },
        { key: "importProvenance", label: "Source", sortable: false, render: (row) => <div className="primary-cell"><strong>{row.importProvenance?.source || "Manual"}</strong><span>{row.sourceRows?.length ? `${row.sourceRows.length} source row${row.sourceRows.length === 1 ? "" : "s"}` : "No imported row"}</span></div> },
        { key: "active", label: "Status", render: (row) => <StatusBadge status={row.active ? "ACTIVE" : "INACTIVE"} /> }
      ]}
    />
  );
}
