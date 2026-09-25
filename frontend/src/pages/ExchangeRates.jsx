import { CloudDownload } from "lucide-react";
import { useEffect, useState } from "react";
import api from "../api/client.js";
import ResourceManager from "../components/ResourceManager.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { exchangeRateDescription } from "../utils/financialEvidence.js";
import { formatDateTime } from "../utils/formatters.js";

function payload(form) {
  return {
    ...form,
    currency: "USD",
    quoteCurrency: "PEN",
    rate: Number(form.rate || 0),
    period: form.period || form.date?.slice(0, 7),
    authoritative: form.providerMode === "SUNAT",
    active: true
  };
}

export default function ExchangeRates() {
  const { t } = useLanguage();
  const { notify } = useToast();
  const [loadingOnline, setLoadingOnline] = useState(false);
  const [currentEvidence, setCurrentEvidence] = useState(null);

  async function fetchCurrentRate() {
    const response = await api.get("/exchange-rates/current");
    const onlineRate = response.data.data;
    setCurrentEvidence(onlineRate);
    return onlineRate;
  }

  useEffect(() => {
    fetchCurrentRate().catch(() => setCurrentEvidence(null));
  }, []);

  async function loadOnlineRate({ rows, startCreate, startEdit }) {
    setLoadingOnline(true);
    try {
      const onlineRate = await fetchCurrentRate();
      const editableValues = {
        date: onlineRate.date,
        period: onlineRate.period,
        rate: onlineRate.rate,
        source: onlineRate.source,
        sourceLabel: onlineRate.sourceLabel || onlineRate.source,
        providerMode: onlineRate.providerMode,
        authoritative: onlineRate.authoritative
      };
      const existing = rows.find((row) => row.date?.slice(0, 10) === onlineRate.date);

      if (existing) {
        startEdit({ ...existing, ...editableValues });
      } else {
        startCreate(editableValues);
      }
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setLoadingOnline(false);
    }
  }

  return (
    <ResourceManager
      title="Exchange Rates"
      description="SUNAT selling rates are verified on the server. Manual and BCRP/SBS records remain references; historical rates are preserved."
      endpoint="/exchange-rates"
      duplicateFields={["date"]}
      transformSubmit={payload}
      renderHeaderActions={(actions) => (
        <button
          type="button"
          className="secondary-button"
          onClick={() => loadOnlineRate(actions)}
          disabled={loadingOnline}
          title={t("Retrieve the applicable SUNAT selling rate and its publication date.")}
        >
          <CloudDownload className={loadingOnline ? "spin" : ""} size={16} />
          <span>{t(loadingOnline ? "Getting online rate..." : "Get latest online rate")}</span>
        </button>
      )}
      renderBeforeTable={() => currentEvidence && <div className={`exchange-rate-evidence ${currentEvidence.fallback?.used ? "warning" : "success"}`}>
        <div><strong>{t("Applicable USD selling rate")}</strong><span>{exchangeRateDescription(currentEvidence, currentEvidence.source, currentEvidence.rate, currentEvidence.date)}</span></div>
        <div className="exchange-rate-evidence-badges"><StatusBadge status={currentEvidence.authoritative ? "VERIFIED" : "NOT_VERIFIED"} />{currentEvidence.fallback?.used && <StatusBadge status="PENDING" />}</div>
        {currentEvidence.fallback?.used && <small>{t("Fallback used")}: {currentEvidence.fallback.reason} · {t("Requested date")}: {String(currentEvidence.requestedDate || currentEvidence.fallback.requestedDate || "").slice(0, 10)} · {t("Rate date")}: {String(currentEvidence.date || "").slice(0, 10)}</small>}
      </div>}
      fields={[
        { type: "section", label: "Rate" },
        { name: "date", label: "Date", type: "date", required: true },
        { name: "period", label: "Period", required: true },
        { name: "rate", label: "Selling rate", type: "number", step: "0.0001", min: "0.0001", required: true, validate: (value) => Number(value) > 0 ? "" : "Enter a rate greater than zero.", hint: "SUNAT values must match the provider evidence." },
        { type: "section", label: "Source" },
        { name: "source", label: "Source code", defaultValue: "MANUAL", hint: "Use MANUAL unless a configured provider supplied the rate." },
        { name: "sourceLabel", label: "Source description", defaultValue: "Authorized manual entry", hint: "Keep the online source or describe the approved manual source." },
        { name: "providerMode", label: "Provider mode", type: "select", defaultValue: "MANUAL", options: ["MANUAL", "BCRP_FALLBACK", "SUNAT"] }
      ]}
      columns={[
        { key: "date", label: "Date", render: (row) => row.date?.slice(0, 10) },
        { key: "period", label: "Period" },
        { key: "rate", label: "Rate", render: (row) => Number(row.rate).toFixed(4) },
        { key: "sourceLabel", label: "Source", render: (row) => row.sourceLabel || row.source },
        { key: "providerMode", label: "Mode" },
        { key: "authoritative", label: "Official / authoritative", render: (row) => <div className="primary-cell"><StatusBadge status={row.authoritative && row.providerMode === "SUNAT" ? "VERIFIED" : "NOT_VERIFIED"} /><span>{row.authoritative && row.providerMode === "SUNAT" ? t("Official SUNAT") : t("Reference — not authoritative")}</span></div> },
        { key: "retrievedAt", label: "Retrieved", render: (row) => row.retrievedAt ? formatDateTime(row.retrievedAt) : "-" }
      ]}
    />
  );
}
