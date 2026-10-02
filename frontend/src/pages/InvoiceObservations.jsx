import useWorkDraft, { useDraftResume, resumeDraftRecord } from "../hooks/useWorkDraft.js";
import DraftPanel from "../components/DraftPanel.jsx";
import { Download, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import api from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DataTable from "../components/DataTable.jsx";
import DeepLinkNotice from "../components/DeepLinkNotice.jsx";
import Drawer from "../components/Drawer.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import useDeepLink from "../hooks/useDeepLink.js";
import usePaginatedResource from "../hooks/usePaginatedResource.js";
import { formatCurrency } from "../utils/formatters.js";

export default function InvoiceObservations() {
  const { t, language } = useLanguage();
  const { notify } = useToast();
  // ?record=<observation id> (task links) opens that observation; ?batch=<batch id> (batch
  // completion notifications) lists the observations of that batch.
  const deepLink = useDeepLink(["record", "batch", "request"]);
  const table = usePaginatedResource("/batch-invoices/observations", { fixedParams: deepLink.link, deepLink: deepLink.active });
  const [selected, setSelected] = useState(null);
  const [xml, setXml] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [acceptXmlValues, setAcceptXmlValues] = useState(false);
  // Bulk revalidation: retry several observed invoices with their stored documents (e.g. after a
  // PO addendum or once SUNAT is reachable again). Corrected files are still uploaded one by one.
  const [bulkIds, setBulkIds] = useState([]);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  const draft = useWorkDraft({ scope: "invoice-resolution", recordId: selected?._id || "new", title: "Invoice correction files", enabled: Boolean(selected), value: { xml, pdf }, restore: data => { setXml(data.xml); setPdf(data.pdf); } });
  useDraftResume("invoice-resolution", id => resumeDraftRecord("/batch-invoices/observations", id, row => row._id, open, setError));

  function open(row) { setAcceptXmlValues(false); setSelected(row); setXml(null); setPdf(null); setError(""); }

  const openedLink = useRef("");
  useEffect(() => {
    const row = deepLink.link.record && table.rows.find((item) => String(item._id) === deepLink.link.record);
    if (!row || openedLink.current === deepLink.link.record) return;
    openedLink.current = deepLink.link.record;
    if ((row.resolutionStatus || "OPEN") === "OPEN") open(row);
  }, [deepLink.link.record, table.rows]);


  async function downloadDocument(kind) {
    if (!selected) return;
    setProcessing(true);
    setError("");
    try {
      const response = await api.get(`/batch-invoices/observations/${selected._id}/${kind}`, { responseType: "blob" });
      const disposition = response.headers?.["content-disposition"] || "";
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const quotedName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
      const fileName = encodedName ? decodeURIComponent(encodedName) : quotedName || `${selected.seriesNumber || "voucher"}.${kind}`;
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
      notify(err.message, "error");
    } finally {
      setProcessing(false);
    }
  }

  async function revalidateSelected() {
    setBulkRunning(true);
    const failures = [];
    let succeeded = 0;
    for (const id of bulkIds) {
      const data = new FormData();
      data.append("acceptXmlValues", "false");
      try {
        await api.post(`/batch-invoices/observations/${id}/resolve`, data, { headers: { "Content-Type": "multipart/form-data" } });
        succeeded += 1;
      } catch (err) {
        const row = table.rows.find((item) => item._id === id);
        failures.push(`${row?.seriesNumber || id}: ${err.message}`);
      }
    }
    setBulkRunning(false);
    setBulkConfirmOpen(false);
    setBulkIds([]);
    table.reload();
    const summary = t("{ok} revalidated, {failed} still observed").replace("{ok}", succeeded).replace("{failed}", failures.length);
    notify(failures.length ? `${summary}: ${failures.slice(0, 3).join(" · ")}${failures.length > 3 ? " …" : ""}` : summary, failures.length ? "error" : "success");
  }

  async function retry(event) {
    event.preventDefault(); if (!draft.ready || draft.status === "conflict") return;
    event.preventDefault();
    setProcessing(true);
    setError("");
    const data = new FormData();
    data.append("acceptXmlValues", String(acceptXmlValues));
    if (xml) data.append("xml", xml);
    if (pdf) data.append("pdf", pdf);
    try {
      await api.post(`/batch-invoices/observations/${selected._id}/resolve`, data, { headers: { "Content-Type": "multipart/form-data" } });
      await draft.complete();
      notify("Voucher revalidated and provisioned successfully.");
      setSelected(null);
      table.reload();
    } catch (err) { setError(err.message); notify(err.message, "error"); }
    finally { setProcessing(false); }
  }

  return (
    <section>
      <PageHeader title="Invoice observation inbox" description="Accounting reviews only invoices isolated by SUNAT, document, duplicate, or PO-ceiling controls. Valid invoices from the same batch remain provisioned." actions={<button type="button" className="secondary-button" onClick={table.reload} disabled={table.loading}><RefreshCw className={table.loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button>} />
      <Message type="error">{table.error}</Message>
      {deepLink.active && <DeepLinkNotice title={deepLink.link.record ? "Showing the observed invoice linked from your notification" : "Showing the observed invoices of the linked batch"} missing={!table.loading && !table.rows.length} missingDescription="No open observation remains for this link. The invoices may already have been revalidated." clearLabel="Show all observations" onClear={deepLink.clear} />}
      <div className="workspace-panel">
        <DataTable selection={{ selected: bulkIds, onChange: setBulkIds }} rows={table.rows} loading={table.loading} remote={table.remote} filters={[{ key: "status", label: "Status", allLabel: "All statuses", options: ["OBSERVED_SUNAT", "OBSERVED_DUPLICATE", "OBSERVED_AMOUNT_EXCEEDED", "OBSERVED_BATCH", "FAILED"] }]} searchPlaceholder="Search RUC, voucher or observation..." emptyTitle="No observed invoices" emptyDescription="Invoices isolated by SUNAT, duplicate, document or PO-ceiling controls appear here." emptyAction={{ label: "A2 Batch Invoices", to: "/batch-invoices" }} rowActions={(row) => [{ label: "Revalidate", icon: RotateCcw, primary: true, onClick: () => open(row) }]} columns={[
          { key: "request", type: "code", label: "Request", sortable: false, render: (row) => row.request?.requestNumber || "-" },
          { key: "purchaseOrder", type: "code", label: "Purchase Order", sortable: false, render: (row) => row.purchaseOrder?.poNumber || "-" },
          { key: "rucIssuer", type: "code", label: "RUC" },
          { key: "seriesNumber", type: "code", label: "Voucher" },
          { key: "xmlAmount", type: "money", label: "Amount", render: (row) => formatCurrency(row.xmlAmount, row.currency || "PEN", language) },
          { key: "validationStatus", type: "status", label: "Status", render: (row) => <StatusBadge status={row.validationStatus || row.status} /> },
          { key: "observationDetail", primary: true, minWidth: "240px", label: "Observation", sortable: false, render: (row) => row.observationDetail || row.errorDetail || "-" },
          { key: "batch", type: "code", label: "Batch", sortable: false, render: (row) => row.batch?.batchCode || "-" }
        ]} />
        {bulkIds.length > 0 && (
          <div className="bulk-bar" role="region" aria-label={t("Bulk revalidation")}>
            <div className="bulk-bar-summary">
              <strong>{t(bulkIds.length === 1 ? "{count} item selected" : "{count} selected").replace("{count}", bulkIds.length)}</strong>
              <span>{t("Retried with their stored XML and PDF.")}</span>
            </div>
            <div className="bulk-bar-actions">
              <button type="button" className="primary-button" disabled={bulkRunning} onClick={() => setBulkConfirmOpen(true)}><RotateCcw size={16} /><span>{t("Revalidate selected")}</span></button>
              <button type="button" className="text-button" onClick={() => setBulkIds([])}>{t("Clear selection")}</button>
            </div>
          </div>
        )}
        <ConfirmDialog
          open={bulkConfirmOpen}
          title="Revalidate the selected invoices?"
          description="Each invoice is validated again with its stored documents. Invoices that still fail stay in this inbox with their reason; to correct one, open it and attach the new XML or PDF."
          details={[{ label: "Invoices", value: String(bulkIds.length) }]}
          confirmLabel="Revalidate selected"
          loading={bulkRunning}
          onClose={() => !bulkRunning && setBulkConfirmOpen(false)}
          onConfirm={revalidateSelected}
        />
      </div>
      <Drawer open={Boolean(selected)} title="Revalidate observed invoice" description={selected ? `${selected.seriesNumber} · ${selected.purchaseOrder?.poNumber || ""}` : ""} onClose={() => !processing && setSelected(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setSelected(null)}>{t("Cancel")}</button><button className="primary-button" form="observation-resolution-form" type="submit" disabled={processing || !draft.ready || draft.status === "conflict"}><RotateCcw size={16} /><span>{t(processing ? "Processing..." : "Revalidate")}</span></button></>}>
        {selected && <DraftPanel busy={processing} draft={draft} onDiscard={() => setSelected(null)}><form id="observation-resolution-form" className="form-grid" onSubmit={retry}>
          <Message type="error">{error}</Message>
          <div className="document-requirement required"><div><strong><StatusBadge status={selected.validationStatus || selected.status} /></strong><p>{selected.observationDetail || selected.errorDetail}</p></div></div>
          <div className="inline-document-actions"><button type="button" className="secondary-button" disabled={processing || !selected.xmlUrl} onClick={() => downloadDocument("xml")}><Download size={15} />{t("Download stored XML")}</button><button type="button" className="secondary-button" disabled={processing || !selected.pdfUrl} onClick={() => downloadDocument("pdf")}><Download size={15} />{t("Download stored PDF")}</button></div>
          <p>{t((selected.validationStatus || selected.status) === "OBSERVED_AMOUNT_EXCEEDED" ? "After the PO addendum increases the available ceiling, retry without replacing the XML, or attach a corrected document." : "Attach a corrected XML/PDF when the supplier replaced the voucher. If the stored XML is still valid after an external correction, you can retry without a replacement.")}</p>
          <label className="checkbox-field"><input type="checkbox" checked={acceptXmlValues} onChange={event => setAcceptXmlValues(event.target.checked)} /><span>{t("Replace entered invoice values with the XML values (audited). All validation checks still apply.")}</span></label>
          <label className="field"><span>{t("Replacement XML")} {xml?.name}</span><input type="file" accept=".xml" onChange={(event) => setXml(event.target.files?.[0] || null)} /></label>
          <label className="field"><span>{t("Replacement PDF")} {pdf?.name}</span><input type="file" accept=".pdf" onChange={(event) => setPdf(event.target.files?.[0] || null)} /></label>
        </form></DraftPanel>}
      </Drawer>
    </section>
  );
}
