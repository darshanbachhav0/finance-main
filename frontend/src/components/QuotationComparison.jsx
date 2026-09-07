import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency } from "../utils/formatters.js";
import PaymentTermsSummary from "./PaymentTermsSummary.jsx";

export default function QuotationComparison({ quotations, suppliers }) {
  const { t, language } = useLanguage();
  return <div className="quotation-comparison"><table>
    <caption className="sr-only">{t("Compare supplier quotations")}</caption>
    <thead><tr><th>{t("Supplier")}</th><th>{t("Amount")}</th><th>{t("Delivery period")}</th><th>{t("Payment conditions")}</th></tr></thead>
    <tbody>{quotations.map((quotation) => {
      const supplier = suppliers.find((item) => item._id === quotation.supplier);
      return <tr key={quotation.clientId} className={quotation.recommended ? "recommended" : ""}>
        <td>{supplier?.legalName || supplier?.name || "-"}{quotation.recommended && <small> · {t("Recommended supplier")}</small>}</td>
        <td><strong>{quotation.amount === "" ? "-" : formatCurrency(quotation.amount, quotation.currency, language)}</strong><small>{quotation.currency}</small></td>
        <td>{quotation.deliveryPeriod || "-"}</td>
        <td><PaymentTermsSummary terms={quotation} showAmounts={false} /></td>
      </tr>;
    })}</tbody>
  </table></div>;
}
