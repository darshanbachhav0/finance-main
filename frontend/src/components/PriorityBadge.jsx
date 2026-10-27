import { useLanguage } from "../context/LanguageContext.jsx";
import { requestPriorityLabels } from "../utils/options.js";

const LEGACY = { ALTA: "P2", MEDIA: "P3", BAJA: "P3" };

// A request's payment priority (P1-P4; older Alta / Media / Baja shown as P2 / P3), drawn the same
// way on every card, table and screen with the platform's priority pill.
export default function PriorityBadge({ priority }) {
  const { t } = useLanguage();
  const code = LEGACY[priority] || priority;
  const value = ["P1", "P2", "P3", "P4"].includes(code) ? code : "P3";
  return <span className={`priority priority-${value.toLowerCase()}`}>{t(requestPriorityLabels[value])}</span>;
}
