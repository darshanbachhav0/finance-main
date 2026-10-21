import { useLanguage } from "../context/LanguageContext.jsx";
import { requestPriorityLabels } from "../utils/options.js";

// A request's priority (Alta / Media / Baja), drawn the same way on every card, table and screen
// with the platform's priority pill.
export default function PriorityBadge({ priority }) {
  const { t } = useLanguage();
  const value = ["ALTA", "MEDIA", "BAJA"].includes(priority) ? priority : "MEDIA";
  return <span className={`priority priority-${value.toLowerCase()}`}>{t(requestPriorityLabels[value])}</span>;
}
