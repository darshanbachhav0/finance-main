import { ArrowLeft, CheckCircle2, Eye, FileText, Forward, Inbox, MessageSquareWarning, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../api/client.js";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import ProtectedAssetButton from "../components/ProtectedAssetButton.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import SupplierToVerify from "../components/SupplierToVerify.jsx";
import WorkspaceSkeleton from "../components/WorkspaceSkeleton.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { celebrate } from "../utils/celebrate.js";
import { formatIsoMonth } from "../utils/dateInput.js";
import { formatCurrency } from "../utils/formatters.js";
import { quickTrackText } from "../utils/quickRequest.js";

// One page, made for the phone, that the approval email's "Aprobar ahora" opens (after sign-in):
// what is asked, by whom, for how much, the documents, who approved before, and three decisions -
// Approve, Send back, Reject. The decision is the signed-in approver's, with the same checks as the
// inbox (POST /approvals/:id/approve|observe|reject).
const DECISIONS = {
  approve: { label: "Approve", icon: CheckCircle2, className: "primary-button approve-button", input: "Comment (optional)", done: "Approved. Thank you." },
  observe: { label: "Send back", icon: MessageSquareWarning, className: "secondary-button", input: "What should be changed?", done: "Sent back to the requester with your comments." },
  reject: { label: "Reject", icon: XCircle, className: "danger-button subtle", input: "Why is it rejected?", done: "Rejected. The requester was told why." }
};

export default function ApprovalDecision() {
  const { id } = useParams();
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [request, setRequest] = useState(null);
  const [related, setRelated] = useState({});
  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState(null);
  const [comments, setComments] = useState("");
  const [forward, setForward] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get(`/requests/${id}`)
      .then(async (response) => {
        if (!active) return;
        const data = response.data.data;
        setRequest(data);
        setRelated(response.data.related || {});
        // The options name the chain's next jefe and a supplier that still waits for approval.
        if ((data.allowedActions || []).includes("APPROVE")) {
          const optionsResponse = await api.get(`/approvals/${id}/options`).catch(() => null);
          if (active) setOptions(optionsResponse?.data?.data || null);
        }
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [id]);

  if (loading) return <WorkspaceSkeleton label="Loading request..." />;
  if (!request) return <section><Message type="error">{error || "Request not found."}</Message><Link className="secondary-button" to="/approvals"><Inbox size={16} /><span>{t("Approval Inbox")}</span></Link></section>;

  const actions = new Set(request.allowedActions || []);
  // The jefe approves a waiting supplier with the request; one that is not ready yet is sent back.
  const supplierApproval = options?.supplierApproval || null;
  const approvesSupplier = Boolean(supplierApproval?.yours);
  const available = { approve: actions.has("APPROVE") && !(approvesSupplier && !supplierApproval.ready), observe: actions.has("OBSERVE") || actions.has("RETURN"), reject: actions.has("REJECT") };
  const canDecide = Object.values(available).some(Boolean);
  const steps = [...(request.approvalRouteSnapshot || [])].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  const pending = steps.find((step) => step.status === "PENDING");
  const chain = pending?.source === "MANAGER_CHAIN";
  const approvedBefore = steps.filter((step) => step.status === "APPROVED");
  const supplier = request.supplier?.legalName || request.supplier?.name || request.supplierSnapshot?.legalName;
  const centers = [...new Set((request.lines || []).map((line) => line.costCenterSnapshot?.code ? `${line.costCenterSnapshot.code} - ${line.costCenterSnapshot.name || ""}` : "").filter(Boolean))];
  const attachments = (request.attachments || []).filter((item) => item.url);
  const budget = related.budgetPreview;

  async function confirm() {
    const needsReason = choice !== "approve";
    if (needsReason && !comments.trim()) {
      setError(t("Write a short comment for the requester."));
      return;
    }
    setProcessing(true);
    setError("");
    try {
      // "observe" sends it back to the requester: one action for both former Observe and Return.
      const type = choice === "observe" && !actions.has("OBSERVE") ? "return" : choice;
      const body = choice === "approve" ? { comments, ...(chain && { forward: Boolean(forward && options?.canForward) }), ...(approvesSupplier && { approveSupplier: true }) } : { comments };
      const response = await api.post(`/approvals/${id}/${type}`, body);
      const finished = choice === "approve" && response.data.data?.status && response.data.data.status !== "PENDIENTE_APROBACION";
      if (finished) celebrate("Request approved");
      notify(response.data.warning?.message || t(choice === "approve" && body.forward ? "Approval recorded and sent to your jefe." : DECISIONS[choice].done));
      setDone({ choice, forwarded: Boolean(body.forward) });
    } catch (err) {
      setError(err.details?.errors ? `${err.message} ${err.details.errors.join(" ")}` : err.message);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <section className="approval-decision">
      <PageHeader title={request.requestNumber} description={canDecide ? "Waiting for your decision" : "Request summary"} actions={<Link className="text-link back-link" to="/approvals"><ArrowLeft size={16} /><span>{t("Approval Inbox")}</span></Link>} />

      <div className="approval-summary">
        <p className="approval-amount">{formatCurrency(request.totalAmount || 0, request.currency, language)}</p>
        <h2>{request.title || request.description}</h2>
        {request.detailedDescription && request.detailedDescription !== request.title && <p>{request.detailedDescription}</p>}
        <dl>
          <div><dt>{t("Requested by")}</dt><dd>{request.requester?.name || request.solicitor?.name || "-"}{request.requesterArea ? ` · ${request.requesterArea}` : ""}</dd></div>
          {supplier && <div><dt>{t("Supplier")}</dt><dd>{supplier}</dd></div>}
          {request.businessJustification && <div><dt>{t("Why is it needed?")}</dt><dd>{request.businessJustification}</dd></div>}
          {centers.length > 0 && <div><dt>{t("Charged to")}</dt><dd>{centers.join(", ")}</dd></div>}
          <div><dt>{t("Month")}</dt><dd>{formatIsoMonth(request.accountingPeriod) || request.accountingPeriod || "-"}</dd></div>
          <div><dt>{t("How it goes")}</dt><dd>{t(quickTrackText(request)) || request.flowType}</dd></div>
          {budget?.status && <div><dt>{t("Budget")}</dt><dd><StatusBadge status={budget.status} />{budget.projectedBalance !== null && budget.projectedBalance !== undefined && <span className="muted-text"> {t("Projected balance")}: {formatCurrency(budget.projectedBalance, "PEN", language)}</span>}</dd></div>}
        </dl>
      </div>

      {attachments.length > 0 && <div className="approval-documents">
        <h3>{t("Documents")}</h3>
        <ul>{attachments.map((item) => <li key={item._id || item.url}><FileText size={16} aria-hidden="true" /><span>{item.originalName || t(item.kind)}</span><ProtectedAssetButton className="icon-button quiet" resourcePath={item.url} fileName={item.originalName} preview title="View document" ariaLabel={`${t("View document")}: ${item.originalName || ""}`}><Eye size={15} aria-hidden="true" /></ProtectedAssetButton></li>)}</ul>
      </div>}

      {canDecide && !done && <SupplierToVerify approval={supplierApproval} />}

      {approvedBefore.length > 0 && <p className="muted-text">{t("Already approved by")}: {approvedBefore.map((step) => step.approverSnapshot?.name || t(step.approvalLevel)).join(", ")}</p>}

      <Message type="error">{error}</Message>

      {done ? <div className="approval-done" role="status">
        <CheckCircle2 size={22} aria-hidden="true" />
        <strong>{t(done.choice === "approve" && done.forwarded ? "Approval recorded and sent to your jefe." : DECISIONS[done.choice].done)}</strong>
        <div className="approval-done-actions">
          <button type="button" className="primary-button" onClick={() => navigate("/approvals")}><Inbox size={16} /><span>{t("Next pending approval")}</span></button>
          <Link className="secondary-button" to={`/requests/${id}`}>{t("Open the request")}</Link>
        </div>
      </div> : canDecide ? <div className="approval-actions">
        <div className="approval-choice" role="group" aria-label={t("Your decision")}>
          {Object.entries(DECISIONS).filter(([key]) => available[key]).map(([key, item]) => { const Icon = item.icon; return <button key={key} type="button" className={`${item.className}${choice === key ? " is-chosen" : ""}`} aria-pressed={choice === key} onClick={() => { setChoice(key); setError(""); }}><Icon size={18} /><span>{t(key === "approve" && approvesSupplier ? "Approve supplier and request" : item.label)}</span></button>; })}
        </div>
        {choice && <div className="approval-confirm">
          <label className="field"><span>{t(DECISIONS[choice].input)}{choice !== "approve" ? " *" : ""}</span><textarea rows="3" value={comments} onChange={(event) => setComments(event.target.value)} /></label>
          {choice === "approve" && chain && options?.canForward && <label className="quick-check"><input type="checkbox" checked={forward} onChange={(event) => setForward(event.target.checked)} /><Forward size={16} aria-hidden="true" /><span>{t("Also send it to my jefe for a further decision")}{options.forwardTo?.name ? ` (${options.forwardTo.name})` : ""}</span></label>}
          <button type="button" className={DECISIONS[choice].className} disabled={processing} onClick={confirm}>{t(processing ? "Saving..." : "Confirm")}</button>
        </div>}
      </div> : <div className="approval-done"><strong>{t("This request is no longer waiting for your approval.")}</strong><StatusBadge status={request.status} /><Link className="secondary-button" to={`/requests/${id}`}>{t("Open the request")}</Link></div>}
    </section>
  );
}
