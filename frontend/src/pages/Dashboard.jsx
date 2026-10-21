import ContinueWork from "../components/ContinueWork.jsx";
import BudgetGauge from "../components/BudgetGauge.jsx";
import PersonalStats from "../components/PersonalStats.jsx";
import JefeDashboard from "../components/JefeDashboard.jsx";
import { greetingName, greetingTemplate, pendingTaskCount } from "../utils/greeting.js";
import { startTour, tourDone } from "../utils/tour.js";
import { RECORD_CHANGED_EVENT } from "../hooks/useLiveEvents.js";
import MyTasks from "../components/MyTasks.jsx";
import { CalendarClock, CircleDollarSign, FileText, RefreshCw, Users } from "lucide-react";
import { lazy, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import FinancialProgressSummary from "../components/FinancialProgressSummary.jsx";
import ProtectedAssetButton from "../components/ProtectedAssetButton.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "../utils/formatters.js";
import { AWAITING_PURCHASE_ORDER_PATH, dashboardMetricLink } from "../utils/dashboardLinks.js";
import { todayIso } from "../utils/dateInput.js";

const AnalyticsChart = lazy(() => import("../components/AnalyticsChart.jsx"));

const descriptions = {
  Admin: "System activity, workflow health, users, and master-data readiness.",
  Solicitor: "Your drafts, approvals, rejected work, renditions, and recent requests.",
  AreaDirector: "Approval workload, waiting value, oldest requests, and recent decisions.",
  ViceRector: "Approval workload, waiting value, oldest requests, and recent decisions.",
  Accounting: "Period readiness, accounting entries, exchange rates, and pending closures.",
  Treasury: "Payable workload, bank readiness, generated files, and the budget: assigned, available, committed and paid.",
  Management: "Institutional CAPEX/OPEX, budget availability, spending, and pending commitments.",
  Procurement: "Approved requests awaiting a Purchase Order, open orders, and invoices registered against them."
};

const isApprovalRole = (role) => role === "AreaDirector" || role === "ViceRector";

const metricIcons = {
  users: Users,
  amount: CircleDollarSign,
  debit: CircleDollarSign,
  credit: CircleDollarSign,
  period: CalendarClock,
  oldest: CalendarClock
};

export default function Dashboard() {
  const { t, language } = useLanguage();
  const { user, readOnly } = useAuth();
  const navigate = useNavigate();
  const [personal, setPersonal] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/dashboard/summary");
      const mine = response.data.jefe ? null : await api.get("/dashboard/me").catch(() => null);
      setSummary(response.data);
      setPersonal(mine?.data?.data || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Live updates: something about one of this person's records changed; refresh the numbers.
  useEffect(() => {
    let timer;
    const refresh = () => { window.clearTimeout(timer); timer = window.setTimeout(load, 1200); };
    window.addEventListener(RECORD_CHANGED_EVENT, refresh);
    return () => { window.clearTimeout(timer); window.removeEventListener(RECORD_CHANGED_EVENT, refresh); };
  }, []);

  // The first visit offers the short tour once the greeting and tasks it points at are on screen.
  useEffect(() => {
    if (summary && !summary.jefe && !readOnly && !tourDone(user._id)) startTour();
  }, [Boolean(summary)]);

  const taskCount = pendingTaskCount(summary?.tasks?.items);
  const greeting = t(greetingTemplate()).replace("{name}", greetingName(user.name));
  const nextPayment = personal?.payments?.next;
  const daySummary = summary?.jefe ? "Presupuesto y solicitudes de tu departamento." : !summary ? t(descriptions[user.role] || descriptions.Admin) : [
    taskCount === 0 ? t("You are all caught up.") : t(taskCount === 1 ? "1 thing needs your attention today." : "{count} things need your attention today.").replace("{count}", formatNumber(taskCount, language)),
    nextPayment ? t(nextPayment.estimated ? "Your next payment is expected on {date}." : "Your next payment is on {date}.").replace("{date}", formatDate(`${nextPayment.date}T12:00:00Z`, language)) : ""
  ].filter(Boolean).join(" ");

  function metricValue(metric) {
    if (metric.format === "text") return t(metric.value);
    if (metric.format === "currency") {
      return formatCurrency(metric.value, metric.currency || "PEN", language);
    }
    return formatNumber(metric.value, language);
  }

  const requestColumns = [
    ...(isApprovalRole(summary?.role) ? [{ key: "approvalDueAt", label: "SLA due", render: row => <div className="primary-cell"><StatusBadge status={row.sla?.alert || row.sla?.severity || "LOW"} /><span>{row.approvalDueAt ? formatDateTime(row.approvalDueAt, language) : "-"}</span></div> }] : []),
    { key: "requestNumber", label: "Request", render: (row) => <Link to={`/requests/${row._id}`}>{row.requestNumber}</Link> },
    { key: "supplier", label: "Supplier", getValue: (row) => row.supplier?.name, render: (row) => row.supplier?.name || "-" },
    { key: "totalAmount", label: "Amount", align: "right", render: (row) => formatCurrency(row.totalAmount, row.currency, language) },
    { key: "status", label: "Status", render: (row) => <FinancialProgressSummary request={row} compact /> }
  ];
  const operationalRows = summary?.oldestRequests || summary?.queue?.map((item) => item.request ? ({ ...item.request, rowId: item._id || item.request._id, supplier: item.supplier, totalAmount: item.outstandingAmount, currency: item.currency, status: item.status }) : item) || summary?.recentRequests || [];
  // The role's primary action, kept visible above its task list (and offered when all is done).
  const primaryAction = {
    Admin: ["/settings", "Settings"],
    Solicitor: ["/requests/new", "New request"],
    AreaDirector: ["/approvals", "Review approvals"],
    ViceRector: ["/approvals", "Review approvals"],
    Accounting: ["/accounting", "Open Accounting"],
    Treasury: ["/treasury", "Open Treasury"],
    Management: ["/approvals", "Review decisions"],
    Procurement: [AWAITING_PURCHASE_ORDER_PATH, "Review requests"]
  }[summary?.role];

  return (
    <section>
      <PageHeader title={greeting} description={daySummary} actions={<><span className="last-updated">{t("Last updated")}: {summary?.lastUpdated ? formatDateTime(summary.lastUpdated, language) : "-"}</span><button type="button" className="icon-button" onClick={load} disabled={loading} aria-label={t("Refresh")} title={t("Refresh")}><RefreshCw className={loading ? "spin" : ""} size={16} /></button></>} />
      <Message type="error">{error}</Message>

      {loading && !summary && (
        <div className="dashboard-loading" role="status" aria-label={t("Loading dashboard...")}>
          <div className="stats-grid">{Array.from({ length: 4 }).map((_, index) => <div className="stat-card" key={index}><span className="skeleton skeleton-line" /><span className="skeleton skeleton-value" /></div>)}</div>
          <div className="workspace-panel"><span className="skeleton skeleton-block" /></div>
        </div>
      )}

      {summary?.jefe && <JefeDashboard data={summary.jefe} />}
      {summary && !summary.jefe && (
        <>
          {/* The role's to-do list replaces the generic welcome banner; its tasks also cover the
              former "Items need attention" warnings (missing exchange-rate dates). */}
          <PersonalStats personal={personal} role={summary.role} />
          <MyTasks items={summary.tasks?.items} action={primaryAction && { to: primaryAction[0], label: primaryAction[1] }} />
          <ContinueWork />
          <div className="stats-grid">
            {summary.metrics.filter(metric => !["credit", "debit", "closed", "files", "assigned", "capex", "opex", "users"].includes(metric.key)).slice(0, 4).map((metric) => (
              <StatCard key={metric.key} label={metric.label} value={metricValue(metric)} suffix={metric.suffix} tone={metric.tone} icon={metricIcons[metric.key] || FileText} {...dashboardMetricLink(summary.role, metric.key)} />
            ))}
          </div>

          <div className="dashboard-grid">
            <div className="workspace-panel dashboard-primary">
              <div className="section-heading">
                <div><h3>{t(isApprovalRole(summary.role) ? "Oldest requests awaiting decision" : summary.role === "Treasury" ? "Next payable requests" : "Recent requests")}</h3></div>
                <Link className="text-link" to={isApprovalRole(summary.role) ? "/approvals" : summary.role === "Treasury" ? "/treasury" : "/requests"}>{t("View all")}</Link>
              </div>
              <DataTable className="dashboard-request-table cards-narrow-only" controls={false} rowKey={operationalRows.some((row) => row.rowId) ? "rowId" : "_id"} rows={operationalRows.slice(0, 5)} columns={requestColumns} emptyDescription="No current requests." />
            </div>

            <AnalyticsChart
              title="Workflow distribution"
              description="Requests grouped by current status."
              data={summary.byStatus.map((item) => ({ ...item, name: t(item._id) }))}
              xKey="name"
              horizontal
              compact
              height={310}
              series={[{ key: "count", label: "Requests", color: "#087c75" }]}
              valueFormatter={(value) => formatNumber(value, language)}
              onDrillDown={(row) => navigate(`/requests?status=${row._id}`)}
            />

            {summary.budget && <BudgetGauge totals={summary.budget.totals} />}
            {summary.budget ? (
              <AnalyticsChart
                title="Budget execution"
                description="Assigned, committed, executed, paid, and available for the current period."
                data={[{ name: todayIso().slice(0, 7), ...summary.budget.totals }]}
                height={245}
                series={[{ key: "assigned", label: "Assigned", color: "#17344c" }, { key: "committed", label: "Committed", color: "#d18a00" }, { key: "executed", label: "Executed", color: "#087c75" }, { key: "paid", label: "Paid", color: "#2463a6" }, { key: "available", label: "Available", color: "#19733d" }]}
                valueFormatter={(value) => formatCurrency(value, "PEN", language)}
              />
            ) : (
              <AnalyticsChart
                title="Requests by type"
                description="PEN-equivalent workload by request classification."
                type="donut"
                data={summary.byType.map((item) => ({ ...item, name: t(item._id) }))}
                xKey="name"
                height={245}
                series={[{ key: "amount", label: "PEN amount", color: "#087c75" }]}
                valueFormatter={(value) => formatCurrency(value, "PEN", language)}
                onDrillDown={(row) => navigate(`/requests?requestType=${row._id}`)}
              />
            )}

            {["Admin", "AreaDirector", "ViceRector", "Accounting", "Treasury", "Management"].includes(summary.role) && <Link className="text-link dashboard-reports-link" to="/reports">{t("More insights in Reports")}</Link>}

          </div>
        </>
      )}
    </section>
  );
}
