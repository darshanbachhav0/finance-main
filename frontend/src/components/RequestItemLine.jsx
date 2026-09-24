import { Trash2 } from "lucide-react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency } from "../utils/formatters.js";

const units = ["UNIT", "SERVICE", "HOUR", "DAY", "MONTH", "SET", "BOX", "KG", "LITER", "METER"];

export default function RequestItemLine({ line, index, currency, errors = {}, onChange, onRemove, canRemove }) {
  const { t, language } = useLanguage();
  const amount = value => formatCurrency(value, currency, language);
  const errorFor = field => errors[`lines.${index}.${field}`];
  const errorText = field => errorFor(field) && <small className="field-error-text">{t(errorFor(field))}</small>;
  return <div className="official-line request-item-card" data-motion-key={line.clientId}>
    <div className="official-line-head"><strong>{t("Item")} {index + 1}</strong><button type="button" className="icon-button danger" onClick={onRemove} disabled={!canRemove} aria-label={`${t("Remove line")} ${index + 1}`} title={t("Remove line")}><Trash2 size={16} /></button></div>
    <label className="field"><span>{t("Item / service description")} *</span><input value={line.itemDescription} onChange={event => onChange({ itemDescription: event.target.value })} aria-invalid={Boolean(errorFor("itemDescription"))} />{errorText("itemDescription")}</label>
    <div className="request-item-inputs">
      <label className="field"><span>{t("Quantity")} *</span><input type="number" inputMode="decimal" min="0.00000001" step="any" value={line.quantity} onChange={event => onChange({ quantity: event.target.value })} aria-invalid={Boolean(errorFor("quantity"))} />{errorText("quantity")}</label>
      <label className="field"><span>{t("Unit of measure")} *</span><select value={line.unitOfMeasure} onChange={event => onChange({ unitOfMeasure: event.target.value })} aria-invalid={Boolean(errorFor("unitOfMeasure"))}>{!units.includes(line.unitOfMeasure) && <option value={line.unitOfMeasure}>{line.unitOfMeasure || t("Select")}</option>}{units.map(unit => <option key={unit} value={unit}>{t(unit)}</option>)}</select>{errorText("unitOfMeasure")}</label>
      <label className="field"><span>{t("Unit price")} ({currency}) *</span><input type="number" inputMode="decimal" min="0.01" step="0.01" value={line.unitPrice} onChange={event => onChange({ unitPrice: event.target.value })} aria-invalid={Boolean(errorFor("unitPrice"))} />{errorText("unitPrice")}</label>
    </div>
    <label className="request-igv-toggle"><input type="checkbox" checked={line.priceIncludesIGV === true} ref={element => { if (element) element.indeterminate = Boolean(line.legacyAmounts); }} onChange={event => onChange({ priceIncludesIGV: event.target.checked })} /><span>{t("Unit price already includes IGV (18%)")}</span></label>
    {line.legacyAmounts && <p className="section-note">{t("Previously saved amounts are retained. Change quantity, unit price or the IGV option to use automatic calculation.")}</p>}
    <div className="request-item-result">
      <div className="request-item-calculation">{!line.legacyAmounts && <><span>{t("Subtotal")}<strong>{amount(line.subtotal)}</strong></span><span>{t("IGV (18%)")}<strong>{line.priceIncludesIGV ? t("Included") : amount(line.igvAmount)}</strong></span></>}</div>
      <div className="request-item-final"><span>{t("Final total")}</span><output aria-label={t("Final total")} aria-live="polite" aria-atomic="true">{amount(line.totalAmount)}</output>{errorText("totalAmount")}</div>
    </div>
  </div>;
}
