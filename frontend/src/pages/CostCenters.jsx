import ResourceManager from "../components/ResourceManager.jsx";

const numberPayload = (form) => ({
  ...form,
  annualBudget: Number(form.annualBudget || 0)
});

export default function CostCenters() {
  return (
    <ResourceManager
      title="Cost Centers"
      description="Configure transitional tracking or active budget enforcement by cost center. Active mode reserves funds before Accounting."
      endpoint="/cost-centers"
      duplicateFields={["code"]}
      transformSubmit={numberPayload}
      fields={[
        { name: "code", label: "Code", required: true },
        { name: "name", label: "Name", required: true },
        { name: "area", label: "Area", required: true },
        { name: "annualBudget", label: "Annual assigned budget", type: "number", step: "0.01", defaultValue: 0 },
        { name: "budgetMode", label: "Budget mode", type: "select", defaultValue: "TRANSITIONAL", options: ["TRANSITIONAL", "ACTIVE"] },
        { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ]}
      columns={[
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
        { key: "area", label: "Area" },
        { key: "annualBudget", label: "Budget", render: (row) => Number(row.annualBudget || 0).toFixed(2) },
        { key: "committedAmount", label: "Committed", render: (row) => Number(row.committedAmount || 0).toFixed(2) },
        { key: "executedAmount", label: "Executed", render: (row) => Number(row.executedAmount || 0).toFixed(2) },
        { key: "paidAmount", label: "Paid", render: (row) => Number(row.paidAmount || 0).toFixed(2) },
        { key: "availableAmount", label: "Available", render: (row) => Number(row.availableAmount || 0).toFixed(2) },
        { key: "budgetMode", label: "Mode" },
        { key: "active", label: "Active", render: (row) => (row.active ? "Yes" : "No") }
      ]}
    />
  );
}
