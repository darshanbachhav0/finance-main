import { ReceiptText } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { formatCurrency, formatDate, formatNumber } from "../../utils/formatters.js";
import { renditionCountdown } from "../../utils/requestJourney.js";

// The employee's advance at a glance: what to do now, by when, and the money in three numbers.
export default function AdvanceRenditionCard({ request, onOpen }) {
  const { t, language } = useLanguage();
  const rendition = request.rendition || {};
  const status = rendition.status;
  const currency = request.currency || "PEN";
  const advanced = Number(rendition.amountAdvanced || request.payment?.confirmedAmount || request.totalAmount || 0);
  const toDo = ["PENDING", "OBSERVED"].includes(status);
  const countdown = toDo ? renditionCountdown(rendition, { openedAt: request.payment?.paidAt }) : null;
  const presented = ["SUBMITTED", "VALIDATED", "REJECTED", "OBSERVED"].includes(status) && Number(rendition.amountRendered || 0) > 0;
  const review = rendition.financeReview?.comments;

  const headline = {
    PENDING: "Present the receipts of what you spent",
    OBSERVED: "Accounting sent your rendition back for corrections",
    SUBMITTED: "Accounting is reviewing your rendition",
    VALIDATED: "Rendition validated. Nothing else to do.",
    REJECTED: "Accounting rejected your rendition"
  }[status] || "Present the receipts of what you spent";
  const deadline = countdown && (countdown.overdue
    ? t("The rendition is overdue by {days} working days").replace("{days}", formatNumber(Math.abs(countdown.daysLeft), language))
    : countdown.daysLeft === 0 ? t("The rendition is due today")
    : t(countdown.daysLeft === 1 ? "1 working day left to submit the rendition" : "{days} working days left to submit the rendition").replace("{days}", formatNumber(countdown.daysLeft, language)));
  const tone = status === "VALIDATED" ? "success" : status === "REJECTED" || countdown?.overdue || (countdown && countdown.daysLeft <= 1) ? "danger" : status === "OBSERVED" || (countdown && countdown.daysLeft <= 3) ? "warning" : "info";

  return (
    <section className={`advance-rendition-card tone-${tone}`} aria-labelledby="advance-rendition-title">
      <div className="advance-rendition-head">
        <ReceiptText size={22} aria-hidden="true" />
        <div>
          <h2 id="advance-rendition-title">{t(headline)}</h2>
          {deadline && <p><strong>{deadline}</strong> · {t("Deadline: {date}.").replace("{date}", formatDate(countdown.dueAt, language))}</p>}
          {status === "OBSERVED" && review && <p>{t("Accounting says")}: “{review}”</p>}
          {status === "REJECTED" && review && <p>{t("Accounting says")}: “{review}”</p>}
        </div>
        {toDo && <button type="button" className="primary-button" onClick={onOpen}>{t("Present receipts")}</button>}
      </div>
      <dl className="advance-rendition-numbers">
        <div><dt>{t("Advance")}</dt><dd>{formatCurrency(advanced, currency, language)}</dd></div>
        {presented && <div><dt>{t("Spent")}</dt><dd>{formatCurrency(rendition.amountRendered || 0, currency, language)}</dd></div>}
        {presented && <div><dt>{t("Returned")}</dt><dd>{formatCurrency(rendition.amountReturned || 0, currency, language)}</dd></div>}
      </dl>
      {request.payment?.paidAt && <p className="advance-rendition-line">{(rendition.reimbursementBankSnapshot?.bank ? t("Paid on {date} to your {bank} account.") : t("Paid on {date}.")).replace("{date}", formatDate(request.payment.paidAt, language)).replace("{bank}", rendition.reimbursementBankSnapshot?.bank || "")}</p>}
      {toDo && request.advanceReturnAccount && <p className="advance-rendition-line">{t("Money left over goes back to: {account}.").replace("{account}", request.advanceReturnAccount)}</p>}
    </section>
  );
}
