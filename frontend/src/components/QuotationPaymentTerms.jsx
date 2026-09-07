import { useId, useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { BALANCE_TIMINGS, CREDIT_STARTS, PAYMENT_CONDITIONS, normalizePaymentTerms } from "../../../shared/paymentTerms.mjs";
import PaymentTermsSummary from "./PaymentTermsSummary.jsx";

const creditPresets = [15, 30, 45, 60];

export default function QuotationPaymentTerms({ quotation, onChange, errors = {}, errorPrefix = "" }) {
  const { t } = useLanguage();
  const id = useId();
  const [customCredit, setCustomCredit] = useState(false);
  const condition = quotation.paymentCondition || "";
  const fieldLabels = {
    paymentCondition: "Payment condition", advancePercentage: "Advance percentage", balanceTiming: "Balance payable",
    balanceTimingNotes: "Describe when the balance is payable", creditDays: "Credit days", creditStart: "Credit period starts after",
    partialPaymentCount: "Number of payments", paymentNotes: condition === "OTHER" ? "Describe the payment condition" : condition === "PARTIAL_PAYMENTS" ? "Payment details" : "Payment notes"
  };
  const errorFor = (field) => errors[`${errorPrefix}${field}`];
  const fieldProps = (field) => ({ id: `${id}-${field}`, "aria-label": t(fieldLabels[field]), "aria-invalid": Boolean(errorFor(field)), "aria-describedby": errorFor(field) ? `${id}-${field}-error` : undefined });
  const errorText = (field) => errorFor(field) && <small className="field-error-text" id={`${id}-${field}-error`}>{t(errorFor(field))}</small>;
  const changeCondition = (nextCondition) => {
    const defaults = nextCondition === "ADVANCE_AND_BALANCE" ? { balanceTiming: "ON_DELIVERY" } : nextCondition === "CREDIT" ? { creditDays: 30, creditStart: "INVOICE" } : {};
    setCustomCredit(false);
    onChange(normalizePaymentTerms({ paymentCondition: nextCondition, paymentNotes: quotation.paymentNotes || quotation.paymentConditions || "", ...defaults }));
  };
  const creditSelection = customCredit || !creditPresets.includes(Number(quotation.creditDays)) ? "OTHER" : String(quotation.creditDays);

  return <fieldset className="quotation-payment-terms">
    <legend>{t("Payment conditions")}</legend>
    <label className="field" htmlFor={`${id}-paymentCondition`}><span>{t("Payment condition")}</span>
      <select {...fieldProps("paymentCondition")} value={condition} onChange={(event) => changeCondition(event.target.value)}>
        <option value="">{t("Not specified")}</option>
        {Object.entries(PAYMENT_CONDITIONS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
      </select>{errorText("paymentCondition")}
    </label>
    {!condition && quotation.paymentConditions && <label className="field"><span>{t("Existing payment terms")}</span><textarea rows="2" maxLength="4000" value={quotation.paymentConditions} onChange={(event) => onChange({ paymentConditions: event.target.value })} /></label>}
    {condition === "ADVANCE_AND_BALANCE" && <>
      <label className="field"><span>{t("Advance percentage")} *</span><input {...fieldProps("advancePercentage")} type="number" min="0.01" max="99.99" step="0.01" value={quotation.advancePercentage ?? ""} onChange={(event) => onChange({ advancePercentage: event.target.value })} />{errorText("advancePercentage")}</label>
      <label className="field"><span>{t("Balance payable")} *</span><select {...fieldProps("balanceTiming")} value={quotation.balanceTiming || ""} onChange={(event) => onChange({ balanceTiming: event.target.value, balanceTimingNotes: "" })}>
        <option value="">{t("Select")}</option>{Object.entries(BALANCE_TIMINGS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
      </select>{errorText("balanceTiming")}</label>
      {quotation.balanceTiming === "OTHER" && <label className="field"><span>{t("Describe when the balance is payable")} *</span><textarea {...fieldProps("balanceTimingNotes")} rows="2" maxLength="4000" value={quotation.balanceTimingNotes || ""} onChange={(event) => onChange({ balanceTimingNotes: event.target.value })} />{errorText("balanceTimingNotes")}</label>}
    </>}
    {condition === "CREDIT" && <>
      <label className="field"><span>{t("Credit period")} *</span><select aria-label={t("Credit period")} value={creditSelection} onChange={(event) => { const custom = event.target.value === "OTHER"; setCustomCredit(custom); onChange({ creditDays: custom ? "" : Number(event.target.value) }); }}>
        {creditPresets.map((days) => <option value={days} key={days}>{t("{days} days").replace("{days}", String(days))}</option>)}<option value="OTHER">{t("Other")}</option>
      </select></label>
      {creditSelection === "OTHER" && <label className="field"><span>{t("Credit days")} *</span><input {...fieldProps("creditDays")} type="number" min="1" step="1" value={quotation.creditDays ?? ""} onChange={(event) => onChange({ creditDays: event.target.value })} />{errorText("creditDays")}</label>}
      <label className="field"><span>{t("Credit period starts after")} *</span><select {...fieldProps("creditStart")} value={quotation.creditStart || ""} onChange={(event) => onChange({ creditStart: event.target.value })}>
        <option value="">{t("Select")}</option>{Object.entries(CREDIT_STARTS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
      </select>{errorText("creditStart")}</label>
    </>}
    {condition === "PARTIAL_PAYMENTS" && <label className="field"><span>{t("Number of payments")} *</span><input {...fieldProps("partialPaymentCount")} type="number" min="2" step="1" value={quotation.partialPaymentCount ?? ""} onChange={(event) => onChange({ partialPaymentCount: event.target.value })} />{errorText("partialPaymentCount")}</label>}
    {(condition || quotation.paymentNotes) && <label className="field"><span>{t(condition === "OTHER" ? "Describe the payment condition" : condition === "PARTIAL_PAYMENTS" ? "Payment details" : "Payment notes")}{["OTHER", "PARTIAL_PAYMENTS"].includes(condition) ? " *" : ""}</span>
      <textarea {...fieldProps("paymentNotes")} rows="2" maxLength="4000" value={quotation.paymentNotes || ""} placeholder={condition === "PARTIAL_PAYMENTS" ? t("30% at start, 40% at 50% progress, 30% on final delivery") : ""} onChange={(event) => onChange({ paymentNotes: event.target.value })} />{errorText("paymentNotes")}
    </label>}
    {condition && <div className="payment-preview" aria-live="polite"><PaymentTermsSummary terms={quotation} /></div>}
  </fieldset>;
}
