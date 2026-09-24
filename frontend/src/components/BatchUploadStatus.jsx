import StatusBadge from "./StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency } from "../utils/formatters.js";

export default function BatchUploadStatus({ batch }) {
  const { t, language } = useLanguage();
  if (!batch) return null;
  return (
    <div className="batch-status-card">
      <div className="section-heading compact">
        <div>
          <h3>{batch.batchCode || t("Batch processing")}</h3>
          <p>{batch.purchaseOrder?.poNumber || ""}</p>
        </div>
        <StatusBadge status={batch.status} />
      </div>
      <div className="batch-kpis">
        <div><span>{t("Invoices")}</span><strong>{batch.totalVouchers || 0}</strong></div>
        <div><span>{t("Provisioned")}</span><strong>{batch.processedSuccess || 0}</strong></div>
        <div><span>{t("Observed")}</span><strong>{batch.observed || 0}</strong></div>
        <div><span>{t("Failed")}</span><strong>{batch.failed || 0}</strong></div>
        {batch.purchaseOrder && <div><span>{t("PO remaining")}</span><strong>{formatCurrency(batch.purchaseOrder.remainingAmount, batch.purchaseOrder.currency || "PEN", language)}</strong></div>}
      </div>
      {batch.errorMessage && <p className="inline-error">{batch.errorMessage}</p>}
      {batch.items?.length > 0 && (
        <div className="batch-item-list">
          {batch.items.map((item) => (
            <div key={item._id || item.sourceName} className="batch-item-row">
              <div><strong>{item.sourceName}</strong><small>{item.errorDetail || item.xmlFileName || item.pdfFileName || ""}</small></div>
              <StatusBadge status={item.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
