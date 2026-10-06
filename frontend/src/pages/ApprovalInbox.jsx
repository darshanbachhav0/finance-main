import { CheckCircle2, CornerUpLeft, Eye, Forward, MessageSquareWarning, RefreshCw, X, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DeepLinkNotice from "../components/DeepLinkNotice.jsx";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import RequestQuickView from "../components/RequestQuickView.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import BudgetExceptionDecisions, { useBudgetExceptionDecisions } from "../components/BudgetExceptionDecisions.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import useDeepLink from "../hooks/useDeepLink.js";
import usePaginatedResource from "../hooks/usePaginatedResource.js";
import { flowTypes, requestTypes } from "../utils/options.js";
import { formatCurrency, formatDateTime } from "../utils/formatters.js";

// Mirrors MAX_BULK_APPROVALS in backend/src/services/approvalService.js.
const BULK_APPROVAL_LIMIT = 50;

export default function ApprovalInbox() {
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const [quickViewId, setQuickViewId] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [actionError, setActionError] = useState("");
  const [processing, setProcessing] = useState(false);
  // Bulk approve: ids selected on the current page, the pending batch dialog and the last result.
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkConfirm, setBulkConfirm] = useState(null);
  const [bulkResult, setBulkResult] = useState(null);
  // /approvals?request=<id> (approval notifications): the inbox narrows to that request and its
  // quick view opens, so the approver lands on the decision row.
  const deepLink = useDeepLink(["request"]);
  const linkedRequest = deepLink.link.request || "";
  const approvalTable = usePaginatedResource("/approvals/inbox", { fixedParams: deepLink.link, deepLink: deepLink.active });
  useEffect(() => { if (linkedRequest) setQuickViewId(linkedRequest); }, [linkedRequest]);
  const { rows, loading } = approvalTable;
  // Management/Admin: reviewed budget exceptions awaiting Management's decision (own section below).
  const exceptionDecisions = useBudgetExceptionDecisions();

  const summary = useMemo(() => ({
    total: approvalTable.payload.summary?.total || 0,
    amount: Number(approvalTable.payload.summary?.amount || 0),
    oldest: approvalTable.payload.summary?.oldestCreatedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(approvalTable.payload.summary.oldestCreatedAt).getTime()) / 86400000))
      : 0
  }), [approvalTable.payload.summary]);

  function activeStepOf(row) {
    const steps = [...(row.approvalRouteSnapshot || [])].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    return steps.find((step) => step.required !== false && step.status === "PENDING") || null;
  }
  // The server decides whether "Send to my jefe" is possible: only while the
  // current approver has an active jefe who is not on leave.
  const canForward = row => Boolean(row.approvalOptions?.canForward);
  const isChainRow = (row) => activeStepOf(row)?.source === "MANAGER_CHAIN";
  const forwardName = row => row.approvalOptions?.forwardTo?.name || "";

  async function decide(comments) {
    setProcessing(true);
    setActionError("");
    try {
      const body = confirm.type === "approve" && typeof confirm.forward === "boolean" ? { comments, forward: confirm.forward } : { comments };
      const response = await api.post(`/approvals/${confirm.row._id}/${confirm.type}`, body);
      const messages = {
        approve: confirm.forward === true ? "Approval recorded and sent to your jefe."
          : confirm.row.approvalStage === "AREA_DIRECTOR" ? "Director electronic sign-off recorded." : "Approval electronic sign-off recorded.",
        observe: "Request observed and returned for correction.",
        return: "Request returned to the requester with comments.",
        reject: "Request rejected with a preserved decision record."
      };
      notify(response.data.warning?.message || messages[confirm.type]);
      setConfirm(null);
      setActionError("");
      approvalTable.reload();
    } catch (err) {
      setActionError(err.details?.errors ? `${err.message} ${err.details.errors.join(" ")}` : err.message);
      setConfirm(null);
    } finally {
      setProcessing(false);
    }
  }

  function openDecision(row, type, forward) {
    const approve = type === "approve";
    const directorStage = row.approvalStage === "AREA_DIRECTOR";
    const chainRow = isChainRow(row);
    const definitions = {
      approve: chainRow ? (forward ? {
        title: "Approve and send to your jefe?",
        description: forwardName(row)
          ? `${t("This records your approval and sends the request to your jefe for a further decision:")} ${forwardName(row)}.`
          : "This records your approval and sends the request to your jefe for a further decision.",
        confirmLabel: "Send to my jefe",
        tone: "success",
        inputLabel: "Approval comments",
        result: "This step is marked approved and your jefe decides next: finalize, or send it to their own jefe."
      } : {
        title: "Approve this request and finalize?",
        description: "This completes all request approvals and proceeds to budget control. Budget and accounting checks still apply.",
        confirmLabel: "Approve and finalize",
        tone: "success",
        inputLabel: "Approval comments",
        result: "Approval complete - Budget control"
      }) : {
        title: "Approve this request?",
        description: directorStage
          ? "This records an authenticated Area Director electronic sign-off and advances the configured route."
          : "This records an authenticated approval and advances to the next configured level or budget control.",
        confirmLabel: "Approve request",
        tone: "success",
        inputLabel: "Approval comments",
        result: "The configured approval route advances. Budget is committed only after all required approvals pass."
      },
      observe: {
        title: "Observe this request?", description: "The requester must correct the stated observations before resubmission.", confirmLabel: "Observe request", tone: "danger", inputLabel: "Observation comments", result: "Status changes to OBSERVADO and the requester receives a task."
      },
      return: {
        title: "Return this request?", description: "Return the request to its owner without erasing the approval history.", confirmLabel: "Return request", tone: "danger", inputLabel: "Return comments", result: "Status changes to DEVUELTO and correction is required."
      },
      reject: {
        title: "Reject this request?", description: "Reject the request and preserve the full decision trail. A reason is mandatory.", confirmLabel: "Reject request", tone: "danger", inputLabel: "Rejection comments", result: "Status changes to RECHAZADO and the requester is notified."
      }
    };
    const definition = definitions[type];
    setConfirm({
      row,
      type,
      forward,
      title: definition.title,
      description: definition.description,
      confirmLabel: definition.confirmLabel,
      tone: definition.tone,
      inputLabel: definition.inputLabel,
      inputRequired: !approve,
      details: [
        { label: "Request", value: row.requestNumber },
        { label: "Supplier", value: row.supplier?.name },
        { label: "Amount", value: formatCurrency(row.totalAmount || 0, row.currency, language) },
        { label: "Approval level", value: row.approvalStage },
        { label: "Track", value: row.flowType || "A1" },
        { label: "Result", value: definition.result }
      ]
    });
  }

  const hasAction = (row, action) => (row.allowedActions || []).includes(action);
  const canDecide = row => ["APPROVE", "OBSERVE", "RETURN", "REJECT"].some(action => hasAction(row, action));

  // ---- Bulk approve. Approve only: observe, return and reject stay individual decisions.
  // Only rows the server lets this user APPROVE are selectable; the chain decision
  // (finalize or send to my jefe) is taken once for the whole batch.
  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => rows.some((row) => row._id === id && hasAction(row, "APPROVE"))));
  }, [rows]);
  const selectedRows = rows.filter((row) => selectedIds.includes(row._id));
  const selectedChainRows = selectedRows.filter(isChainRow);
  const notForwardable = selectedRows.filter((row) => !(isChainRow(row) && canForward(row)));
  const bulkCanForward = selectedRows.length > 0 && notForwardable.length === 0;
  const bulkOverLimit = selectedRows.length > BULK_APPROVAL_LIMIT;
  const selectedTotals = Object.entries(selectedRows.reduce((totals, row) => {
    const code = row.currency || "PEN";
    totals[code] = (totals[code] || 0) + Number(row.totalAmount || 0);
    return totals;
  }, {})).map(([code, value]) => formatCurrency(value, code, language)).join(" · ");
  const selectedPen = selectedRows.reduce((sum, row) => sum + Number(row.totalPENEquivalent || 0), 0);
  const requestNumbers = (list, max = 8) => {
    const names = list.map((row) => row.requestNumber);
    return names.length > max ? `${names.slice(0, max).join(", ")} +${names.length - max}` : names.join(", ");
  };
  const bulkApproveLabel = selectedChainRows.length ? "Approve and finalize" : "Approve selected";

  function openBulkApproval(forward) {
    if (!selectedRows.length || bulkOverLimit || (forward && !bulkCanForward)) return;
    setBulkConfirm({
      forward,
      title: forward ? "Approve these requests and send them to your jefe?" : "Approve these requests?",
      description: forward
        ? "Each request is approved at your level and sent to your jefe, who decides next. Every request is processed on its own, with the same checks as an individual approval."
        : "Each request is approved with the same checks as an individual approval. Manager-chain requests are finalized at your level. A request that fails a check stays pending and is listed in the result.",
      confirmLabel: forward ? "Send to my jefe" : bulkApproveLabel,
      details: [
        { label: "Requests", value: String(selectedRows.length) },
        { label: "Total amount", value: selectedTotals },
        { label: "PEN equivalent", value: formatCurrency(selectedPen, "PEN", language) },
        { label: "Decision", value: forward ? "Send to my jefe" : bulkApproveLabel },
        { label: "Selected requests", value: requestNumbers(selectedRows, 12) }
      ]
    });
  }

  async function bulkApprove(comments) {
    setProcessing(true);
    setActionError("");
    try {
      const body = { ids: selectedRows.map((row) => row._id), comments };
      // forward is only meaningful (and then required) when manager-chain rows are in the batch.
      if (bulkConfirm.forward || selectedChainRows.length) body.forward = Boolean(bulkConfirm.forward);
      const response = await api.post("/approvals/bulk", body);
      const data = response.data.data;
      setBulkResult(data);
      notify(t("{approved} approved, {failed} with errors").replace("{approved}", data.summary.approved).replace("{failed}", data.summary.failed), !data.summary.failed ? "success" : data.summary.approved ? "warning" : "error");
      setSelectedIds([]);
      setActionError("");
      setBulkConfirm(null);
      approvalTable.reload();
    } catch (err) {
      const listed = err.details?.requests?.map((item) => item.requestNumber).filter(Boolean) || [];
      setActionError(listed.length ? `${err.message} ${listed.join(", ")}` : err.message);
      setBulkConfirm(null);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <section>
      <PageHeader title="Approval Inbox" description="Review pending requests in oldest-first order and record a clear approval decision." actions={<button type="button" className="secondary-button" onClick={approvalTable.reload} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button>} />
      <Message type="error">{actionError || approvalTable.error}</Message>
      {deepLink.active && <DeepLinkNotice title="Showing the request linked from your notification" missing={!loading && !rows.length} missingDescription="This request is no longer waiting for your approval. Its quick view shows the current status." clearLabel="Show all pending approvals" onClear={() => { setQuickViewId(null); deepLink.clear(); }} />}
      <div className="stats-grid compact-stats">
        <StatCard label="Pending approval" value={summary.total} tone="warning" />
        <StatCard label="PEN equivalent waiting" value={formatCurrency(summary.amount, "PEN", language)} tone="accent" />
        <StatCard label="Oldest request age" value={summary.oldest} suffix="days" tone="neutral" />
        {exceptionDecisions.enabled && <>
          <StatCard label="Budget exceptions to decide" value={exceptionDecisions.total} tone="danger" to="#budget-exceptions" actionLabel="View budget exceptions" />
          <StatCard label="Decisions awaiting you" value={summary.total + exceptionDecisions.total} tone="neutral" />
        </>}
      </div>
      {bulkResult && (
        <div className={`bulk-result${bulkResult.summary.failed ? " has-errors" : ""}`} role="status">
          <div>
            <strong>{t("{approved} approved, {failed} with errors").replace("{approved}", bulkResult.summary.approved).replace("{failed}", bulkResult.summary.failed)}</strong>
            {bulkResult.results.some((item) => item.ok && item.warning) && <span>{t("Some approvals have a budget follow-up; the requester and Budget were notified.")}</span>}
            {bulkResult.summary.failed > 0 && <ul className="bulk-result-errors">
              {bulkResult.results.filter((item) => !item.ok).map((item) => <li key={item.id}><strong>{item.requestNumber || t("Unknown request")}</strong>: {t(item.message)}</li>)}
            </ul>}
          </div>
          <button type="button" className="icon-button quiet" onClick={() => setBulkResult(null)} aria-label={t("Close summary")}><X size={16} /></button>
        </div>
      )}
      <div className="workspace-panel">
        <DataTable
          rows={rows}
          loading={loading}
          remote={approvalTable.remote}
          selection={{ selected: selectedIds, onChange: setSelectedIds, isRowSelectable: (row) => hasAction(row, "APPROVE") }}
          filters={[
            { key: "flowType", label: "tracks", allLabel: "All tracks", options: flowTypes.filter((item) => item !== "A2") },
            { key: "requestType", label: "types", allLabel: "All types", options: requestTypes }
          ]}
          searchPlaceholder="Search request, supplier, or solicitor..."
          onRowClick={(row) => setQuickViewId(row._id)}
          rowActions={(row) => [
            { label: "Quick view", icon: Eye, onClick: () => setQuickViewId(row._id) },

            // Approve, send to my jefe, observe and reject are buttons in the Decision column; the
            // menu keeps only what isn't shown there.
            { label: "Return", icon: CornerUpLeft, hidden: !hasAction(row, "RETURN"), onClick: () => openDecision(row, "return") }
          ]}
          columns={[
            { key: "requestNumber", type: "name", primary: true, label: "Request", render: (row) => <div className="primary-cell"><Link to={`/requests/${row._id}`}>{row.requestNumber}</Link><span>{row.title || row.description || ""}</span></div> },
            { key: "supplier", type: "name", label: "Supplier", sortable: false, getValue: (row) => row.supplier?.name, render: (row) => row.supplier?.legalName || row.supplier?.name || (row.flowType === "C" ? t("No supplier (Track C)") : "-") },
            { key: "approvalStage", type: "name", minWidth: "150px", label: "Current stage", render: (row) => t(row.approvalStage || "AREA_DIRECTOR") },
            { key: "area", label: "Area", sortable: false, render: row => row.solicitor?.area || row.requesterArea || "—" },
            { key: "solicitor", type: "name", minWidth: "170px", primary: true, label: "Requester", sortable: false, getValue: (row) => row.solicitor?.name, render: (row) => <div className="primary-cell"><strong>{row.solicitor?.name}</strong></div> },
            { key: "approvalDueAt", type: "date", primary: true, label: "SLA due", render: (row) => <div className="primary-cell"><strong className={row.sla?.overdue ? "text-danger" : ""}>{row.approvalDueAt ? formatDateTime(row.approvalDueAt) : "-"}</strong><StatusBadge status={row.sla?.alert || row.sla?.severity || "LOW"} /></div> },
            { key: "totalAmount", type: "money", sortKey: "totalPENEquivalent", label: "Amount", render: (row) => <strong>{formatCurrency(row.totalAmount || 0, row.currency, language)}</strong> },
            { key: "decision", primary: true, label: "Decision", sortable: false, render: (row) => canDecide(row) ? <div className="row-actions decision-actions">{hasAction(row, "APPROVE") && <button type="button" className="secondary-button approve decision-button" title={t(isChainRow(row) ? "Approve and finalize" : "Approve")} onClick={() => openDecision(row, "approve", isChainRow(row) ? false : undefined)}><CheckCircle2 size={17} /><span>{t(isChainRow(row) ? "Approve and finalize" : "Approve")}</span></button>}{hasAction(row, "APPROVE") && isChainRow(row) && canForward(row) && <button type="button" className="secondary-button decision-button" title={forwardName(row) ? `${t("Send to my jefe")}: ${forwardName(row)}` : t("Send to my jefe")} onClick={() => openDecision(row, "approve", true)}><Forward size={17} /><span>{t("Send to my jefe")}</span></button>}{hasAction(row, "OBSERVE") && <button type="button" className="icon-button" title={t("Observe")} aria-label={t("Observe")} onClick={() => openDecision(row, "observe")}><MessageSquareWarning size={17} /></button>}{hasAction(row, "REJECT") && <button type="button" className="icon-button danger" title={t("Reject")} aria-label={t("Reject")} onClick={() => openDecision(row, "reject")}><XCircle size={17} /></button>}</div> : <span className="muted-text">{t("No action available")}</span> }
          ]}
        />
        {selectedRows.length > 0 && (
          <div className="bulk-bar" role="region" aria-label={t("Bulk approval")}>
            <div className="bulk-bar-summary">
              <strong>{t(selectedRows.length === 1 ? "{count} item selected" : "{count} selected").replace("{count}", selectedRows.length)}</strong>
              <span>{selectedTotals}</span>
            </div>
            <div className="bulk-bar-actions">
              <button type="button" className="primary-button" disabled={processing || bulkOverLimit} onClick={() => openBulkApproval(false)}><CheckCircle2 size={16} /><span>{t(bulkApproveLabel)}</span></button>
              {selectedChainRows.length > 0 && <button type="button" className="secondary-button" disabled={processing || bulkOverLimit || !bulkCanForward} aria-describedby={bulkCanForward ? undefined : "bulk-forward-note"} onClick={() => openBulkApproval(true)}><Forward size={16} /><span>{t("Send to my jefe")}</span></button>}
              <button type="button" className="text-button" onClick={() => setSelectedIds([])}>{t("Clear selection")}</button>
            </div>
            {bulkOverLimit && <p className="bulk-bar-note">{t("Select at most {max} requests per batch.").replace("{max}", BULK_APPROVAL_LIMIT)}</p>}
            {selectedChainRows.length > 0 && !bulkCanForward && <p className="bulk-bar-note" id="bulk-forward-note">{t("Send to my jefe is available only when every selected request can be sent to your jefe. Not possible for:")} {requestNumbers(notForwardable)}</p>}
          </div>
        )}
      </div>
      <BudgetExceptionDecisions queue={exceptionDecisions} />
      <RequestQuickView requestId={quickViewId} onClose={() => setQuickViewId(null)} />
      <ConfirmDialog open={Boolean(confirm)} {...confirm} loading={processing} onClose={() => !processing && setConfirm(null)} onConfirm={decide} />
      <ConfirmDialog open={Boolean(bulkConfirm)} {...bulkConfirm} tone="success" inputLabel="Approval comments (shared by every request)" loading={processing} onClose={() => !processing && setBulkConfirm(null)} onConfirm={bulkApprove} />
    </section>
  );
}
