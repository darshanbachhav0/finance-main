import WorkspaceTools from "../components/WorkspaceTools.jsx";
import { useDraftResume } from "../hooks/useWorkDraft.js";
import { AlertTriangle, CalendarClock, CheckCircle2, Eye, RefreshCw, RotateCw, Undo2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DeepLinkNotice from "../components/DeepLinkNotice.jsx";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import Tabs, { tabPanelProps } from "../components/Tabs.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import usePaginatedResource from "../hooks/usePaginatedResource.js";
import BudgetPlanWorkspace, { changeDescription } from "../components/BudgetPlanWorkspace.jsx";
import BudgetLimitSummary from "../components/BudgetLimitSummary.jsx";
import { BUDGET_PLANNING_MODES, BUDGET_MONTHS, validBudgetPeriod, validBudgetYear } from "../../../shared/budgetPlanning.mjs";
import { formatCurrency, formatDateTime } from "../utils/formatters.js";

const TAB_VIEWS = { budget: "Budget", exceptions: "Exceptions", commitments: "Commitments", changes: "Budget changes" };

export default function BudgetControl() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Deep links from notifications, tasks and the dashboard: ?record=<exception id>,
  // ?request=<request id> (that request's exceptions) or ?tab=exceptions (optionally with
  // exceptionStatus=PENDING) open the Exceptions view directly.
  const recordId = searchParams.get("record") || "";
  const linkedRequestId = searchParams.get("request") || "";
  const tabParam = String(searchParams.get("tab") || "").toLowerCase();
  // ?tab=changes&record=<id> deep-links one budget plan change (approval notifications).
  const changeLink = tabParam === "changes" && recordId ? { record: recordId } : null;
  const exceptionLink = changeLink ? null : recordId ? { record: recordId } : linkedRequestId ? { request: linkedRequestId } : null;
  const exceptionStatus = searchParams.get("exceptionStatus") || "";
  const [focusView, setFocusView] = useState(() => changeLink ? "Budget changes" : exceptionLink ? "Exceptions" : TAB_VIEWS[tabParam] || "Budget");
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
  // Changing an existing plan is Admin only; Management decides changes above the approval threshold.
  const canEditPlans = user.role === "Admin";
  const canDecideChanges = user.role === "Management";
  useDraftResume("budget-plan", () => { if (canDecide) setWorkspace({ planId: null }); });
  useDraftResume("budget-adjustment", id => { if (canEditPlans) setWorkspace({ planId: id }); });
  const allocationTable = usePaginatedResource("/budget/allocations", { fixedParams: { period } });
  const exceptionTable = usePaginatedResource("/budget/exceptions", { fixedParams: exceptionLink || { period }, initialFilters: exceptionStatus ? { status: exceptionStatus } : {}, deepLink: Boolean(exceptionLink) });
  useEffect(() => {
    if (changeLink) setFocusView("Budget changes");
    else if (exceptionLink) setFocusView("Exceptions");
    else if (TAB_VIEWS[tabParam]) setFocusView(TAB_VIEWS[tabParam]);
  }, [recordId, linkedRequestId, tabParam]);

  function showAllExceptions() {
    const next = new URLSearchParams(searchParams);
    next.delete("record");
    next.delete("request");
    next.set("tab", "exceptions");
    setSearchParams(next, { replace: true });
  }
  const commitmentTable = usePaginatedResource("/budget/commitments", { fixedParams: { period } });
  const changeTable = usePaginatedResource("/budget/plan-changes", { fixedParams: changeLink || {}, initialFilters: changeLink ? {} : { status: "PENDING" }, deepLink: Boolean(changeLink) });
  function showAllChanges() {
    const next = new URLSearchParams(searchParams);
    next.delete("record");
    next.set("tab", "changes");
    setSearchParams(next, { replace: true });
  }

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
    changeTable.reload();
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
    else { load(); allocationTable.reload(); exceptionTable.reload(); commitmentTable.reload(); changeTable.reload(); }
  }

  async function decide(comments) {
    setProcessing(true);
    try {
      if (confirm.kind === "planChange") {
        await api.post(`/budget/plan-changes/${confirm.row._id}/decision`, { decision: confirm.decision, comments });
        notify(confirm.decision === "APPROVE" ? "Budget change approved and applied." : "Budget change rejected.");
      } else if (confirm.kind === "withdrawChange") {
        await api.post(`/budget/plan-changes/${confirm.row._id}/cancel`);
        notify("Budget change withdrawn.");
      } else if (confirm.kind === "decision") {
        const response = await api.post(`/budget/exceptions/${confirm.row._id}/decision`, { status: confirm.status, comments });
        const increase = response.data?.data?.appliedIncrease?.amount;
        notify(confirm.status === "REVIEWED" ? "Budget review saved for Management." : confirm.status === "APPROVED" ? (increase > 0 ? t("Budget exception approved. The budget was increased by {amount}.").replace("{amount}", money(increase)) : "Budget exception approved.") : "Budget exception rejected.");
      } else if (confirm.kind === "carryOver") {
        const response = await api.post("/budget/year-end/carry-over", { year: confirm.year });
        const summary = response.data.data;
        notify(t("{count} open commitments carried over to {year} ({amount}).").replace("{count}", summary.carriedCommitments).replace("{year}", summary.toYear).replace("{amount}", money(summary.carriedAmount)));
      } else {
        await api.post(`/budget/requests/${confirm.row.request._id}/commit`);
        notify("Budget commitment completed and sent to Accounting.");
      }
      setConfirm(null);
      await load();
      allocationTable.reload();
      exceptionTable.reload();
      commitmentTable.reload();
      changeTable.reload();
    } catch (err) { setError(err.message); setConfirm(null); changeTable.reload(); } finally { setProcessing(false); }
  }

  function exceptionActions(row) {
    // Nothing is left to decide once the request itself is finished.
    if (["CERRADO", "ANULADO", "RECHAZADO"].includes(row.request?.status)) return [];
    if (row.status === "PENDING" && canDecide && !row.preparedAt) return [{ label: "Prepare / review", icon: CheckCircle2, onClick: () => setConfirm({ kind: "decision", row, status: "REVIEWED", title: "Review budget exception", description: "Record your recommendation for Management. This does not authorize an overrun.", confirmLabel: "Save review", inputLabel: "Recommendation", inputRequired: true }) }];
    const id = value => String(value?._id || value || "");
    // Budget reviews first; Management can decide only an exception Budget has reviewed.
    const canApprove = user.role === "Management" && Boolean(row.preparedAt) && ![row.requestedBy, row.preparedBy, row.request?.requester, row.request?.solicitor].some(value => value && id(value) === id(user._id));
    if (row.status === "PENDING" && !canApprove) return [];
    if (row.status === "PENDING") return [
      { label: "Approve exception", icon: CheckCircle2, onClick: () => setConfirm({ kind: "decision", row, status: "APPROVED", title: "Approve budget exception?", description: row.strategy === "REQUEST_BUDGET_INCREASE" ? "This records an audited decision and automatically adds the shortfall to the budget, so the commitment can proceed." : "This records an audited exception decision that authorizes the overrun for this request.", confirmLabel: "Approve exception", inputLabel: "Decision comments", inputRequired: true }) },
      { label: "Reject exception", icon: XCircle, tone: "danger", onClick: () => setConfirm({ kind: "decision", row, status: "REJECTED", title: "Reject budget exception?", description: "The request will remain blocked from budget commitment.", confirmLabel: "Reject exception", inputLabel: "Decision comments", inputRequired: true, tone: "danger" }) }
    ];
    if (row.status === "APPROVED" && canDecide && row.request?.status === "OBSERVADO_PRESUPUESTO") return [{ label: "Retry budget commitment", icon: RotateCw, onClick: () => setConfirm({ kind: "commit", row, title: "Retry budget commitment?", description: "The backend will re-check current dimensional availability and the approved exception strategy.", confirmLabel: "Commit budget" }) }];
    return [];
  }

  function changeActions(row) {
    const actions = [{ label: "Open annual plan", icon: Eye, onClick: () => setWorkspace({ planId: row.plan?._id }) }];
    if (row.status !== "PENDING") return actions;
    if (canDecideChanges) actions.push(
      { label: "Approve change", icon: CheckCircle2, primary: true, onClick: () => setConfirm({ kind: "planChange", decision: "APPROVE", row, title: "Approve this budget change?", description: "The change is checked again against the plan as it is now and applied immediately.", confirmLabel: "Approve and apply", inputLabel: "Decision comments", inputRequired: true }) },
      { label: "Reject change", icon: XCircle, tone: "danger", onClick: () => setConfirm({ kind: "planChange", decision: "REJECT", row, title: "Reject this budget change?", description: "The plan stays as it is. The Admin who requested it is notified.", confirmLabel: "Reject change", inputLabel: "Decision comments", inputRequired: true, tone: "danger" }) }
    );
    if (canEditPlans) actions.push({ label: "Withdraw", icon: Undo2, tone: "danger", onClick: () => setConfirm({ kind: "withdrawChange", row, title: "Withdraw this budget change?", description: "It will not be applied. You can request it again later.", confirmLabel: "Withdraw change", tone: "danger" }) });
    return actions;
  }
  const confirmDetails = !confirm ? [] : confirm.kind === "carryOver"
    ? [{ label: "From budget year", value: confirm.year }, { label: "To budget year", value: String(Number(confirm.year) + 1) }, { label: "Result", value: t("Open commitments move to January of the next year.") }]
    : ["planChange", "withdrawChange"].includes(confirm.kind)
      ? [{ label: "Budget plan", value: `${confirm.row.plan?.period || ""} · ${confirm.row.plan?.costCenter?.code || ""}` }, { label: "Change", value: changeDescription(confirm.row, t, money) }, { label: "Amount", value: money(confirm.row.amount) }, { label: "Requested by", value: confirm.row.requestedByName }, { label: "Reason", value: confirm.row.reason }]
      : [{ label: "Request", value: confirm.row.request?.requestNumber }, { label: "Strategy", value: confirm.row.strategy }, { label: "Result", value: confirm.kind === "commit" ? "The request advances only if the backend budget check passes." : `Exception status changes to ${confirm.status}.` }];

  return <section>
      <PageHeader title="Budget Control" description="Monitor and control assigned, committed, executed, paid, and available budget using the same dimensional ledger as workflow transactions." actions={canDecide && <div className="budget-form-actions"><button type="button" className="secondary-button" onClick={() => setConfirm({ kind: "carryOver", year: period.slice(0, 4), title: "Carry over open commitments?", description: "Open commitments of the selected year that were not yet invoiced move, with their funds, into January of the next budget year. Invoiced and paid amounts stay in the closing year. Running it again has no further effect.", confirmLabel: "Carry over commitments" })}><CalendarClock size={16} /><span>{t("Year-end carry-over")}</span></button><Link className="secondary-button" to="/configuration/budget-allocations">{t("Legacy allocations")}</Link><button type="button" className="primary-button" onClick={() => setWorkspace({ planId: null })}>{t("Create annual budget")}</button></div>} />
      <WorkspaceTools links={[["Configuration", "/configuration/budget-rules"], ["Management Reports", "/reports"]]} />
    <Message type="error">{error || allocationTable.error || exceptionTable.error || commitmentTable.error || changeTable.error}</Message>
    <div className="period-toolbar budget-period-toolbar">
      <div className="budget-view-switch" role="group" aria-label={t("Budget view")}><button type="button" aria-pressed={view === "ANNUAL"} onClick={() => changeView("ANNUAL")}>{t("Annual view")}</button><button type="button" aria-pressed={view === "MONTHLY"} onClick={() => changeView("MONTHLY")}>{t("Monthly view")}</button></div>
      <label className="field compact-period"><span>{t("Budget year")}</span><input aria-label={t("Budget year")} type="number" min="2000" max="2199" value={periodInput.slice(0, 4)} onChange={(event) => setPeriodInput(event.target.value + (view === "MONTHLY" ? "-" + (periodInput.slice(5) || "01") : ""))} /></label>
      {view === "MONTHLY" && <label className="field compact-period"><span>{t("Month")}</span><select aria-label={t("Month")} value={periodInput.slice(5)} onChange={(event) => setPeriodInput(periodInput.slice(0, 4) + "-" + event.target.value)}>{BUDGET_MONTHS.map((name, index) => <option key={name} value={String(index + 1).padStart(2, "0")}>{t(name)}</option>)}</select></label>}
      <button type="button" className="secondary-button" onClick={applyPeriod} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Apply")}</span></button>
    </div>
    {data.hasUndatedLegacy && <Message>{t("Legacy Cost Center balances have no budget year and are excluded from selected-period totals.")}</Message>}
    {data.hasAnnualOnlyActivity && <Message>{t("Annual-only plans show monthly activity without a monthly limit. View their annual plan for available budget.")}</Message>}
    <div className="stats-grid budget-stats"><StatCard label="Assigned budget" value={money(data.totals.assigned)} tone="navy" /><StatCard label="Committed budget" value={money(data.totals.committed)} tone="amber" /><StatCard label="Executed budget" value={money(data.totals.executed)} tone="teal" /><StatCard label="Paid budget" value={money(data.totals.paid)} tone="green" /><StatCard label="Available balance" value={money(data.totals.available)} tone="neutral" /></div>
    {data.totals?.transitional?.committed > 0 && <Message>{t("Committed includes {amount} of informational (transitional) commitments, which do not reduce the available balance.").replace("{amount}", money(data.totals.transitional.committed))}</Message>}
    {data.warnings?.length > 0 && <div className="alert-strip warning"><AlertTriangle size={20} /><div><strong>{t("Budget attention required")}</strong><p>{t("One or more dimensions have low availability or over-execution.")}</p></div></div>}

    <Tabs idPrefix="budget" label="Sections" panels value={focusView} onChange={setFocusView} tabs={["Budget", "Exceptions", "Commitments", "Budget changes"].map((view) => ({ id: view, label: view }))} />
      <div hidden={focusView !== "Budget"} {...tabPanelProps("budget", "Budget")} className="workspace-panel"><div className="section-heading"><div><h3>{t("Dimensional budget")}</h3><p>{t("Period, Cost Center, expense classification, and project remain visible together.")}</p></div><span className="section-count">{allocationTable.pagination.total}</span></div><DataTable rows={allocationTable.rows} loading={allocationTable.loading} remote={allocationTable.remote} rowActions={(row) => row.source === "LINKED_ANNUAL_PLAN" ? [{ label: "View annual plan", onClick: () => setWorkspace({ planId: row._id }) }] : []} filters={[{ key: "source", label: "sources", allLabel: "All sources", options: ["LINKED_ANNUAL_PLAN", "DIMENSIONAL_ALLOCATION", "TRANSITIONAL_COST_CENTER"] }]} searchPlaceholder="Search Cost Center, account, project, or period..." columns={[
      { key: "period", label: "Period", render: (row) => row.period || t("Undated legacy balance") },
      { key: "planningMode", label: "Budget planning mode", sortable: false, render: (row) => t(BUDGET_PLANNING_MODES[row.planningMode] || "Legacy allocation") },
      { key: "costCenter", label: "Cost center", sortable: false, getValue: (row) => `${row.costCenter?.code || ""} ${row.costCenter?.name || ""}`, render: (row) => <div className="primary-cell"><strong>{row.costCenter?.code || "-"}</strong><span>{row.costCenter?.name}</span></div> },
      { key: "project", label: "Project", render: (row) => row.project || t("All") }, { key: "assignedAmount", label: "Assigned", align: "right", render: (row) => money(row.assignedAmount) },
      { key: "committedAmount", label: "Committed", align: "right", render: (row) => money(row.committedAmount) }, { key: "executedAmount", label: "Executed", align: "right", render: (row) => money(row.executedAmount) },
      { key: "paidAmount", label: "Paid", align: "right", render: (row) => money(row.paidAmount) }, { key: "availableAmount", label: "Available", sortable: false, align: "right", render: (row) => <strong className={row.availableAmount < 0 ? "text-danger" : ""}>{money(row.availableAmount)}</strong> }
    ]} /></div>

    <div hidden={focusView !== "Exceptions"} {...tabPanelProps("budget", "Exceptions")} className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Budget exceptions")}</h3><p>{t("Insufficient-budget branches require an explicit decision and remain auditable.")}</p></div><span className="section-count">{exceptionTable.pagination.total}</span></div>{exceptionLink && <DeepLinkNotice title={recordId ? "Showing one budget exception" : "Showing the budget exceptions of the linked request"} missing={!exceptionTable.loading && !exceptionTable.rows.length} missingDescription="No budget exception was found for this link. The request may have been committed or corrected." clearLabel="Show all exceptions" onClear={showAllExceptions} />}<DataTable rows={exceptionTable.rows} loading={exceptionTable.loading} remote={exceptionTable.remote} filters={[{ key: "status", label: "Status", allLabel: "All statuses", options: ["PENDING", "APPROVED", "REJECTED", "RESOLVED"] }]} rowActions={exceptionActions} columns={[
      { key: "request", label: "Request", sortable: false, getValue: (row) => row.request?.requestNumber, render: (row) => row.request ? <Link to={`/requests/${row.request._id}`}>{row.request.requestNumber}</Link> : "-" },
      { key: "preparationComments", label: "Budget review", render: row => row.preparationComments || t(row.status === "PENDING" ? "Pending Budget review" : "Not reviewed") },
      { key: "strategy", label: "Strategy" }, { key: "costCenter", label: "Cost center", sortable: false, render: (row) => row.costCenter?.code || "-" },
      { key: "budgetLimits", label: "Annual / monthly limits", sortable: false, render: (row) => row.budgetLimits?.planningMode ? <BudgetLimitSummary line={row.budgetLimits} /> : "—" },
      { key: "availableAmount", label: "Available", align: "right", render: (row) => money(row.availableAmount) }, { key: "requestedAmount", label: "Requested", align: "right", render: (row) => <strong>{money(row.requestedAmount)}</strong> }, { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> }
    ]} /></div>

    <div hidden={focusView !== "Commitments"} {...tabPanelProps("budget", "Commitments")} className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Budget commitments")}</h3><p>{t("Reservation, execution, payment, and release are independent and traceable.")}</p></div><span className="section-count">{commitmentTable.pagination.total}</span></div><DataTable rows={commitmentTable.rows} loading={commitmentTable.loading} remote={commitmentTable.remote} filters={[{ key: "status", label: "Status", allLabel: "All statuses", options: ["NO_BUDGET", "AVAILABLE", "COMMITTED", "EXECUTED", "RELEASED", "CLOSED"] }]} searchPlaceholder="Search request or period..." columns={[
      { key: "requestNumber", label: "Request", render: (row) => row.request?._id ? <Link to={`/requests/${row.request._id}`}>{row.requestNumber}</Link> : row.requestNumber }, { key: "period", label: "Period" },
      { key: "request", label: "Type", sortable: false, getValue: (row) => row.request?.requestType, render: (row) => row.request?.requestType || "-" }, { key: "requestArea", label: "Area", sortable: false, getValue: (row) => row.request?.requesterArea, render: (row) => row.request?.requesterArea || row.request?.requestingArea || "-" },
      { key: "lines", label: "Dimensions", sortable: false, getValue: (row) => row.lines?.map((line) => line.costCenter?.code).join(" "), render: (row) => row.lines?.map((line) => `${line.costCenter?.code || "-"}${line.project ? ` / ${line.project}` : ""}`).join(", ") },
      { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> }, { key: "totalAmount", label: "Committed amount", align: "right", render: (row) => <strong>{money(row.totalAmount)}</strong> }, { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt) }
    ]} /></div>
    <div hidden={focusView !== "Budget changes"} {...tabPanelProps("budget", "Budget changes")} className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Budget changes")}</h3><p>{t("Changes to an annual plan that move more than the approval threshold wait here for Management. Smaller changes apply immediately and appear in each plan's history.")}</p></div><span className="section-count">{changeTable.pagination.total}</span></div>{changeLink && <DeepLinkNotice title="Showing one budget change" missing={!changeTable.loading && !changeTable.rows.length} missingDescription="This budget change no longer exists." clearLabel="Show all budget changes" onClear={showAllChanges} />}<DataTable rows={changeTable.rows} loading={changeTable.loading} remote={changeTable.remote} filters={[{ key: "status", label: "Status", allLabel: "All statuses", options: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] }]} rowActions={changeActions} emptyTitle="No budget changes" emptyDescription="Changes above the approval threshold appear here until Management decides them." columns={[
      { key: "createdAt", label: "Requested", render: (row) => formatDateTime(row.createdAt) },
      { key: "plan", label: "Budget plan", sortable: false, getValue: (row) => row.plan?.costCenter?.code, render: (row) => <div className="primary-cell"><strong>{row.plan?.costCenter?.code || "-"} · {row.plan?.period}</strong><span>{row.plan?.costCenter?.name}</span></div> },
      { key: "summary", label: "Change", sortable: false, render: (row) => <div className="primary-cell"><strong>{changeDescription(row, t, money)}</strong><span>{row.reason}</span></div> },
      { key: "amount", label: "Amount", align: "right", render: (row) => <strong>{money(row.amount)}</strong> },
      { key: "requestedByName", label: "Requested by", sortable: false },
      { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
      { key: "decision", label: "Decision", sortable: false, render: (row) => row.decidedByName ? <div className="primary-cell"><strong>{row.decidedByName}</strong><span>{row.decisionComments || "-"}</span></div> : "-" }
    ]} /></div>
    <BudgetPlanWorkspace open={Boolean(workspace)} planId={workspace?.planId} year={period.slice(0, 4)} selectedPeriod={period} canManage={canDecide} canEdit={canEditPlans} onClose={() => setWorkspace(null)} onSaved={planSaved} />
    <ConfirmDialog open={Boolean(confirm)} {...confirm} details={confirmDetails} loading={processing} onClose={() => !processing && setConfirm(null)} onConfirm={decide} />
  </section>;
}
