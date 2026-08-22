import { AlertTriangle, Download, Search } from "lucide-react";
import { useState } from "react";
import api from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatCard from "../components/StatCard.jsx";
import ProtectedAssetButton from "../components/ProtectedAssetButton.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import usePaginatedResource from "../hooks/usePaginatedResource.js";

export default function SireExport() {
  const { t } = useLanguage();
  const { notify } = useToast();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState([]);
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
      setRows(response.data.data);
      setSummary(response.data.summary || {});
      setWarnings((response.data.validations || []).flatMap((item) => [
        ...item.errors.map((message) => ({ requestId: item.requestNumber, severity: "ERROR", message })),
        ...item.warnings.map((message) => ({ requestId: item.requestNumber, severity: "WARNING", message }))
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
      historyTable.reload();
    } catch (err) {
      setError(err.message);
      notify(err.message, "error");
    } finally {
      setExporting(false);
    }
  }

  const total = rows.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0);
  return (
    <section>
      <PageHeader title="SIRE RCE Preparation" description="Validate eligible purchase-register rows and create a review CSV. No direct SUNAT submission is performed." />
      <Message type="error">{error || historyTable.error}</Message>

      <div className="period-toolbar">
        <label className="field compact-period"><span>{t("Accounting period")}</span><input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
        <button type="button" className="secondary-button" onClick={preview} disabled={loading}><Search size={16} /><span>{t(loading ? "Loading preview..." : "Validate preview")}</span></button>
        <button type="button" className="primary-button" onClick={exportCsv} disabled={exporting || loading || !rows.length} title={!rows.length ? t("Run preview and resolve errors before export.") : undefined}><Download size={16} /><span>{t(exporting ? "Exporting..." : "Export SIRE CSV")}</span></button>
      </div>

      <div className="stats-grid compact-stats">
        <StatCard label="Reviewed purchases" value={summary.reviewed || 0} tone="navy" />
        <StatCard label="Eligible purchases" value={summary.eligible || rows.length} tone="green" />
        <StatCard label="Excluded purchases" value={summary.excluded || 0} tone={summary.excluded ? "red" : "green"} />
        <StatCard label="Validation warnings" value={summary.warningCount || 0} tone={summary.warningCount ? "amber" : "green"} />
        <StatCard label="Purchase total" value={total.toLocaleString(undefined, { minimumFractionDigits: 2 })} tone="teal" />
      </div>

      {warnings.length > 0 && (
        <div className="validation-warning-list">
          <div><AlertTriangle size={19} /><strong>{t("Resolve validation warnings before filing")}</strong></div>
          {warnings.map((warning) => <p key={`${warning.requestId}-${warning.message}`}><span>{warning.requestId}</span>{t(warning.message)}</p>)}
        </div>
      )}

      <div className="workspace-panel">
        <div className="section-heading"><div><h3>{t("SIRE preview")}</h3><p>{t("Only approved requests with a successfully validated XML are included.")}</p></div><span className="section-count">{rows.length}</span></div>
        <DataTable rows={rows.map((row) => ({ ...row, id: row.requestNumber }))} rowKey="id" loading={loading} searchPlaceholder="Search supplier, RUC, invoice, or request..." filters={[{ key: "currency", label: "currencies", allLabel: "All currencies", options: ["PEN", "USD"] }]} columns={[
          { key: "supplierRucDni", label: "Supplier RUC/DNI" },
          { key: "supplierName", label: "Supplier" },
          { key: "number", label: "Invoice", render: (row) => `${row.voucherType} ${row.series}-${row.number}` },
          { key: "issueDate", label: "Issue date" },
          { key: "netAmount", label: "Net", align: "right", render: (row) => Number(row.netAmount || 0).toFixed(2) },
          { key: "igvAmount", label: "IGV", align: "right", render: (row) => Number(row.igvAmount || 0).toFixed(2) },
          { key: "totalAmount", label: "Total", align: "right", render: (row) => <strong>{Number(row.totalAmount || 0).toFixed(2)}</strong> },
          { key: "currency", label: "Currency" },
          { key: "requestNumber", label: "Request" }
        ]} />
      </div>

      <div className="workspace-panel section-spacer">
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
      </div>
    </section>
  );
}
