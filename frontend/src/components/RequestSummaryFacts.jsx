import { AlertTriangle } from "lucide-react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatDate } from "../utils/formatters.js";
import { bankAccountLabel } from "../utils/bankAccounts.js";
import { requestFrequencyLabels } from "../utils/options.js";
import PriorityBadge from "./PriorityBadge.jsx";
import "../styles/requestSummary.css";
import { invoiceDueDate, scheduledPaymentDate } from "../../../shared/invoiceFinance.mjs";

// The receipt's issue date: the voucher Accounting registered, else the receipt read or typed on
// the request, else the XML checked when it was sent. "" while no receipt has been issued.
export function receiptIssueDate(request, vouchers = []) {
  const registered = [...(vouchers || [])].filter((voucher) => voucher.issueDate && voucher.validationStatus !== "ANNULLED").sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))[0];
  return registered?.issueDate || request?.invoiceDetails?.issueDate || request?.xmlValidation?.data?.issueDate || "";
}

// "Resumen de la solicitud": the dates (in Lima), priority, frequency and where the supplier is paid.
export default function RequestSummaryFacts({ request, vouchers, payables = [] }) {
  const { t, language } = useLanguage();
  const trackC = request.flowType === "C";
  const issued = receiptIssueDate(request, vouchers);
  const terms = request.quotations?.find(q => q.recommended && q.paymentCondition) || request.supplierPaymentTerms;
  const due = payables.find(row => row.status !== "CANCELLED" && row.dueDate)?.dueDate || invoiceDueDate(issued, terms?.paymentCondition ? terms : { option: "CUSTOM", days: request.supplierCreditDaysSnapshot });
  const scheduled = payables.filter(row => !["CANCELLED", "PAID"].includes(row.status)).map(scheduledPaymentDate).filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0];
  const account = request.paymentAccount?.currency ? request.paymentAccount : null;
  const mismatch = account && account.currency !== request.currency;
  // When it was last sent for approval (the request's approval history keeps every sending).
  const sentAt = [...(request.approvalHistory || [])].reverse().find((event) => event.action === "APPROVAL_REQUESTED")?.createdAt;
  return (
    <section className="request-summary-facts" aria-labelledby="request-summary-title">
      <h2 id="request-summary-title">{t("Request summary")}</h2>
      <dl>
        <div><dt>{t("Requirement date")}</dt><dd>{formatDate(request.issueDate, language)}</dd></div>
        <div><dt>{t("Receipt issue date")}</dt><dd>{trackC ? t("Not applicable") : issued ? formatDate(issued, language) : <span className="pending-value">{t("Pending")}</span>}</dd></div>
        {!trackC && request.supplierCreditDaysSnapshot != null && <div><dt>{t("Credit days")}</dt><dd>{terms?.creditDays ?? request.supplierCreditDaysSnapshot}</dd></div>}
        {!trackC && due && <div><dt>{t("Due date")}</dt><dd>{formatDate(due, language)}</dd></div>}
        <div><dt>{t("Scheduled payment date")}</dt><dd>{scheduled ? formatDate(scheduled, language) : "Por programar"}</dd></div>
        <div><dt>{t("Priority")}</dt><dd><PriorityBadge priority={request.priority} /></dd></div>
        <div><dt>{t("Frequency")}</dt><dd>{t(requestFrequencyLabels[request.frequency || request.opexDetails?.expenseFrequency || "ONE_OFF"])}</dd></div>
        {!trackC && <div><dt>{t("Paid into")}</dt><dd>{account ? bankAccountLabel(account, t) : t("Account not chosen")}</dd></div>}
        {sentAt && <div><dt>{t("Sent for approval on")}</dt><dd>{formatDate(sentAt, language, { hour: "2-digit", minute: "2-digit" })}</dd></div>}
      </dl>
      {mismatch && <p className="inline-alert alert-warning"><AlertTriangle size={16} aria-hidden="true" /><span>{t("The supplier's account is in {account} and the request in {request}. Treasury pays only in the account's currency; nothing is converted.").replace("{account}", account.currency).replace("{request}", request.currency)}</span></p>}
    </section>
  );
}
