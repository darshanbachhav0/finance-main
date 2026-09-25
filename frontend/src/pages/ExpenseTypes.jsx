import ResourceManager from "../components/ResourceManager.jsx";
import { expenseNatureLabels, expenseNatures, requestTypeLabels, requestTypes } from "../utils/options.js";

const requestTypeOptions = requestTypes.map((value) => ({ value, label: requestTypeLabels[value] || value }));
const expenseNatureOptions = expenseNatures.map((value) => ({ value, label: expenseNatureLabels[value] || value }));

export default function ExpenseTypes() {
  return (
    <ResourceManager
      title="Expense Types"
      description="Accounting account catalog for OPEX, CAPEX, and non-deductible request lines."
      endpoint="/expense-types"
      duplicateFields={["code", "accountNumber"]}
      fields={[
        { type: "section", label: "Account" },
        { name: "code", label: "Code", required: true },
        { name: "name", label: "Name", required: true },
        { name: "category", label: "Category", type: "select", required: true, options: ["OPEX", "CAPEX", "NON_DEDUCTIBLE"] },
        { name: "accountingClass", label: "Accounting class", type: "select", required: true, options: ["CLASS_6", "CLASS_3", "NON_DEDUCTIBLE"] },
        { name: "accountNumber", label: "Account number", required: true },
        { name: "deductible", label: "Deductible", type: "checkbox", defaultValue: true },
        { type: "section", label: "Where it can be used" },
        { name: "permittedRequestTypes", label: "Permitted request types", type: "multiselect", options: requestTypeOptions, getValue: (row) => row.permittedRequestTypes || [] },
        { name: "permittedExpenseNatures", label: "Permitted expense natures", type: "multiselect", options: expenseNatureOptions, getValue: (row) => row.permittedExpenseNatures || [] },
        { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ]}
      columns={[
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
        { key: "category", label: "Category" },
        { key: "accountingClass", label: "Class" },
        { key: "accountNumber", label: "Account" },
        { key: "active", label: "Status" }
      ]}
    />
  );
}
