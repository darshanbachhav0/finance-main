import { Compass } from "lucide-react";
import { useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { TRACK_RESULTS as RESULTS, recommendTrack } from "../utils/trackRecommendation.js";

// Three short questions that choose the track (A1, B or C) for someone unsure which one fits.

function Question({ legend, name, value, options, onChange }) {
  const { t } = useLanguage();
  return (
    <fieldset className="track-question">
      <legend>{t(legend)}</legend>
      <div>{options.map(([optionValue, label]) => (
        <label key={optionValue} className={value === optionValue ? "selected" : ""}>
          <input type="radio" name={name} value={optionValue} checked={value === optionValue} onChange={() => onChange(optionValue)} />
          <span>{t(label)}</span>
        </label>
      ))}</div>
    </fieldset>
  );
}

export default function TrackPicker({ onChoose }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState({});
  const answer = (key) => (value) => setAnswers((current) => ({ ...current, [key]: value, ...(key === "payee" ? { spent: undefined, hasInvoice: undefined, needsOrder: undefined } : key === "hasInvoice" ? { needsOrder: undefined } : {}) }));
  const resultKey = recommendTrack(answers);
  const result = resultKey && RESULTS[resultKey];

  return (
    <div className="track-picker">
      <button type="button" className="text-button" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Compass size={15} aria-hidden="true" />{t("Not sure? Help me choose")}</button>
      {open && (
        <div className="track-picker-panel">
          <Question legend="Who receives the money?" name="track-payee" value={answers.payee} onChange={answer("payee")} options={[["supplier", "A supplier"], ["employee", "Me, as an employee"]]} />
          {answers.payee === "employee" && <Question legend="Have you already spent it?" name="track-spent" value={answers.spent} onChange={answer("spent")} options={[["no", "No, I need an advance"], ["yes", "Yes, and I have no receipt"]]} />}
          {answers.payee === "supplier" && <Question legend="Do you already have the supplier's invoice?" name="track-invoice" value={answers.hasInvoice} onChange={answer("hasInvoice")} options={[["yes", "Yes"], ["no", "Not yet"]]} />}
          {answers.payee === "supplier" && answers.hasInvoice === "yes" && <Question legend="Does it need quotations or a purchase order?" name="track-order" value={answers.needsOrder} onChange={answer("needsOrder")} options={[["no", "No, it is a direct payment"], ["yes", "Yes"]]} />}
          {result && (
            <div className="track-result" role="status">
              <strong>{t(result.title)}</strong>
              <p>{t(result.reason)}</p>
              <button type="button" className="primary-button" onClick={() => { onChoose(result); setOpen(false); }}>{t("Use this track")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
