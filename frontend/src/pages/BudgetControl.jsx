import WorkspaceTools from "../components/WorkspaceTools.jsx";
import { useDraftResume } from "../hooks/useWorkDraft.js";
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
import BudgetPlanWorkspace from "../components/BudgetPlanWorkspace.jsx";
import BudgetLimitSummary from "../components/BudgetLimitSummary.jsx";
import { BUDGET_PLANNING_MODES, BUDGET_MONTHS, validBudgetPeriod, validBudgetYear } from "../../../shared/budgetPlanning.mjs";
import { formatCurrency } from "../utils/formatters.js";

export default function BudgetControl() {
  const [focusView, setFocusView] = useState("Budget");
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const money = (value) => value === null || value === undefined ? "—" : formatCurrency(value, "PEN", language);
  const { notify } = useToast();
  const initialPeriod = new Date().toISOString().slice(0, 4);
  const [view, setView] = useState("ANNUAL");
  const [workspace, setWorkspace] = useState(null);
  const [periodInput, setPeriodInput] = useState(initialPeriod);
  const [period, setPeriod] = useState(initialPeriod);
  const [data, setData] = useState({ totals: {}, warnings: [] });
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState("");
  const canDecide = ["Admin", "Budget"].includes(user.role);
  useDraftResume("budget-plan", () => { if (canDecide) setWorkspace({ planId: null }); });
  useDraftResume("budget-adjustment", id => { if (canDecide) setWorkspace({ planId: id }); });
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
    if (!(view === "ANNUAL" ? validBudgetYear(periodInput) : validBudgetPeriod(periodInput))) { setError(t("Select a valid budget year or month.")); return; }
    if (periodInput !== period) {
      setPeriod(periodInput);
      return;
    }
    load();
    allocationTable.reload();
    exceptionTable.reload();
    commitmentTable.reload();
  }

  function changeView(nextView) {
    setView(nextView);
    const year = validBudgetYear(periodInput.slice(0, 4)) ? periodInput.slice(0, 4) : initialPeriod;
    const nextPeriod = nextView === "ANNUAL" ? year : year + "-" + new Date().toISOString().slice(5, 7);
    setPeriodInput(nextPeriod); setPeriod(nextPeriod);
  }

  function planSaved(plan) {
    setWorkspace({ planId: plan._id });
    if (plan.period !== period.slice(0, 4)) { setView("ANNUAL"); setPeriod(plan.period); setPeriodInput(plan.period); }
    else { load(); allocationTable.reload(); exceptionTable.reload(); commitmentTable.reload(); }
  }

  async function decide(comments) {
    setProcessing(true);
    try {
      if (confirm.kind === "decision") {
        await api.post(`/budget/exceptions/${confirm.row._id}/decision`, { status: confirm.status, comments });
        notify(confirm.status === "REVIEWED" ? "Budget review saved for Management." : confirm.status === "APPROVED" ? "Budget exception approved." : "Budget exception rejected.");
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
    if (row.status === "PENDING" && canDecide) return [{ label: "Prepare / review", icon: CheckCircle2, onClick: () => setConfirm({ kind: "decision", row, status: "REVIEWED", title: "Review budget exception", description: "Record your recommendation for Management. This does not authorize an overrun.", confirmLabel: "Save review", inputLabel: "Recommendation", inputRequired: true }) }];
    const id = value => String(value?._id || value || "");
    const canApprove = user.role === "Management" && ![row.requestedBy, row.preparedBy, row.request?.requester, row.request?.solicitor].some(value => value && id(value) === id(user._id));
    if (row.status === "PENDING" && !canApprove) return [];
    if (row.status === "PENDING") return [
      { label: "Approve exception", icon: CheckCircle2, onClick: () => setConfirm({ kind: "decision", row, status: "APPROVED", title: "Approve budget exception?", description: "This records an audited exception decision. A budget-increase strategy still requires sufficient allocation before commitment.", confirmLabel: "Approve exception", inputLabel: "Decision comments", inputRequired: true }) },
      { label: "Reject exception", icon: XCircle, tone: "danger", onClick: () => setConfirm({ kind: "decision", row, status: "REJECTED", title: "Reject budget exception?", description: "The request will remain blocked from budget commitment.", confirmLabel: "Reject exception", inputLabel: "Decision comments", inputRequired: true, tone: "danger" }) }
    ];
    if (row.status === "APPROVED" && canDecide) return [{ label: "Retry budget commitment", icon: RotateCw, onClick: () => setConfirm({ kind: "commit", row, title: "Retry budget commitment?", description: "The backend will re-check current dimensional availability and the approved exception strategy.", confirmLabel: "Commit budget" }) }];
    return [];
  }

  return <section>
    <WorkspaceTools links={[["Configuration", "/configuration/budget-rules"], ["Management Reports", "/reports"]]} />
      <PageHeader title="Budget Control" description="Monitor and control assigned, committed, executed, paid, and available budget using the same dimensional ledger as workflow transactions." actions={canDecide && <div className="budget-form-actions"><Link className="secondary-button" to="/configuration/budget-allocations">{t("Legacy allocations")}</Link><button type="button" className="primary-button" onClick={() => setWorkspace({ planId: null })}>{t("Create annual budget")}</button></div>} />
    <Message type="error">{error || allocationTable.error || exceptionTable.error || commitmentTable.error}</Message>
    <div className="period-toolbar budget-period-toolbar">
      <div className="budget-view-switch" role="group" aria-label={t("Budget view")}><button type="button" aria-pressed={view === "ANNUAL"} onClick={() => changeView("ANNUAL")}>{t("Annual view")}</button><button type="button" aria-pressed={view === "MONTHLY"} onClick={() => changeView("MONTHLY")}>{t("Monthly view")}</button></div>
      <label className="field compact-period"><span>{t("Budget year")}</span><input aria-label={t("Budget year")} type="number" min="2000" max="2199" value={periodInput.slice(0, 4)} onChange={(event) => setPeriodInput(event.target.value + (view === "MONTHLY" ? "-" + (periodInput.slice(5) || "01") : ""))} /></label>
      {view === "MONTHLY" && <label className="field compact-period"><span>{t("Month")}</span><select aria-label={t("Month")} value={periodInput.slice(5)} onChange={(event) => setPeriodInput(periodInput.slice(0, 4) + "-" + event.target.value)}>{BUDGET_MONTHS.map((name, index) => <option key={name} value={String(index + 1).padStart(2, "0")}>{t(name)}</option>)}</select></label>}
      <button type="button" className="secondary-button" onClick={applyPeriod} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Apply")}</span></button>
    </div>
    {data.hasUndatedLegacy && <Message>{t("Legacy Cost Center balances have no budget year and are excluded from selected-period totals.")}</Message>}
    {data.hasAnnualOnlyActivity && <Message>{t("Annual-only plans show monthly activity without a monthly limit. View their annual plan for available budget.")}</Message>}
    <div className="stats-grid budget-stats"><StatCard label="Assigned budget" value={money(data.totals.assigned)} tone="navy" /><StatCard label="Committed budget" value={money(data.totals.committed)} tone="amber" /><StatCard label="Executed budget" value={money(data.totals.executed)} tone="teal" /><StatCard label="Paid budget" value={money(data.totals.paid)} tone="green" /><StatCard label="Available balance" value={money(data.totals.available)} tone="neutral" /></div>
    {data.warnings?.length > 0 && <div className="alert-strip warning"><AlertTriangle size={20} /><div><strong>{t("Budget attention required")}</strong><p>{t("One or more dimensions have low availability or over-execution.")}</p></div></div>}

    <nav className="focus-tabs" aria-label={t("Sections")}>{["Budget", "Exceptions", "Commitments"].map(view => <button type="button" key={view} aria-pressed={focusView === view} onClick={() => setFocusView(view)}>{t(view)}</button>)}</nav>
      <div hidden={focusView !== "Budget"} className="workspace-panel"><div className="section-heading"><div><h3>{t("Dimensional budget")}</h3><p>{t("Period, Cost Center, expense classification, and project remain visible together.")}</p></div><span className="section-count">{allocationTable.pagination.total}</span></div><DataTable rows={allocationTable.rows} loading={allocationTable.loading} remote={allocationTable.remote} rowActions={(row) => row.source === "LINKED_ANNUAL_PLAN" ? [{ label: "View annual plan", onClick: () => setWorkspace({ planId: row._id }) }] : []} filters={[{ key: "source", label: "sources", allLabel: "All sources", options: ["LINKED_ANNUAL_PLAN", "DIMENSIONAL_ALLOCATION", "TRANSITIONAL_COST_CENTER"] }]} searchPlaceholder="Search Cost Center, account, project, or period..." columns={[
      { key: "period", label: "Period", render: (row) => row.period || t("Undated legacy balance") },
      { key: "planningMode", label: "Budget planning mode", sortable: false, render: (row) => t(BUDGET_PLANNING_MODES[row.planningMode] || "Legacy allocation") },
      { key: "costCenter", label: "Cost center", sortable: false, getValue: (row) => `${row.costCenter?.code || ""} ${row.costCenter?.name || ""}`, render: (row) => <div className="primary-cell"><strong>{row.costCenter?.code || "-"}</strong><span>{row.costCenter?.name}</span></div> },
      { key: "expenseType", label: "Expense type", sortable: false, getValue: (row) => row.expenseType?.accountNumber, render: (row) => row.expenseType ? `${row.expenseType.accountNumber} - ${row.expenseType.name}` : t("All") },
      { key: "project", label: "Project", render: (row) => row.project || t("All") }, { key: "assignedAmount", label: "Assigned", align: "right", render: (row) => money(row.assignedAmount) },
      { key: "committedAmount", label: "Committed", align: "right", render: (row) => money(row.committedAmount) }, { key: "executedAmount", label: "Executed", align: "right", render: (row) => money(row.executedAmount) },
      { key: "paidAmount", label: "Paid", align: "right", render: (row) => money(row.paidAmount) }, { key: "availableAmount", label: "Available", sortable: false, align: "right", render: (row) => <strong className={row.availableAmount < 0 ? "text-danger" : ""}>{money(row.availableAmount)}</strong> }
    ]} /></div>

    <div hidden={focusView !== "Exceptions"} className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Budget exceptions")}</h3><p>{t("Insufficient-budget branches require an explicit decision and remain auditable.")}</p></div><span className="section-count">{exceptionTable.pagination.total}</span></div><DataTable rows={exceptionTable.rows} loading={exceptionTable.loading} remote={exceptionTable.remote} filters={[{ key: "status", label: "statuses", allLabel: "All statuses", options: ["PENDING", "APPROVED", "REJECTED"] }]} rowActions={exceptionActions} columns={[
      { key: "request", label: "Request", sortable: false, getValue: (row) => row.request?.requestNumber, render: (row) => row.request ? <Link to={`/requests/${row.request._id}`}>{row.request.requestNumber}</Link> : "-" },
      { key: "preparationComments", label: "Budget review", render: row => row.preparationComments || "Pending review" },
      { key: "strategy", label: "Strategy" }, { key: "costCenter", label: "Cost center", sortable: false, render: (row) => row.costCenter?.code || "-" }, { key: "expenseType", label: "Expense type", sortable: false, render: (row) => row.expenseType?.accountNumber || "-" },
      { key: "budgetLimits", label: "Annual / monthly limits", sortable: false, render: (row) => row.budgetLimits?.planningMode ? <BudgetLimitSummary line={row.budgetLimits} /> : "—" },
      { key: "availableAmount", label: "Available", align: "right", render: (row) => money(row.availableAmount) }, { key: "requestedAmount", label: "Requested", align: "right", render: (row) => <strong>{money(row.requestedAmount)}</strong> }, { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> }
    ]} /></div>

    <div hidden={focusView !== "Commitments"} className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Budget commitments")}</h3><p>{t("Reservation, execution, payment, and release are independent and traceable.")}</p></div><span className="section-count">{commitmentTable.pagination.total}</span></div><DataTable rows={commitmentTable.rows} loading={commitmentTable.loading} remote={commitmentTable.remote} filters={[{ key: "status", label: "statuses", allLabel: "All statuses", options: ["NO_BUDGET", "AVAILABLE", "COMMITTED", "EXECUTED", "RELEASED", "CLOSED"] }]} searchPlaceholder="Search request or period..." columns={[
      { key: "requestNumber", label: "Request", render: (row) => row.request?._id ? <Link to={`/requests/${row.request._id}`}>{row.requestNumber}</Link> : row.requestNumber }, { key: "period", label: "Period" },
      { key: "request", label: "Type", sortable: false, getValue: (row) => row.request?.requestType, render: (row) => row.request?.requestType || "-" }, { key: "requestArea", label: "Area", sortable: false, getValue: (row) => row.request?.requesterArea, render: (row) => row.request?.requesterArea || row.request?.requestingArea || "-" },
      { key: "lines", label: "Dimensions", sortable: false, getValue: (row) => row.lines?.map((line) => `${line.costCenter?.code} ${line.expenseType?.accountNumber}`).join(" "), render: (row) => row.lines?.map((line) => `${line.costCenter?.code || "-"} / ${line.expenseType?.accountNumber || "-"}`).join(", ") },
      { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> }, { key: "totalAmount", label: "Committed amount", align: "right", render: (row) => <strong>{money(row.totalAmount)}</strong> }, { key: "createdAt", label: "Created", render: (row) => new Date(row.createdAt).toLocaleString() }
    ]} /></div>
    <BudgetPlanWorkspace open={Boolean(workspace)} planId={workspace?.planId} year={period.slice(0, 4)} selectedPeriod={period} canManage={canDecide} onClose={() => setWorkspace(null)} onSaved={planSaved} />
    <ConfirmDialog open={Boolean(confirm)} {...confirm} details={confirm ? [{ label: "Request", value: confirm.row.request?.requestNumber }, { label: "Strategy", value: confirm.row.strategy }, { label: "Result", value: confirm.kind === "commit" ? "The request advances only if the backend budget check passes." : `Exception status changes to ${confirm.status}.` }] : []} loading={processing} onClose={() => !processing && setConfirm(null)} onConfirm={decide} />
  </section>;
}
