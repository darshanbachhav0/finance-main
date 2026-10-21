import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency } from "../utils/formatters.js";
import "../styles/approvalOptimization.css";

export default function PaymentBatchSummary({ summary, bank = "BBVA", currency = "PEN", expanded = false }) {
  const { t, language } = useLanguage();
  if (!summary) return null;
  return <>
    <div className="txt-summary">
      <div><span>{t("Requests")}</span><strong>{summary.requestCount}</strong></div>
      <div><span>{t("Suppliers")}</span><strong>{summary.supplierCount}</strong></div>
      <div><span>{t("Source bank")}</span><strong>{bank} · {currency}</strong></div>
      <div><span>{t("Net payable")}</span><strong>{formatCurrency(summary.total, currency, language)}</strong></div>
    </div>
    <details open={expanded || undefined}><summary>{t("Supplier summary")}</summary>
      <div className="txt-supplier-list">{summary.suppliers.map((group,index) => <article key={index}><div><strong>{group.supplierName}</strong><small className="cell-note">{group.supplierIdentifier} · {group.bank} · ****{group.accountLast4} · {group.currency}</small><details><summary>{t("Included requests")} ({group.items.length})</summary>{group.items.map(item => <p key={item.payableId}><Link to={`/requests/${item.requestId}`}>{item.requestNumber}</Link> · {item.voucherNumber || "—"} · {formatCurrency(item.amount, item.currency, language)}</p>)}</details></div><strong>{formatCurrency(group.total, group.currency, language)}</strong></article>)}</div>
    </details>
  </>;
}
