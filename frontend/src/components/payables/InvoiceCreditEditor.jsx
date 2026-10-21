import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import api from "../../api/client.js";
import DateInput from "../DateInput.jsx";
import Message from "../Message.jsx";
import { calendarDateKey } from "../../../../shared/businessCalendar.mjs";
import { invoiceDueDate, supplierCreditDays } from "../../../../shared/invoiceFinance.mjs";

export default function InvoiceCreditEditor({ payable, onUpdated }) {
  const { user, readOnly } = useAuth();
  const [days, setDays] = useState("");
  const [due, setDue] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDays(payable.paymentTermsSnapshot?.creditDays ?? supplierCreditDays(payable.paymentTermsSnapshot) ?? "");
    setDue(payable.dueDate ? calendarDateKey(payable.dueDate) : "");
    setReason(""); setError("");
  }, [payable]);
  if (readOnly || !["Admin", "Accounting"].includes(user?.role) || payable.flowType === "C" || !["OPEN", "PARTIALLY_PAID"].includes(payable.status)) return null;
  async function save() {
    setSaving(true); setError("");
    try {
      const response = await api.patch(`/accounting/accounts-payable/${payable._id}/credit-terms`, { creditDays: days, dueDate: due, reason });
      onUpdated(response.data.data);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }
  return <details className="payable-group"><summary>Ajustar condiciones de esta factura</summary>
    <p className="muted-text">Conserva el vencimiento contractual o ingresa la fecha acordada. El cambio requiere un motivo.</p>
    <div className="form-grid two-column-form">
      <label className="field"><span>Días de crédito</span><input type="number" min="0" max="36500" step="1" value={days} onChange={event => setDays(event.target.value)} /></label>
      <label className="field"><span>Vencimiento acordado</span><DateInput value={due} onChange={event => setDue(event.target.value)} /></label>
    </div>
    <button type="button" className="text-button" onClick={() => setDue(invoiceDueDate(payable.voucher?.documentDate, { option: "CUSTOM", days }) || "")}>Calcular desde la emisión</button>
    <label className="field"><span>Motivo</span><textarea rows="2" maxLength="2000" value={reason} onChange={event => setReason(event.target.value)} /></label>
    <Message type="error">{error}</Message>
    <button type="button" className="secondary-button" disabled={saving || !reason.trim() || days === "" || !due} onClick={save}>{saving ? "Guardando…" : "Guardar condiciones"}</button>
  </details>;
}
