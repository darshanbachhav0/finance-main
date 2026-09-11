import { useId, useRef, useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { BALANCE_TIMINGS, normalizePaymentTerms, validatePaymentTerms } from "../../../shared/paymentTerms.mjs";
import PaymentTermsSummary from "./PaymentTermsSummary.jsx";

const options = [
  ["100%_ADVANCE", "100% Advance", "Pay the full amount before starting"],
  ["100%_ON_DELIVERY", "100% On Delivery", "Pay the full amount on delivery"],
  ["ADVANCE_AND_BALANCE", "Advance + Balance", "Choose an advance, pay the rest later"]
];
const presets = [20, 30, 50];

export default function QuotationPaymentTerms({ quotation, onChange, errors = {}, errorPrefix = "" }) {
  const { t } = useLanguage();
  const id = useId();
  const percentageInput = useRef(null);
  const [customPercentage, setCustomPercentage] = useState(false);
  const condition = quotation.paymentCondition || "";
  const split = condition === "ADVANCE_AND_BALANCE";
  const supported = options.some(([value]) => value === condition);
  const validation = validatePaymentTerms(quotation);
  const percentageError = split && validation.find(error => error.field === "advancePercentage")?.message;
  const percentages = normalizePaymentTerms(quotation);
  const showSplit = supported && !percentageError;
  const errorFor = field => errors[`${errorPrefix}${field}`] || (field === "advancePercentage" ? percentageError : "");
  const errorText = field => errorFor(field) && <small className="field-error-text" id={`${id}-${field}-error`}>{t(errorFor(field))}</small>;
  const fieldProps = field => ({ "aria-invalid": Boolean(errorFor(field)), "aria-describedby": errorFor(field) ? `${id}-${field}-error` : undefined });
  const changeCondition = nextCondition => {
    setCustomPercentage(false);
    onChange(normalizePaymentTerms({
      paymentCondition: nextCondition,
      paymentNotes: quotation.paymentNotes || quotation.paymentConditions || "",
      ...(nextCondition === "ADVANCE_AND_BALANCE" ? { advancePercentage: 30, balanceTiming: "ON_DELIVERY" } : {})
    }));
  };
  const changePercentage = value => {
    setCustomPercentage(!presets.includes(Number(value)));
    const next = normalizePaymentTerms({ ...quotation, advancePercentage: value });
    onChange({ advancePercentage: value, balancePercentage: next.balancePercentage });
  };
  const extraErrors = ["balanceTiming", "balanceTimingNotes", "paymentNotes"].some(field => errorFor(field));

  return <fieldset className="quotation-payment-terms">
    <legend>{t("Payment conditions")}</legend>
    <div className="quotation-payment-options" role="radiogroup" aria-label={t("Payment condition")} {...fieldProps("paymentCondition")}>
      {options.map(([value, label, description]) => <label key={value} className={`quotation-payment-option${condition === value ? " selected" : ""}`}>
        <input type="radio" name={`${id}-paymentCondition`} value={value} checked={condition === value} onChange={() => changeCondition(value)} aria-label={t(label)} />
        <span><strong>{t(label)}</strong><small>{t(description)}</small></span>
      </label>)}
    </div>
    {errorText("paymentCondition")}
    {!supported && (condition || quotation.paymentConditions || quotation.paymentNotes) && <div className="payment-saved-terms">
      <strong>{t("Existing payment terms")}</strong><PaymentTermsSummary terms={quotation} />
      <p>{t("Saved terms are retained until you choose a payment option above.")}</p>
      {validation.filter(({ field }) => errorFor(field)).map(({ field }) => <div key={field}>{errorText(field)}</div>)}
    </div>}
    {split && <div className="quotation-advance-controls">
      <label className="field" htmlFor={`${id}-advancePercentage`}><span>{t("Advance percentage")}</span>
        <div className="quotation-percentage-input"><input id={`${id}-advancePercentage`} ref={percentageInput} aria-label={t("Advance percentage")} {...fieldProps("advancePercentage")} type="number" inputMode="decimal" min="0.01" max="99.99" step="0.01" value={quotation.advancePercentage ?? ""} onChange={event => changePercentage(event.target.value)} /><span aria-hidden="true">%</span></div>
        {errorText("advancePercentage")}
      </label>
      <input className="quotation-advance-slider" type="range" min="0.01" max="99.99" step="0.01" aria-label={t("Advance percentage slider")} {...fieldProps("advancePercentage")} aria-valuetext={percentageError ? t("Enter a valid advance percentage") : `${quotation.advancePercentage}% ${t("Advance")}`} value={percentageError ? 0.01 : quotation.advancePercentage} onChange={event => changePercentage(event.target.value)} />
      <div className="quotation-advance-presets" role="group" aria-label={t("Quick advance percentages")}>
        {presets.map(value => <button key={value} className="secondary-button" type="button" aria-pressed={!customPercentage && Number(quotation.advancePercentage) === value} onClick={() => changePercentage(value)}>{value}%</button>)}
        <button className="secondary-button" type="button" aria-pressed={customPercentage || !presets.includes(Number(quotation.advancePercentage))} onClick={() => { setCustomPercentage(true); percentageInput.current?.focus(); percentageInput.current?.select(); }}>{t("Custom")}</button>
      </div>
    </div>}
    {supported && <div className="payment-preview" aria-live="polite" aria-atomic="true">
      {showSplit && <div className="quotation-payment-split" role="img" aria-label={`${t("Advance")} ${percentages.advancePercentage}% | ${t("Balance")} ${percentages.balancePercentage}%`}>
        <div className="quotation-split-labels" aria-hidden="true"><span>{t("Advance")} <strong>{percentages.advancePercentage}%</strong></span><span>{t("Balance")} <strong>{percentages.balancePercentage}%</strong></span></div>
        <div className="quotation-split-bar" aria-hidden="true"><span style={{ width: `${percentages.advancePercentage}%` }} /><span style={{ width: `${percentages.balancePercentage}%` }} /></div>
      </div>}
      <PaymentTermsSummary terms={quotation} />
    </div>}
    {supported && <details className="quotation-payment-extra" open={extraErrors ? true : undefined}>
      <summary>{t("Additional terms (optional)")}</summary>
      {split && <label className="field"><span>{t("Balance payable")}</span><select aria-label={t("Balance payable")} {...fieldProps("balanceTiming")} value={quotation.balanceTiming || ""} onChange={event => onChange({ balanceTiming: event.target.value, balanceTimingNotes: "" })}>
        <option value="">{t("Select")}</option>{Object.entries(BALANCE_TIMINGS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
      </select>{errorText("balanceTiming")}</label>}
      {split && quotation.balanceTiming === "OTHER" && <label className="field"><span>{t("Describe when the balance is payable")} *</span><textarea aria-label={t("Describe when the balance is payable")} {...fieldProps("balanceTimingNotes")} rows="2" maxLength="4000" value={quotation.balanceTimingNotes || ""} onChange={event => onChange({ balanceTimingNotes: event.target.value })} />{errorText("balanceTimingNotes")}</label>}
      <label className="field"><span>{t("Payment notes")}</span><textarea aria-label={t("Payment notes")} {...fieldProps("paymentNotes")} rows="2" maxLength="4000" value={quotation.paymentNotes || ""} onChange={event => onChange({ paymentNotes: event.target.value })} />{errorText("paymentNotes")}</label>
    </details>}
  </fieldset>;
}
