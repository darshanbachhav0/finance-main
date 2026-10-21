import { supplierCreditDays } from "../../../../shared/invoiceFinance.mjs";

export default function CreditDaysField({ value = {}, onChange }) {
  return <div>
    <label className="field"><span>Días de crédito</span><select aria-label="Días de crédito" value={value.option || ""} onChange={event => {
      const option = event.target.value;
      onChange({ ...value, option, days: option === "CUSTOM" ? value.days || "" : supplierCreditDays({ option }) });
    }}>
      <option value="">Sin especificar</option><option value="CASH">Contado (0 días)</option>
      {[15, 30, 45, 60].map(days => <option key={days} value={`CREDIT_${days}`}>{days} días</option>)}
      <option value="CUSTOM">Personalizado</option>
    </select></label>
    {value.option === "CUSTOM" && <label className="field"><span>Días personalizados</span><input aria-label="Días personalizados" required type="number" min="1" step="1" value={value.days ?? ""} onChange={event => onChange({ ...value, days: event.target.value })} /></label>}
  </div>;
}
