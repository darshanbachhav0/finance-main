import { AlertTriangle, DollarSign } from "lucide-react";
import { useEffect, useState } from "react";
import api from "../api/client.js";
import { useLanguage } from "../context/LanguageContext.jsx";

// Today's official SBS USD/PEN rate on the home page (pilot "Tipo de cambio SBS del día"): sell
// and buy, the date it was published for and its source. Kept current by the server.
export default function ExchangeRateChip() {
  const { t } = useLanguage();
  const [data, setData] = useState(null);

  useEffect(() => {
    let active = true;
    api.get("/exchange-rates/applicable").then((response) => { if (active) setData(response.data.data); }).catch(() => {});
    return () => { active = false; };
  }, []);

  if (!data) return null;
  const rate = data.rate;
  const warning = !rate || !rate.official || data.lastSync?.stale;
  const title = rate
    ? `${t("Official SBS exchange rate")} · ${t(rate.sourceLabel)} · ${t("Published for")} ${rate.rateDate}${rate.sbsClosingDate ? ` (${t("SBS close of")} ${rate.sbsClosingDate})` : ""}`
    : t(data.unavailable || "No official rate is available yet.");
  return (
    <span className={`exchange-rate-chip${warning ? " is-warning" : ""}`} title={title}>
      {warning ? <AlertTriangle size={14} aria-hidden="true" /> : <DollarSign size={14} aria-hidden="true" />}
      {rate
        ? <span>{t("USD sell")} <strong>{Number(rate.sellRate).toFixed(3)}</strong>{rate.buyRate ? ` · ${t("buy")} ${Number(rate.buyRate).toFixed(3)}` : ""} · {rate.rateDate}</span>
        : <span>{t("No official exchange rate")}</span>}
    </span>
  );
}
