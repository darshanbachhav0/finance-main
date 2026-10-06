import { MonthInput } from "../components/DateInput.jsx";
import { AlertTriangle, CheckCircle2, Download, Search } from "lucide-react";
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
import { formatCurrency, formatDateTime } from "../utils/formatters.js";

const EMPTY_SUMMARY = { reviewed: 0, eligible: 0, excluded: 0, blockingErrors: 0, cancelledExcluded: 0, warningCount: 0, configurationErrors: [], readyToExport: false, fileName: null, directSubmission: false, providerMode: "EXPORT_ONLY" };
const TXT_PREVIEW_LINES = 20;

function downloadText(fileName, content) {
  // SUNAT's TXT is written as-is (UTF-8, CRLF): no BOM and no transformation in the browser.
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export default function SireExport() {
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [records, setRecords] = useState([]);
  const [issues, setIssues] = useState([]);
  const [txtLines, setTxtLines] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [previewedPeriod, setPreviewedPeriod] = useState("");
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
      const validations = response.data.validations || [];
      setRecords(validations.map((item) => ({ ...item.row, eligible: item.eligible, excluded: item.excluded, excludedReason: item.excludedReason, errors: item.errors || [], warnings: item.warnings || [] })));
      setSummary({ ...EMPTY_SUMMARY, ...(response.data.summary || {}) });
      setTxtLines(validations.filter((item) => item.eligible && item.line).map((item) => item.line));
      setIssues(validations.flatMap((item) => {
        const voucher = `${item.row?.documentType || "-"} ${item.row?.series || "-"}-${item.row?.number || "-"}`;
        const reference = item.requestNumber || item.row?.cxpReference;
        const severity = item.excluded ? "EXCLUDED" : "ERROR";
        return [
          ...(item.errors || []).map((message) => ({ reference, voucher, severity, message })),
          ...(item.warnings || []).map((message) => ({ reference, voucher, severity: "WARNING", message }))
        ];
      }));
      setPreviewedPeriod(period);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function exportTxt() {
    setExporting(true);
    setError("");
    try {
      const response = await api.get("/sire/export", { params: { period, format: "txt", delivery: "json" } });
      downloadText(response.data.fileName, response.data.content);
      notify(t("SUNAT RCE TXT generated and added to report history."));
      await preview();
      historyTable.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  const configurationErrors = summary.configurationErrors || [];
  const canExport = summary.readyToExport && previewedPeriod === period;
  const blockingIssues = issues.filter((issue) => issue.severity === "ERROR");
  const otherIssues = issues.filter((issue) => issue.severity !== "ERROR");
  // PEN and USD vouchers are totalled separately: adding them together gives a meaningless number.
  const totalsByCurrency = records.filter((row) => row.eligible).reduce((sums, row) => {
    const currency = row.currency || "PEN";
    sums[currency] = (sums[currency] || 0) + Number(row.total || 0);
    return sums;
  }, {});
  const purchaseTotal = Object.keys(totalsByCurrency).length
    ? Object.entries(totalsByCurrency).map(([currency, amount]) => formatCurrency(amount, currency, language)).join(" · ")
    : formatCurrency(0, "PEN", language);
  let exportHint;
  if (previewedPeriod !== period) exportHint = t("Run preview and resolve errors before export.");
  else if (!summary.readyToExport) exportHint = t("Every voucher must pass validation before the SUNAT file can be generated.");

  return (
    <section>
      <PageHeader title="SIRE RCE Preparation" description="Validate the purchase register and generate the SUNAT RCE replacement TXT (Anexo 11). No direct SUNAT submission is performed." />
      <Message type="error">{error || historyTable.error}</Message>

      <div className="period-toolbar">
        <label className="field compact-period"><span>{t("Accounting period")}</span><MonthInput value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
        <button type="button" className="secondary-button" onClick={preview} disabled={loading}><Search size={16} /><span>{t(loading ? "Loading preview..." : "Validate preview")}</span></button>
        <button type="button" className="primary-button" onClick={exportTxt} disabled={exporting || loading || !canExport} title={exportHint}><Download size={16} /><span>{t(exporting ? "Exporting..." : "Download SUNAT TXT")}</span></button>
      </div>

      {previewedPeriod && (
        <div className="workspace-panel">
          <div className="section-heading"><div><h3>{t("Official SUNAT file")}</h3><p>{t("File name, structure and IGV columns used for this period.")}</p></div></div>
          <p><strong>{t("File name")}:</strong> <code>{summary.fileName || t("Not available until UMA's RUC is configured")}</code></p>
          <p><strong>{t("Structure")}:</strong> {summary.structureVersion || "-"} &middot; <strong>{t("IGV columns")}:</strong> {summary.igvDestination || "-"}</p>
          {canExport && <p><CheckCircle2 size={16} /> {t("All vouchers passed validation. The file is ready to download.")}</p>}
        </div>
      )}

      {configurationErrors.length > 0 && (
        <div className="validation-warning-list">
          <div><AlertTriangle size={19} /><strong>{t("SIRE configuration is incomplete")}</strong></div>
          {configurationErrors.map((message) => <p key={message}>{t(message)}</p>)}
        </div>
      )}

      <div className="stats-grid compact-stats">
        <StatCard label="Reviewed vouchers" value={summary.reviewed || 0} tone="neutral" />
        <StatCard label="Rows in SUNAT file" value={summary.eligible || 0} tone="success" />
        <StatCard label="Vouchers with errors" value={summary.blockingErrors || 0} tone={summary.blockingErrors ? "danger" : "success"} />
        <StatCard label="Excluded (cancelled or duplicate)" value={(summary.excluded || 0) - (summary.blockingErrors || 0)} tone="warning" />
        <StatCard label="Purchase total" value={purchaseTotal} tone="accent" />
      </div>

      {blockingIssues.length > 0 && (
        <div className="validation-warning-list">
          <div><AlertTriangle size={19} /><strong>{t("Fix these vouchers before generating the SUNAT file")}</strong></div>
          {blockingIssues.map((issue) => <p key={`${issue.reference}-${issue.voucher}-${issue.message}`}><span>{issue.reference} &middot; {issue.voucher}</span>{t(issue.message)}</p>)}
        </div>
      )}

      {otherIssues.length > 0 && (
        <details className="workspace-panel section-spacer"><summary>{t("Warnings and exclusions")} ({otherIssues.length})</summary>
          {otherIssues.map((issue) => <p key={`${issue.severity}-${issue.reference}-${issue.voucher}-${issue.message}`}><StatusBadge status={issue.severity} /> <span>{issue.reference} &middot; {issue.voucher}</span> {t(issue.message)}</p>)}
        </details>
      )}

      <div className="workspace-panel">
        <div className="section-heading"><div><h3>{t("SIRE voucher preview")}</h3><p>{t("Each row represents one fiscal voucher. Only individually validated vouchers are written to the SUNAT TXT; cancelled payables are excluded.")}</p></div><span className="section-count">{records.length}</span></div>
        <DataTable rows={records} rowKey="id" loading={loading} searchPlaceholder="Search supplier, RUC, voucher, request, or CXP..." filters={[
          { key: "currency", label: "currencies", allLabel: "All currencies", options: ["PEN", "USD"] },
          { key: "exportStatus", label: "export status", allLabel: "All export statuses", options: ["PENDING", "EXPORTED", "MANUAL_REVIEW", "EXCLUDED"] }
        ]} columns={[
          { key: "number", label: "Voucher", primary: true, render: (row) => `${row.documentType || "-"} ${row.series || "-"}-${row.number || "-"}` },
          { key: "documentTypeCode", label: "SUNAT type", render: (row) => row.documentTypeCode || "-" },
          { key: "supplierName", label: "Supplier", primary: true, render: (row) => <span><strong>{row.supplierName || "-"}</strong><br /><small>{row.supplierRuc || "RUC missing"}</small></span> },
          { key: "requestReference", label: "Request" },
          { key: "cxpReference", label: "CXP", render: (row) => row.cxpReference || "-" },
          { key: "fiscalPeriod", label: "Fiscal period" },
          { key: "invoiceDate", label: "Invoice date" },
          { key: "accountingDate", label: "Accounting date" },
          { key: "fiscalValidationStatus", label: "Fiscal validation", render: (row) => <StatusBadge status={row.fiscalValidationStatus} /> },
          { key: "exportStatus", label: "Export status", render: (row) => <StatusBadge status={row.exportStatus} /> },
          { key: "subtotal", label: "Subtotal", align: "right", render: (row) => row.subtotal == null ? "-" : formatCurrency(row.subtotal, row.currency, language) },
          { key: "igv", label: "IGV", align: "right", render: (row) => row.igv == null ? "-" : formatCurrency(row.igv, row.currency, language) },
          { key: "total", label: "Total", align: "right", render: (row) => row.total == null ? "-" : <strong>{formatCurrency(row.total, row.currency, language)}</strong> },
          { key: "currency", label: "Currency" },
          { key: "exchangeRate", label: "Exchange rate", align: "right", render: (row) => row.currency && row.currency !== "PEN" ? Number(row.exchangeRate || 0).toFixed(3) : "-" }
        ]} />
      </div>

      {txtLines.length > 0 && (
        <details className="workspace-panel section-spacer"><summary>{t("SUNAT TXT preview")} ({txtLines.length})</summary>
          <pre style={{ overflowX: "auto", fontSize: "0.75rem" }}>{txtLines.slice(0, TXT_PREVIEW_LINES).join("\n")}</pre>
          {txtLines.length > TXT_PREVIEW_LINES && <p>{t("Only the first 20 lines are shown.")}</p>}
        </details>
      )}

      <details className="workspace-panel section-spacer"><summary>{t("Export history")}</summary><div className="workspace-panel section-spacer">
        <div className="section-heading"><div><h3>{t("Report history")}</h3><p>{t("Previously generated SIRE reports remain available for download.")}</p></div></div>
        <DataTable rows={history} loading={historyTable.loading} remote={historyTable.remote} columns={[
          { key: "fileName", label: "File", render: (row) => <ProtectedAssetButton resourcePath={row.url} fileName={row.fileName}>{row.fileName}</ProtectedAssetButton> },
          { key: "period", label: "Period" },
          { key: "rowCount", label: "Rows" },
          { key: "format", label: "Format", getValue: (row) => row.metadata?.format, render: (row) => row.metadata?.format === "SUNAT_RCE_TXT" ? "TXT SUNAT" : "CSV" },
          { key: "metadata", label: "Warnings", getValue: (row) => row.metadata?.warningCount, render: (row) => row.metadata?.warningCount || 0 },
          { key: "generatedBy", label: "Generated by", getValue: (row) => row.generatedBy?.name, render: (row) => row.generatedBy?.name || "-" },
          { key: "createdAt", label: "Generated", render: (row) => formatDateTime(row.createdAt) },
          { key: "download", label: "", sortable: false, render: (row) => <ProtectedAssetButton className="icon-button" resourcePath={row.url} fileName={row.fileName} title="Download"><Download size={16} /></ProtectedAssetButton> }
        ]} />
      </div></details>
    </section>
  );
}
