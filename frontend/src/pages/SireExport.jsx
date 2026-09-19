import { AlertTriangle, Download, Search } from "lucide-react";
import { useState } from "react";
import api from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatCard from "../components/StatCard.jsx";
import ProtectedAssetButton from "../components/ProtectedAssetButton.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import usePaginatedResource from "../hooks/usePaginatedResource.js";

export default function SireExport() {
  const { t } = useLanguage();
  const { notify } = useToast();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [records, setRecords] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [summary, setSummary] = useState({ reviewed: 0, eligible: 0, excluded: 0, warningCount: 0, directSubmission: false, providerMode: "EXPORT_ONLY" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const historyTable = usePaginatedResource("/sire/exports");
  const history = historyTable.rows;

  async function preview() {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/sire/preview", { params: { period } });
      setRecords((response.data.validations || []).map((item) => ({ ...item.row, eligible: item.eligible, errors: item.errors || [], warnings: item.warnings || [] })));
      setSummary(response.data.summary || {});
      setWarnings((response.data.validations || []).flatMap((item) => [
        ...(item.errors || []).map((message) => ({ requestId: item.requestNumber || item.row?.cxpReference, severity: "ERROR", message })),
        ...(item.warnings || []).map((message) => ({ requestId: item.requestNumber || item.row?.cxpReference, severity: "WARNING", message }))
      ]));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    setError("");
    try {
      const response = await api.get("/sire/export", { params: { period, format: "csv" }, responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `sire-rce-${period}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      notify("SIRE CSV generated and added to report history.");
      await preview();
      historyTable.reload();
    } catch (err) {
      setError(err.message);
      notify(err.message, "error");
    } finally {
      setExporting(false);
    }
  }

  const total = records.filter((row) => row.eligible).reduce((sum, row) => sum + Number(row.total || 0), 0);
  return (
    <section>
      <PageHeader title="SIRE RCE Preparation" description="Validate eligible purchase-register rows and create a review CSV. No direct SUNAT submission is performed." />
      <Message type="error">{error || historyTable.error}</Message>

      <div className="period-toolbar">
        <label className="field compact-period"><span>{t("Accounting period")}</span><input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
        <button type="button" className="secondary-button" onClick={preview} disabled={loading}><Search size={16} /><span>{t(loading ? "Loading preview..." : "Validate preview")}</span></button>
        <button type="button" className="primary-button" onClick={exportCsv} disabled={exporting || loading || !summary.eligible} title={!summary.eligible ? t("Run preview and resolve errors before export.") : undefined}><Download size={16} /><span>{t(exporting ? "Exporting..." : "Export SIRE CSV")}</span></button>
      </div>

      <div className="stats-grid compact-stats">
        <StatCard label="Reviewed vouchers" value={summary.reviewed || 0} tone="navy" />
        <StatCard label="Eligible vouchers" value={summary.eligible || 0} tone="green" />
        <StatCard label="Excluded vouchers" value={summary.excluded || 0} tone={summary.excluded ? "red" : "green"} />
        <StatCard label="Manual review" value={summary.manualReview || 0} tone={summary.manualReview ? "amber" : "green"} />
        <StatCard label="Purchase total" value={total.toLocaleString(undefined, { minimumFractionDigits: 2 })} tone="teal" />
      </div>

      {warnings.length > 0 && (
        <div className="validation-warning-list">
          <div><AlertTriangle size={19} /><strong>{t("Resolve validation warnings before filing")}</strong></div>
          {warnings.map((warning) => <p key={`${warning.requestId}-${warning.message}`}><span>{warning.requestId}</span>{t(warning.message)}</p>)}
        </div>
      )}

      <div className="workspace-panel">
        <div className="section-heading"><div><h3>{t("SIRE voucher preview")}</h3><p>{t("Each row represents one fiscal voucher. Only individually validated vouchers are included in the CSV.")}</p></div><span className="section-count">{records.length}</span></div>
        <DataTable rows={records} rowKey="id" loading={loading} searchPlaceholder="Search supplier, RUC, voucher, request, or CXP..." filters={[
          { key: "currency", label: "currencies", allLabel: "All currencies", options: ["PEN", "USD"] },
          { key: "exportStatus", label: "export status", allLabel: "All export statuses", options: ["PENDING", "EXPORTED", "MANUAL_REVIEW"] }
        ]} columns={[
          { key: "number", label: "Voucher", primary: true, render: (row) => `${row.documentType || "-"} ${row.series || "-"}-${row.number || "-"}` },
          { key: "supplierName", label: "Supplier", primary: true, render: (row) => <span><strong>{row.supplierName || "-"}</strong><br /><small>{row.supplierRuc || "RUC missing"}</small></span> },
          { key: "requestReference", label: "Request" },
          { key: "cxpReference", label: "CXP", render: (row) => row.cxpReference || "-" },
          { key: "fiscalPeriod", label: "Fiscal period" },
          { key: "invoiceDate", label: "Invoice date" },
          { key: "accountingDate", label: "Accounting date" },
          { key: "fiscalValidationStatus", label: "Fiscal validation", render: (row) => <StatusBadge status={row.fiscalValidationStatus} /> },
          { key: "exportStatus", label: "Export status", render: (row) => <StatusBadge status={row.exportStatus} /> },
          { key: "subtotal", label: "Subtotal", align: "right", render: (row) => row.subtotal == null ? "-" : Number(row.subtotal).toFixed(2) },
          { key: "igv", label: "IGV", align: "right", render: (row) => row.igv == null ? "-" : Number(row.igv).toFixed(2) },
          { key: "total", label: "Total", align: "right", render: (row) => row.total == null ? "-" : <strong>{Number(row.total).toFixed(2)}</strong> },
          { key: "currency", label: "Currency" },
          { key: "exchangeRate", label: "Exchange rate", align: "right", render: (row) => row.currency === "USD" ? Number(row.exchangeRate || 0).toFixed(4) : "-" }
        ]} />
      </div>

      <details className="workspace-panel section-spacer"><summary>{t("Export history")}</summary><div className="workspace-panel section-spacer">
        <div className="section-heading"><div><h3>{t("Report history")}</h3><p>{t("Previously generated SIRE reports remain available for download.")}</p></div></div>
        <DataTable rows={history} loading={historyTable.loading} remote={historyTable.remote} columns={[
          { key: "fileName", label: "File", render: (row) => <ProtectedAssetButton resourcePath={row.url} fileName={row.fileName}>{row.fileName}</ProtectedAssetButton> },
          { key: "period", label: "Period" },
          { key: "rowCount", label: "Rows" },
          { key: "metadata", label: "Warnings", getValue: (row) => row.metadata?.warningCount, render: (row) => row.metadata?.warningCount || 0 },
          { key: "generatedBy", label: "Generated by", getValue: (row) => row.generatedBy?.name, render: (row) => row.generatedBy?.name || "-" },
          { key: "createdAt", label: "Generated", render: (row) => new Date(row.createdAt).toLocaleString() },
          { key: "download", label: "", sortable: false, render: (row) => <ProtectedAssetButton className="icon-button" resourcePath={row.url} fileName={row.fileName} title="Download"><Download size={16} /></ProtectedAssetButton> }
        ]} />
      </div></details>
    </section>
  );
}
