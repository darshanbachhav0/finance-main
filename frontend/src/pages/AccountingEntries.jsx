import InvoiceXmlPreview from "../components/InvoiceXmlPreview.jsx";
import DateInput, { MonthInput } from "../components/DateInput.jsx";
import WorkspaceTools from "../components/WorkspaceTools.jsx";
import useWorkDraft, { useDraftResume, resumeDraftRecord } from "../hooks/useWorkDraft.js";
import DraftPanel from "../components/DraftPanel.jsx";
import { Download, Eye, FileCheck2, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
import { formatCurrency, formatDateTime } from "../utils/formatters.js";
import { SPOT_CATEGORY_OPTIONS, suggestedSpotCategoryCode } from "../../../shared/spotCategories.mjs";

const NON_CREDITABLE_DOCUMENTS = ["BOLETA"];
// The account category a request type books to (mirrors accountingDimensionService).
const accountCategory = (requestType) => requestType === "CAPEX" ? "CAPEX" : requestType === "REEMBOLSO_SIN_SUSTENTO" ? "NON_DEDUCTIBLE" : "OPEX";
const accountsFor = (accounts, requestType) => accounts.filter((item) => item.active !== false && item.category === accountCategory(requestType) && (!item.permittedRequestTypes?.length || item.permittedRequestTypes.includes(requestType)));

export default function AccountingEntries() {
  // ?view=sunat-exceptions opens the manual SUNAT exception queue (linked from notifications).
  const [searchParams] = useSearchParams();
  const [focusView, setFocusView] = useState(searchParams.get("view") === "sunat-exceptions" ? "SUNAT exceptions" : "Processing");
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [preview, setPreview] = useState([]);
  const [previewSummary, setPreviewSummary] = useState({ transactionSourceTotal: 0, centralizationTotal: 0, difference: 0, balanced: true });
  const [actionError, setActionError] = useState("");
  const [auxiliaryLoading, setAuxiliaryLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [fiscalForm, setFiscalForm] = useState({ documentType: "FACTURA", series: "", number: "", documentDate: "", accountingDate: new Date().toISOString().slice(0, 10), fiscalPeriod: new Date().toISOString().slice(0, 7), dueDate: "", accountingAccount: "", igvDeductible: true, spotCategoryCode: "", subaccountNumber: "", comments: "" });
  const [accountingAccounts, setAccountingAccounts] = useState([]);
  const entriesTable = usePaginatedResource("/accounting/entries", { fixedParams: { period } });
  const pendingTable = usePaginatedResource("/accounting/pending", { fixedParams: { period } });
  const historyTable = usePaginatedResource("/accounting/exports");
  const sunatTable = usePaginatedResource("/accounting/sunat-observations");
  const [exceptionTarget, setExceptionTarget] = useState(null);
  const [exceptionForm, setExceptionForm] = useState({ reason: "", evidenceReference: "" });
  const [exceptionSaving, setExceptionSaving] = useState(false);

  function openException(row) { setExceptionForm({ reason: "", evidenceReference: "" }); setExceptionTarget(row); }

  async function approveException(event) {
    event.preventDefault();
    if (!exceptionForm.reason.trim()) return;
    setExceptionSaving(true);
    try {
      const requestId = exceptionTarget.request?._id || exceptionTarget.request;
      const response = await api.post(`/requests/${requestId}/invoice/${exceptionTarget._id}/manual-sunat-override`, { reason: exceptionForm.reason.trim(), evidenceReference: exceptionForm.evidenceReference.trim() });
      notify(response.data.provisioned ? "Manual SUNAT exception approved. The invoice was posted and its CXP created." : response.data.detail ? `${t("Manual SUNAT exception approved. The invoice could not be posted yet:")} ${response.data.detail}` : "Manual SUNAT exception approved. Process the request again to post the invoice.", response.data.provisioned || !response.data.detail ? "success" : "warning");
      setExceptionTarget(null);
      load();
      sunatTable.reload();
    } catch (err) { setActionError(err.message); notify(err.message, "error"); }
    finally { setExceptionSaving(false); }
  }
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

  const draft = useWorkDraft({ scope: "fiscal", recordId: selectedRequest?._id || "new", title: "Fiscal processing", enabled: Boolean(selectedRequest), value: fiscalForm, restore: setFiscalForm, sourceVersion: selectedRequest?.updatedAt });
  useDraftResume("fiscal", async id => { try { const response = await api.get(`/requests/${id}`); openFiscalProcessing(response.data.data); } catch (err) { setActionError(err.message); } });

  useEffect(() => {
    api.get("/expense-types", { params: { pageSize: 100, active: true } })
      .then((response) => setAccountingAccounts(response.data.data || []))
      .catch((err) => setActionError(err.message));
  }, []);

  // The platform suggests the account (from the request type and expense nature) and the SPOT
  // category (from the expense nature); Accounting confirms or changes both here.
  function openFiscalProcessing(request) {
    const documentDate = request.issueDate?.slice(0, 10) || "";
    const suggestedAccount = request.lines?.[0]?.expenseType?._id || request.lines?.[0]?.expenseType || "";
    setSelectedRequest(request);
    setFiscalForm({ documentType: "FACTURA", series: "", number: "", documentDate, accountingDate: new Date().toISOString().slice(0, 10), fiscalPeriod: documentDate.slice(0, 7) || period, dueDate: "", accountingAccount: String(suggestedAccount), igvDeductible: true, spotCategoryCode: suggestedSpotCategoryCode(request.expenseNature), subaccountNumber: "", comments: "" });
  }

  const creditableDocument = !NON_CREDITABLE_DOCUMENTS.includes(fiscalForm.documentType);
  const accountOptions = useMemo(() => selectedRequest ? accountsFor(accountingAccounts, selectedRequest.requestType) : [], [accountingAccounts, selectedRequest]);

  async function processRequest(event) {
    event.preventDefault(); if (!draft.ready || draft.status === "conflict") return;
    event.preventDefault();
    setProcessing(true);
    try {
      const { igvDeductible, ...fiscal } = fiscalForm;
      await api.post(`/accounting/requests/${selectedRequest._id}/process`, {
        ...fiscal,
        fiscalPeriod: fiscalForm.documentDate?.slice(0, 7) || fiscalForm.fiscalPeriod,
        // Boletas never give tax credit; the override only applies to creditable documents.
        ...(creditableDocument ? { igvDeductible } : {})
      });
      await draft.complete();
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
      <WorkspaceTools links={[["Accounting Periods", "/accounting/periods"], ["Accounting Mappings", "/configuration/accounting-mappings"], ["Reimbursement Banking", "/reimbursement-bank"], ["Suppliers", "/suppliers"], ["Cost Centers", "/cost-centers"], ["Accounting Accounts", "/expense-types"], ["Exchange Rates", "/exchange-rates"], ["Management Reports", "/reports"]]} />
      <Message type="error">{actionError || entriesTable.error || pendingTable.error || historyTable.error}</Message>

      <div className="period-toolbar">
        <label className="field compact-period"><span>{t("Accounting period")}</span><MonthInput value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
        <button type="button" className="secondary-button" onClick={load} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Load period")}</span></button>
        <button type="button" className="primary-button" onClick={exportCsv} disabled={exporting || loading || Number(previewSummary.difference || 0) !== 0 || !previewSummary.balanced} title={Number(previewSummary.difference || 0) !== 0 || !previewSummary.balanced ? t("Export is blocked until the reconciliation difference is zero and journals balance.") : undefined}><Download size={16} /><span>{t(exporting ? "Exporting..." : "Export consolidation CSV")}</span></button>
      </div>

      <div className="stats-grid">
        <StatCard label="Pending fiscal processing" value={pendingTable.pagination.total} tone="amber" />
        <StatCard label="Entries" value={entriesTable.payload.summary?.journalCount || 0} tone="navy" />
        <StatCard label="Consolidated PEN" value={formatCurrency(consolidated.pen, "PEN", language)} tone="green" />
        <StatCard label="Reconciliation difference" value={formatCurrency(previewSummary.difference || 0, "PEN", language)} tone={Number(previewSummary.difference || 0) === 0 && previewSummary.balanced ? "green" : "red"} />
      </div>

      <nav className="focus-tabs" aria-label={t("Sections")}>{["Processing", "SUNAT exceptions", "Entries", "Consolidation", "History"].map(view => <button type="button" key={view} aria-pressed={focusView === view} onClick={() => setFocusView(view)}>{t(view)}</button>)}</nav>
      <div hidden={focusView !== "SUNAT exceptions"} className="workspace-panel">
        <div className="section-heading"><div><h3>{t("Invoices SUNAT could not validate")}</h3><p>{t("When SUNAT is down or the platform runs in Padrón-only mode, one Accounting user can approve a manual SUNAT exception. The reason is required and audited, and the exception stays visible on the invoice and its CXP.")}</p></div><span className="section-count">{sunatTable.pagination.total}</span></div>
        {sunatTable.payload.sunat?.variant === "PADRON" && <div className="document-requirement"><FileCheck2 size={20} /><div><strong>{t("Padrón-only mode")}</strong><p>{t("The public Padrón checks the supplier's RUC status but never verifies an individual invoice, so every invoice needs a manual SUNAT exception.")}</p></div></div>}
        <DataTable rows={sunatTable.rows} loading={sunatTable.loading} remote={sunatTable.remote} searchPlaceholder="Search request, RUC, or voucher..." rowActions={(row) => [{ label: "Approve manual SUNAT exception", icon: ShieldCheck, primary: true, onClick: () => openException(row) }]} columns={[
          { key: "request", type: "code", label: "Request", sortable: false, render: (row) => row.request ? <Link to={`/requests/${row.request._id}`}>{row.request.requestNumber}</Link> : "-" },
          { key: "seriesNumber", type: "code", label: "Voucher", render: (row) => <div className="primary-cell"><strong>{t(row.voucherType)} {row.seriesNumber}</strong><span>{row.rucIssuer}</span></div> },
          { key: "xmlAmount", type: "money", label: "Amount", render: (row) => formatCurrency(row.xmlAmount || 0, row.currency || "PEN", language) },
          { key: "observationDetail", primary: true, minWidth: "240px", label: "Observation", sortable: false, render: (row) => row.observationDetail || "-" },
          { key: "updatedAt", type: "date", label: "Observed", render: (row) => formatDateTime(row.updatedAt) }
        ]} />
      </div>
      <div hidden={focusView !== "Processing"} className="workspace-panel">
        <div className="section-heading"><div><h3>{t("CXP processing queue")}</h3><p>{t("Budget-committed requests waiting for fiscal validation and preliminary accounting.")}</p></div><span className="section-count">{pendingTable.pagination.total}</span></div>
        <DataTable rows={pending} loading={pendingTable.loading} remote={pendingTable.remote} searchPlaceholder="Search request, supplier, or document..." rowActions={(row) => [{ label: "Review fiscal data", icon: Eye, primary: true, onClick: () => openFiscalProcessing(row) }]} columns={[
          { key: "requestNumber", type: "code", label: "Request", render: (row) => <Link to={`/requests/${row._id}`}>{row.requestNumber}</Link> },
          { key: "supplier", type: "name", label: "Supplier", sortable: false, getValue: (row) => row.supplier?.name, render: (row) => <div className="primary-cell"><strong>{row.supplier?.name}</strong><span>{row.supplier?.rucDni}</span></div> },
          { key: "requestType", label: "Type" },
          { key: "expenseNature", label: "Expense nature" },
          { key: "accountingPeriod", type: "code", label: "Period" },
          { key: "status", type: "status", label: "Status", sortable: false, render: (row) => <StatusBadge status={row.status} /> },
          { key: "totalPENEquivalent", type: "money", label: "PEN equivalent", render: (row) => <strong>{formatCurrency(row.totalPENEquivalent ?? row.penEquivalent ?? 0, "PEN", language)}</strong> }
        ]} />
      </div>

      <div hidden={focusView !== "Entries"} className="workspace-panel section-spacer">
        <div className="section-heading"><div><h3>{t("Accounting entries")}</h3><p>{t("Provision, payment, and rendition entries created by the workflow.")}</p></div></div>
        <DataTable
          rows={entries}
          loading={entriesTable.loading}
          remote={entriesTable.remote}
          filters={[{ key: "type", label: "entry types", allLabel: "All entry types", options: ["PROVISION", "ADVANCE", "PAYMENT", "RENDITION", "REVERSAL", "CREDIT_NOTE", "DEBIT_NOTE", "SUPPLIER_CREDIT_APPLICATION", "SUPPLIER_CREDIT_RECOVERY"] }]}
          searchPlaceholder="Search entry, request, account, or description..."
          columns={[
            { key: "entryNumber", type: "code", label: "Entry" },
            { key: "type", type: "code", label: "Entry type", render: (row) => <span className={`entry-type entry-${row.type.toLowerCase()}`}>{t(row.type)}</span> },
            { key: "request", type: "code", primary: true, label: "Request", sortable: false, getValue: (row) => row.request?.requestNumber, render: (row) => row.request ? <Link to={`/requests/${row.request._id}`}>{row.request.requestNumber}</Link> : "-" },
            { key: "accountNumber", type: "code", primary: true, label: "Account" },
            { key: "costCenter", type: "code", label: "Cost center", sortable: false, getValue: (row) => row.costCenter?.code, render: (row) => row.costCenter?.code || "-" },
            { key: "description", label: "Description" },
            { key: "debit", type: "money", label: "Debit", render: (row) => formatCurrency(row.debit || 0, "PEN", language) },
            { key: "credit", type: "money", label: "Credit", render: (row) => formatCurrency(row.credit || 0, "PEN", language) },
            { key: "createdAt", type: "date", label: "Created", render: (row) => formatDateTime(row.createdAt) }
          ]}
        />
      </div>

      <div hidden={focusView !== "Consolidation"} className="workspace-panel section-spacer">
        <div className="section-heading"><div><h3>{t("Consolidation summary")}</h3><p>{t("Period totals grouped by cost center, expense account, and currency.")}</p></div><span className="section-count">{preview.length}</span></div>
        <DataTable rows={preview.map((row, index) => ({ ...row, id: `${row.costCenterCode}-${row.expenseAccount}-${row.currency}-${index}` }))} rowKey="id" loading={loading} filters={[{ key: "currency", label: "currencies", allLabel: "All currencies", options: ["PEN", "USD"] }]} columns={[
          { key: "costCenterCode", type: "code", label: "CeCo", render: (row) => <div className="primary-cell"><strong>{row.costCenterCode}</strong><span>{row.costCenterName}</span></div> },
          { key: "expenseAccount", type: "code", label: "Account", render: (row) => <div className="primary-cell"><strong>{row.expenseAccount}</strong><span>{row.expenseTypeName}</span></div> },
          { key: "currency", type: "code", label: "Currency" },
          { key: "netAmount", type: "money", label: "Net", render: (row) => formatCurrency(row.netAmount || 0, row.currency || "PEN", language) },
          { key: "igvAmount", type: "money", label: "IGV", render: (row) => formatCurrency(row.igvAmount || 0, row.currency || "PEN", language) },
          { key: "totalAmount", type: "money", label: "Total", render: (row) => <strong>{formatCurrency(row.totalAmount || 0, row.currency || "PEN", language)}</strong> },
          { key: "penEquivalent", type: "money", label: "PEN equivalent", render: (row) => formatCurrency(row.penEquivalent || 0, "PEN", language) },
          { key: "debit", type: "money", label: "Debit", render: (row) => formatCurrency(row.debit || 0, row.currency || "PEN", language) },
          { key: "credit", type: "money", label: "Credit", render: (row) => formatCurrency(row.credit || 0, row.currency || "PEN", language) },
          { key: "requestCount", type: "number", label: "Requests" }
        ]} />
      </div>

      <div hidden={focusView !== "History"} className="workspace-panel section-spacer">
        <div className="section-heading"><div><h3>{t("Export history")}</h3><p>{t("Previously generated consolidation reports remain available for download.")}</p></div></div>
        <DataTable rows={history} loading={historyTable.loading} remote={historyTable.remote} columns={[
          { key: "fileName", type: "name", label: "File", render: (row) => <ProtectedAssetButton resourcePath={row.url} fileName={row.fileName}>{row.fileName}</ProtectedAssetButton> },
          { key: "period", type: "code", label: "Period" },
          { key: "rowCount", type: "number", primary: true, label: "Rows" },
          { key: "generatedBy", type: "name", primary: true, label: "Generated by", getValue: (row) => row.generatedBy?.name, render: (row) => row.generatedBy?.name || "-" },
          { key: "createdAt", type: "date", primary: true, label: "Generated", render: (row) => formatDateTime(row.createdAt) },
          { key: "download", label: "", sortable: false, render: (row) => <ProtectedAssetButton className="icon-button" resourcePath={row.url} fileName={row.fileName} title="Download"><Download size={16} /></ProtectedAssetButton> }
        ]} />
      </div>

      <Drawer open={Boolean(selectedRequest)} title="Process account payable" description={selectedRequest ? `${selectedRequest.requestNumber} · ${selectedRequest.supplier?.name}` : ""} onClose={() => !processing && setSelectedRequest(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setSelectedRequest(null)}>{t("Cancel")}</button><button type="submit" form="fiscal-processing-form" className="primary-button" disabled={processing || !draft.ready || draft.status === "conflict"}><FileCheck2 size={16} /><span>{t(processing ? "Processing..." : "Validate and create CXP")}</span></button></>}>
        <div className="document-requirement required"><FileCheck2 size={20} /><div><strong>{t("Fiscal duplicate control")}</strong><p>{t("The system blocks repeated RUC + document type + series + number combinations.")}</p></div></div>
        <DraftPanel busy={processing} draft={draft} onDiscard={() => setSelectedRequest(null)}><form id="fiscal-processing-form" className="form-grid two-column-form" onSubmit={processRequest}>
          <label className="field"><span>{t("Document type")} *</span><select value={fiscalForm.documentType} onChange={(event) => setFiscalForm({ ...fiscalForm, documentType: event.target.value })}><option value="FACTURA">{t("FACTURA")}</option><option value="BOLETA">{t("BOLETA")}</option><option value="RXH">{t("RXH")}</option></select><small className="field-hint">{t("Credit and debit notes are registered against their original invoice from Accounts Payable.")}</small></label>
          <label className="field"><span>{t("Series")} *</span><input required value={fiscalForm.series} onChange={(event) => setFiscalForm({ ...fiscalForm, series: event.target.value.toUpperCase() })} /></label>
          <label className="field"><span>{t("Document number")} *</span><input required value={fiscalForm.number} onChange={(event) => setFiscalForm({ ...fiscalForm, number: event.target.value })} /></label>
          <InvoiceXmlPreview key={selectedRequest?._id} expected={{ ruc: selectedRequest?.supplier?.rucDni, currency: selectedRequest?.currency, totalAmount: selectedRequest?.totalAmount, invoiceNumber: fiscalForm.series && fiscalForm.number ? `${fiscalForm.series}-${fiscalForm.number}` : undefined }} onApply={xml => { const split = String(xml.invoiceNumber || "").indexOf("-"); setFiscalForm(previous => ({ ...previous, documentType: ["FACTURA", "BOLETA", "RXH"].includes(xml.voucherType) ? xml.voucherType : previous.documentType, series: split < 0 ? "" : xml.invoiceNumber.slice(0, split), number: split < 0 ? "" : xml.invoiceNumber.slice(split + 1), documentDate: String(xml.issueDate || "").slice(0, 10), fiscalPeriod: String(xml.issueDate || "").slice(0, 7) })); }} />
          <label className="field"><span>{t("Document date")} *</span><DateInput required value={fiscalForm.documentDate} onChange={(event) => setFiscalForm({ ...fiscalForm, documentDate: event.target.value, fiscalPeriod: event.target.value.slice(0, 7) })} /></label>
          <label className="field"><span>{t("Accounting date")} *</span><DateInput required value={fiscalForm.accountingDate} onChange={(event) => setFiscalForm({ ...fiscalForm, accountingDate: event.target.value })} /></label>
          <label className="field"><span>{t("Fiscal period")}</span><MonthInput readOnly value={fiscalForm.documentDate?.slice(0, 7) || fiscalForm.fiscalPeriod} /><small className="field-hint">{t("Invoices are booked in the period of their document date.")}</small></label>
          <label className="field"><span>{t("Due date")}</span><DateInput value={fiscalForm.dueDate} onChange={(event) => setFiscalForm({ ...fiscalForm, dueDate: event.target.value })} /><small>{t("Optional override. Otherwise use the agreed terms; milestone payments require a confirmed payment date.")}</small></label>
          <label className="field"><span>{t("Accounting account")} *</span><select required value={fiscalForm.accountingAccount} onChange={(event) => setFiscalForm({ ...fiscalForm, accountingAccount: event.target.value })}><option value="">{t("Select")}</option>{accountOptions.map((item) => <option key={item._id} value={item._id}>{item.accountNumber} - {item.name}</option>)}</select><small className="field-hint">{t("Suggested from the request type and the nature of the expense. Requesters never see accounts.")}</small></label>
          <label className="field"><span>{t("Detraction (SPOT)")}</span><select value={fiscalForm.spotCategoryCode} onChange={(event) => setFiscalForm({ ...fiscalForm, spotCategoryCode: event.target.value })}><option value="">{t("Not subject to SPOT")}</option>{SPOT_CATEGORY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><small className="field-hint">{t("Suggested from the nature of the expense. Confirm it for this invoice.")}</small></label>
          <label className="checkbox-row with-hint form-span-two"><input type="checkbox" checked={creditableDocument && fiscalForm.igvDeductible} disabled={!creditableDocument} onChange={(event) => setFiscalForm({ ...fiscalForm, igvDeductible: event.target.checked })} /><span><strong>{t("IGV is deductible (tax credit)")}</strong><small>{t(creditableDocument ? "Clear it when this invoice's IGV cannot be claimed: it is then booked as cost." : "Boletas do not give tax credit; the IGV is booked as cost.")}</small></span></label>
          <label className="field"><span>{t("Subaccount")}</span><input value={fiscalForm.subaccountNumber} onChange={(event) => setFiscalForm({ ...fiscalForm, subaccountNumber: event.target.value })} /></label>
          <label className="field form-span-two"><span>{t("Accounting comments")}</span><textarea rows="3" value={fiscalForm.comments} onChange={(event) => setFiscalForm({ ...fiscalForm, comments: event.target.value })} /></label>
        </form></DraftPanel>
      </Drawer>

      <Drawer open={Boolean(exceptionTarget)} title="Approve manual SUNAT exception" description={exceptionTarget ? `${exceptionTarget.seriesNumber} · ${exceptionTarget.request?.requestNumber || ""}` : ""} onClose={() => !exceptionSaving && setExceptionTarget(null)} footer={<><button type="button" className="secondary-button" disabled={exceptionSaving} onClick={() => setExceptionTarget(null)}>{t("Cancel")}</button><button type="submit" form="sunat-exception-form" className="primary-button" disabled={exceptionSaving || !exceptionForm.reason.trim()}><ShieldCheck size={16} /><span>{t(exceptionSaving ? "Processing..." : "Approve exception")}</span></button></>}>
        {exceptionTarget && <form id="sunat-exception-form" className="form-grid" onSubmit={approveException}>
          <div className="document-requirement required"><ShieldCheck size={20} /><div><strong>{t("Non-authoritative decision")}</strong><p>{exceptionTarget.observationDetail}</p><p>{t("The invoice will be posted and paid on Accounting's responsibility. It cannot override a supplier mismatch, a duplicate or the Purchase Order ceiling.")}</p></div></div>
          <label className="field"><span>{t("Reason")} *</span><textarea rows="3" required value={exceptionForm.reason} onChange={(event) => setExceptionForm({ ...exceptionForm, reason: event.target.value })} placeholder={t("For example: SUNAT CPE service unavailable; PDF checked against the supplier's portal.")} /></label>
          <label className="field"><span>{t("Evidence reference")}</span><input value={exceptionForm.evidenceReference} onChange={(event) => setExceptionForm({ ...exceptionForm, evidenceReference: event.target.value })} /></label>
        </form>}
      </Drawer>
    </section>
  );
}