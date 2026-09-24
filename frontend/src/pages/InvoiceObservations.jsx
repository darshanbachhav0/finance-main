import useWorkDraft, { useDraftResume, resumeDraftRecord } from "../hooks/useWorkDraft.js";
import DraftPanel from "../components/DraftPanel.jsx";
import { Download, RefreshCw, RotateCcw } from "lucide-react";
import { useState } from "react";
import api from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import Drawer from "../components/Drawer.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import usePaginatedResource from "../hooks/usePaginatedResource.js";
import { formatCurrency } from "../utils/formatters.js";

export default function InvoiceObservations() {
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const table = usePaginatedResource("/batch-invoices/observations");
  const [selected, setSelected] = useState(null);
  const [xml, setXml] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [acceptXmlValues, setAcceptXmlValues] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  const draft = useWorkDraft({ scope: "invoice-resolution", recordId: selected?._id || "new", title: "Invoice correction files", enabled: Boolean(selected), value: { xml, pdf }, restore: data => { setXml(data.xml); setPdf(data.pdf); } });
  useDraftResume("invoice-resolution", id => resumeDraftRecord("/batch-invoices/observations", id, row => row._id, open, setError));

  function open(row) { setAcceptXmlValues(false); setSelected(row); setXml(null); setPdf(null); setError(""); }


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
      <div className="workspace-panel">
        <DataTable rows={table.rows} loading={table.loading} remote={table.remote} filters={[{ key: "status", label: "statuses", allLabel: "All statuses", options: ["OBSERVED_SUNAT", "OBSERVED_DUPLICATE", "OBSERVED_AMOUNT_EXCEEDED", "OBSERVED_BATCH", "FAILED"] }]} searchPlaceholder="Search RUC, voucher or observation..." rowActions={(row) => [{ label: "Revalidate", icon: RotateCcw, onClick: () => open(row) }]} columns={[
          { key: "request", label: "Request", sortable: false, render: (row) => row.request?.requestNumber || "-" },
          { key: "purchaseOrder", label: "Purchase Order", sortable: false, render: (row) => row.purchaseOrder?.poNumber || "-" },
          { key: "rucIssuer", label: "RUC" },
          { key: "seriesNumber", label: "Voucher" },
          { key: "xmlAmount", label: "Amount", align: "right", render: (row) => formatCurrency(row.xmlAmount, row.currency || "PEN", language) },
          { key: "validationStatus", label: "Status", render: (row) => <StatusBadge status={row.validationStatus || row.status} /> },
          { key: "observationDetail", label: "Observation", sortable: false, render: (row) => row.observationDetail || row.errorDetail || "-" },
          { key: "batch", label: "Batch", sortable: false, render: (row) => row.batch?.batchCode || "-" }
        ]} />
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
