import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client.js";
import { useLanguage } from "../context/LanguageContext.jsx";
export default function ReadinessPanel({ requestId, revision, payload, paymentPayload, defaultOpen = false }) {
  const { t } = useLanguage();
  const [result, setResult] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const serialized = JSON.stringify(paymentPayload || payload);
  async function check(signal) {
    setBusy(true); setError(""); setResult(null);
    try { const response = requestId ? await api.get(`/operations/requests/${requestId}`, { signal }) : await api.post(paymentPayload ? "/operations/payments" : "/operations/submission", JSON.parse(serialized), { signal }); if (!signal?.aborted) setResult(response.data.data); }
    catch (error) { if (!signal?.aborted) setError(error.message); }
    finally { if (!signal?.aborted) setBusy(false); }
  }
  useEffect(() => { const controller = new AbortController(); const timer = setTimeout(() => check(controller.signal), 1000); return () => { clearTimeout(timer); controller.abort(); }; }, [requestId, revision, serialized]);
  return <details className="workspace-panel section-spacer" open={defaultOpen || undefined}><summary>{t("Readiness check")} {busy ? t("Checking...") : result?.issues?.length ? `(${result.issues.length})` : ""}</summary>
    {error && <p role="alert">{error}</p>}
    {result?.next && <p><strong>{t(result.next.message)}</strong> · {t(result.next.owner)}</p>}
    {result?.issues?.map((issue, index) => <p key={index}>{t(issue.message)} <small>— {t(issue.owner)}</small>{requestId && issue.path && <Link to={issue.path}> · {t("View")}</Link>}</p>)}
    {result && !result.issues?.length && <p>{t("No blockers found by this preview. Final checks run when you submit the action.")}</p>}
    {result?.budget && <p>{t("Budget")}: {t(result.budget.status)} · PEN {Number(result.budget.totalRequested || 0).toFixed(2)}</p>}
    <button type="button" className="secondary-button" disabled={busy} onClick={() => check()}>{t("Refresh")}</button>
  </details>;
}
