import { CloudDownload } from "lucide-react";
import { useState } from "react";
import api from "../api/client.js";
import ResourceManager from "../components/ResourceManager.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";

function payload(form) {
  return {
    ...form,
    currency: "USD",
    quoteCurrency: "PEN",
    rate: Number(form.rate || 0),
    period: form.period || form.date?.slice(0, 7),
    authoritative: false,
    active: true
  };
}

export default function ExchangeRates() {
  const { t } = useLanguage();
  const { notify } = useToast();
  const [loadingOnline, setLoadingOnline] = useState(false);

  async function loadOnlineRate({ rows, startCreate, startEdit }) {
    setLoadingOnline(true);
    try {
      const response = await api.get("/exchange-rates/current");
      const onlineRate = response.data.data;
      const editableValues = {
        date: onlineRate.date,
        period: onlineRate.period,
        rate: onlineRate.rate,
        source: onlineRate.source,
        sourceLabel: onlineRate.sourceLabel,
        providerMode: onlineRate.providerMode,
        authoritative: false
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
      description="Daily USD/PEN selling rates used for dated conversion. Online BCRP/SBS values are editable references and are not labelled as authoritative SUNAT rates."
      endpoint="/exchange-rates"
      duplicateFields={["date"]}
      transformSubmit={payload}
      renderHeaderActions={(actions) => (
        <button
          type="button"
          className="secondary-button"
          onClick={() => loadOnlineRate(actions)}
          disabled={loadingOnline}
          title={t("Load the latest published BCRP/SBS selling rate into an editable form.")}
        >
          <CloudDownload className={loadingOnline ? "spin" : ""} size={16} />
          <span>{t(loadingOnline ? "Getting online rate..." : "Get latest online rate")}</span>
        </button>
      )}
      fields={[
        { name: "date", label: "Date", type: "date", required: true },
        { name: "period", label: "Period", required: true },
        { name: "rate", label: "Selling rate", type: "number", step: "0.0001", min: "0.0001", required: true, validate: (value) => Number(value) > 0 ? "" : "Enter a rate greater than zero.", hint: "You can edit the online value before saving." },
        { name: "source", label: "Source code", defaultValue: "MANUAL", hint: "Use MANUAL unless a configured provider supplied the rate." },
        { name: "sourceLabel", label: "Source description", defaultValue: "Authorized manual entry", hint: "Keep the online source or describe the approved manual source." },
        { name: "providerMode", label: "Provider mode", type: "select", defaultValue: "MANUAL", options: ["MANUAL", "BCRP_FALLBACK"] }
      ]}
      columns={[
        { key: "date", label: "Date", render: (row) => row.date?.slice(0, 10) },
        { key: "period", label: "Period" },
        { key: "rate", label: "Rate", render: (row) => Number(row.rate).toFixed(4) },
        { key: "sourceLabel", label: "Source", render: (row) => row.sourceLabel || row.source },
        { key: "providerMode", label: "Mode" },
        { key: "authoritative", label: "Authoritative SUNAT", render: (row) => row.authoritative ? t("Yes") : t("No") }
      ]}
    />
  );
}
