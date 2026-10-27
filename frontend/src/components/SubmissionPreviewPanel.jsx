import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Route, ShieldCheck, XCircle } from "lucide-react";
import api from "../api/client.js";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency, formatDate } from "../utils/formatters.js";

const STEP_LABELS = {
  RESPONSIBLE: "Cost center responsible",
  BENEFICIARY: "Visto of the cost center charged",
  SUPERIOR: "Superior in the cascade",
  JEFE: "Your jefe",
  GAF: "Gerencia de Administración Financiera",
  GENERAL_MANAGEMENT: "Gerencia General",
  TREASURY_HEAD: "Jefe de Tesorería"
};

const WINDOW_LABELS = {
  SAME_DAY: "Same day (P1)",
  URGENCY: "Weekly urgency window",
  FORTNIGHT: "Fortnightly payment day",
  AGREED_DATE: "Agreed date"
};

// "Validación en línea", "Ruta de aprobación" and "Pago estimado" (Manual del usuario): what the
// platform checks before sending, who will approve and when it would be paid, for the form as it is.
// Nothing is saved; the same checks run again when the request is sent.
export default function SubmissionPreviewPanel({ payload, enabled = true }) {
  const { t, language } = useLanguage();
  // A check's text in the interface language: its template translated, then its values filled in.
  const fill = (template, params = {}) => t(template).replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? ""));
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const serialized = JSON.stringify(payload);

  useEffect(() => {
    if (!enabled) { setResult(null); return undefined; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setBusy(true);
      setError("");
      try {
        const response = await api.post("/requests/submission-preview", JSON.parse(serialized), { signal: controller.signal, timeout: 15000 });
        if (!controller.signal.aborted) setResult(response.data.data);
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 700);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [serialized, enabled]);

  if (!enabled) return null;
  const checks = result?.checks || [];
  const steps = result?.route?.steps || [];
  const amount = result?.amount;
  return <aside className="submission-preview" aria-live="polite" aria-busy={busy}>
    <section>
      <h3><ShieldCheck size={16} aria-hidden="true" /> {t("Online validation")}</h3>
      {error && <p className="submission-preview-error" role="alert">{error}</p>}
      {!error && !checks.length && <p className="field-hint">{t(busy ? "Checking..." : "No additional checks apply to this request yet.")}</p>}
      <ul className="submission-checks">
        {checks.map((item) => {
          const Icon = item.ok ? CheckCircle2 : item.warning ? AlertTriangle : XCircle;
          const state = item.ok ? "ok" : item.warning ? "warning" : "fail";
          return <li key={item.code} className={`submission-check submission-check-${state}`}>
            <Icon size={16} aria-hidden="true" />
            <span><strong>{item.template ? fill(item.template.title, item.template.titleParams) : t(item.title)}</strong><small>{item.template ? fill(item.template.detail, item.template.detailParams) : t(item.detail)}</small></span>
          </li>;
        })}
      </ul>
    </section>
    <section>
      <h3><Route size={16} aria-hidden="true" /> {t("Approval route")}</h3>
      {amount?.amountUit != null && <p className="field-hint">{formatCurrency(amount.total, amount.currency, language)}{amount.currency !== "PEN" ? ` ≈ ${formatCurrency(amount.penEquivalent, "PEN", language)}` : ""} = {amount.amountUit.toFixed(2)} UIT</p>}
      {result?.route?.error && <p className="submission-preview-error">{t(result.route.error)}</p>}
      {steps.length > 0 && <ol className="submission-route">
        {steps.map((step) => <li key={step.sequence}>
          <strong>{t(STEP_LABELS[step.kind] || step.label)}{step.costCenterCode ? ` · ${step.costCenterCode}` : ""}</strong>
          <small>{step.approverName ? `${step.approverName}${step.coveringForName ? ` (${t("covering for")} ${step.coveringForName})` : ""}` : t("Any active user of the role")}</small>
        </li>)}
      </ol>}
    </section>
    {result?.payment && <section>
      <h3><CalendarClock size={16} aria-hidden="true" /> {t("Estimated payment")}</h3>
      <p><strong>{formatDate(`${result.payment.date}T12:00:00.000Z`, language)}</strong> · {t(WINDOW_LABELS[result.payment.window] || result.payment.window)}</p>
      <small className="field-hint">{t("Treasury confirms the date when it schedules the payment.")}</small>
    </section>}
  </aside>;
}
