import { Download, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client.js";
import AnalyticsChart from "../components/AnalyticsChart.jsx";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import ProtectedAssetButton from "../components/ProtectedAssetButton.jsx";
import ReportFilters from "../components/ReportFilters.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import usePaginatedResource from "../hooks/usePaginatedResource.js";
import { formatCurrency, formatDateTime, formatNumber } from "../utils/formatters.js";

const emptyFilters = Object.freeze({ period: "", dateFrom: "", dateTo: "", currency: "", requestType: "", area: "", costCenter: "", project: "" });
const emptyData = Object.freeze({
  byType: [], byMonth: [], byYear: [], byArea: [], byProject: [], byCostCenter: [], byAccount: [], payable: [], payableAgeing: [], paymentComparison: [], treasurySchedule: [], approvalTiming: [], approvalSla: [], observed: [], accounting: [], bankFiles: [], commitments: [], commitmentAnalysis: [], budgetExceptionAnalysis: [], supplierConcentration: [], renditionAnalysis: [], statusFunnel: [], reconciliationStatus: [], budget: {}, budgetAllocations: [], budgetWarnings: [], comparison: {}, periodClose: { blockers: {} }, filterOptions: { areas: [], projects: [], costCenters: [] }, overdueApprovals: 0, overduePayables: 0
});

const lifecycleOrder = ["BORRADOR", "EN_VALIDACION", "ENVIADO", "PENDIENTE_APROBACION", "APROBADO_DIRECTOR", "APROBADO_VICERRECTOR", "COMPROMISO_PRESUPUESTAL", "CONTABILIZADO", "PROGRAMADO", "TXT_GENERADO", "PAGADO", "CONCILIADO", "RENDICION_PENDIENTE", "CERRADO", "OBSERVADO", "DEVUELTO", "RECHAZADO", "ANULADO"];

function requestPath(filters) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  return `/requests${params.size ? `?${params}` : ""}`;
}

export default function ManagementReports() {
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [draftFilters, setDraftFilters] = useState({ ...emptyFilters });
  const [filters, setFilters] = useState({ ...emptyFilters });
  const [activeSection, setActiveSection] = useState("overview");
  const [data, setData] = useState({ ...emptyData });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const exportTable = usePaginatedResource("/reports/management/exports", { persistKey: "management-report-history" });

  const cleanParams = (values) => Object.fromEntries(Object.entries(values).filter(([, value]) => value));

  async function load(nextFilters = filters) {
    setLoading(true);
    try {
      const response = await api.get("/reports/management", { params: cleanParams(nextFilters) });
      setData({ ...emptyData, ...response.data.data });
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(emptyFilters); }, []);

  const money = (value) => formatCurrency(value, "PEN", language);
  const amountSeries = [{ key: "total", label: "PEN amount", color: "#087c75" }];
  const countSeries = [{ key: "count", label: "Requests", color: "#17344c" }];
  const payableTotal = useMemo(() => data.payable.reduce((sum, item) => sum + Number(item.outstanding || 0), 0), [data.payable]);
  const comparisonChange = data.comparison?.changePercent;
  const comparisonTone = comparisonChange === null || comparisonChange === undefined ? "neutral" : comparisonChange > 0 ? "amber" : "green";
  const labelRows = (rows) => rows.map((row) => ({ ...row, name: row._id || t("Unassigned") }));
  const dimensionRows = (rows) => rows.map((row) => ({ ...row, name: row._id?.code ? `${row._id.code} - ${row._id.name || ""}` : row._id?.name || t("Unassigned") }));
  const supplierRows = data.supplierConcentration.map((row) => ({ ...row, name: row.name || row.identifier || t("Unassigned") }));
  const statusRows = data.statusFunnel.map((row) => ({ ...row, name: t(row._id) })).sort((left, right) => lifecycleOrder.indexOf(left._id) - lifecycleOrder.indexOf(right._id));
  const slaRows = data.approvalSla.map((row) => ({ ...row, name: t(row._id) }));
  const exceptionRows = data.budgetExceptionAnalysis.map((row) => ({ ...row, name: `${t(row._id?.status)} - ${t(row._id?.strategy)}` }));
  const closeBlockers = Object.entries(data.periodClose?.blockers || {}).map(([key, value]) => ({ key, value }));

  function applyFilters() {
    setFilters(draftFilters);
    load(draftFilters);
  }

  function clearFilters() {
    const cleared = { ...emptyFilters };
    setDraftFilters(cleared);
    setFilters(cleared);
    load(cleared);
  }

  async function exportReport() {
    setExporting(true);
    try {
      const response = await api.get("/reports/management/export", { params: cleanParams(filters), responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `management-report-${filters.period || "filtered"}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      notify("Management report generated.");
      exportTable.reload();
      await load();
    } catch (err) {
      setError(err.message);
      notify(err.message, "error");
    } finally {
      setExporting(false);
    }
  }

  const tabs = [
    { key: "overview", label: "Executive overview" },
    { key: "spend", label: "Spending analysis" },
    { key: "workflow", label: "Workflow and SLA" },
    { key: "finance", label: "Finance readiness" }
  ];

  return (
    <section>
      <PageHeader
        title="Management Reports"
        description="Interactive institutional analysis using current request, budget, Accounting, CXP, Treasury, rendition, and reconciliation data."
        actions={<>
          <span className="last-updated">{t("Last updated")}: {data.lastUpdated ? formatDateTime(data.lastUpdated, language) : "-"}</span>
          <button type="button" className="secondary-button" onClick={() => load()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button>
          <button type="button" className="primary-button" onClick={exportReport} disabled={loading || exporting}><Download size={16} /><span>{t(exporting ? "Exporting..." : "Export management CSV")}</span></button>
        </>}
      />
      <Message type="error">{error || exportTable.error}</Message>
      <ReportFilters values={draftFilters} options={data.filterOptions || emptyData.filterOptions} onChange={setDraftFilters} onApply={applyFilters} onClear={clearFilters} loading={loading} />

      <div className="stats-grid report-stats">
        <StatCard label="Assigned budget" value={money(data.budget.assigned)} tone="navy" />
        <StatCard label="Committed" value={money(data.budget.committed)} tone="amber" />
        <StatCard label="Executed" value={money(data.budget.executed)} tone="teal" />
        <StatCard label="Paid" value={money(data.budget.paid)} tone="neutral" />
        <StatCard label="Available" value={money(data.budget.available)} tone="green" />
        <StatCard label="Accounts payable" value={money(payableTotal)} tone={data.overduePayables ? "red" : "teal"} />
      </div>

      <div className={`comparison-strip tone-${comparisonTone}`}>
        {comparisonChange > 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
        <div><strong>{t("Previous-period comparison")}</strong><span>{money(data.comparison?.currentTotal)} {t("current")} / {money(data.comparison?.previousTotal)} {t("previous")}</span></div>
        <b>{comparisonChange === null || comparisonChange === undefined ? t("No baseline") : `${comparisonChange > 0 ? "+" : ""}${formatNumber(comparisonChange, language, { maximumFractionDigits: 1 })}%`}</b>
      </div>

      <div className="analytics-tabs" role="tablist" aria-label={t("Report sections")}>
        {tabs.map((item) => <button key={item.key} type="button" role="tab" aria-selected={activeSection === item.key} className={activeSection === item.key ? "active" : ""} onClick={() => setActiveSection(item.key)}>{t(item.label)}</button>)}
      </div>

      <div className="analytics-grid" role="tabpanel">
        {activeSection === "overview" && <>
          <AnalyticsChart title="Global budget execution" description="Assigned, committed, executed, paid, and available budget for the selected scope." data={[{ name: data.comparison?.currentPeriod || t("Selected scope"), ...data.budget }]} series={[{ key: "assigned", label: "Assigned", color: "#17344c" }, { key: "committed", label: "Committed", color: "#d18a00" }, { key: "executed", label: "Executed", color: "#087c75" }, { key: "paid", label: "Paid", color: "#2463a6" }, { key: "available", label: "Available", color: "#19733d" }]} valueFormatter={money} loading={loading} />
          <AnalyticsChart title="CAPEX versus OPEX" description="Controlled expenditure by request type." type="donut" data={labelRows(data.byType)} series={amountSeries} valueFormatter={money} loading={loading} onDrillDown={(row) => navigate(requestPath({ requestType: row._id, period: filters.period }))} />
          <AnalyticsChart title="Monthly spending trend" description="PEN-equivalent expenditure by accounting period." type="area" data={labelRows(data.byMonth)} series={amountSeries} valueFormatter={money} loading={loading} onDrillDown={(row) => navigate(requestPath({ period: row._id }))} />
          <AnalyticsChart title="Spending by area" description="Areas ranked by PEN-equivalent expenditure." data={labelRows(data.byArea)} horizontal series={amountSeries} valueFormatter={money} loading={loading} onDrillDown={(row) => navigate(requestPath({ area: row._id, period: filters.period }))} />
          {data.byYear.length > 1 && <AnalyticsChart title="Yearly spending trend" description="Year-over-year expenditure and volume." type="line" data={labelRows(data.byYear)} series={[amountSeries[0], { key: "count", label: "Requests", color: "#2463a6" }]} valueFormatter={(value, key) => key === "count" ? formatNumber(value, language) : money(value)} loading={loading} />}
        </>}

        {activeSection === "spend" && <>
          <AnalyticsChart title="Spending by Cost Center" description="Accounting-line allocation by Cost Center." data={dimensionRows(data.byCostCenter)} horizontal series={amountSeries} valueFormatter={money} loading={loading} onDrillDown={(row) => navigate(requestPath({ costCenter: row._id?.id, period: filters.period }))} />
          <AnalyticsChart title="Spending by project" description="Projects ranked by controlled expenditure." data={labelRows(data.byProject)} horizontal series={amountSeries} valueFormatter={money} loading={loading} onDrillDown={(row) => navigate(requestPath({ project: row._id, period: filters.period }))} />
          <AnalyticsChart title="Spending by account" description="Expense and ledger accounts from validated accounting lines." data={dimensionRows(data.byAccount)} horizontal series={amountSeries} valueFormatter={money} loading={loading} />
          <AnalyticsChart title="Supplier concentration" description="Top suppliers by PEN-equivalent institutional expenditure." data={supplierRows} horizontal series={amountSeries} valueFormatter={money} loading={loading} />
        </>}

        {activeSection === "workflow" && <>
          <AnalyticsChart title="Request lifecycle funnel" description="Requests at each controlled workflow status." data={statusRows} horizontal compact series={countSeries} valueFormatter={(value) => formatNumber(value, language)} loading={loading} onDrillDown={(row) => navigate(requestPath({ status: row._id, period: filters.period }))} />
          <AnalyticsChart title="Approval SLA compliance" description="Completed decisions inside and outside configured SLA." type="donut" data={slaRows} series={countSeries} valueFormatter={(value) => formatNumber(value, language)} loading={loading} />
          <AnalyticsChart title="Average approval time" description="Average completed approval hours by area." data={data.approvalTiming.map((row) => ({ ...row, name: row._id || t("Unassigned") }))} horizontal series={[{ key: "averageHours", label: "Average hours", color: "#2463a6" }]} valueFormatter={(value) => `${formatNumber(value, language, { maximumFractionDigits: 1 })} h`} loading={loading} />
          <AnalyticsChart title="Rendition pending" description="Outstanding advances requiring evidence or Accounting validation." data={data.renditionAnalysis.map((row) => ({ ...row, name: row._id || t("Unassigned") }))} horizontal series={[{ key: "outstanding", label: "Outstanding", color: "#d18a00" }]} valueFormatter={money} loading={loading} onDrillDown={() => navigate(requestPath({ status: "RENDICION_PENDIENTE" }))} />
          <AnalyticsChart title="Returned and observed work" description="Correction workload by requesting area." data={data.observed.map((row) => ({ ...row, name: row._id || t("Unassigned") }))} horizontal series={countSeries} valueFormatter={(value) => formatNumber(value, language)} loading={loading} />
        </>}

        {activeSection === "finance" && <>
          <AnalyticsChart title="Accounts Payable ageing" description="Outstanding PEN equivalent grouped by due-date ageing." data={labelRows(data.payableAgeing)} series={amountSeries} valueFormatter={money} loading={loading} />
          <AnalyticsChart title="Paid, overdue, and pending" description="CXP payment position for the selected scope." type="donut" data={labelRows(data.paymentComparison)} series={amountSeries} valueFormatter={money} loading={loading} />
          <AnalyticsChart title="Treasury payment schedule" description="Near-term PEN-equivalent cash requirement by due date." type="area" data={labelRows(data.treasurySchedule)} series={amountSeries} valueFormatter={money} loading={loading} />
          <AnalyticsChart title="Reconciliation status" description="Paid, reconciled, and closed requests." data={data.reconciliationStatus.map((row) => ({ ...row, name: t(row._id) }))} series={countSeries} valueFormatter={(value) => formatNumber(value, language)} loading={loading} />
          <AnalyticsChart title="Budget commitments" description="Independent commitment-state totals." data={data.commitmentAnalysis.map((row) => ({ ...row, name: t(row._id) }))} series={amountSeries} valueFormatter={money} loading={loading} />
          <AnalyticsChart title="Budget exceptions" description="Requested exception value by status and strategy." data={exceptionRows} horizontal series={[{ key: "requested", label: "Requested", color: "#b4232c" }]} valueFormatter={money} loading={loading} />
          <section className={`analytics-panel close-readiness${data.periodClose?.ready ? " is-ready" : " has-blockers"}`}>
            <header className="analytics-heading"><div><h3>{t("Period-close readiness")}</h3><p>{t("Backend control checks that must be resolved before accounting close.")}</p></div><StatusBadge status={data.periodClose?.status} /></header>
            <div className="readiness-summary"><strong>{data.periodClose?.ready ? t("Ready to close") : t("Not ready to close")}</strong><span>{data.periodClose?.period}</span></div>
            <dl className="readiness-list">{closeBlockers.map((item) => <div key={item.key}><dt>{t(item.key)}</dt><dd className={item.value ? "text-danger" : ""}>{formatNumber(item.value, language)}</dd></div>)}</dl>
          </section>
        </>}
      </div>

      <div className="workspace-panel section-spacer">
        <div className="section-heading"><div><h3>{t("Budget execution matrix")}</h3><p>{t("Exact assigned, committed, executed, paid, and available balances.")}</p></div></div>
        <DataTable tableId="management-budget-matrix" exportable rows={data.budgetAllocations || []} loading={loading} searchPlaceholder="Search cost center..." columns={[
          { key: "costCenter", label: "Cost center", getValue: (row) => row.costCenter?.code, render: (row) => <div className="primary-cell"><strong>{row.costCenter?.code || "-"}</strong><span>{row.costCenter?.name}</span></div> },
          { key: "period", label: "Period" },
          { key: "assignedAmount", label: "Assigned", align: "right", render: (row) => money(row.assignedAmount) },
          { key: "committedAmount", label: "Committed", align: "right", render: (row) => money(row.committedAmount) },
          { key: "executedAmount", label: "Executed", align: "right", render: (row) => money(row.executedAmount) },
          { key: "paidAmount", label: "Paid", align: "right", render: (row) => money(row.paidAmount) },
          { key: "availableAmount", label: "Available", align: "right", render: (row) => <strong>{money(row.availableAmount)}</strong> }
        ]} />
      </div>

      <div className="workspace-panel section-spacer">
        <div className="section-heading"><div><h3>{t("Report history")}</h3><p>{t("Previously generated management exports remain available.")}</p></div></div>
        <DataTable tableId="management-report-history" rows={exportTable.rows} loading={exportTable.loading} remote={exportTable.remote} columns={[
          { key: "fileName", label: "File", render: (row) => <ProtectedAssetButton resourcePath={row.url} fileName={row.fileName}>{row.fileName}</ProtectedAssetButton> },
          { key: "period", label: "Period", render: (row) => row.period || t("All periods") },
          { key: "rowCount", label: "Rows" },
          { key: "generatedBy", label: "Generated by", sortable: false, getValue: (row) => row.generatedBy?.name, render: (row) => row.generatedBy?.name || "-" },
          { key: "createdAt", label: "Generated", render: (row) => formatDateTime(row.createdAt, language) }
        ]} />
      </div>
    </section>
  );
}
