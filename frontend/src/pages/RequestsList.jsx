import WorkspaceTools from "../components/WorkspaceTools.jsx";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
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

  function canModify(row) {
    return ["BORRADOR", "OBSERVADO", "OBSERVADO_PRESUPUESTO", "OBSERVADO_SUNAT", "OBSERVADO_MONTO_EXCEDIDO", "OBSERVADO_CARGA_MASIVA", "DEVUELTO"].includes(row.status) && isOwner(row);
  }

  function canDelete(row) {
    return ["BORRADOR"].includes(row.status) && isOwner(row);
  }

  async function removeRequest() {
    setDeleting(true);
    try {
      await api.delete(`/requests/${deleteRow._id}`);
      notify("Draft request permanently deleted.");
      setDeleteRow(null);
      setActionError("");
      requestsTable.reload();
    } catch (err) {
      setActionError(err.message);
      notify(err.message, "error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section>
      <WorkspaceTools links={[["Suppliers", "/suppliers"], ["Reimbursement Banking", "/reimbursement-bank"], ["A2 Batch Invoices", "/batch-invoices"]]} />
      <PageHeader
        title={ownScope ? "My Requests" : "Requests"}
        description="Create, track, submit, and review financial requests by status and accounting period."
        help={<WorkflowStatusLegend align="start" />}
        actions={canCreate && <Link className="primary-button" to="/requests/new"><Plus size={16} /><span>{t("New request")}</span></Link>}
      />
      <Message type="error">{actionError || requestsTable.error}</Message>
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
          onRowClick={(row) => setQuickViewId(row._id)}
          rowActions={(row) => [
            { label: "Quick view", icon: Eye, onClick: () => setQuickViewId(row._id) },
            { label: "Open full details", icon: Eye, onClick: () => navigate(`/requests/${row._id}`) },
            { label: "Edit request", icon: Pencil, hidden: !canModify(row), onClick: () => navigate(`/requests/${row._id}/edit`) },
            { label: "Delete permanently", icon: Trash2, tone: "danger", hidden: !canDelete(row), onClick: () => setDeleteRow(row) }
          ]}
          columns={[
            { key: "requestNumber", label: "Request", render: (row) => <Link to={`/requests/${row._id}`}>{row.requestNumber}</Link> },
            { key: "flowType", label: "Track", render: (row) => <span className="flow-chip">{row.flowType || "A1"}</span> },
            { key: "requestType", label: "Type" },
            { key: "expenseNature", label: "Expense nature", render: (row) => t(expenseNatureLabels[row.expenseNature] || row.expenseNature) },
            { key: "priority", label: "Priority", render: (row) => <span className={`priority priority-${String(row.priority || "MEDIA").toLowerCase()}`}>{t(row.priority || "MEDIA")}</span> },
            { key: "supplier", label: "Supplier", sortable: false, getValue: (row) => row.supplier?.name, render: (row) => <div className="primary-cell"><strong>{row.supplier?.name || "-"}</strong><span>{row.supplier?.rucDni}</span></div> },
            { key: "solicitor", label: "Solicitor", sortable: false, getValue: (row) => row.solicitor?.name, render: (row) => row.solicitor?.name || "-" },
            { key: "accountingPeriod", label: "Period" },
            { key: "totalAmount", label: "Amount", align: "right", render: (row) => <strong>{formatCurrency(row.totalAmount || 0, row.currency, language)}</strong> },
            { key: "status", label: "Status", render: (row) => <div className="status-cell"><FinancialProgressSummary request={row} compact /><RequestStageIndicator request={row} compact /></div> },
            { key: "updatedAt", label: "Updated", render: (row) => formatDate(row.updatedAt) }
          ]}
        />
      </div>

      <RequestQuickView requestId={quickViewId} onClose={() => setQuickViewId(null)} />
      <ConfirmDialog
        open={Boolean(deleteRow)}
        title="Permanently delete this request?"
        description="Only draft requests can be deleted. This action cannot be undone."
        details={deleteRow ? [{ label: "Request", value: deleteRow.requestNumber }, { label: "Result", value: "The request and its draft data will be permanently removed." }] : []}
        confirmLabel="Delete permanently"
        tone="danger"
        loading={deleting}
        onClose={() => setDeleteRow(null)}
        onConfirm={removeRequest}
      />
    </section>
  );
}
