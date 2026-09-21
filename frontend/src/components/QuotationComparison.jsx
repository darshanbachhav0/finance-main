import { quotationDifference } from "../utils/experience.js";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency } from "../utils/formatters.js";
import PaymentTermsSummary from "./PaymentTermsSummary.jsx";

export default function QuotationComparison({ quotations, suppliers }) {
  const { t, language } = useLanguage();
  return <div className="quotation-comparison"><table>
    <caption className="sr-only">{t("Compare supplier quotations")}</caption>
    <thead><tr><th>{t("Supplier")}</th><th>{t("Amount")}</th><th>{t("Delivery period")}</th><th>{t("Payment conditions")}</th></tr></thead>
    <tbody>{quotations.map((quotation) => {
      const comparison = quotationDifference(quotation, quotations);
      const supplier = suppliers.find((item) => item._id === quotation.supplier);
      return <tr key={quotation.clientId} className={quotation.recommended ? "recommended" : ""}>
        <td data-label={t("Supplier")}>{supplier?.legalName || supplier?.name || "-"}{quotation.recommended && <small> · {t("Recommended supplier")}</small>}</td>
        <td data-label={t("Amount")}><strong>{quotation.amount === "" ? "-" : formatCurrency(quotation.amount, quotation.currency, language)}</strong><small>{quotation.currency}</small>{comparison && <small className={comparison.lowest ? "quote-lowest" : ""}>{comparison.lowest ? t("Lowest price in this currency") : `+${formatCurrency(comparison.difference, quotation.currency, language)} ${t("above lowest in this currency")}`}</small>}</td>
        <td data-label={t("Delivery period")}>{quotation.deliveryPeriod || "-"}</td>
        <td data-label={t("Payment conditions")}><PaymentTermsSummary terms={quotation} showAmounts={false} /></td>
      </tr>;
    })}</tbody>
  </table></div>;
}
