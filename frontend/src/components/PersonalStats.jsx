import { CalendarCheck2, FileStack, Gauge, HandCoins, Hourglass, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency, formatDate, formatNumber } from "../utils/formatters.js";
import CountUp from "./CountUp.jsx";
import { ROLES } from "../utils/access.js";

const APPROVER_ROLES = ["AreaDirector", "ViceRector", "Management", "GAF"];

function hoursLabel(hours, t, language) {
  if (hours === null || hours === undefined) return "-";
  if (hours < 1) return t("Under 1 h");
  return t("{hours} h").replace("{hours}", formatNumber(hours, language));
}

// The signed-in person's own numbers (GET /dashboard/me), shown under the greeting.
export default function PersonalStats({ personal, role }) {
  const { t, language } = useLanguage();
  if (!personal) return null;
  const { requests = {}, payments = {}, approvals = {} } = personal;
  const showApprovals = approvals.decidedThisMonth > 0 || APPROVER_ROLES.includes(role);
  // Someone who only decides (a director who never raises requests) is not shown rows of zeros.
  const showRequests = role === ROLES.SOLICITOR || requests.submittedThisYear > 0 || requests.inProgress > 0 || requests.drafts > 0 || payments.paidThisYearPen > 0;
  const money = (value) => formatCurrency(value, "PEN", language);
  const next = payments.next;

  const tiles = [
    ...(showRequests ? [
      { key: "submitted", icon: FileStack, label: "Requests this year", value: requests.submittedThisYear, to: "/requests" },
      { key: "progress", icon: Hourglass, label: "In progress", value: requests.inProgress, to: "/requests" },
      { key: "paid", icon: Wallet, label: "Paid this year", value: payments.paidThisYearPen, format: money }
    ] : []),
    ...(payments.paidToMeThisYearPen > 0 ? [{ key: "paidToMe", icon: HandCoins, label: "Paid to you this year", value: payments.paidToMeThisYearPen, format: money }] : []),
    ...(showApprovals ? [
      { key: "decisions", icon: CalendarCheck2, label: "Decisions this month", value: approvals.decidedThisMonth, to: "/approvals" },
      { key: "speed", icon: Gauge, label: "Average decision time", text: hoursLabel(approvals.averageHours, t, language) }
    ] : [])
  ];

  if (!tiles.length && !next) return null;
  return (
    <div className="personal-pulse" data-tour="pulse">
      <ul className="personal-stats" aria-label={t("Your numbers")}>
        {tiles.map(({ key, icon: Icon, label, value, format, text, to }) => {
          const body = <><Icon size={17} aria-hidden="true" /><span className="personal-stat-label">{t(label)}</span><strong>{text ?? <CountUp value={value} format={format || ((number) => formatNumber(Math.round(number), language))} />}</strong></>;
          return <li key={key}>{to ? <Link className="personal-stat" to={to}>{body}</Link> : <div className="personal-stat">{body}</div>}</li>;
        })}
      </ul>
      {next && (
        <Link className="next-payment-chip" to={`/requests/${next.requestId}`}>
          <HandCoins size={18} aria-hidden="true" />
          <span>
            <strong>{t(next.estimated ? "Next payment expected" : "Next payment")}</strong>
            <small>{t("{amount} for {request} on {date}").replace("{amount}", formatCurrency(next.amount, next.currency, language)).replace("{request}", next.requestNumber || "-").replace("{date}", formatDate(`${next.date}T12:00:00Z`, language))}</small>
          </span>
        </Link>
      )}
    </div>
  );
}
