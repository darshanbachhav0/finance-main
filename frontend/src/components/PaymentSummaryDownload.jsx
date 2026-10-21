import { useState } from "react";
import api from "../api/client.js";
import { useLanguage } from "../context/LanguageContext.jsx";
import Message from "./Message.jsx";
export default function PaymentSummaryDownload({ batch }) {
  const { t } = useLanguage(); const [error,setError] = useState(""); const [busy,setBusy] = useState(false);
  async function download() {
    setBusy(true); setError("");
    try { const response = await api.get(`/treasury/bank-files/${batch._id}/summary`, { params: { format: "csv" }, responseType: "blob" });
      const url = URL.createObjectURL(response.data); const link = document.createElement("a"); link.href = url; link.download = `${batch.batchNumber}-resumen.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
    } catch(error) { setError(error.message); } finally { setBusy(false); }
  }
  return <><button type="button" className="text-button" disabled={busy} onClick={download}>{t("Download supplier summary")}</button><Message type="error">{error}</Message></>;
}
