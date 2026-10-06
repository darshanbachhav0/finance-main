import { canonicalRequestStatus } from "../../../shared/workflowStatus.mjs";
import { useLanguage } from "../context/LanguageContext.jsx";
import { statusTone } from "../utils/tones.js";

// Colour and marker come from the status's meaning (utils/tones.js), so the same word always looks
// the same: a ring (neutral), dot (info), check (success), triangle (warning) or diamond (danger).
export default function StatusBadge({ status }) {
  if (status !== "RENDICION_PENDIENTE") status = canonicalRequestStatus(status);
  const { t } = useLanguage();
  return <span className={`badge badge-${statusTone(status)}`}><span className="badge-label">{t(status || "N/A")}</span></span>;
}
