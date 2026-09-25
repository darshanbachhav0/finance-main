import ResourceManager from "../components/ResourceManager.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency } from "../utils/formatters.js";

const numberPayload = (form) => ({
  ...form,
  annualBudget: Number(form.annualBudget || 0)
});

export default function CostCenters() {
  const { language } = useLanguage();
  return (
    <ResourceManager
      title="Cost Centers"
      description="UMA Cost Centers with their area, organizational hierarchy, import source, and budget controls."
      endpoint="/cost-centers"
      duplicateFields={["code"]}
      transformSubmit={numberPayload}
      fields={[
        { type: "section", label: "Identity" },
        { name: "code", label: "Code", required: true },
        { name: "name", label: "Name", required: true },
        { name: "area", label: "Area", required: true, wide: true },
        { name: "organizationalUnit", label: "Organizational unit" },
        { name: "organizationalUnitCode", label: "Organizational unit code" },
        { type: "section", label: "Budget" },
        { name: "annualBudget", label: "Annual assigned budget", type: "number", step: "0.01", defaultValue: 0 },
        { name: "budgetMode", label: "Budget mode", type: "select", defaultValue: "TRANSITIONAL", options: ["TRANSITIONAL", "ACTIVE"] },
        { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ]}
      columns={[
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
        { key: "area", label: "Area" },
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
