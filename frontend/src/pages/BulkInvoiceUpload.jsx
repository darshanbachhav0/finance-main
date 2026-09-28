import useWorkDraft, { useDraftResume, resumeDraftRecord } from "../hooks/useWorkDraft.js";
import DraftPanel from "../components/DraftPanel.jsx";
import { FileArchive, RefreshCw, UploadCloud, Eye } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import api from "../api/client.js";
import BatchUploadStatus from "../components/BatchUploadStatus.jsx";
import DataTable from "../components/DataTable.jsx";
import DeepLinkNotice from "../components/DeepLinkNotice.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import useDeepLink from "../hooks/useDeepLink.js";
import usePaginatedResource from "../hooks/usePaginatedResource.js";
import { formatCurrency, formatDateTime } from "../utils/formatters.js";

const finalStatuses = new Set(["COMPLETED", "COMPLETED_WITH_OBSERVATIONS", "FAILED"]);

export default function BulkInvoiceUpload() {
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const [orders, setOrders] = useState([]);
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [file, setFile] = useState(null);
  const [activeBatch, setActiveBatch] = useState(null);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // ?batch=<batch id> (batch notifications) opens that batch; ?request=<request id> lists the
  // request's batches and opens the most recent one.
  const deepLink = useDeepLink(["batch", "request"]);
  const batchTable = usePaginatedResource("/batch-invoices", { initialPageSize: 10, fixedParams: deepLink.link, deepLink: deepLink.active });
  const openedLink = useRef("");
  useEffect(() => {
    if (!deepLink.active || openedLink.current === deepLink.linkKey) return;
    const target = deepLink.link.batch || (!batchTable.loading && batchTable.rows[0]?._id);
    if (!target) return;
    openedLink.current = deepLink.linkKey;
    openBatch({ _id: target });
  }, [deepLink.linkKey, batchTable.loading, batchTable.rows]);

  async function loadOrders() {
    setLoadingOrders(true);
    try {
      const response = await api.get("/batch-invoices/purchase-orders");
      setOrders(response.data.data || []);
      setPurchaseOrderId((current) => current || response.data.data?.[0]?._id || "");
    } catch (err) { setError(err.message); }
    finally { setLoadingOrders(false); }
  }

  useEffect(() => { loadOrders(); }, []);

  useEffect(() => {
    if (!activeBatch?._id || finalStatuses.has(activeBatch.status)) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const response = await api.get(`/batch-invoices/${activeBatch._id}`);
        setActiveBatch(response.data.data);
        if (finalStatuses.has(response.data.data.status)) {
          batchTable.reload();
          loadOrders();
        }
      } catch (err) { setError(err.message); }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [activeBatch?._id, activeBatch?.status]);

  const draft = useWorkDraft({ scope: "batch-invoice", title: "Batch invoice upload", enabled: !loadingOrders, value: { purchaseOrderId, file }, restore: data => { setPurchaseOrderId(data.purchaseOrderId); setFile(data.file); } });

  const selectedOrder = useMemo(() => orders.find((item) => item._id === purchaseOrderId), [orders, purchaseOrderId]);

  async function upload(event) {
    event.preventDefault(); if (!draft.ready || draft.status === "conflict") return;
    event.preventDefault();
    if (!purchaseOrderId || !file) return;
    setSubmitting(true);
    setError("");
    const data = new FormData();
    data.append("purchaseOrderId", purchaseOrderId);
    data.append("batchFile", file);
    try {
      const response = await api.post("/batch-invoices", data, { headers: { "Content-Type": "multipart/form-data" } });
      await draft.complete();
      setActiveBatch(response.data.data);
      setFile(null);
      notify("Batch accepted. Valid invoices will continue even when another invoice is observed.");
      batchTable.reload();
    } catch (err) { setError(err.message); notify(err.message, "error"); }
    finally { setSubmitting(false); }
  }

  async function openBatch(row) {
    try {
      const response = await api.get(`/batch-invoices/${row._id}`);
      setActiveBatch(response.data.data);
    } catch (err) { setError(err.message); }
  }

  return (
    <section>
      <PageHeader title="A2 · Batch invoice ingestion" description="Select an active Purchase Order and upload a ZIP of XML/PDF pairs, optionally with an XLSX invoice list. Every voucher is validated independently." actions={<button type="button" className="secondary-button" onClick={() => { loadOrders(); batchTable.reload(); }}><RefreshCw size={16} /><span>{t("Refresh")}</span></button>} />
      <Message type="error">{error || batchTable.error}</Message>
      {deepLink.active && <DeepLinkNotice title={deepLink.link.batch ? "Showing the batch linked from your notification" : "Showing the batches of the linked request"} missing={!batchTable.loading && !batchTable.rows.length} missingDescription="No invoice batch was found for this link." clearLabel="Show all batches" onClear={() => { setActiveBatch(null); deepLink.clear(); }} />}
      <div className="workspace-panel batch-upload-workspace">
        <div className="document-requirement required"><FileArchive size={22} /><div><strong>{t("Independent batch processing")}</strong><p>{t("SUNAT, duplicate identity, and remaining PO ceiling are checked per invoice. Invalid invoices are isolated instead of stopping the entire batch.")}</p></div></div>
        <DraftPanel busy={submitting} draft={draft} onDiscard={() => { setFile(null); setPurchaseOrderId(""); draft.separateCopy(); }}><form className="form-grid two-column-form" onSubmit={upload}>
          <label className="field"><span>{t("Purchase Order")} *</span><select required disabled={loadingOrders || submitting} value={purchaseOrderId} onChange={(event) => setPurchaseOrderId(event.target.value)}><option value="">{t("Select Purchase Order")}</option>{orders.map((order) => <option value={order._id} key={order._id}>{order.poNumber} · {order.request?.requestNumber || ""} · {formatCurrency(order.remainingAmount, order.currency || "PEN", language)}</option>)}</select></label>
          <label className="field"><span>{t("Batch file")} * {file?.name}</span><input required={!file} type="file" accept=".zip" disabled={submitting} onChange={(event) => setFile(event.target.files?.[0] || null)} /><small>{t("ZIP: same-name XML + PDF pairs. An XLSX invoice list may be included in the ZIP; every row needs its XML, because only an XML invoice can be validated and posted.")}</small></label>
          {selectedOrder && <div className="form-span-two payment-destination-summary"><strong>{selectedOrder.poNumber} · {formatCurrency(selectedOrder.remainingAmount, selectedOrder.currency || "PEN", language)} {t("remaining")}</strong><span>{selectedOrder.supplier?.legalName || selectedOrder.supplier?.name || ""}</span><small>{selectedOrder.request?.requestNumber}</small></div>}
          <div className="form-span-two"><button className="primary-button" type="submit" disabled={submitting || !file || !purchaseOrderId}><UploadCloud size={16} /><span>{t(submitting ? "Uploading..." : "Process batch")}</span></button></div>
        </form></DraftPanel>
      </div>

      {activeBatch && <div className="workspace-panel section-spacer"><BatchUploadStatus batch={activeBatch} /></div>}

      <div className="workspace-panel section-spacer">
        <div className="section-heading"><div><h3>{t("Recent batches")}</h3><p>{t("Open a batch to inspect per-invoice results.")}</p></div></div>
        <DataTable rows={batchTable.rows} loading={batchTable.loading} remote={batchTable.remote} filters={[{ key: "status", label: "Status", allLabel: "All statuses", options: ["QUEUED", "PROCESSING", "COMPLETED", "COMPLETED_WITH_OBSERVATIONS", "FAILED"] }]} searchPlaceholder="Search batch..." rowActions={(row) => [{ label: "View batch", icon: Eye, onClick: () => openBatch(row) }]} columns={[
          { key: "batchCode", label: "Batch" },
          { key: "purchaseOrder", label: "Purchase Order", sortable: false, render: (row) => row.purchaseOrder?.poNumber || "-" },
          { key: "request", label: "Request", sortable: false, render: (row) => row.request?.requestNumber || "-" },
          { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
          { key: "processedSuccess", label: "Provisioned", align: "right" },
          { key: "observed", label: "Observed", align: "right" },
          { key: "createdAt", label: "Uploaded", render: (row) => row.createdAt ? formatDateTime(row.createdAt) : "-" }
        ]} />
      </div>
    </section>
  );
}
