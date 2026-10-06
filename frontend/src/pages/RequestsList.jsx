import WorkspaceTools from "../components/WorkspaceTools.jsx";
import { Eye, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import RequestQuickView from "../components/RequestQuickView.jsx";
import FinancialProgressSummary from "../components/FinancialProgressSummary.jsx";
import RequestStageIndicator from "../components/RequestStageIndicator.jsx";
import WorkflowStatusLegend from "../components/WorkflowStatusLegend.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import usePaginatedResource from "../hooks/usePaginatedResource.js";
import { expenseNatureLabels, expenseNatures, flowTypes, requestPriorities, requestStatuses, requestTypes } from "../utils/options.js";
import { formatCurrency, formatDate } from "../utils/formatters.js";

export default function RequestsList() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [quickViewId, setQuickViewId] = useState(null);
  const [deleteRow, setDeleteRow] = useState(null);
  const [actionError, setActionError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [withdrawRow, setWithdrawRow] = useState(null);
  const [withdrawing, setWithdrawing] = useState(false);
  // Solicitors see "My Requests": only their own. Their reports' requests are on My Team.
  const ownScope = user.role === "Solicitor";
  const requestsTable = usePaginatedResource("/requests", {
    fixedParams: ownScope ? { ownScope: true } : {},
    initialSearch: searchParams.get("search") || "",
    initialFilters: {
      status: searchParams.get("status") || "",
      renditionStatus: searchParams.get("renditionStatus") || "",
      flowType: searchParams.get("flowType") || "",
      requestType: searchParams.get("requestType") || "",
      currency: searchParams.get("currency") || "",
      period: searchParams.get("period") || "",
      project: searchParams.get("project") || "",
      costCenter: searchParams.get("costCenter") || ""
    },
    persistKey: "requests-list"
  });
  const periodsResource = usePaginatedResource("/accounting-periods", { initialPageSize: 100, debounceMs: 0 });
  const costCentersResource = usePaginatedResource("/cost-centers", { initialPageSize: 100, debounceMs: 0, persistKey: "request-filter-cost-centers" });
  const projectsResource = usePaginatedResource("/projects", { initialPageSize: 100, debounceMs: 0, persistKey: "request-filter-projects" });
  const { rows, loading } = requestsTable;

  const periods = useMemo(() => periodsResource.rows.map((row) => row.period), [periodsResource.rows]);
  const costCenters = useMemo(() => costCentersResource.rows.map((row) => ({ value: row._id, label: `${row.code} - ${row.name}` })), [costCentersResource.rows]);
  const projects = useMemo(() => projectsResource.rows.map((row) => ({ value: row.code || row.name, label: `${row.code || ""} ${row.name || ""}`.trim() })), [projectsResource.rows]);
  const canCreate = ["Admin", "Solicitor"].includes(user.role);

  function isOwner(row) {
    return user.role === "Admin" || (row.requester?._id || row.solicitor?._id) === user._id;
  }

  // The server decides what each row allows (status, issued order, who must resolve an observation).
  function canModify(row) {
    return Boolean(row.allowedActions?.includes("EDIT")) && isOwner(row);
  }

  function canDelete(row) {
    return Boolean(row.allowedActions?.includes("DELETE")) && isOwner(row);
  }

  async function removeRequest() {
    setDeleting(true);
    setActionError("");
    try {
      await api.delete(`/requests/${deleteRow._id}`);
      notify("Draft request permanently deleted.");
      setDeleteRow(null);
      setActionError("");
      requestsTable.reload();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  async function withdrawRequest(comments) {
    setWithdrawing(true);
    setActionError("");
    try {
      await api.post(`/requests/${withdrawRow._id}/withdraw`, { comments });
      notify("Request withdrawn to draft. Edit it and submit it again when ready.");
      setWithdrawRow(null);
      setActionError("");
      requestsTable.reload();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <section>
      <PageHeader
        title={ownScope ? "My Requests" : "Requests"}
        description="Create, track, submit, and review financial requests by status and accounting period."
        help={<WorkflowStatusLegend align="start" />}
        actions={canCreate && <Link className="primary-button" to="/requests/new"><Plus size={16} /><span>{t("New request")}</span></Link>}
      />
      <WorkspaceTools links={[["Suppliers", "/suppliers"], ["Reimbursement Banking", "/reimbursement-bank"], ["A2 Batch Invoices", "/batch-invoices"]]} />
      <Message type="error">{(deleteRow || withdrawRow ? "" : actionError) || requestsTable.error}</Message>
      <div className="workspace-panel">
        <DataTable
          tableId="requests"
          exportable
          rows={rows}
          loading={loading}
          remote={requestsTable.remote}
          filters={[
            { key: "status", label: "Status", allLabel: "All statuses", options: requestStatuses },
            { key: "renditionStatus", label: "rendition statuses", allLabel: "All rendition statuses", options: [
              { value: "PENDING,SUBMITTED,OBSERVED", label: "Pending / submitted / observed" },
              "VALIDATED", "NOT_REQUIRED"
            ] },
            { key: "flowType", label: "tracks", allLabel: "All tracks", options: flowTypes },
            { key: "requestType", label: "types", allLabel: "All types", options: requestTypes },
            { key: "expenseNature", label: "expense natures", allLabel: "All expense natures", options: expenseNatures.map((value) => ({ value, label: expenseNatureLabels[value] || value })) },
            { key: "priority", label: "priorities", allLabel: "All priorities", options: requestPriorities },
            { key: "currency", label: "currencies", allLabel: "All currencies", options: ["PEN", "USD"] },
            { key: "period", getValue: (row) => row.accountingPeriod, label: "periods", allLabel: "All periods", options: periods },
            { key: "costCenter", label: "Cost Centers", allLabel: "All Cost Centers", options: costCenters },
            { key: "project", label: "projects", allLabel: "All projects", options: projects }
          ]}
          searchPlaceholder="Search request, supplier, solicitor..."
          emptyTitle="No requests yet"
          emptyDescription={canCreate ? "Create a request to start its approval workflow." : "Requests appear here once they are submitted."}
          emptyAction={canCreate ? { label: "Create request", to: "/requests/new", icon: Plus } : undefined}
          onRowClick={(row) => navigate(`/requests/${row._id}`)}
          rowActions={(row) => [
            { label: "Quick view", icon: Eye, onClick: () => setQuickViewId(row._id) },
            // Next step: edit a draft or returned request; withdraw one still waiting for the jefe.
            { label: "Edit request", icon: Pencil, primary: true, hidden: !canModify(row), onClick: () => navigate(`/requests/${row._id}/edit`) },
            {
              label: "Withdraw", icon: Undo2,
              primary: (row.allowedActions || []).includes("WITHDRAW"),
              // Shown but disabled once an approver has acted, so the requester learns why.
              // The disabled hint is for the requester only, not for Admin on everyone's requests.
              hidden: !(row.allowedActions || []).includes("WITHDRAW") && !(row.status === "PENDIENTE_APROBACION" && (row.requester?._id || row.solicitor?._id) === user._id),
              disabled: !(row.allowedActions || []).includes("WITHDRAW"),
              disabledReason: (row.allowedActions || []).includes("WITHDRAW") ? undefined : "An approver has already acted on this request; it can no longer be withdrawn.",
              onClick: () => setWithdrawRow(row)
            },
            { label: "Delete permanently", icon: Trash2, tone: "danger", hidden: !canDelete(row), onClick: () => setDeleteRow(row) }
          ]}
          columns={[
            { key: "requestNumber", type: "code", label: "Request", render: (row) => <Link to={`/requests/${row._id}`}>{row.requestNumber}</Link> },
            { key: "flowType", type: "code", label: "Track", render: (row) => <span className="flow-chip">{row.flowType || "A1"}</span> },
            { key: "requestType", label: "Type" },
            { key: "expenseNature", label: "Expense nature", render: (row) => t(expenseNatureLabels[row.expenseNature] || row.expenseNature) },
            { key: "priority", label: "Priority", render: (row) => <span className={`priority priority-${String(row.priority || "MEDIA").toLowerCase()}`}>{t(row.priority || "MEDIA")}</span> },
            { key: "supplier", type: "name", label: "Supplier", sortable: false, getValue: (row) => row.supplier?.name, render: (row) => <div className="primary-cell"><strong>{row.supplier?.name || "-"}</strong><span>{row.supplier?.rucDni}</span></div> },
            { key: "solicitor", label: "Solicitor", sortable: false, getValue: (row) => row.solicitor?.name, render: (row) => row.solicitor?.name || "-" },
            { key: "accountingPeriod", type: "code", label: "Period" },
            { key: "totalAmount", type: "money", label: "Amount", render: (row) => <strong>{formatCurrency(row.totalAmount || 0, row.currency, language)}</strong> },
            { key: "status", type: "status", minWidth: "180px", label: "Status", render: (row) => <div className="status-cell"><FinancialProgressSummary request={row} compact /><RequestStageIndicator request={row} compact /></div> },
            { key: "updatedAt", type: "date", label: "Updated", render: (row) => formatDate(row.updatedAt) }
          ]}
        />
      </div>

      <RequestQuickView requestId={quickViewId} onClose={() => setQuickViewId(null)} />
      <ConfirmDialog
        open={Boolean(deleteRow)}
        error={actionError}
        title="Permanently delete this request?"
        description="Only draft requests can be deleted. This action cannot be undone."
        details={deleteRow ? [{ label: "Request", value: deleteRow.requestNumber }, { label: "Result", value: "The request and its draft data will be permanently removed." }] : []}
        confirmLabel="Delete permanently"
        tone="danger"
        loading={deleting}
        onClose={() => !deleting && setDeleteRow(null)}
        onConfirm={removeRequest}
      />
      <ConfirmDialog
        open={Boolean(withdrawRow)}
        error={actionError}
        title="Withdraw this request?"
        description="Your first approver has not approved it yet. Withdrawing returns it to draft so you can edit it and submit it again; the approval restarts from the first approver."
        details={withdrawRow ? [{ label: "Request", value: withdrawRow.requestNumber }, { label: "Result", value: "Status changes to BORRADOR and the pending approval task is closed." }] : []}
        confirmLabel="Withdraw request"
        inputLabel="Reason (optional)"
        tone="danger"
        loading={withdrawing}
        onClose={() => !withdrawing && setWithdrawRow(null)}
        onConfirm={withdrawRequest}
      />
    </section>
  );
}
