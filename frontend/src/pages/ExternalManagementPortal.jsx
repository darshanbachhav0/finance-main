import { RefreshCw, ShieldCheck, WalletCards, ClipboardCheck, CircleDollarSign, CalendarClock, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import api from "../api/client.js";
import AnalyticsChart from "../components/AnalyticsChart.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatCard from "../components/StatCard.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency, formatDateTime, formatNumber } from "../utils/formatters.js";

const empty = { overview: {}, budget: {}, workflow: {}, payments: {}, sla: {}, filters: { periods: [], areas: [] } };

function chartRows(rows = []) {
  return rows.map((row) => ({ ...row, name: row.key }));
}

export default function ExternalManagementPortal() {
  const { t, language } = useLanguage();
  const [data, setData] = useState(empty);
  const [filters, setFilters] = useState({ period: "", area: "", dateFrom: "", dateTo: "" });
  const [applied, setApplied] = useState(filters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [asOf, setAsOf] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = Object.fromEntries(Object.entries(applied).filter(([, value]) => value));
      const sections = ["overview", "budget", "workflow", "payments", "sla", "filters"];
      const responses = await Promise.all(sections.map((section) => api.get(`/management/v1/${section}`, { params: section === "filters" ? {} : params, timeout: 15000 })));
      setData(Object.fromEntries(sections.map((section, index) => [section, responses[index].data.data])));
      setAsOf(responses[0].data.asOf);
    } catch (err) {
      setError(err.message || "The management snapshot could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [applied]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") load(); };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [load]);

  const overview = data.overview || {};
  const budget = data.budget?.totals || overview.budget || {};
  const money = (value) => formatCurrency(value, "PEN", language, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const counts = [{ key: "count", label: "Requests", color: "#c91545" }];
  const amounts = [{ key: "amountPEN", label: "Amount", color: "#2463a6" }];

  return (
    <section className="management-portal">
      <PageHeader title="Management Portal" description="A secure, read-only view of institutional financial performance. Data refreshes automatically and contains aggregates only." actions={<button className="secondary-button" type="button" onClick={load} disabled={loading}><RefreshCw size={16} />{t("Refresh")}</button>} />
      <div className="management-trust-strip"><ShieldCheck size={18} /><span>{t("Read-only management view")}</span><small>{asOf ? `${t("Updated")} ${formatDateTime(asOf, language)}` : t("Loading current snapshot...")}</small></div>
      <form className="report-filter-shell management-filter" onSubmit={(event) => { event.preventDefault(); setApplied(filters); }}>
        <div className="report-filter-grid">
          <label className="field"><span>{t("Period")}</span><select value={filters.period} onChange={(event) => setFilters((current) => ({ ...current, period: event.target.value }))}><option value="">{t("All periods")}</option>{data.filters?.periods?.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="field"><span>{t("Area")}</span><select value={filters.area} onChange={(event) => setFilters((current) => ({ ...current, area: event.target.value }))}><option value="">{t("All areas")}</option>{data.filters?.areas?.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="field"><span>{t("From")}</span><input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} /></label>
          <label className="field"><span>{t("To")}</span><input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} /></label>
        </div>
        <div className="management-filter-actions"><button className="primary-button" type="submit">{t("Apply filters")}</button><button className="text-button" type="button" onClick={() => { const reset = { period: "", area: "", dateFrom: "", dateTo: "" }; setFilters(reset); setApplied(reset); }}>{t("Clear")}</button></div>
      </form>
      <Message type="error">{error}</Message>
      <div className="stats-grid management-kpis" aria-busy={loading}>
        <StatCard label="Pending requests" value={formatNumber(overview.pendingRequests, language)} tone="neutral" icon={ClipboardCheck} />
        <StatCard label="Pending approvals" value={formatNumber(overview.pendingApprovals, language)} tone="amber" icon={CalendarClock} />
        <StatCard label="Committed budget" value={money(budget.committedPEN)} tone="teal" icon={WalletCards} />
        <StatCard label="Pending payments" value={money(overview.pendingPaymentAmountPEN)} tone="amber" icon={CircleDollarSign} />
        <StatCard label="Paid this month" value={money(overview.paidThisMonth?.amountPEN)} tone="green" icon={CircleDollarSign} />
        <StatCard label="Overdue approvals" value={formatNumber(overview.overdueApprovals, language)} tone="red" icon={TriangleAlert} />
      </div>
      <div className="analytics-grid management-charts">
        <AnalyticsChart title="Workflow position" description="Current request volume by controlled status." data={chartRows(data.workflow?.byStatus)} horizontal compact series={counts} valueFormatter={(value) => formatNumber(value, language)} loading={loading} />
        <AnalyticsChart title="Requests by track" description="Aggregate A1, A2, B and C workload." data={chartRows(data.workflow?.byFlow)} type="donut" series={counts} valueFormatter={(value) => formatNumber(value, language)} loading={loading} />
        <AnalyticsChart title="Budget position" description="Assigned, committed, executed, paid and available budget in PEN." data={[{ name: t("Current selection"), assigned: budget.assignedPEN, committed: budget.committedPEN, executed: budget.executedPEN, paid: budget.paidPEN, available: budget.availablePEN }]} series={[{ key: "committed", label: "Committed" }, { key: "executed", label: "Executed" }, { key: "paid", label: "Paid" }, { key: "available", label: "Available" }]} valueFormatter={money} loading={loading} />
        <AnalyticsChart title="Payment position" description="Payables by current Treasury state." data={chartRows(data.payments?.byStatus)} horizontal series={amounts} valueFormatter={money} loading={loading} />
        <AnalyticsChart title="Institutional workload" description="Aggregate request value by organizational area." data={chartRows(data.workflow?.byArea)} horizontal series={amounts} valueFormatter={money} loading={loading} />
        <AnalyticsChart title="Approval SLA" description="Current approval queues by SLA condition." data={chartRows(data.sla?.current)} type="donut" series={counts} valueFormatter={(value) => formatNumber(value, language)} loading={loading} />
      </div>
      <p className="management-privacy-note">{t("This portal contains summarized institutional data. Transaction records, personal data, supplier identifiers, bank details, documents, and audit actors are not exposed.")}</p>
    </section>
  );
}
