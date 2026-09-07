import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency } from "../utils/formatters.js";
import { paymentBreakdown, paymentTermsSummary } from "../../../shared/paymentTerms.mjs";

export default function PaymentTermsSummary({ terms = {}, amount = terms.amount, currency = terms.currency, showAmounts = true }) {
  const { t, language } = useLanguage();
  const breakdown = showAmounts ? paymentBreakdown(terms, amount) : null;
  const showNotes = terms.paymentCondition && !["OTHER", "PARTIAL_PAYMENTS"].includes(terms.paymentCondition) && terms.paymentNotes;
  return <div className="payment-terms-summary">
    <span>{paymentTermsSummary(terms, t)}</span>
    {breakdown && <div className="payment-amounts">
      <div><span>{t("Advance")} · {breakdown.advancePercentage}%</span><strong>{formatCurrency(breakdown.advanceAmount, currency, language)}</strong></div>
      <div><span>{t("Balance")} · {breakdown.balancePercentage}%</span><strong>{formatCurrency(breakdown.balanceAmount, currency, language)}</strong></div>
    </div>}
    {showNotes && <small>{terms.paymentNotes}</small>}
  </div>;
}
