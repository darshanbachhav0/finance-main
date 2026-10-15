import { FileUp, Loader2, ReceiptText, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency } from "../utils/formatters.js";

// "Drop the supplier's factura and the form fills itself." Accepts one XML or PDF by drag and drop
// or the file picker; the result shows what was read and whether the supplier is registered.
export default function InvoiceDropZone({ check, onFile, supplierProposalPath }) {
  const { t, language } = useLanguage();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const reading = check?.status === "reading";
  const invoice = check?.invoice;

  function choose(files) {
    const file = [...(files || [])].find((item) => /\.(xml|pdf)$/i.test(item.name));
    if (file) onFile(file);
  }

  return (
    <div
      className={`invoice-drop${dragging ? " is-dragging" : ""}${invoice ? " has-result" : ""}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files); }}
    >
      <span className="invoice-drop-icon" aria-hidden="true">{reading ? <Loader2 className="spin" size={22} /> : invoice ? <ReceiptText size={22} /> : <Sparkles size={22} />}</span>
      <div className="invoice-drop-text">
        {!invoice && <>
          <strong>{t("Have the supplier's factura?")}</strong>
          <span>{t(reading ? "Reading the invoice..." : "Drop its XML or PDF here and the form fills itself: supplier, currency and amounts.")}</span>
        </>}
        {invoice && <>
          <strong>{t("Filled from {invoice}").replace("{invoice}", invoice.invoiceNumber || check.fileName)}</strong>
          <span>{[check.supplier?.legalName || check.supplier?.name, invoice.ruc && `RUC ${invoice.ruc}`, invoice.totalAmount !== undefined && formatCurrency(invoice.totalAmount, invoice.currency || "PEN", language)].filter(Boolean).join(" · ")}</span>
          {!check.supplier && invoice.ruc && <span className="invoice-drop-note">{t("This supplier is not registered yet.")} <Link to={supplierProposalPath}>{t("Propose the supplier")}</Link></span>}
        </>}
        {check?.status === "error" && <span className="invoice-drop-error" role="alert">{check.error}</span>}
      </div>
      <button type="button" className="secondary-button" disabled={reading} onClick={() => inputRef.current?.click()}><FileUp size={16} /><span>{t(invoice ? "Use another invoice" : "Choose file")}</span></button>
      <input ref={inputRef} type="file" accept=".xml,.pdf" hidden onChange={(event) => { choose(event.target.files); event.target.value = ""; }} aria-label={t("Supplier invoice XML or PDF")} />
    </div>
  );
}
