import { useEffect, useState } from "react";
import api from "../api/client.js";
import { useLanguage } from "../context/LanguageContext.jsx";
export default function PadronStatus() {
  const { t } = useLanguage();
  const [status,setStatus]=useState(null), [error,setError]=useState("");
  useEffect(()=>{let active=true;async function load(){if(document.hidden)return;try{const response=await api.get("/sunat-padron/status");if(active){setStatus(response.data.data);setError("");}}catch(e){if(active)setError(e.message);}}void load();const timer=setInterval(load,15000);return()=>{active=false;clearInterval(timer);};},[]);
  const sync=status?.synchronization || {};
  const date=value=>value?new Date(value).toLocaleString():"—";
  return <details className="workspace-panel"><summary>SUNAT Padrón · {t(!status ? "Loading..." : !status.ready ? "Preparation pending" : !status.acceptablyStale ? "Expired" : status.fresh ? "Ready" : "Update pending")}</summary>
    {error && <p role="alert">{error}</p>}
    {status && <dl className="detail-grid"><div><dt>{t("Updater")}</dt><dd>{t(status.worker?.running ? "Running" : "Not running")}</dd></div><div><dt>{t("Next check")}</dt><dd>{date(status.worker?.nextCheckAt)}</dd></div><div><dt>{t("Dataset date")}</dt><dd>{status.manifest?.datasetDate || "—"}</dd></div><div><dt>{t("Last successful check")}</dt><dd>{date(status.manifest?.lastCheckedAt)}</dd></div><div><dt>{t("Update status")}</dt><dd>{t(sync.phase || "IDLE")}</dd></div><div><dt>{t("Indexed records")}</dt><dd>{Number(sync.rows || status.manifest?.rows || 0).toLocaleString()}</dd></div><div><dt>{t("Last update activity")}</dt><dd>{date(sync.updatedAt)}</dd></div></dl>}
    {sync.error && <p role="alert">{sync.error}</p>}
    <p>{t("Updates run separately. Missing or expired data does not bypass taxpayer validation.")}</p>
  </details>;
}
