import { useEffect, useState } from "react";
import api from "../../api/client.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { formatCurrency, formatDateTime } from "../../utils/formatters.js";
import Message from "../Message.jsx";

export default function AccountingDetraction({ payable, onUpdated }) {
  const { user, readOnly } = useAuth();
  const { t, language } = useLanguage();
  const [category, setCategory] = useState(payable.accountingTreatment?.spotCategoryCode ?? "");
  const [categories, setCategories] = useState([]);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const confirmed = Boolean(payable.detraction?.confirmedAt);
  const legacyPartial = payable.status === "PARTIALLY_PAID" && !confirmed;
  const editable = !readOnly && ["Admin", "Accounting"].includes(user?.role) && (legacyPartial || (["OPEN", "SCHEDULED"].includes(payable.status) && !payable.paymentBatch && payable.outstandingAmount === payable.originalAmount));
  useEffect(() => {
    if (!editable || confirmed || payable.flowType === "C") return;
    api.get("/treasury/spot-categories", { params: { at: payable.voucher?.documentDate } }).then(response => setCategories(response.data.data || [])).catch(err => setError(err.message));
  }, [payable._id, editable, confirmed]);
  useEffect(() => {
    if (!editable || confirmed || payable.flowType === "C") return;
    let active = true;
    setPreview(null);
    api.post(`/accounting/accounts-payable/${payable._id}/detraction-preview`, { categoryCode: category }).then(response => { if (active) { setPreview(response.data.data); setError(""); } }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [payable._id, category, editable, confirmed]);
  if (payable.flowType === "C") return null;
  async function confirm() {
    setBusy(true); setError("");
    try { const response = await api.post(`/accounting/accounts-payable/${payable._id}/detraction-confirm`, { categoryCode: category }); onUpdated(response.data.data); }
    catch(err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="payable-group"><h3>{t("Accounting SPOT confirmation")}</h3>
    {confirmed ? <p>{t("Confirmed by Accounting")}{payable.detraction.confirmedBy?.name ? ` · ${payable.detraction.confirmedBy.name}` : ""} · {formatDateTime(payable.detraction.confirmedAt, language)}</p> : editable ? <>
      <Message type="error">{error}</Message>
      <label className="field"><span>{t("Detraction (SPOT)")}</span><select value={category} onChange={event => setCategory(event.target.value)}><option value="">{t("Not subject to SPOT")}</option>{[...new Map(categories.map(item => [item.code,item])).values()].map(item => <option key={item.code} value={item.code}>{item.code} · {item.description}</option>)}</select></label>
      {preview && <><p>{t("Detraction")}: <strong>{formatCurrency(preview.calculation.amountPen || 0, "PEN", language)}</strong> · {t("Net payable")}: <strong>{formatCurrency(preview.netAmount, payable.currency, language)}</strong>{preview.calculation.rate !== undefined ? ` · ${preview.calculation.rate}%` : ""}</p>
        {preview.calculation.status === "PENDING" && <p>{preview.bankAccountRegistered ? `${t("Banco de la Nación account")} · ****${preview.bankAccountLast4}` : t("Register the Banco de la Nación account in the supplier profile.")}</p>}</>}
      <button type="button" className="primary-button" disabled={busy || !preview || (preview.calculation.status === "PENDING" && !preview.bankAccountRegistered)} onClick={confirm}>{t("Confirm treatment and net amount")}</button>
    </> : <p>{t("Accounting confirmation pending")}</p>}
  </section>;
}
