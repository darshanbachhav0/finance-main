import { Hourglass } from "lucide-react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatDate, formatNumber } from "../utils/formatters.js";
import { renditionCountdown } from "../utils/requestJourney.js";

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// An advance's rendition deadline as a countdown: working days left, a ring that fills as the
// deadline approaches, and the way to submit it. Reminders also arrive 3 days and 1 day before.
export default function RenditionCountdown({ request, mine, onOpen }) {
  const { t, language } = useLanguage();
  const pending = request.flowType === "C" && request.requestType !== "REEMBOLSO_SIN_SUSTENTO" && ["PENDING", "OBSERVED"].includes(request.rendition?.status);
  const countdown = pending ? renditionCountdown(request.rendition, { openedAt: request.payment?.paidAt }) : null;
  if (!countdown) return null;
  const { overdue, daysLeft, progress, dueAt } = countdown;
  const tone = overdue ? "danger" : daysLeft <= 1 ? "danger" : daysLeft <= 3 ? "warning" : "success";
  const headline = overdue
    ? t("The rendition is overdue by {days} working days").replace("{days}", formatNumber(Math.abs(daysLeft), language))
    : daysLeft === 0 ? t("The rendition is due today")
    : t(daysLeft === 1 ? "1 working day left to submit the rendition" : "{days} working days left to submit the rendition").replace("{days}", formatNumber(daysLeft, language));

  return (
    <section className={`rendition-countdown tone-${tone}`} role="status">
      <svg className="countdown-ring" viewBox="0 0 64 64" aria-hidden="true">
        <circle className="countdown-track" cx="32" cy="32" r={RADIUS} />
        <circle className="countdown-fill" cx="32" cy="32" r={RADIUS} style={{ strokeDasharray: CIRCUMFERENCE, "--countdown-offset": CIRCUMFERENCE * (1 - progress) }} />
      </svg>
      <span className="countdown-number" aria-hidden="true">{overdue ? "!" : daysLeft}</span>
      <div>
        <strong>{headline}</strong>
        <span>{t(request.rendition?.status === "OBSERVED" ? "Accounting returned it for corrections. Deadline: {date}." : "Deadline: {date}. Reminders arrive 3 days and 1 day before.").replace("{date}", formatDate(dueAt, language))}</span>
      </div>
      {mine && <button type="button" className="primary-button" onClick={onOpen}><Hourglass size={16} /><span>{t("Submit rendition")}</span></button>}
    </section>
  );
}
