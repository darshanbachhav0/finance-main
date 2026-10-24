import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency } from "../utils/formatters.js";
import "../styles/requestSummary.css";

// The CECOs a Por Encargo request is charged to: each with its code, school or department, share
// and amount. Rows are { costCenterSnapshot: { code, name, area }, percentage, amount }.
export default function CostAllocationSummary({ allocations = [], currency }) {
  const { language } = useLanguage();
  return (
    <ul className="cost-allocation-summary">
      {allocations.map((allocation, index) => {
        const center = allocation.costCenterSnapshot || {};
        return <li key={`${center.code || "ceco"}-${index}`}>
          <span><strong>{center.code}</strong> {center.name}{center.area && center.area !== center.name ? <small> · {center.area}</small> : null}</span>
          <span className="cost-allocation-share">{Number(allocation.percentage || 0).toLocaleString(language === "en" ? "en-US" : "es-PE", { maximumFractionDigits: 2 })}% · {formatCurrency(allocation.amount || 0, currency, language)}</span>
        </li>;
      })}
    </ul>
  );
}
