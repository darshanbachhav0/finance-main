import PadronStatus from "../components/PadronStatus.jsx";
import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, useParams } from "react-router-dom";
import api from "../api/client.js";
import Message from "../components/Message.jsx";
import ResourceManager from "../components/ResourceManager.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { approvalLevels, banks, currencies, expenseNatureLabels, expenseNatures, flowTypeLabels, flowTypes, requestTypeLabels, requestTypes, roles } from "../utils/options.js";
import { formatCurrency } from "../utils/formatters.js";

function BankFormatCertificationPanel({ rows, reload }) {
  const { t } = useLanguage();
  const { notify } = useToast();
  const [busyId, setBusyId] = useState(null);
  const [reference, setReference] = useState({});

  async function certify(row, certified) {
    setBusyId(row._id);
    try {
      await api.post(`/bank-formats/${row._id}/certify`, { certified, certificationReference: reference[row._id] || "" });
      notify(certified ? "BBVA format certified." : "BBVA format certification removed.");
      reload();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusyId(null);
    }
  }

  if (!rows.length) return null;
  return (
    <details className="workspace-panel" open>
      <summary>{t("BBVA certification")}</summary>
      <p>{t("Certification is a separate, audited action from editing the format. Mark a format certified only after Treasury/BBVA formally accepts the generated PEN/USD test files. Files already generated keep the certification state that applied when they were created.")}</p>
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("Currency")}</th>
            <th>{t("Certified")}</th>
            <th>{t("Certified by")}</th>
            <th>{t("Certified at")}</th>
            <th>{t("Reference / comment")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row._id}>
              <td>{row.currency}</td>
              <td>{row.certified ? t("Yes") : t("No")}</td>
              <td>{row.certifiedBy?.name || "-"}</td>
              <td>{row.certifiedAt ? new Date(row.certifiedAt).toLocaleString() : "-"}</td>
              <td>
                <input
                  type="text"
                  placeholder={t("Required to certify")}
                  value={reference[row._id] || ""}
                  onChange={(event) => setReference({ ...reference, [row._id]: event.target.value })}
                />
              </td>
              <td>
                {row.certified ? (
                  <button type="button" className="secondary-button" disabled={busyId === row._id} onClick={() => certify(row, false)}>{t("Remove certification")}</button>
                ) : (
                  <button type="button" className="primary-button" disabled={busyId === row._id} onClick={() => certify(row, true)}>{t("Certify")}</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

const requestTypeOptions = ["*", ...requestTypes].map((value) => ({ value, label: requestTypeLabels[value] || value }));
const natureOptions = ["*", ...expenseNatures].map((value) => ({ value, label: expenseNatureLabels[value] || value }));
const flowOptions = ["*", ...flowTypes].map((value) => ({ value, label: flowTypeLabels[value] || value }));
const documentPhases = ["SUBMISSION", "PROCUREMENT", "INVOICE_REGISTRATION", "ACCOUNTING", "RENDITION"];

function parseJsonArray(value) {
  const parsed = JSON.parse(value || "[]");
  if (!Array.isArray(parsed)) throw new Error("Requirements must be a JSON array.");
  return parsed;
}

export default function MasterConfiguration() {
  const { resource = "projects" } = useParams();
  const { user } = useAuth();
  const { t, language } = useLanguage();
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
        { name: "requestType", label: "Request type", type: "select", defaultValue: "*", options: requestTypeOptions }, { name: "flowType", label: "Track", type: "select", defaultValue: "*", options: flowOptions }, { name: "sequence", label: "Sequence", type: "number", min: 1, defaultValue: 1, required: true },
        { name: "slaHours", label: "SLA hours", type: "number", min: 1, defaultValue: 24, required: true }, { name: "required", label: "Required", type: "checkbox", defaultValue: true }, { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ],
      columns: [{ key: "sequence", label: "Sequence" }, { key: "name", label: "Name" }, { key: "approvalLevel", label: "Approval level" }, { key: "role", label: "Role" }, { key: "area", label: "Area" }, { key: "flowType", label: "Track" }, { key: "requestType", label: "Request type" }, { key: "slaHours", label: "SLA hours" }, { key: "active", label: "Status" }]
    },
    "budget-rules": {
      label: "Budget Rules", roles: ["Admin", "Budget"], endpoint: "/budget-rules",
      description: "Select active or transitional control, the insufficient-budget exception strategy, and who may authorize an extraordinary exception, by dimension.",
      fields: [
        { name: "name", label: "Name", required: true }, { name: "mode", label: "Mode", type: "select", options: ["TRANSITIONAL", "ACTIVE"], defaultValue: "TRANSITIONAL" },
        { name: "exceptionStrategy", label: "Exception strategy", type: "select", options: ["REJECT", "REQUEST_BUDGET_INCREASE", "EXTRAORDINARY_APPROVAL"], defaultValue: "REJECT" },
        { name: "costCenter", label: "Cost center", type: "select", options: masters.costCenters.map((item) => ({ value: item._id, label: `${item.code} - ${item.name}` })) },
        { name: "expenseType", label: "Expense type", type: "select", options: masters.expenseTypes.map((item) => ({ value: item._id, label: `${item.accountNumber} - ${item.name}` })) },
        { name: "project", label: "Project", defaultValue: "*" },
        { name: "exceptionApproverRole", label: "Exception approver role", type: "select", defaultValue: "Management", options: roles, hint: "Who may APPROVE/REJECT an extraordinary exception for this dimension. Defaults to Management." },
        { name: "exceptionEscalationAmount", label: "Escalate above amount (PEN)", type: "number", min: 0, step: "0.01", hint: "Optional. Above this requested amount, a different (higher) authority is required instead." },
        { name: "exceptionEscalationApproverRole", label: "Escalated approver role", type: "select", options: roles, hint: "Required only when an escalation amount is set." },
        { name: "effectiveFrom", label: "Effective from", type: "date" }, { name: "effectiveTo", label: "Effective to", type: "date" }, { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ],
      columns: [{ key: "name", label: "Name" }, { key: "mode", label: "Mode" }, { key: "exceptionStrategy", label: "Exception strategy" }, { key: "exceptionApproverRole", label: "Exception approver", render: (row) => t(row.exceptionApproverRole || "Management") }, { key: "costCenter", label: "Cost center", render: (row) => row.costCenter?.code || "All" }, { key: "expenseType", label: "Expense type", render: (row) => row.expenseType?.accountNumber || "All" }, { key: "active", label: "Status" }]
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
      columns: [{ key: "period", label: "Period" }, { key: "costCenter", label: "Cost center", render: (row) => row.costCenter ? `${row.costCenter.code} - ${row.costCenter.name}` : "-" }, { key: "expenseType", label: "Expense type", render: (row) => row.expenseType?.accountNumber || "All" }, { key: "project", label: "Project", render: (row) => row.project || "All" }, { key: "assignedAmount", label: "Assigned", render: (row) => formatCurrency(row.assignedAmount || 0, "PEN", language) }, { key: "active", label: "Status" }]
    },
    "document-rules": {
      label: "Document Rules", roles: ["Admin", "Accounting"], endpoint: "/document-rules",
      description: "Configure evidence by track, workflow phase, request type and expense nature. Requirements use kind, minCount, and labelKey.",
      fields: [
        { name: "code", label: "Code", required: true }, { name: "flowType", label: "Track", type: "select", defaultValue: "*", options: flowOptions },
        { name: "phase", label: "Document phase", type: "select", defaultValue: "SUBMISSION", options: documentPhases }, { name: "requestType", label: "Request type", type: "select", defaultValue: "*", options: requestTypeOptions },
        { name: "expenseNature", label: "Expense nature", type: "select", defaultValue: "*", options: natureOptions },
        { name: "requirements", label: "Requirements JSON", type: "textarea", rows: 7, required: true, defaultValue: "[]", getValue: (row) => JSON.stringify(row.requirements || [], null, 2), validate: (value) => { try { parseJsonArray(value); return ""; } catch (error) { return error.message; } } },
        { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ],
      transformSubmit: (form) => ({ ...form, requirements: parseJsonArray(form.requirements) }),
      columns: [{ key: "code", label: "Code" }, { key: "flowType", label: "Track" }, { key: "phase", label: "Phase" }, { key: "requestType", label: "Request type" }, { key: "expenseNature", label: "Expense nature" }, { key: "requirements", label: "Requirements", getValue: (row) => row.requirements?.map((item) => item.kind).join(" "), render: (row) => row.requirements?.map((item) => `${item.kind} x${item.minCount}`).join(", ") || "-" }, { key: "active", label: "Status" }]
    },
    "accounting-mappings": {
      label: "Accounting Mappings", roles: ["Admin", "Accounting"], endpoint: "/accounting-mappings",
      description: "Configure expense, asset, non-deductible, CXP, bank, IGV, advance, and return accounts used by posting services.",
      fields: [
        { name: "code", label: "Code", required: true }, { name: "name", label: "Name", required: true },
        { name: "purpose", label: "Purpose", type: "select", required: true, options: ["ACCOUNTS_PAYABLE", "BANK", "ADVANCE_TRANSIT", "IGV", "RETURN_RECEIVABLE"] },
        { name: "requestType", label: "Request type", type: "select", defaultValue: "*", options: requestTypeOptions }, { name: "expenseNature", label: "Expense nature", type: "select", defaultValue: "*", options: natureOptions },
        { name: "bank", label: "Bank", type: "select", defaultValue: "*", options: ["*", ...banks] }, { name: "currency", label: "Currency", type: "select", defaultValue: "*", options: ["*", ...currencies] },
        { name: "accountNumber", label: "Account number", required: true }, { name: "subAccount", label: "Subaccount" }, { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ],
      columns: [{ key: "code", label: "Code" }, { key: "purpose", label: "Purpose" }, { key: "name", label: "Name" }, { key: "accountNumber", label: "Account" }, { key: "requestType", label: "Request type" }, { key: "bank", label: "Bank" }, { key: "currency", label: "Currency" }, { key: "active", label: "Status" }]
    },
    "bank-formats": {
      label: "Bank Formats", roles: ["Admin"], endpoint: "/bank-formats",
      description: "Configure BBVA PEN and USD formats using Treasury-confirmed field values. Existing bank files retain their original format. Certification is managed separately below.",
      transformSubmit: (form) => ({ ...form, bbva: form.bbva ? JSON.parse(form.bbva) : undefined }),
      fields: [
        { name: "bank", label: "Bank", type: "select", required: true, options: ["BBVA"] }, { name: "currency", label: "Currency", type: "select", required: true, options: currencies },
        { name: "mode", label: "Mode", type: "select", options: ["FIXED_WIDTH"], defaultValue: "FIXED_WIDTH" }, { name: "specificationVersion", label: "Specification version", required: true, defaultValue: "UMA-BBVA-151-277-v1" },
        { name: "bbva", label: "BBVA confirmed configuration (JSON)", type: "textarea", rows: 14, getValue: (row) => JSON.stringify(row.bbva || {}, null, 2), hint: "Use the documented field configuration. Set confirmed only after Treasury reviews every field." },
        { name: "notes", label: "Notes", type: "textarea", defaultValue: "" }, { name: "active", label: "Active", type: "checkbox", defaultValue: false }
      ],
      columns: [{ key: "bank", label: "Bank" }, { key: "currency", label: "Currency" }, { key: "mode", label: "Mode" }, { key: "specificationVersion", label: "Specification version" }, { key: "certified", label: "Certified", render: (row) => row.certified ? t("Yes") : t("No") }, { key: "notes", label: "Notes" }, { key: "active", label: "Status" }],
      renderBeforeTable: ({ rows, reload }) => <BankFormatCertificationPanel rows={rows} reload={reload} />
    }
  }), [masters, t, language]);

  const visibleEntries = Object.entries(configs).filter(([, config]) => config.roles.includes(user.role));
  if (!configs[resource] || !configs[resource].roles.includes(user.role)) return <Navigate to={`/configuration/${visibleEntries[0]?.[0] || "projects"}`} replace />;
  const config = configs[resource];

  return <section>
    {user.role === "Admin" && <details className="workspace-tools"><summary>{t("SUNAT administration")}</summary><PadronStatus /></details>}
    <Message type="error">{error}</Message>
    <details className="workspace-tools"><summary>{t("Configuration sections")}</summary><nav className="section-tabs" aria-label={t("Configuration sections")}>{visibleEntries.map(([key, item]) => <NavLink key={key} to={`/configuration/${key}`}>{t(item.label)}</NavLink>)}</nav></details>
    <ResourceManager key={resource} title={config.label} description={config.description} endpoint={config.endpoint} fields={config.fields} columns={config.columns} transformSubmit={config.transformSubmit} deleteMode="deactivate" />
  </section>;
}
