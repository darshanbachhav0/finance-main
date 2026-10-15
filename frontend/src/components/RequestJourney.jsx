import { CalendarCheck2, CalendarClock, Check, CircleAlert, Users } from "lucide-react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatDate } from "../utils/formatters.js";
import { expectedPayment, journeyMilestones, journeySummary } from "../utils/requestJourney.js";
import { timeAgo } from "../utils/timeAgo.js";
import Avatar from "./Avatar.jsx";

const fill = (text, params = {}) => Object.entries(params).reduce((result, [key, value]) => result.replace(`{${key}}`, value ?? ""), text);

// "Where is my request?" at the top of a request: one plain sentence, who has it now and since
// when, when the payment is expected, and the milestones of its own track.
export default function RequestJourney({ request, payables = [], activeStep, orderApplies = true, viewerId }) {
  const { t, language } = useLanguage();
  const payment = expectedPayment(request, payables);
  const day = (key) => (key ? formatDate(`${key}T12:00:00Z`, language) : "");
  const summary = journeySummary(request, { activeStep, orderApplies, payment: payment && { ...payment, date: day(payment.date) }, viewerId });
  const milestones = journeyMilestones(request, { orderApplies });

  return (
    <section className={`request-journey tone-${summary.tone || "progress"}`} aria-labelledby="request-journey-title">
      <div className="journey-head">
        <div className="journey-text">
          <h2 id="request-journey-title" className="sr-only">{t("Where is this request?")}</h2>
          <p className="journey-sentence">{summary.tone === "attention" && <CircleAlert size={18} aria-hidden="true" />}{fill(t(summary.text), summary.params)}</p>
          {summary.holder && (
            <p className="journey-holder person-chip">
              {summary.holder.team ? <span className="team-badge" aria-hidden="true"><Users size={13} /></span> : <Avatar name={summary.holder.name} size="sm" />}
              <span>{t("With {name}").replace("{name}", summary.holder.team ? t(summary.holder.name) : summary.holder.name)}{summary.since ? ` · ${timeAgo(summary.since, language)}` : ""}</span>
            </p>
          )}
        </div>
        {payment && (
          <div className={`journey-payment state-${payment.state}`}>
            {payment.state === "paid" ? <CalendarCheck2 size={20} aria-hidden="true" /> : <CalendarClock size={20} aria-hidden="true" />}
            <span>{t(payment.state === "paid" ? "Paid on" : payment.state === "scheduled" ? "Payment scheduled for" : "Payment expected around")}</span>
            <strong>{payment.date ? day(payment.date) : t("Recorded")}</strong>
          </div>
        )}
      </div>
      <ol className="journey-steps" aria-label={t("Request milestones")}>
        {milestones.map((step) => (
          <li key={step.key} className={`journey-step is-${step.state}`} aria-current={["current", "attention"].includes(step.state) ? "step" : undefined}>
            <span className="journey-dot" aria-hidden="true">{step.state === "done" ? <Check size={13} /> : null}</span>
            <span className="journey-label">{t(step.label)}</span>
            <span className="sr-only">{t(step.state === "done" ? "Done" : step.state === "upcoming" ? "Not yet" : step.state === "stopped" ? "Stopped" : "In progress")}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
