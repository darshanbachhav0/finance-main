import { normalizePaymentTerms, paymentBreakdown, PAYMENT_CONDITIONS } from "../../../shared/paymentTerms.mjs";
import { formatCurrency } from "../utils/formatters.js";
import { useLanguage } from "../context/LanguageContext.jsx";
import "../styles/jefeDashboard.css";

export default function SupplierPaymentCondition({ value = {}, onChange, amount, currency }) {
  const { t, language } = useLanguage();
  const advance = ["100%_ADVANCE", "ADVANCE_AND_BALANCE"].includes(value.paymentCondition);
  const split = value.paymentCondition === "ADVANCE_AND_BALANCE";
  const breakdown = advance ? paymentBreakdown(value, amount) : null;
  const money = number => formatCurrency(number, currency, language);
  return <div className="supplier-payment-condition">
    <label className="field"><span>Condición de pago</span><select aria-label="Condición de pago" value={value.paymentCondition || ""} onChange={event => onChange(normalizePaymentTerms({
      paymentCondition: event.target.value,
      ...(event.target.value === "ADVANCE_AND_BALANCE" ? { advancePercentage: 30, balanceTiming: "ON_DELIVERY" } : {}),
      ...(event.target.value === "CREDIT" ? { creditDays: value.creditDays || "", creditStart: "INVOICE" } : {})
    }))}>
      <option value="">Según condiciones del proveedor</option>
      {Object.entries(PAYMENT_CONDITIONS).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}
    </select></label>
    {value.paymentCondition === "CREDIT" && <div className="form-grid two-column-form">
      <label className="field"><span>Días de crédito acordados</span><input aria-label="Días de crédito acordados" required type="number" min="1" step="1" value={value.creditDays ?? ""} onChange={event => onChange({ ...value, creditDays: event.target.value })} /></label>
      <label className="field"><span>Desde</span><select aria-label="Inicio del crédito" value={value.creditStart || "INVOICE"} onChange={event => onChange({ ...value, creditStart: event.target.value })}><option value="INVOICE">Emisión del comprobante</option><option value="CONFORMITY">Conformidad</option></select></label>
    </div>}
    {advance && <fieldset className="supplier-advance-calculator"><legend>Calculadora de adelanto al proveedor</legend>
      <dl className="detail-grid"><div><dt>Importe total</dt><dd>{money(amount)}</dd></div></dl>
      <div className="form-grid two-column-form">
        <label className="field"><span>Porcentaje de adelanto</span><input aria-label="Porcentaje de adelanto" type="number" min="0.01" max={split ? "99.999999" : "100"} step="any" readOnly={!split} value={split ? breakdown?.advancePercentage ?? value.advancePercentage ?? "" : 100} onChange={event => onChange({ ...value, plannedAdvanceAmount: null, advancePercentage: event.target.value })} /></label>
        <label className="field"><span>Monto del adelanto ({currency})</span><input aria-label="Monto del adelanto" type="number" min="0.01" max={amount} step="0.01" readOnly={!split || !Number(amount)} value={value.plannedAdvanceAmount ?? breakdown?.advanceAmount ?? ""} onChange={event => onChange({ ...value, plannedAdvanceAmount: event.target.value, advancePercentage: Number(amount) > 0 ? Number((Number(event.target.value) / Number(amount) * 100).toFixed(6)) : "" })} /></label>
      </div>
      <p aria-live="polite">Saldo pendiente: <strong>{breakdown ? money(breakdown.balanceAmount) : "—"}</strong></p>
      {!breakdown && <small className="field-error-text">Ingrese un importe y un porcentaje válidos. El adelanto no puede superar el saldo pendiente.</small>}
      {split && <details><summary>Condiciones del saldo</summary><label className="field"><span>Saldo pagadero</span><select value={value.balanceTiming || "ON_DELIVERY"} onChange={event => onChange({ ...value, balanceTiming: event.target.value })}><option value="ON_DELIVERY">A la entrega</option><option value="ON_CONFORMITY">A la conformidad</option><option value="SERVICE_COMPLETION">Al completar el servicio</option><option value="AFTER_INVOICE">Después de la factura</option></select></label></details>}
    </fieldset>}
    {value.paymentCondition === "PARTIAL_PAYMENTS" && <label className="field"><span>Número de pagos</span><input type="number" required min="2" step="1" value={value.partialPaymentCount ?? ""} onChange={event => onChange({ ...value, partialPaymentCount: event.target.value })} /></label>}
    {["PARTIAL_PAYMENTS", "OTHER"].includes(value.paymentCondition) && <label className="field"><span>Condiciones acordadas</span><textarea required rows="2" maxLength="4000" value={value.paymentNotes || ""} onChange={event => onChange({ ...value, paymentNotes: event.target.value })} /></label>}
  </div>;
}
