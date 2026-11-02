import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import api from "../api/client.js";
import ResourceManager from "../components/ResourceManager.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { formatDateTime } from "../utils/formatters.js";

// Official SBS USD/PEN rates (compra and venta) arrive on their own: the server synchronizes them
// every hour from SUNAT's published table and BCRPData, with nobody signed in. This page shows the
// rate that applies today, how current the synchronization is, and the history. A person may only
// add a manual reference rate, which is labelled as such and used only where the server allows it.

const day = (value) => String(value || "").slice(0, 10);
const four = (value) => value === null || value === undefined || value === "" ? "-" : Number(value).toFixed(4);
const official = (row) => row.providerMode === "SBS" && row.authoritative;
const SYNC_STATUS = { OK: "Synchronized", PARTIAL: "Partially synchronized", FAILED: "Not synchronized" };

function payload(form) {
  return {
    date: form.date,
    period: form.period || form.date?.slice(0, 7),
    buyRate: form.buyRate === "" || form.buyRate === undefined ? undefined : Number(form.buyRate),
    sellRate: Number(form.sellRate || form.rate || 0),
    rate: Number(form.sellRate || form.rate || 0),
    sourceLabel: form.sourceLabel,
    currency: "USD",
    quoteCurrency: "PEN",
    active: true
  };
}

function ApplicableRate({ data, syncing, onSync }) {
  const { t, language } = useLanguage();
  if (!data) return null;
  const rate = data.rate;
  const stale = data.lastSync?.stale;
  const tone = !rate || stale || !rate.official ? "warning" : "success";
  return (
    <div className={`exchange-rate-evidence ${tone}`}>
      <div>
        <strong>{t("Applicable rate today")} ({data.requestedDate})</strong>
        {rate ? (
          <span>
            {t("Buy")} {four(rate.buyRate)} · {t("Sell")} <b>{four(rate.sellRate)}</b> · {t(rate.sourceLabel)} · {t("Published for")} {rate.rateDate}
            {rate.sbsClosingDate ? ` (${t("SBS close of")} ${rate.sbsClosingDate})` : ""}
          </span>
        ) : <span>{t(data.unavailable || "No official rate is available yet.")}</span>}
        {rate && rate.rateDate !== data.requestedDate && <small>{t("No new publication applies to this date (weekend, holiday or not yet published): the latest valid rate is used, with its own date.")}</small>}
        {rate?.fallback?.used && !rate.official && <small>{t("Manual reference rate, used because no official rate could be retrieved.")}</small>}
        {data.lastSync && <small>{t("Last synchronization")}: {formatDateTime(data.lastSync.finishedAt, language)} · {t(SYNC_STATUS[data.lastSync.status] || data.lastSync.status)}{data.lastSync.sources?.map((source) => ` · ${source.source}: ${t(source.status === "OK" ? "answered" : "did not answer")}`).join("")}</small>}
      </div>
      <div className="exchange-rate-evidence-badges">
        {rate && <StatusBadge status={rate.official ? "VERIFIED" : "NOT_VERIFIED"} />}
        {stale && <span className="inline-flag"><AlertTriangle size={14} aria-hidden="true" /> {t("Out of date")}</span>}
        {!stale && rate?.official && <span className="inline-flag"><CheckCircle2 size={14} aria-hidden="true" /> {t("Up to date")}</span>}
        <button type="button" className="secondary-button" onClick={onSync} disabled={syncing} title={t("Retrieve the latest official SBS rates now.")}>
          <RefreshCw className={syncing ? "spin" : ""} size={16} aria-hidden="true" />
          <span>{t(syncing ? "Synchronizing..." : "Synchronize now")}</span>
        </button>
      </div>
    </div>
  );
}

export default function ExchangeRates() {
  const { t } = useLanguage();
  const { notify } = useToast();
  const [applicable, setApplicable] = useState(null);
  const [syncing, setSyncing] = useState(false);

  async function loadApplicable() {
    const response = await api.get("/exchange-rates/applicable");
    setApplicable(response.data.data);
  }

  useEffect(() => { loadApplicable().catch(() => setApplicable(null)); }, []);

  async function synchronize(reload) {
    setSyncing(true);
    try {
      const response = await api.post("/exchange-rates/sync");
      const result = response.data.data;
      notify(t(result.run.status === "OK" ? "Official rates synchronized." : result.run.status === "PARTIAL" ? "Official rates synchronized; one source did not answer." : "No source answered. The latest stored rate stays in use and the team was alerted."), result.run.status === "FAILED" ? "error" : "success");
      await Promise.all([loadApplicable(), reload?.()]);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <ResourceManager
      title="Exchange Rates"
      description="Official SBS buy and sell rates (USD/PEN) are retrieved automatically every business day. Each transaction keeps the rate it used; weekends and holidays use the latest valid rate with its own date."
      endpoint="/exchange-rates"
      deleteMode="deactivate"
      duplicateFields={["date"]}
      transformSubmit={payload}
      rowLocked={official}
      renderBeforeTable={({ reload }) => <ApplicableRate data={applicable} syncing={syncing} onSync={() => synchronize(reload)} />}
      fields={[
        { type: "section", label: "Manual reference rate" },
        { name: "date", label: "Date", type: "date", required: true, hint: "Only when no official rate can be retrieved. It is never treated as official." },
        { name: "period", label: "Period", required: true },
        { name: "buyRate", label: "Buy rate", type: "number", step: "0.0001", min: "0.0001" },
        { name: "sellRate", label: "Sell rate", type: "number", step: "0.0001", min: "0.0001", required: true, validate: (value) => Number(value) > 0 ? "" : "Enter a rate greater than zero." },
        { name: "sourceLabel", label: "Source description", defaultValue: "Authorized manual selling rate", hint: "Describe where the value comes from." }
      ]}
      columns={[
        { key: "date", label: "Applies to", render: (row) => day(row.date) },
        { key: "buyRate", label: "Buy", render: (row) => four(row.buyRate) },
        { key: "sellRate", label: "Sell", render: (row) => four(row.sellRate ?? row.rate) },
        { key: "sourceLabel", label: "Source", render: (row) => <div className="primary-cell"><span>{t(row.sourceLabel || row.source)}</span>{row.sbsClosingDate && <small>{t("SBS close of")} {day(row.sbsClosingDate)}</small>}</div> },
        { key: "authoritative", label: "Official / authoritative", render: (row) => <div className="primary-cell"><StatusBadge status={official(row) ? "VERIFIED" : "NOT_VERIFIED"} /><span>{official(row) ? t("Official SBS") : t("Reference — not authoritative")}</span></div> },
        { key: "retrievedAt", label: "Retrieved", render: (row) => row.retrievedAt ? formatDateTime(row.retrievedAt) : "-" },
        { key: "active", label: "Status" }
      ]}
    />
  );
}
