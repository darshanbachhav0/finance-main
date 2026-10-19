import { CheckCircle2, CircleAlert, Eye, Info, Undo2, XCircle } from "lucide-react";
import { useState } from "react";
import api from "../../api/client.js";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { celebrate } from "../../utils/celebrate.js";
import { formatCurrency, formatDate } from "../../utils/formatters.js";
import { reviewSummary } from "../../utils/simpleRendition.js";
import ConfirmDialog from "../ConfirmDialog.jsx";
import Message from "../Message.jsx";
import ProtectedAssetButton from "../ProtectedAssetButton.jsx";

const KIND_LABELS = { RECEIPT: "Receipt", TRANSPORT: "Transport", NO_RECEIPT: "Without receipt" };

function FileButton({ file, label }) {
  const { t } = useLanguage();
  if (!file) return null;
  return (
    <ProtectedAssetButton className="secondary-button compact-button" resourcePath={file.url} fileName={file.originalName} preview title={t("View")} ariaLabel={`${t("View")}: ${file.originalName}`}>
      <Eye size={15} aria-hidden="true" /><span>{t(label || "View")}</span>
    </ProtectedAssetButton>
  );
}

// Accounting's review of a rendition, on the request's first screen: the money, what the
// employee presented with each file, the checks, and the three decisions. Same endpoints as the
// detailed workspace (Documents tab), which stays for every detail.
export default function RenditionReviewPanel({ request, onReload }) {
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const [confirm, setConfirm] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const summary = reviewSummary(request);
  const currency = request.currency || "PEN";
  const money = (value) => formatCurrency(value, currency, language);
  const name = request.requester?.name || request.solicitor?.name || t("the employee");
  const fill = (text, params) => Object.entries(params).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, value), t(text));

  const decisions = {
    approve: { title: "Approve this rendition?", description: summary.isAdvance ? "The accounting entry is posted and the advance is cleared." : "The declaration is accepted and the reimbursement goes to Treasury for payment.", confirmLabel: "Approve rendition", tone: "success", inputLabel: "Comment (optional)" },
    observe: { title: fill("Send the rendition back to {name}?", { name }), description: fill("{name} gets your comment, corrects the rendition and sends it again.", { name }), confirmLabel: "Send back", inputLabel: "What should be corrected?", inputRequired: true },
    reject: { title: "Reject this rendition?", description: summary.isAdvance ? fill("The money that was not returned has to be recovered from {name}.", { name }) : "The reimbursement is not paid.", confirmLabel: "Reject rendition", tone: "danger", inputLabel: "Why is it rejected?", inputRequired: true }
  };

  async function decide(action, comments) {
    setProcessing(true);
    setError("");
    try {
      await api.post(`/requests/${request._id}/rendition/${action}`, { comments });
      notify(action === "approve" ? "Rendition approved." : action === "observe" ? "Rendition sent back for corrections." : "Rendition rejected.");
      if (action === "approve") celebrate("Rendition validated");
      setConfirm(null);
      await onReload?.();
    } catch (err) {
      setError(err.message);
      setConfirm(null);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="rendition-review">
      <dl className="advance-rendition-numbers">
        {summary.isAdvance && <div><dt>{t("Advance")}</dt><dd>{money(summary.advanced)}</dd></div>}
        <div><dt>{t(summary.isAdvance ? "Spent" : "Declared")}</dt><dd>{money(summary.spent)}</dd></div>
        {summary.isAdvance && <div><dt>{t("Returned")}</dt><dd>{money(summary.returned)}</dd></div>}
        {summary.isAdvance && <div className={summary.balance === 0 ? "is-balanced" : "is-open"}><dt>{t("Left to account for")}</dt><dd>{money(summary.balance)}</dd></div>}
      </dl>

      {summary.checks.length > 0 && (
        <ul className="rendition-review-checks">
          {summary.checks.map((check) => {
            const Icon = check.ok === true ? CheckCircle2 : check.ok === false ? CircleAlert : Info;
            return <li key={check.key} className={check.ok === true ? "is-ok" : check.ok === false ? "is-problem" : "is-info"}><Icon size={16} aria-hidden="true" /><span>{fill(check.text, { amount: money(check.amount || 0), count: check.count || 0 })}</span></li>;
          })}
        </ul>
      )}

      {summary.note && <p className="rendition-review-note"><strong>{fill("Note from {name}", { name })}:</strong> “{summary.note}”</p>}

      <ul className="simple-rendition-list rendition-review-items" aria-label={t("What was presented")}>
        {summary.items.map((item) => (
          <li key={item.key}>
            <span className="type-chip">{t(KIND_LABELS[item.kind])}</span>
            <strong>{item.title || "-"}</strong>
            <b>{money(item.amount)}</b>
            {item.file ? <FileButton file={item.file} /> : <span aria-hidden="true" />}
            <small>{[item.date && formatDate(item.date, language), ...item.detail.map((part) => t(part))].filter(Boolean).join(" · ")}</small>
          </li>
        ))}
        {summary.depositSlip && (
          <li>
            <span className="type-chip">{t("Deposit slip")}</span>
            <strong>{t("Money returned")}</strong>
            <b>{money(summary.returned)}</b>
            <FileButton file={summary.depositSlip} />
          </li>
        )}
        {summary.otherFiles.map((file) => (
          <li key={file._id}>
            <span className="type-chip">{t("File")}</span>
            <strong>{file.originalName}</strong>
            <span aria-hidden="true" />
            <FileButton file={file} />
          </li>
        ))}
        {!summary.items.length && !summary.depositSlip && !summary.otherFiles.length && <li><span>{t("No receipts presented yet.")}</span></li>}
      </ul>

      <Message type="error">{error}</Message>
      <div className="next-step-actions">
        <button type="button" className="primary-button approve-button" disabled={processing} onClick={() => setConfirm({ action: "approve", ...decisions.approve })}><CheckCircle2 size={16} aria-hidden="true" /><span>{t("Approve rendition")}</span></button>
        <button type="button" className="secondary-button" disabled={processing} onClick={() => setConfirm({ action: "observe", ...decisions.observe })}><Undo2 size={16} aria-hidden="true" /><span>{t("Send back for corrections")}</span></button>
        <button type="button" className="danger-button subtle" disabled={processing} onClick={() => setConfirm({ action: "reject", ...decisions.reject })}><XCircle size={16} aria-hidden="true" /><span>{t("Reject")}</span></button>
      </div>
      {!summary.ready && <p className="section-note">{t("Something does not add up: send it back with a comment so the employee can fix it.")}</p>}
      <ConfirmDialog open={Boolean(confirm)} {...confirm} loading={processing} onClose={() => !processing && setConfirm(null)} onConfirm={(comments) => decide(confirm.action, comments)} />
    </div>
  );
}
