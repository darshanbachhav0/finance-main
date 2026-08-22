import { ChevronDown, Filter, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { optionLabel, requestTypeLabels, requestTypes } from "../utils/options.js";

export default function ReportFilters({ values, options, onChange, onApply, onClear, loading }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(() => !window.matchMedia("(max-width: 900px)").matches);
  const update = (key) => (event) => onChange({ ...values, [key]: event.target.value });

  return (
    <section className={`report-filter-shell${expanded ? " is-expanded" : ""}`} aria-label={t("Report filters")}>
      <button type="button" className="filter-toggle" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
        <Filter size={16} /><span>{t("Report filters")}</span><ChevronDown size={16} />
      </button>
      <div className="report-filter-content">
        <div className="report-filter-grid">
          <label className="field"><span>{t("Accounting period")}</span><input type="month" value={values.period} onChange={update("period")} /></label>
          <label className="field"><span>{t("Date from")}</span><input type="date" value={values.dateFrom} onChange={update("dateFrom")} /></label>
          <label className="field"><span>{t("Date to")}</span><input type="date" value={values.dateTo} onChange={update("dateTo")} /></label>
          <label className="field"><span>{t("Currency")}</span><select value={values.currency} onChange={update("currency")}><option value="">{t("All currencies")}</option><option value="PEN">PEN</option><option value="USD">USD</option></select></label>
          <label className="field"><span>{t("Request type")}</span><select value={values.requestType} onChange={update("requestType")}><option value="">{t("All types")}</option>{requestTypes.map((item) => <option key={item} value={item}>{t(optionLabel(item, requestTypeLabels))}</option>)}</select></label>
          <label className="field"><span>{t("Area")}</span><select value={values.area} onChange={update("area")}><option value="">{t("All areas")}</option>{options.areas.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="field"><span>{t("Cost center")}</span><select value={values.costCenter} onChange={update("costCenter")}><option value="">{t("All Cost Centers")}</option>{options.costCenters.map((item) => <option key={item.value} value={item.value}>{item.code} - {item.name}</option>)}</select></label>
          <label className="field"><span>{t("Project")}</span><select value={values.project} onChange={update("project")}><option value="">{t("All projects")}</option>{options.projects.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        </div>
        <div className="report-filter-actions">
          <button type="button" className="text-button" onClick={onClear}><X size={15} /><span>{t("Clear filters")}</span></button>
          <button type="button" className="primary-button" onClick={onApply} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Apply filters")}</span></button>
        </div>
      </div>
    </section>
  );
}
