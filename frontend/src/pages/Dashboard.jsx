import ContinueWork from "../components/ContinueWork.jsx";
import MyTasks from "../components/MyTasks.jsx";
import { CalendarClock, CircleDollarSign, FileText, RefreshCw, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/client.js";
import AnalyticsChart from "../components/AnalyticsChart.jsx";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import FinancialProgressSummary from "../components/FinancialProgressSummary.jsx";
import ProtectedAssetButton from "../components/ProtectedAssetButton.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "../utils/formatters.js";
import { AWAITING_PURCHASE_ORDER_PATH, dashboardMetricLink } from "../utils/dashboardLinks.js";

const descriptions = {
  Admin: "System activity, workflow health, users, and master-data readiness.",
  Solicitor: "Your drafts, approvals, rejected work, renditions, and recent requests.",
  AreaDirector: "Approval workload, waiting value, oldest requests, and recent decisions.",
  ViceRector: "Approval workload, waiting value, oldest requests, and recent decisions.",
  Accounting: "Period readiness, accounting entries, exchange rates, and pending closures.",
  Treasury: "Payable workload, currency totals, bank readiness, and generated files.",
  Budget: "Assigned, available, committed, executed, and paid budget with low-balance controls.",
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
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/dashboard/summary");
      setSummary(response.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

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
    Admin: ["/administration", "Administration"],
    Solicitor: ["/requests/new", "New request"],
    AreaDirector: ["/approvals", "Review approvals"],
    ViceRector: ["/approvals", "Review approvals"],
    Accounting: ["/accounting", "Open Accounting"],
    Treasury: ["/treasury", "Open Treasury"],
    Budget: ["/budget", "Open Budget Control"],
    Management: ["/approvals", "Review decisions"],
    Procurement: [AWAITING_PURCHASE_ORDER_PATH, "Review requests"]
  }[summary?.role];

  return (
    <section>
      <PageHeader title={`${summary?.role || ""} Dashboard`.trim()} description={descriptions[summary?.role] || descriptions.Admin} actions={<><span className="last-updated">{t("Last updated")}: {summary?.lastUpdated ? formatDateTime(summary.lastUpdated, language) : "-"}</span><button type="button" className="icon-button" onClick={load} disabled={loading} aria-label={t("Refresh")} title={t("Refresh")}><RefreshCw className={loading ? "spin" : ""} size={16} /></button></>} />
      <Message type="error">{error}</Message>

      {loading && !summary && (
        <div className="dashboard-loading" role="status" aria-label={t("Loading dashboard...")}>
          <div className="stats-grid">{Array.from({ length: 5 }).map((_, index) => <div className="stat-card" key={index}><span className="skeleton skeleton-line" /><span className="skeleton skeleton-value" /></div>)}</div>
          <div className="workspace-panel"><span className="skeleton skeleton-block" /></div>
        </div>
      )}

      {summary && (
        <>
          {/* The role's to-do list replaces the generic welcome banner; its tasks also cover the
              former "Items need attention" warnings (missing exchange-rate dates). */}
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
                <div><h3>{t(isApprovalRole(summary.role) ? "Oldest requests awaiting decision" : summary.role === "Treasury" ? "Next payable requests" : "Recent requests")}</h3><p>{t("Current operational work in priority order.")}</p></div>
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

            {summary.budget ? (
              <AnalyticsChart
                title="Budget execution"
                description="Assigned, committed, executed, paid, and available for the current period."
                data={[{ name: new Date().toISOString().slice(0, 7), ...summary.budget.totals }]}
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

            {["Admin", "AreaDirector", "ViceRector", "Accounting", "Treasury", "Budget", "Management"].includes(summary.role) && <Link className="text-link dashboard-reports-link" to="/reports">{t("More insights in Reports")}</Link>}

          </div>
        </>
      )}
    </section>
  );
}
