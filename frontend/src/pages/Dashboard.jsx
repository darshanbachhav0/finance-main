import { AlertTriangle, CalendarClock, CircleDollarSign, FileText, RefreshCw, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/client.js";
import AnalyticsChart from "../components/AnalyticsChart.jsx";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import ProtectedAssetButton from "../components/ProtectedAssetButton.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency, formatDateTime, formatNumber } from "../utils/formatters.js";

const descriptions = {
  Admin: "System activity, workflow health, users, and master-data readiness.",
  Solicitor: "Your drafts, approvals, rejected work, renditions, and recent requests.",
  Approver: "Approval workload, waiting value, oldest requests, and recent decisions.",
  Accounting: "Period readiness, accounting entries, exchange rates, and pending closures.",
  Treasury: "Payable workload, currency totals, bank readiness, and generated files.",
  Budget: "Assigned, available, committed, executed, and paid budget with low-balance controls.",
  Management: "Institutional CAPEX/OPEX, budget availability, spending, and pending commitments."
};

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
    { key: "requestNumber", label: "Request", render: (row) => <Link to={`/requests/${row._id}`}>{row.requestNumber}</Link> },
    { key: "supplier", label: "Supplier", getValue: (row) => row.supplier?.name, render: (row) => row.supplier?.name || "-" },
    { key: "totalAmount", label: "Amount", align: "right", render: (row) => formatCurrency(row.totalAmount, row.currency, language) },
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> }
  ];
  const operationalRows = summary?.oldestRequests || summary?.queue?.map((item) => item.request ? ({ ...item.request, supplier: item.supplier, totalAmount: item.outstandingAmount, currency: item.currency, status: item.status }) : item) || summary?.recentRequests || [];

  return (
    <section>
      <PageHeader title={`${summary?.role || ""} Dashboard`.trim()} description={descriptions[summary?.role] || descriptions.Admin} actions={<><span className="last-updated">{t("Last updated")}: {summary?.lastUpdated ? formatDateTime(summary.lastUpdated, language) : "-"}</span><button type="button" className="secondary-button" onClick={load} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button></>} />
      <Message type="error">{error}</Message>

      {loading && (
        <div className="dashboard-loading" aria-label={t("Loading dashboard...")}>
          <div className="stats-grid">{Array.from({ length: 5 }).map((_, index) => <div className="stat-card" key={index}><span className="skeleton skeleton-line" /><span className="skeleton skeleton-value" /></div>)}</div>
          <div className="workspace-panel"><span className="skeleton skeleton-block" /></div>
        </div>
      )}

      {!loading && summary && (
        <>
          <div className="stats-grid">
            {summary.metrics.map((metric) => (
              <StatCard key={metric.key} label={metric.label} value={metricValue(metric)} suffix={metric.suffix} tone={metric.tone} icon={metricIcons[metric.key] || FileText} />
            ))}
          </div>

          {summary.warnings?.length > 0 && (
            <div className="alert-strip" role="status">
              <AlertTriangle size={20} />
              <div>
                <strong>{t("Items need attention")}</strong>
                <div className="alert-links">
                  {summary.warnings.map((warning) => <Link key={warning.key} to={warning.path}>{t(warning.label)} <span>{warning.count}</span></Link>)}
                </div>
              </div>
            </div>
          )}

          <div className="dashboard-grid">
            <div className="workspace-panel dashboard-primary">
              <div className="section-heading">
                <div><h3>{t(summary.role === "Approver" ? "Oldest requests awaiting decision" : summary.role === "Treasury" ? "Next payable requests" : "Recent requests")}</h3><p>{t("Current operational work in priority order.")}</p></div>
                <Link className="text-link" to={summary.role === "Approver" ? "/approvals" : summary.role === "Treasury" ? "/treasury" : "/requests"}>{t("View all")}</Link>
              </div>
              <DataTable className="dashboard-request-table" controls={false} rows={operationalRows} columns={requestColumns} emptyDescription="No current requests." />
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

            {summary.recentDecisions && (
              <div className="workspace-panel dashboard-primary">
                <div className="section-heading"><div><h3>{t("Recent decisions")}</h3><p>{t("Requests you recently approved or rejected.")}</p></div></div>
                <DataTable className="dashboard-request-table" controls={false} rows={summary.recentDecisions} columns={requestColumns} />
              </div>
            )}

            {summary.periods && (
              <div className="workspace-panel dashboard-primary">
                <div className="section-heading"><div><h3>{t("Recent accounting periods")}</h3><p>{t("Open and closed period status.")}</p></div><Link className="text-link" to="/accounting/periods">{t("Manage periods")}</Link></div>
                <DataTable controls={false} rows={summary.periods} columns={[
                  { key: "period", label: "Period" },
                  { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
                  { key: "closingDate", label: "Closing date", render: (row) => row.closingDate ? new Date(row.closingDate).toLocaleDateString() : "-" },
                  { key: "closedBy", label: "Closed by", getValue: (row) => row.closedBy?.name, render: (row) => row.closedBy?.name || "-" }
                ]} />
              </div>
            )}

            {summary.recentFiles && (
              <div className="workspace-panel dashboard-primary">
                <div className="section-heading"><div><h3>{t("Recent generated files")}</h3><p>{t("Bank and accounting exports created by the team.")}</p></div></div>
                <DataTable controls={false} rows={summary.recentFiles} columns={[
                  { key: "fileName", label: "File", render: (row) => <ProtectedAssetButton resourcePath={row.url} fileName={row.fileName}>{row.fileName}</ProtectedAssetButton> },
                  { key: "kind", label: "Type" },
                  { key: "rowCount", label: "Rows" },
                  { key: "createdAt", label: "Generated", render: (row) => new Date(row.createdAt).toLocaleString() },
                  { key: "generatedBy", label: "Generated by", getValue: (row) => row.generatedBy?.name, render: (row) => row.generatedBy?.name || "-" }
                ]} />
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
