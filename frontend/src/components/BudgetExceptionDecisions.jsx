import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import api from "../api/client.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import DataTable from "./DataTable.jsx";
import Message from "./Message.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { formatCurrency, formatDateTime } from "../utils/formatters.js";

// One decision inbox for Management: the budget exceptions Budget has already reviewed are
// decided in the Approval Inbox, next to the approvals. Only Management may approve or reject
// one (the backend enforces it, and blocks an exception the user requested or prepared); Admin
// sees the same queue read-only. The full record stays in Budget Control → Exceptions.
export const BUDGET_EXCEPTION_DECISION_ROLES = ["Management", "Admin"];
const QUEUE_ENDPOINT = "/dashboard/decisions/budget-exceptions";
const ALL_EXCEPTIONS_PATH = "/budget?tab=exceptions&exceptionStatus=PENDING";
const STRATEGY_LABELS = { REQUEST_BUDGET_INCREASE: "Budget increase", EXTRAORDINARY_APPROVAL: "Extraordinary approval" };
const strategyLabel = (strategy) => STRATEGY_LABELS[strategy] || strategy || "-";

export function useBudgetExceptionDecisions() {
  const { user } = useAuth();
  const enabled = BUDGET_EXCEPTION_DECISION_ROLES.includes(user?.role);
  const [state, setState] = useState({ rows: [], total: 0, canDecide: false, loading: enabled, error: "" });
  const reload = useCallback(async () => {
    if (!enabled) return;
    setState((current) => ({ ...current, loading: true }));
    try {
      const response = await api.get(QUEUE_ENDPOINT);
      setState({ rows: response.data.data || [], total: Number(response.data.total || 0), canDecide: Boolean(response.data.canDecide), loading: false, error: "" });
    } catch (err) {
      setState((current) => ({ ...current, loading: false, error: err.message }));
    }
  }, [enabled]);
  useEffect(() => { void reload(); }, [reload]);
  return { enabled, ...state, reload };
}

export default function BudgetExceptionDecisions({ queue }) {
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const sectionRef = useRef(null);
  const [confirm, setConfirm] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [actionError, setActionError] = useState("");
  const money = (value) => formatCurrency(value || 0, "PEN", language);

  // Task and notification links (/approvals#budget-exceptions) land on this section.
  useEffect(() => {
    if (queue.enabled && !queue.loading && location.hash === "#budget-exceptions") sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [queue.enabled, queue.loading, location.hash]);

  if (!queue.enabled) return null;

  function openDecision(row, status) {
    const approve = status === "APPROVED";
    setConfirm({
      row,
      status,
      title: approve ? "Approve budget exception?" : "Reject budget exception?",
      description: approve
        ? row.strategy === "REQUEST_BUDGET_INCREASE" ? "This records an audited decision and automatically adds the shortfall to the budget, so the commitment can proceed." : "This records an audited exception decision that authorizes the overrun for this request."
        : "The request will remain blocked from budget commitment.",
      confirmLabel: approve ? "Approve exception" : "Reject exception",
      tone: approve ? "success" : "danger",
      inputLabel: "Decision comments",
      inputRequired: true,
      details: [
        { label: "Request", value: row.request?.requestNumber },
        { label: "Strategy", value: strategyLabel(row.strategy) },
        { label: "Requested", value: money(row.requestedAmount) },
        { label: "Available", value: money(row.availableAmount) },
        { label: "Budget review", value: row.preparationComments || "-" }
      ]
    });
  }

  async function decide(comments) {
    setProcessing(true);
    setActionError("");
    try {
      const response = await api.post(`/budget/exceptions/${confirm.row._id}/decision`, { status: confirm.status, comments });
      const increase = response.data?.data?.appliedIncrease?.amount;
      notify(confirm.status === "APPROVED"
        ? (increase > 0 ? t("Budget exception approved. The budget was increased by {amount}.").replace("{amount}", money(increase)) : "Budget exception approved.")
        : "Budget exception rejected.");
      setConfirm(null);
      await queue.reload();
    } catch (err) {
      setActionError(err.message);
      setConfirm(null);
      await queue.reload();
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div ref={sectionRef} id="budget-exceptions" className="workspace-panel section-spacer budget-exception-decisions">
      <div className="section-heading">
        <div>
          <h3>{t("Budget exceptions awaiting your decision")}</h3>
          <p>{t(queue.canDecide ? "Budget has reviewed these exceptions. Approve or reject each one with a comment." : "Budget has reviewed these exceptions. Only Management may approve or reject them.")}</p>
        </div>
        <div className="budget-exception-decisions-links">
          <span className="section-count">{queue.total}</span>
          <Link className="text-link" to={ALL_EXCEPTIONS_PATH}>{t("View all exceptions")}</Link>
        </div>
      </div>
      <Message type="error">{actionError || queue.error}</Message>
      <DataTable
        className="cards-narrow-only"
        controls={false}
        rows={queue.rows}
        loading={queue.loading}
        emptyDescription="No budget exceptions are waiting for your decision."
        rowActions={(row) => [
          { label: "View exception", icon: ExternalLink, onClick: () => navigate(row.path) },
          { label: "Approve exception", icon: CheckCircle2, hidden: !row.canDecide, onClick: () => openDecision(row, "APPROVED") },
          { label: "Reject exception", icon: XCircle, tone: "danger", hidden: !row.canDecide, onClick: () => openDecision(row, "REJECTED") }
        ]}
        columns={[
          { key: "request", primary: true, label: "Request", sortable: false, getValue: (row) => row.request?.requestNumber, render: (row) => row.request ? <div className="primary-cell"><Link to={`/requests/${row.request._id}`}>{row.request.requestNumber}</Link><span>{row.request.requester?.name || row.request.requesterArea || ""}</span></div> : "-" },
          { key: "costCenter", label: "Cost center", sortable: false, getValue: (row) => row.costCenter?.code, render: (row) => row.costCenter ? <div className="primary-cell"><strong>{row.costCenter.code}</strong><span>{row.costCenter.name}</span></div> : "-" },
          { key: "strategy", label: "Strategy", render: (row) => t(strategyLabel(row.strategy)) },
          { key: "requestedAmount", label: "Requested", align: "right", render: (row) => <strong>{money(row.requestedAmount)}</strong> },
          { key: "availableAmount", label: "Available", align: "right", render: (row) => money(row.availableAmount) },
          { key: "preparationComments", primary: true, label: "Budget review", sortable: false, render: (row) => <div className="primary-cell"><span>{row.preparationComments || "-"}</span><small className="muted-text">{[row.preparedBy?.name, row.preparedAt ? formatDateTime(row.preparedAt, language) : ""].filter(Boolean).join(" · ")}</small></div> },
          { key: "decision", primary: true, label: "Decision", sortable: false, render: (row) => row.canDecide
            ? <div className="row-actions decision-actions">
                <button type="button" className="secondary-button approve decision-button" onClick={() => openDecision(row, "APPROVED")}><CheckCircle2 size={17} /><span>{t("Approve")}</span></button>
                <button type="button" className="icon-button danger" title={t("Reject")} aria-label={t("Reject")} onClick={() => openDecision(row, "REJECTED")}><XCircle size={17} /></button>
                <Link className="icon-button" to={row.path} title={t("View exception")} aria-label={t("View exception")}><ExternalLink size={17} /></Link>
              </div>
            : <div className="primary-cell"><span className="muted-text">{t(row.blockedReason || "No action available")}</span><Link className="text-link" to={row.path}>{t("View exception")}</Link></div> }
        ]}
      />
      <ConfirmDialog open={Boolean(confirm)} {...confirm} loading={processing} onClose={() => !processing && setConfirm(null)} onConfirm={decide} />
    </div>
  );
}
