import { useLanguage } from "../../context/LanguageContext.jsx";
import { LIMA_TIME_ZONE } from "../../../../shared/businessCalendar.mjs";
import { sunatCalendarDate } from "../../../../shared/supplierSunat.mjs";
import "../../styles/supplierForm.css";

export function sunatDateLabel(value, language, withTime = false) {
  if (!value) return "";
  const calendar = sunatCalendarDate(value);
  const date = new Date(calendar ? `${calendar}T12:00:00-05:00` : value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(language === "es" ? "es-PE" : "en-GB", {
    year: "numeric", month: "2-digit", day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}), timeZone: LIMA_TIME_ZONE
  }).format(date);
}

export function SunatRepresentativeNote({ representative, queriedAt }) {
  const { t, language } = useLanguage();
  if (!representative) return null;
  return <p className="field-hint">{[
    representative.position,
    sunatCalendarDate(representative.dateFrom) && `${t("Representative since")}: ${sunatDateLabel(representative.dateFrom, language)}`,
    queriedAt && `${t("SUNAT consulted at")}: ${sunatDateLabel(queriedAt, language, true)}`
  ].filter(Boolean).join(" · ")}</p>;
}

const listed = (values) => (Array.isArray(values) ? values.filter(Boolean) : []);

// Display only returned values. The Padrón also supplies address and ubigeo.
function profileRows(data, t, language) {
  const activity = (item) => [item.kind, item.code, item.description].filter(Boolean).join(" · ");
  return [
    ["Taxpayer type", data.taxpayerType],
    ["Identity document", data.identityDocument],
    ["Economic activities", listed(data.economicActivities).map(activity)],
    ["Voucher issuing system", data.voucherIssuanceSystem],
    ["Accounting system", data.accountingSystem],
    ["Foreign trade activity", data.foreignTradeActivity],
    ["Electronic issuer since", sunatDateLabel(data.electronicIssuerSince, language)],
    ["Electronic vouchers", listed(data.electronicVouchers)],
    ["Electronic issuing system", listed(data.electronicIssuanceSystems)],
    ["Vouchers authorized for printing", listed(data.printedVoucherTypes)],
    ["PLE affiliate since", sunatDateLabel(data.pleAffiliationDate, language)],
    ["SUNAT registries (padrones)", data.registries ? (listed(data.registries).length ? listed(data.registries) : [t("None")]) : undefined]
  ].filter(([, value]) => (Array.isArray(value) ? value.length : value));
}

export default function SupplierSunatEvidence({ lookup }) {
  const { t, language } = useLanguage();
  if (!lookup?.found) return null;
  const data = lookup.data || {};
  const dates = [
    ["SUNAT registration date", data.registrationDate],
    ["Start of activities", data.activityStartDate],
    ["SUNAT deregistration date", data.deregistrationDate],
    ["Dataset", lookup.datasetDate],
    ["SUNAT consulted at", lookup.queriedAt, true]
  ].filter(([, value]) => value);
  const profile = profileRows(data, t, language);
  const identity = [
    ["RUC", data.rucDni || lookup.ruc],
    ["Legal name", data.legalName],
    ["Commercial name", data.commercialName],
    ["Fiscal address", data.fiscalAddress],
    ["Department", data.location?.department],
    ["Province", data.location?.province],
    ["District", data.location?.district],
    ["Ubigeo", data.location?.ubigeo]
  ].filter(([, value]) => value);
  return <div className={`supplier-sunat-evidence ${data.taxpayerStatus === "ACTIVO" && data.domicileCondition === "HABIDO" ? "is-valid" : "needs-review"}`}>
    {lookup.fallback && <p><span>{t("SUNAT public Padrón")} · {t("Dataset")}: {sunatDateLabel(lookup.datasetDate, language)}</span><small>{t("Consulta RUC unavailable. Official Padrón fallback used.")}</small></p>}
    <p role="status"><strong>{t("SUNAT taxpayer status")}: {data.taxpayerStatus || t("Not reported")}</strong><span>{t("Domicile condition")}: {data.domicileCondition || t("Not reported")}</span></p>
    <dl className="supplier-detail-grid">
      {identity.map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}
    </dl>
    <details><summary>{t("SUNAT dates and source")}</summary>
      <dl className="supplier-detail-grid">
        {dates.map(([label, value, withTime]) => <div key={label}><dt>{t(label)}</dt><dd>{sunatDateLabel(value, language, withTime) || t("Not reported")}</dd></div>)}
        <div><dt>{t("Validation source")}</dt><dd>{lookup.source === "SUNAT_PUBLIC_PADRON_RUC" ? t("SUNAT public Padrón") : t("SUNAT Consulta RUC")}</dd></div>
      </dl>
      {lookup.fallback && <small>{t("Consulta RUC unavailable. Official Padrón fallback used.")}</small>}
    </details>
    {profile.length > 0 && <details open><summary>{t("SUNAT taxpayer profile")}</summary>
      <dl className="supplier-detail-grid">
        {profile.map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{Array.isArray(value) ? <ul className="supplier-sunat-list">{value.map((item) => <li key={item}>{item}</li>)}</ul> : value}</dd></div>)}
      </dl>
    </details>}
  </div>;
}
