import { CONSULTA_RUC_URL } from "../../../../shared/consultaRuc.mjs";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { useEffect, useRef, useState } from "react";
import api from "../../api/client.js";

export default function ConsultaRucLink({ pending = false, ruc = "", assistedAvailable = false, onVerified }) {
  const { t } = useLanguage();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef(null);
  useEffect(() => {
    setWorking(false);
    setError("");
    return () => { attempt.current?.abort(); };
  }, [ruc]);
  async function verify() {
    const controller = new AbortController();
    attempt.current?.abort();
    attempt.current = controller;
    setWorking(true);
    setError("");
    try {
      const response = await api.post(`/suppliers/consulta-ruc/${ruc}/assisted`, {}, { signal: controller.signal, timeout: 195000 });
      if (controller.signal.aborted) return;
      if (response.data?.ruc !== ruc) throw new Error("SUNAT returned an unexpected RUC.");
      onVerified?.(response.data);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message);
    } finally {
      if (attempt.current === controller) setWorking(false);
    }
  }
  return <div className="field-hint">
    {pending && assistedAvailable && onVerified && /^\d{11}$/.test(ruc) && <>
      <button type="button" className="secondary-button" disabled={working} onClick={() => void verify()}>{t("Verify in SUNAT browser")}</button>
      {working && <div role="status"><p>{t("Complete any verification in the SUNAT window on this computer. We will read the result and fill the supplier details.")}</p><button type="button" className="text-button" onClick={() => { attempt.current?.abort(); setWorking(false); }}>{t("Cancel")}</button></div>}
      {error && <p role="alert">{t(error)}</p>}
    </>}
    <a href={CONSULTA_RUC_URL} target="_blank" rel="noopener noreferrer">{t("Open SUNAT Consulta RUC")}</a>
    {pending && <p>{t("Automatic SUNAT verification is pending. Details entered manually require Accounting review.")}</p>}
  </div>;
}
