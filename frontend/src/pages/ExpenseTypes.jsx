import ResourceManager from "../components/ResourceManager.jsx";

export default function ExpenseTypes() {
  return (
    <ResourceManager
      title="Expense Types"
      description="Accounting account catalog for OPEX, CAPEX, and non-deductible request lines."
      endpoint="/expense-types"
      duplicateFields={["code", "accountNumber"]}
      fields={[
        { name: "code", label: "Code", required: true },
        { name: "name", label: "Name", required: true },
        { name: "category", label: "Category", type: "select", required: true, options: ["OPEX", "CAPEX", "NON_DEDUCTIBLE"] },
        { name: "accountingClass", label: "Accounting class", type: "select", required: true, options: ["CLASS_6", "CLASS_3", "NON_DEDUCTIBLE"] },
        { name: "accountNumber", label: "Account number", required: true },
        { name: "permittedRequestTypes", label: "Permitted request types", type: "textarea", rows: 2, getValue: (row) => (row.permittedRequestTypes || []).join(", "), hint: "Optional comma-separated canonical request types." },
        { name: "permittedExpenseNatures", label: "Permitted expense natures", type: "textarea", rows: 2, getValue: (row) => (row.permittedExpenseNatures || []).join(", "), hint: "Optional comma-separated canonical expense natures." },
        { name: "deductible", label: "Deductible", type: "checkbox", defaultValue: true },
        { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ]}
      columns={[
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
        { key: "category", label: "Category" },
        { key: "accountingClass", label: "Class" },
        { key: "accountNumber", label: "Account" },
        { key: "active", label: "Active", render: (row) => (row.active ? "Yes" : "No") }
      ]}
      transformSubmit={(form) => ({ ...form, permittedRequestTypes: String(form.permittedRequestTypes || "").split(",").map((item) => item.trim()).filter(Boolean), permittedExpenseNatures: String(form.permittedExpenseNatures || "").split(",").map((item) => item.trim()).filter(Boolean) })}
    />
  );
}
