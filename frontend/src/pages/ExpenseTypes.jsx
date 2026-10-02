import ResourceManager from "../components/ResourceManager.jsx";
import { expenseNatureLabels, expenseNatures, requestTypeLabels, requestTypes } from "../utils/options.js";

const requestTypeOptions = requestTypes.map((value) => ({ value, label: requestTypeLabels[value] || value }));
const expenseNatureOptions = expenseNatures.map((value) => ({ value, label: expenseNatureLabels[value] || value }));

// Accounting's PCGE account catalog. Requesters never see it: the platform suggests an account
// from the request type and expense nature, and Accounting confirms it when processing the
// invoice. IGV deductibility follows the document and SPOT follows the expense nature, both
// confirmed per invoice, so neither is configured here.
export default function ExpenseTypes() {
  return (
    <ResourceManager
      title="Accounting Accounts"
      description="PCGE accounts Accounting books invoices to. The platform suggests one from the request type and the nature of the expense."
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
        { type: "section", label: "When it is suggested" },
        { name: "permittedRequestTypes", label: "Permitted request types", type: "multiselect", options: requestTypeOptions, getValue: (row) => row.permittedRequestTypes || [] },
        { name: "permittedExpenseNatures", label: "Suggested for expense natures", type: "multiselect", options: expenseNatureOptions, getValue: (row) => row.permittedExpenseNatures || [] },
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
