import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, useParams } from "react-router-dom";
import api from "../api/client.js";
import Message from "../components/Message.jsx";
import ResourceManager from "../components/ResourceManager.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { approvalLevels, banks, currencies, expenseNatureLabels, expenseNatures, requestTypeLabels, requestTypes, roles } from "../utils/options.js";

const requestTypeOptions = ["*", ...requestTypes].map((value) => ({ value, label: requestTypeLabels[value] || value }));
const natureOptions = ["*", ...expenseNatures].map((value) => ({ value, label: expenseNatureLabels[value] || value }));

function parseJsonArray(value) {
  const parsed = JSON.parse(value || "[]");
  if (!Array.isArray(parsed)) throw new Error("Requirements must be a JSON array.");
  return parsed;
}

export default function MasterConfiguration() {
  const { resource = "projects" } = useParams();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [masters, setMasters] = useState({ costCenters: [], expenseTypes: [] });
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api.get("/cost-centers", { params: { pageSize: 100 } }),
      api.get("/expense-types", { params: { pageSize: 100 } })
    ]).then(([centers, expenses]) => setMasters({ costCenters: centers.data.data, expenseTypes: expenses.data.data })).catch((err) => setError(err.message));
  }, []);

  const configs = useMemo(() => ({
    projects: {
      label: "Projects", roles: ["Admin", "Accounting"], endpoint: "/projects",
      description: "Maintain active project dimensions used by requests, budgets, and management reporting.",
      fields: [
        { name: "code", label: "Code", required: true }, { name: "name", label: "Name", required: true },
        { name: "description", label: "Description", type: "textarea" },
        { name: "costCenter", label: "Cost center", type: "select", options: masters.costCenters.map((item) => ({ value: item._id, label: `${item.code} - ${item.name}` })) },
        { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ],
      columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "costCenter", label: "Cost center", render: (row) => row.costCenter ? `${row.costCenter.code} - ${row.costCenter.name}` : "-" }, { key: "active", label: "Status" }]
    },
    "approval-rules": {
      label: "Approval Rules", roles: ["Admin"], endpoint: "/approval-rules",
      description: "Configure approval sequence, role, amount range, area, and SLA without hard-coding workflow decisions in the UI.",
      fields: [
        { name: "name", label: "Name", required: true }, { name: "approvalLevel", label: "Approval level", type: "select", required: true, options: approvalLevels },
        { name: "role", label: "Role", type: "select", required: true, options: roles }, { name: "area", label: "Area", defaultValue: "*", required: true },
        { name: "amountFrom", label: "Amount from", type: "number", min: 0, step: "0.01", defaultValue: 0 }, { name: "amountTo", label: "Amount to", type: "number", min: 0, step: "0.01" },
        { name: "requestType", label: "Request type", type: "select", defaultValue: "*", options: requestTypeOptions }, { name: "sequence", label: "Sequence", type: "number", min: 1, defaultValue: 1, required: true },
        { name: "slaHours", label: "SLA hours", type: "number", min: 1, defaultValue: 24, required: true }, { name: "required", label: "Required", type: "checkbox", defaultValue: true }, { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ],
      columns: [{ key: "sequence", label: "Sequence" }, { key: "name", label: "Name" }, { key: "approvalLevel", label: "Approval level" }, { key: "role", label: "Role" }, { key: "area", label: "Area" }, { key: "requestType", label: "Request type" }, { key: "slaHours", label: "SLA hours" }, { key: "active", label: "Status" }]
    },
    "budget-rules": {
      label: "Budget Rules", roles: ["Admin", "Budget"], endpoint: "/budget-rules",
      description: "Select active or transitional control and the explicit insufficient-budget exception strategy by dimension.",
      fields: [
        { name: "name", label: "Name", required: true }, { name: "mode", label: "Mode", type: "select", options: ["TRANSITIONAL", "ACTIVE"], defaultValue: "TRANSITIONAL" },
        { name: "exceptionStrategy", label: "Exception strategy", type: "select", options: ["REJECT", "REQUEST_BUDGET_INCREASE", "EXTRAORDINARY_APPROVAL"], defaultValue: "REJECT" },
        { name: "costCenter", label: "Cost center", type: "select", options: masters.costCenters.map((item) => ({ value: item._id, label: `${item.code} - ${item.name}` })) },
        { name: "expenseType", label: "Expense type", type: "select", options: masters.expenseTypes.map((item) => ({ value: item._id, label: `${item.accountNumber} - ${item.name}` })) },
        { name: "project", label: "Project", defaultValue: "*" }, { name: "effectiveFrom", label: "Effective from", type: "date" }, { name: "effectiveTo", label: "Effective to", type: "date" }, { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ],
      columns: [{ key: "name", label: "Name" }, { key: "mode", label: "Mode" }, { key: "exceptionStrategy", label: "Exception strategy" }, { key: "costCenter", label: "Cost center", render: (row) => row.costCenter?.code || "All" }, { key: "expenseType", label: "Expense type", render: (row) => row.expenseType?.accountNumber || "All" }, { key: "active", label: "Status" }]
    },
    "budget-allocations": {
      label: "Budget Allocations", roles: ["Admin", "Budget"], endpoint: "/budget-allocations",
      description: "Maintain assigned budget by period, Cost Center, expense classification, and project.",
      fields: [
        { name: "period", label: "Period / year", required: true, placeholder: "YYYY or YYYY-MM" },
        { name: "costCenter", label: "Cost center", type: "select", required: true, options: masters.costCenters.map((item) => ({ value: item._id, label: `${item.code} - ${item.name}` })) },
        { name: "expenseType", label: "Expense type", type: "select", options: masters.expenseTypes.map((item) => ({ value: item._id, label: `${item.accountNumber} - ${item.name}` })) },
        { name: "project", label: "Project" }, { name: "assignedAmount", label: "Assigned amount", type: "number", min: 0, step: "0.01", required: true }, { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ],
      columns: [{ key: "period", label: "Period" }, { key: "costCenter", label: "Cost center", render: (row) => row.costCenter ? `${row.costCenter.code} - ${row.costCenter.name}` : "-" }, { key: "expenseType", label: "Expense type", render: (row) => row.expenseType?.accountNumber || "All" }, { key: "project", label: "Project", render: (row) => row.project || "All" }, { key: "assignedAmount", label: "Assigned", render: (row) => `PEN ${Number(row.assignedAmount || 0).toFixed(2)}` }, { key: "active", label: "Status" }]
    },
    "document-rules": {
      label: "Document Rules", roles: ["Admin", "Accounting"], endpoint: "/document-rules",
      description: "Configure the evidence required by request type and expense nature. Requirements use kind, minCount, and labelKey.",
      fields: [
        { name: "code", label: "Code", required: true }, { name: "requestType", label: "Request type", type: "select", defaultValue: "*", options: requestTypeOptions },
        { name: "expenseNature", label: "Expense nature", type: "select", defaultValue: "*", options: natureOptions },
        { name: "requirements", label: "Requirements JSON", type: "textarea", rows: 7, required: true, defaultValue: "[]", getValue: (row) => JSON.stringify(row.requirements || [], null, 2), validate: (value) => { try { parseJsonArray(value); return ""; } catch (error) { return error.message; } } },
        { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ],
      transformSubmit: (form) => ({ ...form, requirements: parseJsonArray(form.requirements) }),
      columns: [{ key: "code", label: "Code" }, { key: "requestType", label: "Request type" }, { key: "expenseNature", label: "Expense nature" }, { key: "requirements", label: "Requirements", getValue: (row) => row.requirements?.map((item) => item.kind).join(" "), render: (row) => row.requirements?.map((item) => `${item.kind} x${item.minCount}`).join(", ") || "-" }, { key: "active", label: "Status" }]
    },
    "accounting-mappings": {
      label: "Accounting Mappings", roles: ["Admin", "Accounting"], endpoint: "/accounting-mappings",
      description: "Configure expense, asset, non-deductible, CXP, bank, IGV, advance, and return accounts used by posting services.",
      fields: [
        { name: "code", label: "Code", required: true }, { name: "name", label: "Name", required: true },
        { name: "purpose", label: "Purpose", type: "select", required: true, options: ["EXPENSE", "ASSET", "NON_DEDUCTIBLE", "ACCOUNTS_PAYABLE", "BANK", "ADVANCE_TRANSIT", "IGV", "RETURN_RECEIVABLE"] },
        { name: "requestType", label: "Request type", type: "select", defaultValue: "*", options: requestTypeOptions }, { name: "expenseNature", label: "Expense nature", type: "select", defaultValue: "*", options: natureOptions },
        { name: "bank", label: "Bank", type: "select", defaultValue: "*", options: ["*", ...banks] }, { name: "currency", label: "Currency", type: "select", defaultValue: "*", options: ["*", ...currencies] },
        { name: "accountNumber", label: "Account number", required: true }, { name: "subAccount", label: "Subaccount" }, { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ],
      columns: [{ key: "code", label: "Code" }, { key: "purpose", label: "Purpose" }, { key: "name", label: "Name" }, { key: "accountNumber", label: "Account" }, { key: "requestType", label: "Request type" }, { key: "bank", label: "Bank" }, { key: "currency", label: "Currency" }, { key: "active", label: "Status" }]
    },
    "bank-formats": {
      label: "Bank Formats", roles: ["Admin"], endpoint: "/bank-formats",
      description: "Record bank-adapter mode and specification version. Demo formats remain clearly marked as not certified.",
      fields: [
        { name: "bank", label: "Bank", type: "select", required: true, options: banks }, { name: "currency", label: "Currency", type: "select", required: true, options: currencies },
        { name: "mode", label: "Mode", type: "select", options: ["DEMO", "CERTIFIED"], defaultValue: "DEMO" }, { name: "specificationVersion", label: "Specification version", required: true, defaultValue: "UMA-DEMO-1" },
        { name: "certified", label: "Certified", type: "checkbox", defaultValue: false }, { name: "notes", label: "Notes", type: "textarea", defaultValue: "DEMO / NOT CERTIFIED" }, { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ],
      columns: [{ key: "bank", label: "Bank" }, { key: "currency", label: "Currency" }, { key: "mode", label: "Mode" }, { key: "specificationVersion", label: "Specification version" }, { key: "certified", label: "Certified", render: (row) => row.certified ? t("Yes") : t("No") }, { key: "notes", label: "Notes" }, { key: "active", label: "Status" }]
    }
  }), [masters, t]);

  const visibleEntries = Object.entries(configs).filter(([, config]) => config.roles.includes(user.role));
  if (!configs[resource] || !configs[resource].roles.includes(user.role)) return <Navigate to={`/configuration/${visibleEntries[0]?.[0] || "projects"}`} replace />;
  const config = configs[resource];

  return <section>
    <Message type="error">{error}</Message>
    <nav className="section-tabs" aria-label={t("Configuration sections")}>{visibleEntries.map(([key, item]) => <NavLink key={key} to={`/configuration/${key}`}>{t(item.label)}</NavLink>)}</nav>
    <ResourceManager key={resource} title={config.label} description={config.description} endpoint={config.endpoint} fields={config.fields} columns={config.columns} transformSubmit={config.transformSubmit} deleteMode="deactivate" />
  </section>;
}
