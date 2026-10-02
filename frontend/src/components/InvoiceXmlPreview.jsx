import { useState } from "react";
import api from "../api/client.js";
import { useLanguage } from "../context/LanguageContext.jsx";
export default function InvoiceXmlPreview({ expected = {}, onApply }) {
  const { t } = useLanguage();
  const [data, setData] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function preview(file) {
    if (!file) return;
    setBusy(true); setError(""); setData(null);
    try { const body = new FormData(); body.append("xml", file); const response = await api.post("/operations/xml-preview", body); setData(response.data.data); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <details className="workspace-panel form-span-two"><summary>{t("Read invoice XML before posting")}</summary><p>{t("Preview only. Original evidence is unchanged; this does not verify the invoice with SUNAT.")}</p>
    <input aria-label={t("Invoice XML")} type="file" accept=".xml" disabled={busy} onChange={event => preview(event.target.files[0])} />
    {error && <p role="alert">{error}</p>}
    {data && <><dl className="detail-grid">{Object.entries(data).filter(([key, value]) => value !== null && typeof value !== "object").map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{String(value)}{expected[key] !== undefined && String(expected[key]) !== String(value) && <strong> — {t("Entered value")}: {String(expected[key])}</strong>}</dd></div>)}</dl>{onApply && <button type="button" className="secondary-button" onClick={() => onApply(data)}>{t("Use these invoice fields")}</button>}</>}
  </details>;
}
