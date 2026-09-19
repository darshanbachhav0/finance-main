import { useAuth } from "../context/AuthContext.jsx";
import { exchangeRateDescription } from "../utils/financialEvidence.js";
import { useLanguage } from "../context/LanguageContext.jsx";


function AdvancedFinancialValidation({ request, related }) {
  const { t } = useLanguage();
  const check = (result, supplier = false) => result ? `${result.valid && (supplier || (result.voucherVerified !== false && !result.publicDataset)) ? t("Validated") : t("Not verified")} · ${result.source || "—"} · ${result.status || result.condition || "—"}${supplier ? "" : result.voucherVerified === false ? " · Invoice verification required" : ""}` : t("Not verified");
  return <div className="subsection-block">
    <h4>{t("Financial validation")}</h4>
    <dl className="definition-grid">
      <div><dt>{t("Exchange rate evidence")}</dt><dd>{exchangeRateDescription(request.exchangeRateEvidence, request.exchangeRateSource, request.exchangeRate, request.exchangeRateDate)}</dd></div>
      <div><dt>{t("Supplier / RUC validation")}</dt><dd>{request.fiscalValidation?.taxpayer ? check(request.fiscalValidation.taxpayer, true) : request.supplier?.taxpayerStatus || t("Not verified")}</dd></div>
      <div><dt>{t("Invoice validation")}</dt><dd>{check(request.fiscalValidation?.fiscal)}</dd></div>
      <div><dt>{t("Budget availability")}</dt><dd>{related.budgetPreview?.totalAvailable == null ? "—" : `PEN ${Number(related.budgetPreview.totalAvailable).toFixed(2)}`}</dd></div>
    </dl>
    {(related.sunatVouchers || []).map(voucher => <div key={voucher._id} className="subsection-block">
      <strong>{voucher.seriesNumber}</strong>
      <p>{t("Supplier / RUC validation")}: {check(voucher.validationEvidence?.taxpayer, true)}</p>
      <p>{t("Invoice validation")}: {check(voucher.validationEvidence?.fiscal)} · {voucher.validationStatus}{voucher.observationDetail ? ` · ${voucher.observationDetail}` : ""}</p>
    </div>)}
    {(related.accountsPayable || []).filter(ap => ap.currency === "USD").map(ap => <p key={ap._id}>{ap.voucher?.series}-{ap.voucher?.number}: {exchangeRateDescription(ap.exchangeRateEvidence, null, ap.exchangeRate)}</p>)}
    {(related.budgetExceptions || []).map(exception => <p key={exception._id}>{t("Budget exception")}: {exception.status} · {exception.strategy}{exception.preparationComments ? ` · ${exception.preparationComments}` : ""}{exception.comments ? ` · ${exception.comments}` : ""}</p>)}
  </div>;
}

export default function FinancialValidationSummary({ request, related }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const supplier = request.fiscalValidation?.taxpayer;
  const fiscal = request.fiscalValidation?.fiscal;
  const verified = Boolean(fiscal?.valid && fiscal?.voucherVerified === true && !fiscal?.publicDataset);
  const evidence = request.exchangeRateEvidence;
  return <div className="workspace-panel"><h3>{t("Validation")}</h3><dl className="detail-grid">
    <div><dt>{t("Supplier")}</dt><dd>{t(supplier?.valid ? "Validated" : "Not verified")}</dd></div>
    <div><dt>{t("Invoice")}</dt><dd>{t(verified ? "Verified" : "Not verified")}</dd></div>
    {request.currency === "USD" && <div><dt>{t("Exchange rate")}</dt><dd>{request.exchangeRate} · {t(evidence?.authoritative && /SUNAT/i.test(evidence?.source || "") ? "Official SUNAT rate" : "Reference rate")}<br />{String(evidence?.date || request.exchangeRateDate || "").slice(0, 10) || "—"}</dd></div>}
  </dl>{["Accounting", "Admin"].includes(user.role) && <details><summary>{t("Advanced validation details")}</summary><AdvancedFinancialValidation request={request} related={related} /></details>}</div>;
}
