import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext.jsx";

// An invoice the platform already has (DUPLICATE_VOUCHER): where it is registered and, step by
// step, how to correct it. `details` comes from the server: the reason (SAME_REQUEST,
// OTHER_REQUEST or ELSEWHERE), the invoice, its issuer RUC and the request holding it.
export default function DuplicateInvoiceHelp({ details = {}, linkRequest = false }) {
  const { t } = useLanguage();
  const invoice = [details.invoice, details.ruc && `RUC ${details.ruc}`].filter(Boolean).join(" · ");
  const holder = details.request;
  const fill = (text) => text.replace("{invoice}", invoice).replace("{status}", holder?.status ? t(holder.status) : "");
  let fact;
  if (details.reason === "SAME_REQUEST") fact = fill(t("Invoice {invoice} is already registered on this request."));
  else if (holder?.requestNumber) {
    const [before, after = ""] = fill(t("Invoice {invoice} is already registered on request {request} ({status}).")).split("{request}");
    fact = <>{before}{linkRequest ? <Link className="text-link" to={`/requests/${holder._id}`}>{holder.requestNumber}</Link> : <strong>{holder.requestNumber}</strong>}{after}</>;
  } else fact = invoice ? fill(t("Invoice {invoice} is already registered in the platform.")) : t("This invoice is already registered in the platform.");
  const steps = details.reason === "SAME_REQUEST"
    ? [
        "Nothing needs to be corrected: this request already has this invoice.",
        "To use the order's remaining balance, upload the next invoice the supplier issued for this purchase."
      ]
    : [
        "Check the file you chose: it must be the invoice the supplier issued for this purchase (look at its series and number).",
        "If the supplier issued a different invoice for this purchase, upload that one instead.",
        "If it was registered on the other request by mistake and is not paid yet, ask Accounting to cancel that request's payable (CXP). Then upload it here again.",
        "Not sure? Write in this request's Comments so Accounting can check it."
      ];
  return (
    <div className="inline-alert alert-warning duplicate-invoice-help" role="alert">
      <AlertTriangle size={16} aria-hidden="true" />
      <div>
        <strong>{t("This invoice is already registered")}</strong>
        <span>{fact}</span>
        <span>{t(details.reason === "SAME_REQUEST" ? "What to do:" : "How to correct it:")}</span>
        <ol>{steps.map((step) => <li key={step}>{t(step)}</li>)}</ol>
      </div>
    </div>
  );
}
