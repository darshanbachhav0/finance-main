import { AlertTriangle, CheckCircle2, RefreshCw, RotateCw, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import usePaginatedResource from "../hooks/usePaginatedResource.js";

const money = (value) => `PEN ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function BudgetControl() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { notify } = useToast();
  const initialPeriod = new Date().toISOString().slice(0, 7);
  const [periodInput, setPeriodInput] = useState(initialPeriod);
  const [period, setPeriod] = useState(initialPeriod);
  const [data, setData] = useState({ totals: {}, warnings: [] });
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState("");
  const canDecide = ["Admin", "Budget"].includes(user.role);
  const allocationTable = usePaginatedResource("/budget/allocations", { fixedParams: { period } });
  const exceptionTable = usePaginatedResource("/budget/exceptions", { fixedParams: { period } });
  const commitmentTable = usePaginatedResource("/budget/commitments", { fixedParams: { period } });

  async function load() {
    setLoading(true);
    try {
      const response = await api.get("/budget/overview", { params: period ? { period, summaryOnly: true } : { summaryOnly: true } });
      setData(response.data.data);
      setError("");
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [period]);

  function applyPeriod() {
    if (periodInput !== period) {
      setPeriod(periodInput);
      return;
    }
    load();
    allocationTable.reload();
    exceptionTable.reload();
    commitmentTable.reload();
  }

  async function decide(comments) {
    setProcessing(true);
    try {
      if (confirm.kind === "decision") {
        await api.post(`/budget/exceptions/${confirm.row._id}/decision`, { status: confirm.status, comments });
        notify(confirm.status === "APPROVED" ? "Budget exception approved." : "Budget exception rejected.");
      } else {
        await api.post(`/budget/requests/${confirm.row.request._id}/commit`);
        notify("Budget commitment completed and sent to Accounting.");
      }
      setConfirm(null);
      await load();
      allocationTable.reload();
      exceptionTable.reload();
      commitmentTable.reload();
    } catch (err) { setError(err.message); notify(err.message, "error"); setConfirm(null); } finally { setProcessing(false); }
  }

  function exceptionActions(row) {
    if (!canDecide) return [];
    if (row.status === "PENDING") return [
      { label: "Approve exception", icon: CheckCircle2, onClick: () => setConfirm({ kind: "decision", row, status: "APPROVED", title: "Approve budget exception?", description: "This records an audited exception decision. A budget-increase strategy still requires sufficient allocation before commitment.", confirmLabel: "Approve exception", inputLabel: "Decision comments", inputRequired: true }) },
      { label: "Reject exception", icon: XCircle, tone: "danger", onClick: () => setConfirm({ kind: "decision", row, status: "REJECTED", title: "Reject budget exception?", description: "The request will remain blocked from budget commitment.", confirmLabel: "Reject exception", inputLabel: "Decision comments", inputRequired: true, tone: "danger" }) }
    ];
    if (row.status === "APPROVED") return [{ label: "Retry budget commitment", icon: RotateCw, onClick: () => setConfirm({ kind: "commit", row, title: "Retry budget commitment?", description: "The backend will re-check current dimensional availability and the approved exception strategy.", confirmLabel: "Commit budget" }) }];
    return [];
  }

  return <section>
    <PageHeader title="Budget Control" description="Monitor and control assigned, committed, executed, paid, and available budget using the same dimensional ledger as workflow transactions." actions={<Link className="secondary-button" to="/configuration/budget-allocations">{t("Manage allocations")}</Link>} />
    <Message type="error">{error || allocationTable.error || exceptionTable.error || commitmentTable.error}</Message>
    <div className="period-toolbar"><label className="field compact-period"><span>{t("Commitment period")}</span><input type="month" value={periodInput} onChange={(event) => setPeriodInput(event.target.value)} /></label><button type="button" className="secondary-button" onClick={applyPeriod} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Apply")}</span></button></div>
    <div className="stats-grid budget-stats"><StatCard label="Assigned budget" value={money(data.totals.assigned)} tone="navy" /><StatCard label="Committed budget" value={money(data.totals.committed)} tone="amber" /><StatCard label="Executed budget" value={money(data.totals.executed)} tone="teal" /><StatCard label="Paid budget" value={money(data.totals.paid)} tone="green" /><StatCard label="Available balance" value={money(data.totals.available)} tone="neutral" /></div>
    {data.warnings?.length > 0 && <div className="alert-strip warning"><AlertTriangle size={20} /><div><strong>{t("Budget attention required")}</strong><p>{t("One or more dimensions have low availability or over-execution.")}</p></div></div>}

    <div className="workspace-panel"><div className="section-heading"><div><h3>{t("Dimensional budget")}</h3><p>{t("Period, Cost Center, expense classification, and project remain visible together.")}</p></div><span className="section-count">{allocationTable.pagination.total}</span></div><DataTable rows={allocationTable.rows} loading={allocationTable.loading} remote={allocationTable.remote} filters={[{ key: "source", label: "sources", allLabel: "All sources", options: ["DIMENSIONAL_ALLOCATION", "TRANSITIONAL_COST_CENTER"] }]} searchPlaceholder="Search Cost Center, account, project, or period..." columns={[
      { key: "period", label: "Period", render: (row) => row.period || period },
      { key: "costCenter", label: "Cost center", sortable: false, getValue: (row) => `${row.costCenter?.code || ""} ${row.costCenter?.name || ""}`, render: (row) => <div className="primary-cell"><strong>{row.costCenter?.code || "-"}</strong><span>{row.costCenter?.name}</span></div> },
      { key: "expenseType", label: "Expense type", sortable: false, getValue: (row) => row.expenseType?.accountNumber, render: (row) => row.expenseType ? `${row.expenseType.accountNumber} - ${row.expenseType.name}` : t("All") },
      { key: "project", label: "Project", render: (row) => row.project || t("All") }, { key: "assignedAmount", label: "Assigned", align: "right", render: (row) => money(row.assignedAmount) },
      { key: "committedAmount", label: "Committed", align: "right", render: (row) => money(row.committedAmount) }, { key: "executedAmount", label: "Executed", align: "right", render: (row) => money(row.executedAmount) },
      { key: "paidAmount", label: "Paid", align: "right", render: (row) => money(row.paidAmount) }, { key: "availableAmount", label: "Available", sortable: false, align: "right", render: (row) => <strong className={row.availableAmount < 0 ? "text-danger" : ""}>{money(row.availableAmount)}</strong> }
    ]} /></div>

    <div className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Budget exceptions")}</h3><p>{t("Insufficient-budget branches require an explicit decision and remain auditable.")}</p></div><span className="section-count">{exceptionTable.pagination.total}</span></div><DataTable rows={exceptionTable.rows} loading={exceptionTable.loading} remote={exceptionTable.remote} filters={[{ key: "status", label: "statuses", allLabel: "All statuses", options: ["PENDING", "APPROVED", "REJECTED"] }]} rowActions={exceptionActions} columns={[
      { key: "request", label: "Request", sortable: false, getValue: (row) => row.request?.requestNumber, render: (row) => row.request ? <Link to={`/requests/${row.request._id}`}>{row.request.requestNumber}</Link> : "-" },
      { key: "strategy", label: "Strategy" }, { key: "costCenter", label: "Cost center", sortable: false, render: (row) => row.costCenter?.code || "-" }, { key: "expenseType", label: "Expense type", sortable: false, render: (row) => row.expenseType?.accountNumber || "-" },
      { key: "availableAmount", label: "Available", align: "right", render: (row) => money(row.availableAmount) }, { key: "requestedAmount", label: "Requested", align: "right", render: (row) => <strong>{money(row.requestedAmount)}</strong> }, { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> }
    ]} /></div>

    <div className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Budget commitments")}</h3><p>{t("Reservation, execution, payment, and release are independent and traceable.")}</p></div><span className="section-count">{commitmentTable.pagination.total}</span></div><DataTable rows={commitmentTable.rows} loading={commitmentTable.loading} remote={commitmentTable.remote} filters={[{ key: "status", label: "statuses", allLabel: "All statuses", options: ["NO_BUDGET", "AVAILABLE", "COMMITTED", "EXECUTED", "RELEASED", "CLOSED"] }]} searchPlaceholder="Search request or period..." columns={[
      { key: "requestNumber", label: "Request", render: (row) => row.request?._id ? <Link to={`/requests/${row.request._id}`}>{row.requestNumber}</Link> : row.requestNumber }, { key: "period", label: "Period" },
      { key: "request", label: "Type", sortable: false, getValue: (row) => row.request?.requestType, render: (row) => row.request?.requestType || "-" }, { key: "requestArea", label: "Area", sortable: false, getValue: (row) => row.request?.requesterArea, render: (row) => row.request?.requesterArea || row.request?.requestingArea || "-" },
      { key: "lines", label: "Dimensions", sortable: false, getValue: (row) => row.lines?.map((line) => `${line.costCenter?.code} ${line.expenseType?.accountNumber}`).join(" "), render: (row) => row.lines?.map((line) => `${line.costCenter?.code || "-"} / ${line.expenseType?.accountNumber || "-"}`).join(", ") },
      { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> }, { key: "totalAmount", label: "Committed amount", align: "right", render: (row) => <strong>{money(row.totalAmount)}</strong> }, { key: "createdAt", label: "Created", render: (row) => new Date(row.createdAt).toLocaleString() }
    ]} /></div>
    <ConfirmDialog open={Boolean(confirm)} {...confirm} details={confirm ? [{ label: "Request", value: confirm.row.request?.requestNumber }, { label: "Strategy", value: confirm.row.strategy }, { label: "Result", value: confirm.kind === "commit" ? "The request advances only if the backend budget check passes." : `Exception status changes to ${confirm.status}.` }] : []} loading={processing} onClose={() => !processing && setConfirm(null)} onConfirm={decide} />
  </section>;
}
