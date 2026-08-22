import { Download, Eye, FileCheck2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatCard from "../components/StatCard.jsx";
import Drawer from "../components/Drawer.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import ProtectedAssetButton from "../components/ProtectedAssetButton.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import usePaginatedResource from "../hooks/usePaginatedResource.js";

export default function AccountingEntries() {
  const { t } = useLanguage();
  const { notify } = useToast();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [preview, setPreview] = useState([]);
  const [previewSummary, setPreviewSummary] = useState({ transactionSourceTotal: 0, centralizationTotal: 0, difference: 0, balanced: true });
  const [actionError, setActionError] = useState("");
  const [auxiliaryLoading, setAuxiliaryLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [fiscalForm, setFiscalForm] = useState({ documentType: "FACTURA", series: "", number: "", documentDate: "", accountingDate: new Date().toISOString().slice(0, 10), fiscalPeriod: new Date().toISOString().slice(0, 7), dueDate: "", accountNumber: "", subaccountNumber: "", comments: "" });
  const entriesTable = usePaginatedResource("/accounting/entries", { fixedParams: { period } });
  const pendingTable = usePaginatedResource("/accounting/pending", { fixedParams: { period } });
  const historyTable = usePaginatedResource("/accounting/exports");
  const entries = entriesTable.rows;
  const pending = pendingTable.rows;
  const history = historyTable.rows;
  const loading = auxiliaryLoading || entriesTable.loading || pendingTable.loading || historyTable.loading;

  async function loadAuxiliary() {
    setAuxiliaryLoading(true);
    setActionError("");
    try {
      const previewResponse = await api.get("/accounting/consolidation", { params: { period } });
      setPreview(previewResponse.data.data);
      setPreviewSummary(previewResponse.data.summary || {});
    } catch (err) {
      setActionError(err.message);
    } finally {
      setAuxiliaryLoading(false);
    }
  }

  useEffect(() => { loadAuxiliary(); }, [period]);

  function load() {
    entriesTable.reload();
    pendingTable.reload();
    historyTable.reload();
    loadAuxiliary();
  }

  const totals = useMemo(() => ({
    debit: Number(entriesTable.payload.summary?.debit || 0),
    credit: Number(entriesTable.payload.summary?.credit || 0)
  }), [entriesTable.payload.summary]);
  const consolidated = useMemo(() => ({ requests: previewSummary.requestCount || 0, pen: previewSummary.centralizationTotal || 0 }), [previewSummary]);

  async function exportCsv() {
    setExporting(true);
    try {
      const response = await api.get("/accounting/consolidation/export", { params: { period, format: "csv" }, responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `consolidation-${period}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      notify("Consolidation CSV generated and added to export history.");
      historyTable.reload();
    } catch (err) {
      setActionError(err.message);
      notify(err.message, "error");
    } finally {
      setExporting(false);
    }
  }

  function openFiscalProcessing(request) {
    const documentDate = request.issueDate?.slice(0, 10) || "";
    setSelectedRequest(request);
    setFiscalForm({ documentType: "FACTURA", series: "", number: "", documentDate, accountingDate: new Date().toISOString().slice(0, 10), fiscalPeriod: request.accountingPeriod || period, dueDate: documentDate, accountNumber: request.lines?.[0]?.expenseType?.accountNumber || "", subaccountNumber: "", comments: "" });
  }

  async function processRequest(event) {
    event.preventDefault();
    setProcessing(true);
    try {
      await api.post(`/accounting/requests/${selectedRequest._id}/process`, fiscalForm);
      notify("Fiscal document validated and account payable created.");
      setSelectedRequest(null);
      load();
      window.dispatchEvent(new Event("erp:tasks-changed"));
    } catch (err) {
      setActionError(err.message);
      notify(err.message, "error");
    } finally { setProcessing(false); }
  }

  return (
    <section>
      <PageHeader title="Accounting Entries" description="Process fiscal documents, post balanced journals, reconcile the month, and retain export history." actions={<><Link className="secondary-button" to="/accounting/payables">{t("Accounts Payable")}</Link><Link className="secondary-button" to="/accounting/periods">{t("Manage periods")}</Link></>} />
      <Message type="error">{actionError || entriesTable.error || pendingTable.error || historyTable.error}</Message>

      <div className="period-toolbar">
        <label className="field compact-period"><span>{t("Accounting period")}</span><input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
        <button type="button" className="secondary-button" onClick={load} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Load period")}</span></button>
        <button type="button" className="primary-button" onClick={exportCsv} disabled={exporting || loading || Number(previewSummary.difference || 0) !== 0 || !previewSummary.balanced} title={Number(previewSummary.difference || 0) !== 0 || !previewSummary.balanced ? t("Export is blocked until the reconciliation difference is zero and journals balance.") : undefined}><Download size={16} /><span>{t(exporting ? "Exporting..." : "Export consolidation CSV")}</span></button>
      </div>

      <div className="stats-grid">
        <StatCard label="Pending fiscal processing" value={pendingTable.pagination.total} tone="amber" />
        <StatCard label="Entries" value={entriesTable.payload.summary?.journalCount || 0} tone="navy" />
        <StatCard label="Debit total" value={`PEN ${totals.debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} tone="teal" />
        <StatCard label="Credit total" value={`PEN ${totals.credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} tone="neutral" />
        <StatCard label="Consolidated PEN" value={`PEN ${consolidated.pen.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} tone="green" />
        <StatCard label="Reconciliation difference" value={`PEN ${Number(previewSummary.difference || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} tone={Number(previewSummary.difference || 0) === 0 && previewSummary.balanced ? "green" : "red"} />
      </div>

      <div className="workspace-panel">
        <div className="section-heading"><div><h3>{t("CXP processing queue")}</h3><p>{t("Budget-committed requests waiting for fiscal validation and preliminary accounting.")}</p></div><span className="section-count">{pendingTable.pagination.total}</span></div>
        <DataTable rows={pending} loading={pendingTable.loading} remote={pendingTable.remote} searchPlaceholder="Search request, supplier, or document..." rowActions={(row) => [{ label: "Review fiscal data", icon: Eye, onClick: () => openFiscalProcessing(row) }]} columns={[
          { key: "requestNumber", label: "Request", render: (row) => <Link to={`/requests/${row._id}`}>{row.requestNumber}</Link> },
          { key: "supplier", label: "Supplier", sortable: false, getValue: (row) => row.supplier?.name, render: (row) => <div className="primary-cell"><strong>{row.supplier?.name}</strong><span>{row.supplier?.rucDni}</span></div> },
          { key: "requestType", label: "Type" },
          { key: "expenseNature", label: "Expense nature" },
          { key: "accountingPeriod", label: "Period" },
          { key: "status", label: "Status", sortable: false, render: (row) => <StatusBadge status={row.status} /> },
          { key: "totalPENEquivalent", label: "PEN equivalent", align: "right", render: (row) => <strong>PEN {Number(row.totalPENEquivalent ?? row.penEquivalent ?? 0).toFixed(2)}</strong> }
        ]} />
      </div>

      <div className="workspace-panel section-spacer">
        <div className="section-heading"><div><h3>{t("Accounting entries")}</h3><p>{t("Provision, payment, and rendition entries created by the workflow.")}</p></div></div>
        <DataTable
          rows={entries}
          loading={entriesTable.loading}
          remote={entriesTable.remote}
          filters={[{ key: "type", label: "entry types", allLabel: "All entry types", options: ["PROVISION", "ADVANCE", "PAYMENT", "RENDITION"] }]}
          searchPlaceholder="Search entry, request, account, or description..."
          columns={[
            { key: "entryNumber", label: "Entry" },
            { key: "type", label: "Entry type", render: (row) => <span className={`entry-type entry-${row.type.toLowerCase()}`}>{t(row.type)}</span> },
            { key: "request", label: "Request", sortable: false, getValue: (row) => row.request?.requestNumber, render: (row) => row.request ? <Link to={`/requests/${row.request._id}`}>{row.request.requestNumber}</Link> : "-" },
            { key: "accountNumber", label: "Account" },
            { key: "costCenter", label: "Cost center", sortable: false, getValue: (row) => row.costCenter?.code, render: (row) => row.costCenter?.code || "-" },
            { key: "description", label: "Description" },
            { key: "debit", label: "Debit", align: "right", render: (row) => Number(row.debit || 0).toFixed(2) },
            { key: "credit", label: "Credit", align: "right", render: (row) => Number(row.credit || 0).toFixed(2) },
            { key: "createdAt", label: "Created", render: (row) => new Date(row.createdAt).toLocaleString() }
          ]}
        />
      </div>

      <div className="workspace-panel section-spacer">
        <div className="section-heading"><div><h3>{t("Consolidation summary")}</h3><p>{t("Period totals grouped by cost center, expense account, and currency.")}</p></div><span className="section-count">{preview.length}</span></div>
        <DataTable rows={preview.map((row, index) => ({ ...row, id: `${row.costCenterCode}-${row.expenseAccount}-${row.currency}-${index}` }))} rowKey="id" loading={loading} filters={[{ key: "currency", label: "currencies", allLabel: "All currencies", options: ["PEN", "USD"] }]} columns={[
          { key: "costCenterCode", label: "CeCo", render: (row) => <div className="primary-cell"><strong>{row.costCenterCode}</strong><span>{row.costCenterName}</span></div> },
          { key: "expenseAccount", label: "Account", render: (row) => <div className="primary-cell"><strong>{row.expenseAccount}</strong><span>{row.expenseTypeName}</span></div> },
          { key: "currency", label: "Currency" },
          { key: "netAmount", label: "Net", align: "right", render: (row) => Number(row.netAmount || 0).toFixed(2) },
          { key: "igvAmount", label: "IGV", align: "right", render: (row) => Number(row.igvAmount || 0).toFixed(2) },
          { key: "totalAmount", label: "Total", align: "right", render: (row) => <strong>{Number(row.totalAmount || 0).toFixed(2)}</strong> },
          { key: "penEquivalent", label: "PEN equivalent", align: "right", render: (row) => Number(row.penEquivalent || 0).toFixed(2) },
          { key: "debit", label: "Debit", align: "right", render: (row) => Number(row.debit || 0).toFixed(2) },
          { key: "credit", label: "Credit", align: "right", render: (row) => Number(row.credit || 0).toFixed(2) },
          { key: "requestCount", label: "Requests" }
        ]} />
      </div>

      <div className="workspace-panel section-spacer">
        <div className="section-heading"><div><h3>{t("Export history")}</h3><p>{t("Previously generated consolidation reports remain available for download.")}</p></div></div>
        <DataTable rows={history} loading={historyTable.loading} remote={historyTable.remote} columns={[
          { key: "fileName", label: "File", render: (row) => <ProtectedAssetButton resourcePath={row.url} fileName={row.fileName}>{row.fileName}</ProtectedAssetButton> },
          { key: "period", label: "Period" },
          { key: "rowCount", label: "Rows" },
          { key: "generatedBy", label: "Generated by", getValue: (row) => row.generatedBy?.name, render: (row) => row.generatedBy?.name || "-" },
          { key: "createdAt", label: "Generated", render: (row) => new Date(row.createdAt).toLocaleString() },
          { key: "download", label: "", sortable: false, render: (row) => <ProtectedAssetButton className="icon-button" resourcePath={row.url} fileName={row.fileName} title="Download"><Download size={16} /></ProtectedAssetButton> }
        ]} />
      </div>

      <Drawer open={Boolean(selectedRequest)} title="Process account payable" description={selectedRequest ? `${selectedRequest.requestNumber} · ${selectedRequest.supplier?.name}` : ""} onClose={() => !processing && setSelectedRequest(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setSelectedRequest(null)}>{t("Cancel")}</button><button type="submit" form="fiscal-processing-form" className="primary-button" disabled={processing}><FileCheck2 size={16} /><span>{t(processing ? "Processing..." : "Validate and create CXP")}</span></button></>}>
        <div className="document-requirement required"><FileCheck2 size={20} /><div><strong>{t("Fiscal duplicate control")}</strong><p>{t("The system blocks repeated RUC + document type + series + number combinations.")}</p></div></div>
        <form id="fiscal-processing-form" className="form-grid two-column-form" onSubmit={processRequest}>
          <label className="field"><span>{t("Document type")} *</span><select value={fiscalForm.documentType} onChange={(event) => setFiscalForm({ ...fiscalForm, documentType: event.target.value })}><option>FACTURA</option><option>BOLETA</option><option>RXH</option><option>NOTA_CREDITO</option></select></label>
          <label className="field"><span>{t("Series")} *</span><input required value={fiscalForm.series} onChange={(event) => setFiscalForm({ ...fiscalForm, series: event.target.value.toUpperCase() })} /></label>
          <label className="field"><span>{t("Document number")} *</span><input required value={fiscalForm.number} onChange={(event) => setFiscalForm({ ...fiscalForm, number: event.target.value })} /></label>
          <label className="field"><span>{t("Document date")} *</span><input required type="date" value={fiscalForm.documentDate} onChange={(event) => setFiscalForm({ ...fiscalForm, documentDate: event.target.value })} /></label>
          <label className="field"><span>{t("Accounting date")} *</span><input required type="date" value={fiscalForm.accountingDate} onChange={(event) => setFiscalForm({ ...fiscalForm, accountingDate: event.target.value })} /></label>
          <label className="field"><span>{t("Fiscal period")} *</span><input required type="month" value={fiscalForm.fiscalPeriod} onChange={(event) => setFiscalForm({ ...fiscalForm, fiscalPeriod: event.target.value })} /></label>
          <label className="field"><span>{t("Due date")}</span><input type="date" value={fiscalForm.dueDate} onChange={(event) => setFiscalForm({ ...fiscalForm, dueDate: event.target.value })} /></label>
          <label className="field"><span>{t("Account number")} *</span><input required value={fiscalForm.accountNumber} onChange={(event) => setFiscalForm({ ...fiscalForm, accountNumber: event.target.value })} /><small className="field-hint">{t("The posting account is still validated against the configured mapping.")}</small></label>
          <label className="field"><span>{t("Subaccount")}</span><input value={fiscalForm.subaccountNumber} onChange={(event) => setFiscalForm({ ...fiscalForm, subaccountNumber: event.target.value })} /></label>
          <label className="field form-span-two"><span>{t("Accounting comments")}</span><textarea rows="3" value={fiscalForm.comments} onChange={(event) => setFiscalForm({ ...fiscalForm, comments: event.target.value })} /></label>
        </form>
      </Drawer>
    </section>
  );
}
