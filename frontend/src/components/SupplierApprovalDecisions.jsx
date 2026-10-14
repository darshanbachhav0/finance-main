import { CheckCircle2, ExternalLink, MessageSquareWarning, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import api from "../api/client.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import DataTable from "./DataTable.jsx";
import Message from "./Message.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { formatDateTime } from "../utils/formatters.js";

// Suppliers waiting for this user's decision: only the proposer's jefe approves a supplier (their
// substitute or the jefe above while they are away; the Admin when the proposer has no jefe). The
// backend decides who that is, so the queue holds only suppliers this user may decide on.
const QUEUE_ENDPOINT = "/suppliers";
const QUEUE_PARAMS = { awaitingMyApproval: "true", pageSize: 50, sortBy: "createdAt", sortDirection: "asc" };

export function useSupplierApprovalDecisions() {
  const { user, readOnly } = useAuth();
  const enabled = !readOnly && !["ManagementViewer", "SuperAdmin"].includes(user?.role);
  const [state, setState] = useState({ rows: [], total: 0, loading: enabled, error: "" });
  const reload = useCallback(async () => {
    if (!enabled) return;
    setState((current) => ({ ...current, loading: true }));
    try {
      const response = await api.get(QUEUE_ENDPOINT, { params: QUEUE_PARAMS });
      setState({ rows: response.data.data || [], total: Number(response.data.pagination?.total || 0), loading: false, error: "" });
    } catch (err) {
      setState((current) => ({ ...current, loading: false, error: err.message }));
    }
  }, [enabled]);
  useEffect(() => { void reload(); }, [reload]);
  return { enabled, ...state, reload };
}

const DECISIONS = {
  APPROVE: {
    title: "Approve this supplier?",
    description: "Approving assigns the PRV code and lets every requester use this supplier on their requests. Accounting still verifies its bank account before Treasury pays it.",
    confirmLabel: "Approve supplier",
    tone: "success",
    inputLabel: "Approval comments",
    inputRequired: false,
    success: "Supplier approved and PRV assigned. It can now be used on requests."
  },
  OBSERVE: {
    title: "Observe this supplier?",
    description: "The proposer corrects the stated observations and the supplier comes back to you.",
    confirmLabel: "Observe supplier",
    tone: "danger",
    inputLabel: "Observation comments",
    inputRequired: true,
    success: "Supplier observed and returned to the proposer."
  },
  REJECT: {
    title: "Reject this supplier?",
    description: "No PRV is assigned and the RUC/DNI cannot be proposed again to bypass the rejection.",
    confirmLabel: "Reject supplier",
    tone: "danger",
    inputLabel: "Rejection comments",
    inputRequired: true,
    success: "Supplier rejected with a preserved decision record."
  }
};

export default function SupplierApprovalDecisions({ queue }) {
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const sectionRef = useRef(null);
  const [confirm, setConfirm] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [actionError, setActionError] = useState("");
  const linked = location.hash === "#supplier-approvals";

  // Task and notification links (/approvals#supplier-approvals) land on this section.
  useEffect(() => {
    if (queue.enabled && !queue.loading && linked) sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [queue.enabled, queue.loading, linked]);

  // Most people never approve a supplier, so the section appears only when there is one to decide.
  if (!queue.enabled || (!queue.total && !linked)) return null;

  const supplierName = (row) => row.legalName || row.name || row.rucDni;
  const recordPath = (row) => `/suppliers/${row._id}`;

  function openDecision(row, decision) {
    const definition = DECISIONS[decision];
    setConfirm({
      row,
      decision,
      title: definition.title,
      description: definition.description,
      confirmLabel: definition.confirmLabel,
      tone: definition.tone,
      inputLabel: definition.inputLabel,
      inputRequired: definition.inputRequired,
      details: [
        { label: "Supplier", value: supplierName(row) },
        { label: "RUC / DNI", value: row.rucDni },
        { label: "Proposed By", value: row.proposedBy?.name || "-" },
        { label: "Registration justification", value: row.proposalJustification || "-" }
      ]
    });
  }

  async function decide(comments) {
    setProcessing(true);
    setActionError("");
    try {
      await api.post(`/suppliers/${confirm.row._id}/approval`, { decision: confirm.decision, comments });
      notify(DECISIONS[confirm.decision].success);
      setConfirm(null);
      await queue.reload();
    } catch (err) {
      // An incomplete proposal lists what is missing; the jefe can then observe it instead.
      const issues = err.details?.issues?.map((issue) => t(issue.code)).join(", ");
      setActionError(issues ? `${err.message} ${issues}.` : err.message);
      setConfirm(null);
      await queue.reload();
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div ref={sectionRef} id="supplier-approvals" className="workspace-panel section-spacer budget-exception-decisions">
      <div className="section-heading">
        <div>
          <h3>{t("Suppliers awaiting your approval")}</h3>
          <p>{t("Only the proposer's jefe approves a supplier. Once you approve it, every requester can use it.")}</p>
        </div>
        <div className="budget-exception-decisions-links">
          <span className="section-count">{queue.total}</span>
        </div>
      </div>
      <Message type="error">{actionError || queue.error}</Message>
      <DataTable
        className="cards-narrow-only"
        controls={false}
        rows={queue.rows}
        loading={queue.loading}
        emptyDescription="No suppliers are waiting for your approval."
        rowActions={(row) => [
          { label: "View supplier record", icon: ExternalLink, onClick: () => navigate(recordPath(row)) },
          { label: "Approve supplier", icon: CheckCircle2, onClick: () => openDecision(row, "APPROVE") },
          { label: "Observe supplier", icon: MessageSquareWarning, onClick: () => openDecision(row, "OBSERVE") },
          { label: "Reject supplier", icon: XCircle, tone: "danger", onClick: () => openDecision(row, "REJECT") }
        ]}
        columns={[
          { key: "legalName", primary: true, label: "Supplier", sortable: false, getValue: supplierName, render: (row) => <div className="primary-cell"><Link to={recordPath(row)}>{supplierName(row)}</Link><span>{[row.rucDni, row.supplierCode].filter(Boolean).join(" · ")}</span></div> },
          { key: "proposedBy", label: "Proposed By", sortable: false, getValue: (row) => row.proposedBy?.name, render: (row) => <div className="primary-cell"><strong>{row.proposedBy?.name || "-"}</strong><small className="muted-text">{row.proposedAt || row.createdAt ? formatDateTime(row.proposedAt || row.createdAt, language) : ""}</small></div> },
          { key: "proposalJustification", label: "Registration justification", sortable: false, render: (row) => row.proposalJustification || "-" },
          { key: "approval", label: "Waiting for", sortable: false, render: (row) => row.approval?.coveringFor ? t("on behalf of {name}").replace("{name}", row.approval.coveringFor.name) : row.approval?.approver ? t("You") : t("Admin (no jefe available)") },
          { key: "decision", primary: true, label: "Decision", sortable: false, render: (row) => (
            <div className="row-actions decision-actions">
              <button type="button" className="secondary-button approve decision-button" onClick={() => openDecision(row, "APPROVE")}><CheckCircle2 size={17} /><span>{t("Approve")}</span></button>
              <button type="button" className="icon-button" title={t("Observe")} aria-label={t("Observe")} onClick={() => openDecision(row, "OBSERVE")}><MessageSquareWarning size={17} /></button>
              <button type="button" className="icon-button danger" title={t("Reject")} aria-label={t("Reject")} onClick={() => openDecision(row, "REJECT")}><XCircle size={17} /></button>
              <Link className="icon-button" to={recordPath(row)} title={t("View supplier record")} aria-label={t("View supplier record")}><ExternalLink size={17} /></Link>
            </div>
          ) }
        ]}
      />
      <ConfirmDialog open={Boolean(confirm)} {...confirm} loading={processing} onClose={() => !processing && setConfirm(null)} onConfirm={decide} />
    </div>
  );
}
