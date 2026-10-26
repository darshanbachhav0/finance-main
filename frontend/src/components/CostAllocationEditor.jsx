import { Plus, Trash2 } from "lucide-react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency } from "../utils/formatters.js";
import { clientId } from "../utils/clientId.js";
import { allocationPercentages, percentageTotal, splitByPercentages } from "../../../shared/costCenterAllocation.mjs";
import SearchSelect from "./SearchSelect.jsx";

export const newCostAllocation = (percentage = "") => ({ clientId: clientId(), costCenter: "", percentage });
const centerLabel = (item) => `${item.code} - ${item.name}${item.area && item.area !== item.name ? ` (${item.area})` : ""}`;

// Por Encargo: the school or department the request is for, chosen from the CECO master (never a
// typed code). One beneficiary takes 100%; "Add another cost center" shares the expense by
// percentage, and each share's amount follows the request total.
export default function CostAllocationEditor({ allocations, centers, ownCostCenter, total, currency, errors = {}, onChange, onFieldBlur }) {
  const { t, language } = useLanguage();
  const shared = allocations.length > 1;
  const percentages = allocationPercentages(allocations);
  const distributed = percentageTotal(percentages.map((value) => (Number.isFinite(value) ? value : 0)));
  const shares = splitByPercentages(total, percentages.map((value) => (Number.isFinite(value) ? value : 0)));
  const percent = (value) => Number(value).toLocaleString(language === "en" ? "en-US" : "es-PE", { maximumFractionDigits: 2 });
  // A CECO is chosen once; the requester's own CECO only as one share of several.
  const optionsFor = (index) => centers.filter((center) => !allocations.some((row, position) => position !== index && row.costCenter === center._id) && (shared || center._id !== ownCostCenter));
  const change = (index, patch) => onChange(allocations.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  // The first share added splits the expense in halves; later ones take what is left.
  function add() {
    if (!shared) return onChange([{ ...allocations[0], percentage: "50" }, newCostAllocation("50")]);
    const left = Math.round((100 - distributed) * 100) / 100;
    onChange([...allocations, newCostAllocation(left > 0 ? String(left) : "")]);
  }
  function remove(index) {
    const rest = allocations.filter((_, position) => position !== index);
    onChange(rest.length === 1 ? [{ ...rest[0], percentage: "100" }] : rest);
  }
  const fieldError = (key) => errors[key] && <small className="field-error-text">{t(errors[key])}</small>;

  return (
    <div className="cost-allocation">
      {allocations.map((row, index) => (
        <div className={`cost-allocation-row${shared ? " is-shared" : ""}`} key={row.clientId}>
          <SearchSelect label="School or department" value={row.costCenter} options={optionsFor(index)} onChange={(value) => change(index, { costCenter: value || "" })} getOptionLabel={centerLabel} error={errors[`costAllocations.${index}.costCenter`]} required searchPlaceholder="Search school, department or CECO..." />
          {shared && <label className={`field cost-allocation-percentage${errors[`costAllocations.${index}.percentage`] ? " field-error" : ""}`}>
            <span>{t("Percentage")} *</span>
            <span className="percentage-input"><input type="number" inputMode="decimal" min="0.01" max="100" step="0.01" value={row.percentage} onChange={(event) => change(index, { percentage: event.target.value })} onBlur={() => onFieldBlur?.(`costAllocations.${index}.percentage`, "costAllocations")} aria-invalid={Boolean(errors[`costAllocations.${index}.percentage`])} /><span aria-hidden="true">%</span></span>
            {fieldError(`costAllocations.${index}.percentage`)}
          </label>}
          <div className="cost-allocation-amount" aria-live="polite">
            {!shared && <span>100%</span>}
            <strong>{formatCurrency(shares[index] || 0, currency, language)}</strong>
          </div>
          {shared && <button type="button" className="icon-button danger" onClick={() => remove(index)} title={t("Remove cost center")} aria-label={t("Remove cost center")}><Trash2 size={16} aria-hidden="true" /></button>}
        </div>
      ))}
      <div className="cost-allocation-footer">
        <button type="button" className="text-button" onClick={add}><Plus size={15} aria-hidden="true" />{t("Add another cost center")}</button>
        {shared && <span className={`cost-allocation-total${distributed === 100 ? " is-complete" : ""}`} role="status">{t("Distributed: {percentage}% of 100%.").replace("{percentage}", percent(distributed))}</span>}
      </div>
      {fieldError("costAllocations")}
    </div>
  );
}
