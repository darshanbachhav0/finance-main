import { CheckCircle2, CornerUpLeft, Eye, MessageSquareWarning, RefreshCw, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import RequestQuickView from "../components/RequestQuickView.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import usePaginatedResource from "../hooks/usePaginatedResource.js";
import { flowTypes, requestTypes } from "../utils/options.js";

export default function ApprovalInbox() {
  const { t } = useLanguage();
  const { notify } = useToast();
  const [quickViewId, setQuickViewId] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [actionError, setActionError] = useState("");
  const [processing, setProcessing] = useState(false);
  const approvalTable = usePaginatedResource("/approvals/inbox");
  const { rows, loading } = approvalTable;

  const summary = useMemo(() => ({
    total: approvalTable.payload.summary?.total || 0,
    amount: Number(approvalTable.payload.summary?.amount || 0),
    oldest: approvalTable.payload.summary?.oldestCreatedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(approvalTable.payload.summary.oldestCreatedAt).getTime()) / 86400000))
      : 0
  }), [approvalTable.payload.summary]);

  async function decide(comments) {
    setProcessing(true);
    try {
      const response = await api.post(`/approvals/${confirm.row._id}/${confirm.type}`, { comments });
      const messages = {
        approve: confirm.row.approvalStage === "AREA_DIRECTOR" ? "Director electronic sign-off recorded." : "Approval electronic sign-off recorded.",
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
      notify(err.message, "error");
      setConfirm(null);
    } finally {
      setProcessing(false);
    }
  }

  function openDecision(row, type) {
    const approve = type === "approve";
    const directorStage = row.approvalStage === "AREA_DIRECTOR";
    const definitions = {
      approve: {
        title: "Approve this request?",
        description: directorStage
          ? "This records an authenticated Area Director electronic sign-off and advances the configured route."
          : "This records an authenticated approval and advances to the next configured level or budget control.",
        confirmLabel: "Approve request",
        tone: "primary",
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
      title: definition.title,
      description: definition.description,
      confirmLabel: definition.confirmLabel,
      tone: definition.tone,
      inputLabel: definition.inputLabel,
      inputRequired: !approve,
      details: [
        { label: "Request", value: row.requestNumber },
        { label: "Supplier", value: row.supplier?.name },
        { label: "Amount", value: `${row.currency} ${Number(row.totalAmount || 0).toFixed(2)}` },
        { label: "Approval level", value: row.approvalStage },
        { label: "Track", value: row.flowType || "A1" },
        { label: "Result", value: definition.result }
      ]
    });
  }

  return (
    <section>
      <PageHeader title="Approval Inbox" description="Review pending requests in oldest-first order and record a clear approval decision." actions={<button type="button" className="secondary-button" onClick={approvalTable.reload} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button>} />
      <Message type="error">{actionError || approvalTable.error}</Message>
      <div className="stats-grid compact-stats">
        <StatCard label="Pending approval" value={summary.total} tone="amber" />
        <StatCard label="PEN equivalent waiting" value={`PEN ${summary.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} tone="teal" />
        <StatCard label="Oldest request age" value={summary.oldest} suffix="days" tone="navy" />
      </div>
      <div className="workspace-panel">
        <DataTable
          rows={rows}
          loading={loading}
          remote={approvalTable.remote}
          filters={[
            { key: "flowType", label: "tracks", allLabel: "All tracks", options: flowTypes.filter((item) => item !== "A2") },
            { key: "requestType", label: "types", allLabel: "All types", options: requestTypes }
          ]}
          searchPlaceholder="Search request, supplier, or solicitor..."
          onRowClick={(row) => setQuickViewId(row._id)}
          rowActions={(row) => [
            { label: "Quick view", icon: Eye, onClick: () => setQuickViewId(row._id) },
            { label: "Approve", icon: CheckCircle2, onClick: () => openDecision(row, "approve") },
            { label: "Observe", icon: MessageSquareWarning, onClick: () => openDecision(row, "observe") },
            { label: "Return", icon: CornerUpLeft, onClick: () => openDecision(row, "return") },
            { label: "Reject", icon: XCircle, tone: "danger", onClick: () => openDecision(row, "reject") }
          ]}
          columns={[
            { key: "requestNumber", label: "Request", render: (row) => <Link to={`/requests/${row._id}`}>{row.requestNumber}</Link> },
            { key: "flowType", label: "Track", render: (row) => <span className="flow-chip">{row.flowType || "A1"}</span> },
            { key: "requestType", label: "Type" },
            { key: "priority", label: "Priority", render: (row) => <span className={`priority priority-${String(row.priority || "MEDIA").toLowerCase()}`}>{t(row.priority || "MEDIA")}</span> },
            { key: "approvalStage", label: "Approval level", render: (row) => t(row.approvalStage || "AREA_DIRECTOR") },
            { key: "supplier", label: "Supplier", sortable: false, getValue: (row) => row.supplier?.name, render: (row) => <div className="primary-cell"><strong>{row.supplier?.name}</strong><span>{row.supplier?.rucDni}</span></div> },
            { key: "solicitor", label: "Solicitor", sortable: false, getValue: (row) => row.solicitor?.name, render: (row) => <div className="primary-cell"><strong>{row.solicitor?.name}</strong><span>{row.solicitor?.area}</span></div> },
            { key: "approvalDueAt", label: "SLA due", render: (row) => <div className="primary-cell"><strong className={row.sla?.overdue ? "text-danger" : ""}>{row.approvalDueAt ? new Date(row.approvalDueAt).toLocaleString() : "-"}</strong><span>{t(row.sla?.severity || (row.sla?.overdue ? "OVERDUE" : "LOW"))}</span></div> },
            { key: "totalAmount", sortKey: "totalPENEquivalent", label: "Amount", align: "right", render: (row) => <strong>{row.currency} {Number(row.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong> },
            { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
            { key: "decision", label: "Decision", sortable: false, render: (row) => <div className="row-actions"><button type="button" className="icon-button approve" title={t("Approve")} onClick={() => openDecision(row, "approve")}><CheckCircle2 size={17} /></button><button type="button" className="icon-button" title={t("Observe")} onClick={() => openDecision(row, "observe")}><MessageSquareWarning size={17} /></button><button type="button" className="icon-button danger" title={t("Reject")} onClick={() => openDecision(row, "reject")}><XCircle size={17} /></button></div> }
          ]}
        />
      </div>
      <RequestQuickView requestId={quickViewId} onClose={() => setQuickViewId(null)} />
      <ConfirmDialog open={Boolean(confirm)} {...confirm} loading={processing} onClose={() => !processing && setConfirm(null)} onConfirm={decide} />
    </section>
  );
}
