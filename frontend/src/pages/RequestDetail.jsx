import ReadinessPanel from "../components/ReadinessPanel.jsx";
import RequestStageIndicator from "../components/RequestStageIndicator.jsx";
import FinancialValidationSummary from "../components/FinancialValidationSummary.jsx";
import FinancialProgressSummary from "../components/FinancialProgressSummary.jsx";
import { REQUEST_LIFECYCLE, canonicalRequestStatus } from "../../../shared/workflowStatus.mjs";
import MotionCollapse from "../components/MotionCollapse.jsx";
import SectionNavigation from "../components/SectionNavigation.jsx";
import useWorkDraft, { useDraftResume, resumeDraftRecord } from "../hooks/useWorkDraft.js";
import DraftPanel from "../components/DraftPanel.jsx";
import {
  ArrowLeft,
  BookOpenCheck,
  Check,
  CheckCircle2,
  CornerUpLeft,
  Download,
  FileCheck2,
  FileText,
  Forward,
  History as HistoryIcon,
  Landmark,
  MessageSquareWarning,
  Pencil,
  Printer,
  Send,
  ShoppingCart,
  Trash2,
  Undo2,
  UploadCloud,
  WalletCards,
  XCircle
} from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../api/client.js";
import ApprovalTimeline from "../components/ApprovalTimeline.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import InfoPopover from "../components/InfoPopover.jsx";
import WorkspaceSkeleton from "../components/WorkspaceSkeleton.jsx";
import ProtectedAssetButton from "../components/ProtectedAssetButton.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import OfficialRenditionWorkspace from "../components/rendition/OfficialRenditionWorkspace.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { formatCurrency, formatDate, formatDateTime } from "../utils/formatters.js";
import { displayedRequestStatus, renditionRequirements as summarizeRenditionRequirements } from "../utils/requestPresentation.js";
import PaymentTermsSummary from "../components/PaymentTermsSummary.jsx";
import BudgetLimitSummary from "../components/BudgetLimitSummary.jsx";
import { paymentTermsSummary } from "../../../shared/paymentTerms.mjs";
import {
  expenseNatureLabels,
  flowTypeLabels,
  optionLabel,
  requestTypeLabels
} from "../utils/options.js";

const workflow = REQUEST_LIFECYCLE;
const documentPhaseOrder = ["SUBMISSION", "PROCUREMENT", "INVOICE_REGISTRATION", "ACCOUNTING", "RENDITION"];
const invoiceDocumentFields = [
  { key: "xml", kind: "XML", label: "Invoice XML", accept: ".xml,text/xml,application/xml" },
  { key: "pdf", kind: "PDF", label: "Invoice PDF", accept: ".pdf,application/pdf" },
  { key: "feeReceipt", kind: "FEE_RECEIPT", label: "Recibo por Honorarios", accept: ".pdf,application/pdf" },
  { key: "conformity", kind: "CONFORMITY", label: "Conformity evidence", accept: ".pdf,.jpg,.jpeg,.png" },
  { key: "activityReport", kind: "ACTIVITY_REPORT", label: "Activity report", accept: ".pdf,.doc,.docx" },
  { key: "supporting", kind: "SUPPORTING", label: "Supporting documents", accept: ".pdf,.doc,.docx,.xlsx,.jpg,.jpeg,.png" }
];

const interruptionStatuses = [
  "OBSERVADO",
  "OBSERVADO_PRESUPUESTO",
  "OBSERVADO_SUNAT",
  "OBSERVADO_MONTO_EXCEDIDO",
  "OBSERVADO_CARGA_MASIVA",
  "PAGO_REBOTADO",
  "DEVUELTO",
  "RECHAZADO",
  "ANULADO"
];

const emptyRelated = {
  accountsPayable: [],
  journalEntries: [],
  paymentBatches: [],
  reconciliation: null,
  audit: [],
  budgetPreview: { status: "PENDING_VALIDATION", lines: [] },
  procurementReadiness: null,
  sunatVouchers: [],
  massUploadBatches: [],
  invoiceObservations: []
};

function entityName(value, fallback = "-") {
  return value?.legalName || value?.commercialName || value?.name || fallback;
}

// Labels for the values RequestCreate stores in opexDetails.expenseFrequency.
const opexFrequencyLabels = { ONE_OFF: "One-off", MONTHLY_RECURRING: "Monthly recurring", EVERY_3_MONTHS: "Every 3 months", ANNUAL_RENEWAL: "Annual renewal" };

// capexDetails.projectSnapshot carries code and name once the backend resolves the project.
function capexProjectLabel(capexDetails = {}) {
  const snapshot = capexDetails.projectSnapshot || {};
  const named = [snapshot.code, snapshot.name].filter(Boolean).join(" - ");
  return named || capexDetails.projectPep || null;
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function requesterName(request) {
  return request?.requester?.name || request?.solicitor?.name || request?.rendition?.beneficiarySnapshot?.name || "-";
}

function RequestStatusFlow({ request }) {
  const { t } = useLanguage();
  const currentStatus = canonicalRequestStatus(request.status);
  const closed = currentStatus === "CERRADO";
  const currentIndex = workflow.indexOf(currentStatus);
  return (
    <ol className="status-flow" aria-label={t("Request workflow status")}>
      {workflow.map((status, index) => (
        <li key={status} className={`${closed || index < currentIndex ? "completed" : ""} ${!closed && index === currentIndex ? "active" : ""}`}>
          <span className="status-flow-dot">{closed || index < currentIndex ? <Check size={14} /> : index + 1}</span>
          <span>{t(status)}</span>
        </li>
      ))}
      {interruptionStatuses.includes(request.status) && (
        <li className="rejected active">
          <span className="status-flow-dot"><XCircle size={14} /></span>
          <span>{t(request.status)}</span>
        </li>
      )}
    </ol>
  );
}

function DefinitionGrid({ children, className = "" }) {
  return <dl className={`detail-grid ${className}`.trim()}>{children}</dl>;
}

function Definition({ label, children }) {
  const { t } = useLanguage();
  return <div><dt>{t(label)}</dt><dd>{children ?? "-"}</dd></div>;
}

const DetailTab = createContext("General");
const tabIcons = { General: FileText, Documents: FileCheck2, Approvals: CheckCircle2, Budget: WalletCards, Accounting: BookOpenCheck, Payment: Landmark, History: HistoryIcon };
const sectionTabs = { "Budget preview": "Budget", "Budget commitment": "Budget", "Procurement Readiness": "Budget", "Documents and fiscal validation": "Documents", "Register A1 invoice and conformity": "Documents", "Invoice control register": "Accounting", "Financial control records": "Payment" };
function Section({ title, description, children, className = "" }) {
  const { t } = useLanguage();
  const activeTab = useContext(DetailTab);
  const [expanded, setExpanded] = useState(true);
  const sectionId = `request-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div hidden={activeTab !== (sectionTabs[title] || "General")} className={`workspace-panel detail-section ${className}`.trim()} id={sectionId}>
      <h3 className="request-section-heading"><button type="button" className="request-section-toggle" aria-expanded={expanded} aria-controls={`${sectionId}-content`} onClick={() => setExpanded((value) => !value)}><span><strong>{t(title)}</strong></span><span aria-hidden="true">{expanded ? "−" : "+"}</span></button>{description && <InfoPopover label="About this section" align="end"><p>{t(description)}</p></InfoPopover>}</h3>
      <MotionCollapse className="request-section-content" id={`${sectionId}-content`} open={expanded}>{children}</MotionCollapse>
    </div>
  );
}

export default function RequestDetail() {
  const [activeTab, setActiveTab] = useState("General");
  const [showAllPhases, setShowAllPhases] = useState(false);
  const [replacingInvoice, setReplacingInvoice] = useState(false);
  const { id } = useParams();
  const { user } = useAuth();
  const { language, t } = useLanguage();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [request, setRequest] = useState(null);
  const [related, setRelated] = useState(emptyRelated);
  const [requirements, setRequirements] = useState([]);
  const [documentStatus, setDocumentStatus] = useState({ currentPhase: "SUBMISSION", phases: {} });
  const [masters, setMasters] = useState({ costCenters: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [invoiceFiles, setInvoiceFiles] = useState(Object.fromEntries(invoiceDocumentFields.map((field) => [field.key, null])));
  const [invoiceSubmitting, setInvoiceSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const response = await api.get(`/requests/${id}`);
      const nextRequest = { ...response.data.data, status: canonicalRequestStatus(response.data.data.status) };
      setRequest(nextRequest);
      setRelated({ ...emptyRelated, ...(response.data.related || {}) });
      const [requirementsResponse, centersResponse] = await Promise.all([
        api.get(`/requests/${id}/document-requirements`),
        api.get("/cost-centers", { params: { pageSize: 100, active: true } })
      ]);
      const nextDocumentStatus = requirementsResponse.data.data || { currentPhase: "SUBMISSION", phases: {} };
      setDocumentStatus(nextDocumentStatus);
      setRequirements(nextDocumentStatus.phases?.SUBMISSION?.requirements || []);
      setMasters({ costCenters: centersResponse.data.data || [] });
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  const permissions = useMemo(() => {
    if (!request) return {};
    const actions = new Set(request.allowedActions || []);
    return {
      modifiable: actions.has("EDIT"),
      deletable: actions.has("DELETE"),
      canApprove: actions.has("APPROVE"),
      canObserve: actions.has("OBSERVE"),
      canReturn: actions.has("RETURN"),
      canReject: actions.has("REJECT"),
      canCommitBudget: actions.has("COMMIT_BUDGET"),
      canIssueOrder: actions.has("ISSUE_ORDER"),
      canRegisterInvoice: actions.has("REGISTER_INVOICE"),
      canClose: actions.has("CLOSE"),
      canVoid: actions.has("CANCEL"),
      canWithdraw: actions.has("WITHDRAW")
    };
  }, [request]);

  const approvalSteps = useMemo(() => [...(request?.approvalRouteSnapshot || [])].sort((a, b) => (a.sequence || 0) - (b.sequence || 0)), [request]);
  const activeApprovalStep = useMemo(() => approvalSteps.find((step) => step.required !== false && step.status === "PENDING") || null, [approvalSteps]);
  const isChainApprovalStep = activeApprovalStep?.source === "MANAGER_CHAIN";
  // The server decides whether "Send to my jefe" is possible: only while the current
  // approver has an active jefe who is not on leave (GET /approvals/:id/options).
  const [approvalOptions, setApprovalOptions] = useState(null);
  useEffect(() => {
    let active = true;
    setApprovalOptions(null);
    if (!permissions.canApprove || !isChainApprovalStep) return undefined;
    api.get(`/approvals/${id}/options`).then((response) => { if (active) setApprovalOptions(response.data.data || null); }).catch(() => { if (active) setApprovalOptions(null); });
    return () => { active = false; };
  }, [id, permissions.canApprove, isChainApprovalStep, activeApprovalStep?._id]);
  const canForwardChain = isChainApprovalStep && Boolean(approvalOptions?.canForward);
  const forwardToName = approvalOptions?.forwardTo?.name || "";

  const attachments = request?.attachments || [];
  const missingDocuments = useMemo(() => requirements
    .map((rule) => ({
      ...rule,
      present: attachments.filter((item) => item.kind === rule.kind).length
    }))
    .filter((rule) => rule.present < rule.minCount), [requirements, attachments]);

  const invoiceRequirements = useMemo(() => {
    const combined = [
      ...(documentStatus.phases?.INVOICE_REGISTRATION?.requirements || []),
      ...(documentStatus.phases?.ACCOUNTING?.requirements || [])
    ];
    return [...new Map(combined.map((item) => [item.kind, item])).values()];
  }, [documentStatus]);

  const journalLines = useMemo(() => (related.journalEntries || []).flatMap((journal) =>
    (journal.lines || []).map((line) => ({
      ...line,
      _id: line._id || `${journal._id}-${line.accountNumber}`,
      entryNumber: journal.entryNumber,
      entryType: journal.entryType,
      period: journal.period,
      createdAt: journal.createdAt
    }))), [related.journalEntries]);

  const latestPayable = related.accountsPayable?.[related.accountsPayable.length - 1];
  const procurementReadiness = related.procurementReadiness;
  const trackCRenditionRequirements = useMemo(() => summarizeRenditionRequirements(documentStatus), [documentStatus]);

  async function runAction(type, comments = "", forward) {
    setProcessing(true);
    try {
      if (["approve", "observe", "return", "reject"].includes(type)) {
        await api.post(`/approvals/${id}/${type}`, type === "approve" && typeof forward === "boolean" ? { comments, forward } : { comments });
      }
      if (type === "budget") await api.post(`/budget/requests/${id}/commit`);
      if (type === "order") await api.post(`/requests/${id}/procurement-order`);
      if (type === "close") await api.post(`/requests/${id}/close`, { comments });
      if (type === "void") await api.post(`/requests/${id}/void`, { comments });
      if (type === "withdraw") await api.post(`/requests/${id}/withdraw`, { comments });
      if (type === "delete") {
        await api.delete(`/requests/${id}`);
        notify("Draft request permanently deleted.");
        navigate("/requests");
        return;
      }
      notify({
        approve: forward === true ? "Approval recorded and sent to your jefe." : "Electronic approval recorded.",
        withdraw: "Request withdrawn to draft. Edit it and submit it again when ready.",
        observe: "Request observed.",
        return: "Request returned for correction.",
        reject: "Request rejected.",
        budget: "Budget control completed.",
        order: "Purchase or Service Order issued from approved request data.",
        close: "Request closed.",
        void: "Request annulled and any reservation was released."
      }[type]);
      setConfirm(null);
      await load();
    } catch (err) {
      setError(`${err.message}${err.code ? ` (${err.code})` : ""}`);
      notify(err.message, "error");
      setConfirm(null);
    } finally {
      setProcessing(false);
    }
  }

  async function submitRequest() {
    setProcessing(true);
    try {
      await api.post(`/requests/${id}/submit`);
      notify("Request submitted for approval.");
      await load();
    } catch (err) {
      setError(err.message);
      notify(err.message, "error");
    } finally {
      setProcessing(false);
    }
  }

  const invoiceDraft = useWorkDraft({ scope: "invoice-files", recordId: id, title: "Invoice and conformity files", enabled: Boolean(permissions.canRegisterInvoice), value: invoiceFiles, restore: setInvoiceFiles });

  async function submitInvoice(event) {
    event.preventDefault(); if (!invoiceDraft.ready || invoiceDraft.status === "conflict") return;
    const form = event.currentTarget;
    if (invoiceRequirements.some((item) => !item.kind || !invoiceDocumentFields.some((field) => field.kind === item.kind))) {
      setError(t("Invoice document requirements could not be loaded correctly. Refresh the page; if this continues, contact Admin to review the document rules."));
      return;
    }
    const missingInvoiceFiles = invoiceRequirements.filter((requirement) => !invoiceFiles[invoiceDocumentFields.find((field) => field.kind === requirement.kind)?.key]);
    if (missingInvoiceFiles.length) {
      setError(`${t("Required invoice documents are missing")}: ${missingInvoiceFiles.map((item) => t(invoiceDocumentFields.find((field) => field.kind === item.kind)?.label || item.labelKey || item.kind)).join(", ")}.`);
      return;
    }
    setInvoiceSubmitting(true);
    try {
      const data = new FormData();
      invoiceDocumentFields.forEach((field) => { if (invoiceFiles[field.key]) data.append(field.key, invoiceFiles[field.key]); });
      const response = await api.post(`/requests/${id}/invoice`, data);
      await invoiceDraft.complete();
      notify(response.data.observed ? "Invoice isolated for correction; the observation is now traceable." : "Invoice validated, matched to the PO and provisioned in CXP.");
      setInvoiceFiles(Object.fromEntries(invoiceDocumentFields.map((field) => [field.key, null])));
      form.reset();
      await load();
    } catch (err) {
      setError(`${err.message}${err.code ? ` (${err.code})` : ""}`);
      notify(err.message, "error");
    } finally {
      setInvoiceSubmitting(false);
    }
  }

  function decision(type, forward) {
    const details = { label: "Request", value: request.requestNumber };
    const actions = {
      approve: isChainApprovalStep ? (forward ? {
        title: "Approve and send to your jefe?",
        description: "This records your approval and sends the request to your jefe for a further decision.",
        confirmLabel: "Send to my jefe",
        inputLabel: "Approval comments",
        details: [details, ...(forwardToName ? [{ label: "Next approver", value: forwardToName }] : []), { label: "Result", value: "This step is marked approved and your jefe decides next: finalize, or send it to their own jefe." }]
      } : {
        title: "Approve this request and finalize?",
        description: "This completes all request approvals and proceeds to budget control. Budget and accounting checks still apply.",
        confirmLabel: "Approve and finalize",
        tone: "success",
        inputLabel: "Approval comments",
        details: [details, { label: "Result", value: "Approval complete - Budget control" }]
      }) : {
        title: "Approve this request?",
        description: "Record an authenticated electronic sign-off and advance the configured route.",
        confirmLabel: "Approve request",
        inputLabel: "Approval comments",
        details: [details, { label: "Result", value: "The configured route advances; budget remains a separate controlled stage." }]
      },
      observe: {
        title: "Observe this request?",
        description: "Return it for documented corrections without erasing history.",
        confirmLabel: "Observe request",
        tone: "danger",
        inputLabel: "Observation comments",
        inputRequired: true,
        details: [details, { label: "Result", value: "Status changes to OBSERVADO." }]
      },
      return: {
        title: "Return this request?",
        description: "Return it to its owner with a mandatory explanation.",
        confirmLabel: "Return request",
        tone: "danger",
        inputLabel: "Return comments",
        inputRequired: true,
        details: [details, { label: "Result", value: "Status changes to DEVUELTO." }]
      },
      withdraw: {
        title: "Withdraw this request?",
        description: "Your first approver has not approved it yet. Withdrawing returns it to draft so you can edit it and submit it again; the approval restarts from the first approver.",
        confirmLabel: "Withdraw request",
        tone: "danger",
        inputLabel: "Reason (optional)",
        details: [details, { label: "Result", value: "Status changes to BORRADOR and the pending approval task is closed." }]
      },
      reject: {
        title: "Reject this request?",
        description: "Reject it and preserve the complete decision record.",
        confirmLabel: "Reject request",
        tone: "danger",
        inputLabel: "Rejection comments",
        inputRequired: true,
        details: [details, { label: "Result", value: "Status changes to RECHAZADO." }]
      }
    };
    setConfirm({ type, forward, ...actions[type] });
  }

  if (loading && !request) return <WorkspaceSkeleton label="Loading request..." />;
  if (!request) return <section><Message type="error">{error || "Request not found."}</Message></section>;

  const supplier = request.supplier;
  const order = request.purchaseOrder;
  const invoiceCorrection = Boolean(order) && ["OBSERVADO_SUNAT", "OBSERVADO_MONTO_EXCEDIDO", "OBSERVADO_CARGA_MASIVA"].includes(request.status);
  const approvedExceptionAfterObservation = request.status === "OBSERVADO_SUNAT"
    && request.observation?.code === "OBSERVADO_SUNAT"
    && related.sunatVouchers?.some((voucher) => voucher.validationStatus === "MANUAL_EXCEPTION"
      && new Date(voucher.manualOverride?.overriddenAt) > new Date(request.observation?.observedAt));
  const nextAction = invoiceCorrection
    ? ["Correct the invoice documents. Existing approvals and the issued order remain valid; do not submit the request for approval again.", "Documents", "#request-section-documents-and-fiscal-validation"]
    : request.observationOwner === "BUDGET" && !permissions.canCommitBudget
    ? ["Budget is reviewing an exception for this request's budget. You do not need to submit it again; you will be notified of the decision.", "General", "#request-actions"]
    : request.observationOwner === "ACCOUNTING"
    ? [user?.role === "Accounting" || user?.role === "Admin"
      ? "SUNAT could not verify this invoice. Review it in Accounting > SUNAT exceptions; once the exception is approved the payment continues without new approvals."
      : "SUNAT could not verify this invoice. Accounting will review it; once it approves a manual SUNAT exception the payment continues on its own. You do not need to submit the request again.", "Documents", "#request-section-documents-and-fiscal-validation"]
    : permissions.canCommitBudget ? ["Review budget availability and commit the approved request.", "Available actions", "#request-actions"]
    : permissions.modifiable
    ? (missingDocuments.length ? ["Complete the required documents before submitting.", "Documents", "#request-section-documents-and-fiscal-validation"] : ["Your request is ready for your submission review.", "Available actions", "#request-actions"])
    : permissions.canApprove ? ["Review the supporting documents and record your decision.", "Available actions", "#request-actions"]
    : permissions.canCommitBudget ? ["Review budget availability and commit the approved request.", "Available actions", "#request-actions"]
    : permissions.canIssueOrder ? ["Review the approved purchase and issue the order.", "Available actions", "#request-actions"]
    : permissions.canClose ? ["Review the reconciliation before closing this request.", "Available actions", "#request-actions"] : null;
  const confirmCommitBudget = () => setConfirm({
    type: "budget",
    title: "Commit this request budget?",
    description: "The backend will validate every budget dimension and exception rule before reserving funds.",
    confirmLabel: "Commit budget",
    details: [{ label: "Request", value: request.requestNumber }, { label: "Result", value: "Successful commitment changes the request to COMPROMISO_PRESUPUESTAL." }]
  });
  const confirmIssueOrder = () => setConfirm({
    type: "order",
    title: "Issue the Purchase or Service Order?",
    description: "The order will use the approved request supplier, PRV, lines, currency, and amount. Repeated requests return the existing order.",
    confirmLabel: "Issue order",
    details: [
      { label: "Request", value: request.requestNumber },
      { label: "Order type", value: procurementReadiness?.orderKind },
      { label: "Supplier / PRV", value: `${entityName(supplier)} / ${supplier?.supplierCode || "-"}` },
      { label: "Result", value: "An immutable OC reference and approved-data snapshot are created." }
    ]
  });
  const confirmClose = () => setConfirm({
    type: "close",
    title: "Close this request?",
    description: "Only a reconciled request in an open permitted period can be closed.",
    confirmLabel: "Close request",
    inputLabel: "Closing comments",
    details: [{ label: "Request", value: request.requestNumber }, { label: "Result", value: "Status changes from CONCILIADO to CERRADO." }]
  });
  // Phones: the main action the page offers stays within reach in a bar above the bottom
  // navigation. It reuses the action panel's handlers; the full panel stays at #request-actions.
  const stickyAction = permissions.canApprove
    ? (isChainApprovalStep
      ? { label: "Approve and finalize", icon: CheckCircle2, onClick: () => decision("approve", false), className: "primary-button approve-button" }
      : { label: "Approve", icon: CheckCircle2, onClick: () => decision("approve") })
    : permissions.canCommitBudget ? { label: "Commit budget", icon: CheckCircle2, onClick: confirmCommitBudget }
    : permissions.modifiable && !missingDocuments.length ? { label: "Submit", icon: Send, onClick: submitRequest, disabled: processing }
    : permissions.canIssueOrder ? { label: "Issue order", icon: ShoppingCart, onClick: confirmIssueOrder }
    : permissions.canClose ? { label: "Close request", icon: CheckCircle2, onClick: confirmClose }
    : nextAction?.[1] === "Documents" ? { label: "Open documents", icon: FileText, href: nextAction[2], onClick: () => setActiveTab("Documents") }
    : null;
  const availableActionCount = [permissions.canWithdraw, permissions.modifiable, permissions.canApprove, permissions.canApprove && isChainApprovalStep && canForwardChain, permissions.canApprove && permissions.canObserve, permissions.canApprove && permissions.canReturn, permissions.canApprove && permissions.canReject, permissions.canCommitBudget, permissions.canIssueOrder, permissions.canClose, permissions.canVoid].filter(Boolean).length;
  const StickyIcon = stickyAction?.icon;
  const requestDescription = request.flowType === "C"
    ? `${t(optionLabel(request.requestType, requestTypeLabels))} - ${requesterName(request)}`
    : `${t(optionLabel(request.requestType, requestTypeLabels))} - ${entityName(supplier, "")}`;

  return (
    <DetailTab.Provider value={activeTab}><section className="focused-request-detail">
      <PageHeader
        title={request.requestNumber}
        description={requestDescription}
        actions={(
          <div className="page-actions">
            <Link className="text-link back-link" to="/requests"><ArrowLeft size={16} /><span>{t("Back to list")}</span></Link>
            <button type="button" className="icon-button" onClick={() => window.print()} aria-label={t("Print record")} title={t("Print record")}><Printer size={16} /></button>
            {permissions.modifiable && <Link className="secondary-button" to={`/requests/${id}/edit`}><Pencil size={16} /><span>{t("Edit request")}</span></Link>}
            {permissions.deletable && (
              <button
                type="button"
                className="danger-button subtle"
                onClick={() => setConfirm({
                  type: "delete",
                  title: "Permanently delete this request?",
                  description: "Only a permitted draft or rejected record can be deleted. This cannot be undone.",
                  confirmLabel: "Delete request",
                  tone: "danger",
                  details: [{ label: "Request", value: request.requestNumber }]
                })}
              >
                <Trash2 size={16} /><span>{t("Delete")}</span>
              </button>
            )}
          </div>
        )}
      />

      <Message type="error">{error}</Message>
      <ReadinessPanel requestId={id} revision={request.updatedAt} />
      {["Admin", "Solicitor"].includes(user.role) && request.requestType === "OPEX" && ["A1", "B"].includes(request.flowType) && String(request.requester?._id || request.requester) === String(user._id) && <Link className="text-button" to={`/operations?source=${id}`}>{t("Prepare recurring drafts")}</Link>}

      <dl className="request-overview">
        <div><dt>{t("Total amount")}</dt><dd>{formatCurrency(request.totalAmount, request.currency, language)}</dd></div>
        <div><dt>{t("Requester")}</dt><dd>{requesterName(request)}</dd></div>
        <div><dt>{t("Title")}</dt><dd>{request.title || request.description}</dd></div>
        <div><dt>{t("Current status")}</dt><dd><FinancialProgressSummary request={request} financialProgress={related.financialProgress} renditionRequirements={trackCRenditionRequirements} compact /></dd></div>
      </dl>
      {nextAction && <div className="record-next-action"><div><strong>{t("Next step")}</strong><p>{t(nextAction[0])}</p></div><a className="secondary-button" href={nextAction[2]} onClick={() => setActiveTab(nextAction[1] === "Documents" ? "Documents" : "General")}>{t(nextAction[1])}</a></div>}
      {invoiceCorrection && request.observation?.detail && <Message type={approvedExceptionAfterObservation ? "warning" : "error"}>{t(approvedExceptionAfterObservation
        ? "Accounting has recorded a manual SUNAT exception. Invoice posting is still pending. Open Documents and retry with the same invoice files; any remaining blocker will be shown."
        : request.observation.detail)}</Message>}
      <div className="stage-row">
        <RequestStageIndicator request={request} financialProgress={related.financialProgress} />
        {request.status === "PENDIENTE_APROBACION" && activeApprovalStep && <p className="muted-text"><strong>{t("Pending with")}:</strong> {activeApprovalStep.approverSnapshot?.name || t(activeApprovalStep.approvalLevel)}</p>}
        <InfoPopover label="What do these statuses mean?" align="end"><div className="workflow-details"><RequestStatusFlow request={{ ...request, status: displayedRequestStatus(request, related.financialProgress) }} /></div></InfoPopover>
      </div>
      <nav className="focus-tabs" aria-label={t("Request sections")}>{["General", "Documents", "Approvals", "Budget", ...(["Admin", "Accounting"].includes(user.role) ? ["Accounting"] : []), "Payment", "History"].map(tab => { const TabIcon = tabIcons[tab]; return <button type="button" key={tab} aria-pressed={activeTab === tab} onClick={() => setActiveTab(tab)}><TabIcon size={15} aria-hidden="true" />{t(tab)}</button>; })}</nav>

      <div className="request-detail-layout">
        <div className="request-detail-main">
          <Section title="Requirement and justification" description="Official request identity, responsible area and business need.">
            <DefinitionGrid>
              <Definition label="Request type">{t(optionLabel(request.requestType, requestTypeLabels))}</Definition>
              <Definition label="Track">{t(flowTypeLabels[request.flowType] || request.flowType)}</Definition>
              <Definition label="Expense nature">{t(optionLabel(request.expenseNature, expenseNatureLabels))}</Definition>
              <Definition label="Area / School">{request.schoolOrDepartment || request.requesterArea || request.requestingArea || "-"}</Definition>
              <Definition label="Issue date">{formatDate(request.issueDate, language)}</Definition>
              <Definition label="Accounting period">{request.accountingPeriod}</Definition>
              <Definition label="Priority">{t(request.priority || "-")}</Definition>
              <Definition label="Currency">{request.currency}</Definition>
              <Definition label="Business justification">{request.businessJustification || request.detailedDescription || request.description || "-"}</Definition>
              <Definition label="Risk if not approved">{request.nonApprovalRisk || "-"}</Definition>
            </DefinitionGrid>
          </Section>

          {request.requestType === "CAPEX" && (
            <Section title="CAPEX financial information" description="Investment classification and financial evaluation captured in the official request.">
              <DefinitionGrid>
                <Definition label="Project / PEP">{capexProjectLabel(request.capexDetails) || "-"}</Definition>
                <Definition label="Fixed asset category">{request.capexDetails?.assetCategory ? t(request.capexDetails.assetCategory) : "-"}</Definition>
                <Definition label="Useful life (years)">{hasValue(request.capexDetails?.usefulLifeYears) ? request.capexDetails.usefulLifeYears : "-"}</Definition>
                <Definition label="NPV / VAN amount">{hasValue(request.capexDetails?.npv?.amount) ? formatCurrency(request.capexDetails.npv.amount, request.capexDetails.npv.currency || request.currency, language) : "-"}</Definition>
                <Definition label="Payback">{hasValue(request.capexDetails?.payback?.value) ? `${request.capexDetails.payback.value} ${t(request.capexDetails.payback.unit === "YEARS" ? "Years" : "Months")}` : "-"}</Definition>
              </DefinitionGrid>
            </Section>
          )}

          {request.requestType === "OPEX" && (
            <Section title="OPEX financial information" description="Operating expense frequency and controlled recurrence.">
              <DefinitionGrid>
                <Definition label="Expense frequency">{request.opexDetails?.expenseFrequency ? t(opexFrequencyLabels[request.opexDetails.expenseFrequency] || request.opexDetails.expenseFrequency) : "-"}</Definition>
              </DefinitionGrid>
            </Section>
          )}

          <Section title="Item / service breakdown" description="All accounting dimensions and immutable commercial totals are shown per line.">
            <DataTable
              controls={false}
              rows={request.lines || []}
              columns={[
                { key: "itemDescription", label: "Description" },
                { key: "costCenter", label: "Cost center", render: (row) => `${row.costCenterSnapshot?.code || row.costCenter?.code || "-"} · ${row.costCenterSnapshot?.name || row.costCenter?.name || ""}` },
                // Accounting accounts are Accounting's decision; requesters and approvers never see them.
                ...(["Accounting", "Admin"].includes(user?.role) ? [{ key: "expenseType", label: "Accounting account", render: (row) => `${row.expenseType?.accountNumber || row.expenseTypeSnapshot?.accountNumber || "-"} · ${row.expenseType?.name || row.expenseTypeSnapshot?.name || ""}` }] : []),
                { key: "quantity", label: "Qty", align: "right" },
                { key: "unitPrice", label: "Unit price", align: "right", render: (row) => formatCurrency(row.unitPrice, row.currency || request.currency, language) },
                { key: "netAmount", label: "Net", align: "right", render: (row) => formatCurrency(row.netAmount, row.currency || request.currency, language) },
                { key: "igvAmount", label: "IGV", align: "right", render: (row) => formatCurrency(row.igvAmount, row.currency || request.currency, language) },
                { key: "totalAmount", label: "Total", align: "right", render: (row) => formatCurrency(row.totalAmount, row.currency || request.currency, language) }
              ]}
            />
            <div className="request-total-strip">
              <span>{t("Original total")} <strong>{formatCurrency(request.totalAmount, request.currency, language)}</strong></span>
              <span>{t("PEN equivalent")} <strong>{formatCurrency(request.totalPENEquivalent, "PEN", language)}</strong></span>
            </div>
          </Section>

          {request.flowType !== "C" && (
            <Section title="Supplier quotations" description="The supplier comparison and recommendation remain linked to uploaded evidence.">
              <DefinitionGrid>
                <Definition label="Supplier">{entityName(supplier)}</Definition>
                <Definition label="RUC / DNI">{supplier?.rucDni || supplier?.normalizedIdentifier || request.supplierSnapshot?.identifier || "-"}</Definition>
                <Definition label="Supplier homologation"><StatusBadge status={supplier?.homologationStatus || "PENDING"} /></Definition>
                <Definition label="PRV status">{supplier?.supplierCode || t("SUPPLIER_PRV_MISSING")}</Definition>
                <Definition label="Recommended supplier">{entityName((request.quotations || []).find((item) => item.recommended)?.supplier, entityName(supplier))}</Definition>
                <Definition label="Supplier selection reason">{request.supplierSelectionReason || "-"}</Definition>
              </DefinitionGrid>
              {(request.quotations || []).length > 0 && (
                <DataTable
                  controls={false}
                  rows={request.quotations}
                  columns={[
                    { key: "supplier", label: "Supplier", render: (row) => entityName(row.supplier, row.supplierSnapshot?.legalName) },
                    { key: "amount", label: "Amount", align: "right", render: (row) => formatCurrency(row.amount, row.currency || request.currency, language) },
                    { key: "deliveryPeriod", label: "Delivery period" },
                    { key: "paymentConditions", label: "Payment conditions", getValue: (row) => paymentTermsSummary(row, t), render: (row) => <PaymentTermsSummary terms={row} /> },
                    { key: "recommended", label: "Recommended supplier", render: (row) => row.recommended ? t("Yes") : t("No") }
                  ]}
                />
              )}
            </Section>
          )}

          <Section title="Budget commitment"><DefinitionGrid>              <Definition label="Budget status"><StatusBadge status={request.budgetCommitment?.status || "NO_BUDGET"} /></Definition>
              <Definition label="Budget amount">{request.budgetCommitment ? formatCurrency(request.budgetCommitment.totalAmount, "PEN", language) : "-"}</Definition>
              <Definition label="Executed budget">{request.budgetCommitment ? formatCurrency(request.budgetCommitment.executedAmount, "PEN", language) : "-"}</Definition>
              <Definition label="Paid budget">{request.budgetCommitment ? formatCurrency(request.budgetCommitment.paidAmount, "PEN", language) : "-"}</Definition>
</DefinitionGrid></Section>
          <Section title="Budget preview" description="This is a current read-only calculation; the authoritative commitment remains in the budget ledger.">
            <div className="budget-preview">
              <div className="budget-preview-summary">
                <StatusBadge status={related.budgetPreview?.status || "PENDING_VALIDATION"} />
                <strong>{formatCurrency(related.budgetPreview?.totalRequested || request.totalPENEquivalent, "PEN", language)}</strong>
                {related.budgetPreview?.projectedBalance !== null && related.budgetPreview?.projectedBalance !== undefined && (
                  <span>{t("Projected balance")}: {formatCurrency(related.budgetPreview.projectedBalance, "PEN", language)}</span>
                )}
              </div>
              {(related.budgetPreview?.lines || []).length > 0 && (
                <DataTable
                  controls={false}
                  rows={related.budgetPreview.lines.map((row, index) => ({ ...row, _id: `${row.costCenter}-${row.project || ""}-${index}` }))}
                  columns={[
                    { key: "costCenterSnapshot", label: "Cost center", render: (row) => `${row.costCenterSnapshot?.code || "-"} · ${row.costCenterSnapshot?.name || ""}` },
                    { key: "mode", label: "Mode", render: (row) => <StatusBadge status={row.mode} /> },
                    { key: "amount", label: "Requested", align: "right", render: (row) => formatCurrency(row.amount, "PEN", language) },
                    { key: "available", label: "Available", align: "right", render: (row) => row.available === undefined ? "-" : formatCurrency(row.available, "PEN", language) },
                    { key: "projectedBalance", label: "Projected balance", align: "right", render: (row) => row.projectedBalance === undefined ? "-" : formatCurrency(row.projectedBalance, "PEN", language) },
                    { key: "planningMode", label: "Annual / monthly limits", sortable: false, render: (row) => <BudgetLimitSummary line={row} /> },
                    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> }
                  ]}
                />
              )}
            </div>
          </Section>

          {request.flowType === "A1" && (
            <Section title="Procurement Readiness" description="The system derives every gate from the approved request and controlled master data.">
              <div className="readiness-gates">
                <div><span>{t("Request approval")}</span><StatusBadge status={procurementReadiness?.gates?.requestApproval ? "COMPLIANT" : "PENDING"} /></div>
                <div><span>{t("Budget commitment")}</span><StatusBadge status={procurementReadiness?.gates?.budgetCommitment ? "COMPLIANT" : "PENDING"} /></div>
                <div><span>{t("Supplier homologation")}</span><StatusBadge status={procurementReadiness?.gates?.supplierHomologation ? "COMPLIANT" : supplier?.homologationStatus || "PENDING"} /></div>
                <div><span>{t("PRV status")}</span><StatusBadge status={supplier?.supplierCode ? "COMPLIANT" : "PENDING"} /></div>
              </div>
              <div className="responsibility-map">
                <div><span>{t("School")}</span><strong>{t("Requirement, CECO, quotations and conformity")}</strong></div>
                <div><span>{t("System")}</span><strong>{t("Budget, PO ceiling, SUNAT and duplicate controls")}</strong></div>
                <div><span>{t("Accounting / Treasury")}</span><strong>{t("CXP provision and bank payment processing")}</strong></div>
              </div>
              {procurementReadiness?.issues?.length > 0 && (
                <ul className="readiness-issues">
                  {procurementReadiness.issues.map((issue) => <li key={`${issue.code}-${issue.message}`}>{t(issue.code)} — {t(issue.message)}</li>)}
                </ul>
              )}
              <div className="order-summary">
                <div><span>{t("Order readiness")}</span><strong>{procurementReadiness?.readyForOrderCreation ? t("Ready") : t("Not ready")}</strong></div>
                <div><span>{t("Order type")}</span><strong>{t(procurementReadiness?.orderKind === "SERVICE_ORDER" ? "Service Order" : "Purchase Order")}</strong></div>
                <div><span>{t("Existing order")}</span><strong>{order?.poNumber || "-"}</strong></div>
                <div><span>supplierCodeSnapshot</span><strong>{order?.supplierCodeSnapshot || supplier?.supplierCode || "-"}</strong></div>
              </div>
            </Section>
          )}

          <Section title="Documents and fiscal validation" description="Original evidence is protected and fiscal amounts come from server-side XML parsing.">
            <div className="document-phase-heading">
              <span>{t("Current document phase")}</span>
              <StatusBadge status={documentStatus.currentPhase || "SUBMISSION"} />
            </div>
            <div className={`evidence-summary ${missingDocuments.length ? "warning" : "success"}`}>
              <FileCheck2 size={19} />
              <div>
                <strong>{missingDocuments.length ? t("Required evidence incomplete") : t("Required evidence complete")}</strong>
                <p>{requirements.length
                  ? requirements.map((rule) => `${t(rule.labelKey)} ${attachments.filter((item) => item.kind === rule.kind).length}/${rule.minCount}`).join(" · ")
                  : t("No additional configured evidence for this classification.")}</p>
              </div>
            </div>
            <button type="button" className="text-button" aria-expanded={showAllPhases} onClick={() => setShowAllPhases(value => !value)}>{t(showAllPhases ? "Current phase only" : "All document phases")}</button>
            <div className="document-phase-grid">
              {documentPhaseOrder.filter(phase => showAllPhases || phase === (documentStatus.currentPhase || "SUBMISSION")).map((phase) => {
                const phaseStatus = documentStatus.phases?.[phase] || { requirements: [], missing: [], valid: true };
                return <article key={phase} className={`document-phase-card${documentStatus.currentPhase === phase ? " current" : ""}`}>
                  <div><strong>{t(phase)}</strong><StatusBadge status={phaseStatus.valid ? "COMPLIANT" : "PENDING"} /></div>
                  {phaseStatus.missing?.length > 0 && <p>{t("Missing documents")}: {phaseStatus.missing.map((item) => t(item.label || item.kind)).join(", ")}</p>}
                  {phaseStatus.requirements?.length ? <ul>{phaseStatus.requirements.map((item) => <li key={item.kind} className={item.present >= item.minCount ? "complete" : "missing"}><span>{t(item.labelKey || item.kind)}</span><strong>{item.present}/{item.minCount}</strong></li>)}</ul> : <p>{t("No documents required in this phase.")}</p>}
                </article>;
              })}
            </div>
            <DataTable
              controls={false}
              rows={attachments}
              columns={[
                { key: "kind", label: "Kind", render: (row) => <span className="file-kind"><FileText size={15} />{t(row.kind)}</span> },
                { key: "originalName", label: "File" },
                { key: "size", label: "Size", render: (row) => row.size ? `${(row.size / 1024).toFixed(0)} KB` : "-" },
                { key: "uploadedAt", label: "Uploaded", render: (row) => formatDateTime(row.uploadedAt, language) },
                { key: "download", label: "", sortable: false, render: (row) => <ProtectedAssetButton className="icon-button" resourcePath={row.url} fileName={row.originalName} preview title="Preview or download"><Download size={16} /></ProtectedAssetButton> }
              ]}
            />
            <div className={`xml-result ${request.xmlValidation?.validated ? "valid" : request.xmlValidation?.status === "INVALID" ? "invalid" : "neutral"}`}>
              <FileCheck2 size={19} />
              <div>
                <strong>{t(request.xmlValidation?.validated ? "XML validation passed" : "XML validation not passed")}</strong>
                {["Accounting", "Admin"].includes(user.role) && <details><summary>{t("Advanced validation details")}</summary><p>{request.xmlValidation
                  ? ["supplierMatch", "documentNumberMatch", "dateMatch", "netMatch", "igvMatch", "totalMatch", "currencyMatch"].map((key) => `${t(key)}: ${request.xmlValidation[key] === true ? t("Yes") : request.xmlValidation[key] === false ? t("No") : "-"}`).join(" · ")
                  : t("No XML validation result is stored.")}</p></details>}
                {request.xmlValidation?.errors?.length > 0 && <p className="text-danger">{request.xmlValidation.errors.join(" ")}</p>}
              </div>
            </div>
          </Section>

          {permissions.canRegisterInvoice && (
            <Section title="Register A1 invoice and conformity" description="Upload the documents required for invoice registration and Accounting. Amount fields are immutable and read from XML.">
              <DraftPanel busy={invoiceSubmitting} draft={invoiceDraft}><form className="invoice-registration-panel" onSubmit={submitInvoice}>
                <p className="draft-file-list">{Object.values(invoiceFiles).filter(Boolean).map(file => file.name).join(", ")}</p><div className="file-upload-grid">
                  {invoiceDocumentFields.filter((field) => invoiceRequirements.some((item) => item.kind === field.kind)).map((field) => <label className="field" key={field.kind}><span>{t(field.label)} *</span><input type="file" accept={field.accept} onChange={(event) => setInvoiceFiles((current) => ({ ...current, [field.key]: event.target.files?.[0] || null }))} required={!invoiceFiles[field.key]} /></label>)}
                </div>
                <div className="invoice-control-note">
                  <strong>{order?.poNumber}</strong>
                  <span>{t("Remaining PO balance")}: {formatCurrency(order?.remainingAmount, order?.currency || request.currency, language)}</span>
                  <span>{t("The server validates SUNAT, anti-duplication and the PO ceiling before creating CXP.")}</span>
                </div>
                <button className="primary-button" type="submit" disabled={invoiceSubmitting}><UploadCloud size={16} /><span>{t(invoiceSubmitting ? "Processing..." : "Validate and provision invoice")}</span></button>
              </form></DraftPanel>
            </Section>
          )}

          {(related.sunatVouchers?.length > 0 || related.massUploadBatches?.length > 0 || related.invoiceObservations?.length > 0) && (
            <Section title="Invoice control register" description="A1 and A2 vouchers, batch outcomes and isolated observations are independently traceable.">
              {related.sunatVouchers?.length > 0 && (
                <div className="subsection-block">
                  <h4>{t("SUNAT vouchers")}</h4>
                  <DataTable
                    controls={false}
                    rows={related.sunatVouchers}
                    columns={[
                      { key: "seriesNumber", label: "Voucher" },
                      { key: "flowType", label: "Track", render: (row) => <span className={`track-pill track-${row.flowType}`}>{row.flowType}</span> },
                      { key: "rucIssuer", label: "RUC" },
                      { key: "issueDate", label: "Issue date", render: (row) => formatDate(row.issueDate, language) },
                      { key: "xmlAmount", label: "XML amount", align: "right", render: (row) => formatCurrency(row.xmlAmount, row.currency || request.currency, language) },
                      { key: "sunatStatus", label: "SUNAT" },
                      { key: "validationStatus", label: "Status", render: (row) => <StatusBadge status={row.validationStatus} /> },
                      { key: "observationDetail", label: "Observation" },
                      { key: "replacement", label: "Replacement", render: (row) => row.supersededBy
                        ? <span>{t("Replaced by")}: {related.sunatVouchers.find((item) => item._id === row.supersededBy)?.seriesNumber || row.supersededBy}</span>
                        : ["Admin", "Accounting"].includes(user.role) && !["RECHAZADO", "ANULADO", "CERRADO", "PAGADO_CERRADO"].includes(request.status) && !row.accountsPayable && !row.batch && ["OBSERVED_SUNAT", "OBSERVED_AMOUNT_EXCEEDED", "PENDING"].includes(row.validationStatus)
                          && related.sunatVouchers.some((item) => item.accountsPayable && !item.supersededBy)
                        ? <details><summary>{t("Replace incorrect invoice")}</summary><form onSubmit={async (event) => {
                          event.preventDefault();
                          const values = new FormData(event.currentTarget);
                          setReplacingInvoice(true);
                          try {
                            await api.post(`/requests/${id}/invoice/${row._id}/replace`, { replacementId: values.get("replacementId"), reason: values.get("reason") });
                            notify("Invoice replacement recorded. Request progress updated.");
                            await load();
                          } catch (err) { setError(err.message); notify(err.message, "error"); }
                          finally { setReplacingInvoice(false); }
                        }}>
                          <label>{t("Posted replacement invoice")}<select name="replacementId" required defaultValue=""><option value="">{t("Select")}</option>{related.sunatVouchers.filter((item) => item.accountsPayable && !item.supersededBy).map((item) => <option key={item._id} value={item._id}>{item.seriesNumber}</option>)}</select></label>
                          <label>{t("Reason")}<input name="reason" required maxLength={1000} /></label>
                          <p>{t("The original invoice and its history are preserved. No payment is created.")}</p>
                          <button className="secondary-button" disabled={replacingInvoice} type="submit">{t("Confirm replacement")}</button>
                        </form></details> : null }
                    ]}
                  />
                </div>
              )}
              {related.massUploadBatches?.length > 0 && (
                <div className="subsection-block">
                  <h4>{t("Mass upload batches")}</h4>
                  <DataTable
                    controls={false}
                    rows={related.massUploadBatches}
                    columns={[
                      { key: "batchCode", label: "Batch" },
                      { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
                      { key: "totalVouchers", label: "Total", align: "right" },
                      { key: "processedSuccess", label: "Successful", align: "right" },
                      { key: "observed", label: "Observed", align: "right" },
                      { key: "failed", label: "Failed", align: "right" },
                      { key: "uploadedAt", label: "Uploaded", render: (row) => formatDateTime(row.uploadedAt, language) }
                    ]}
                  />
                </div>
              )}
              {related.invoiceObservations?.length > 0 && (
                <div className="subsection-block">
                  <h4>{t("Invoice observations")}</h4>
                  <DataTable
                    controls={false}
                    rows={related.invoiceObservations}
                    columns={[
                      { key: "seriesNumber", label: "Voucher", render: (row) => row.seriesNumber || row.sourceName },
                      { key: "batch", label: "Batch", render: (row) => row.batch?.batchCode || "-" },
                      { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status || row.validationStatus} /> },
                      { key: "totalAmount", label: "Amount", align: "right", render: (row) => formatCurrency(row.totalAmount ?? row.xmlAmount, row.currency || request.currency, language) },
                      { key: "errorDetail", label: "Technical detail", render: (row) => row.errorDetail || row.observationDetail },
                      { key: "resolutionStatus", label: "Resolution", render: (row) => <StatusBadge status={row.resolutionStatus} /> }
                    ]}
                  />
                </div>
              )}
            </Section>
          )}

          <div hidden={activeTab !== "Documents"}><FinancialValidationSummary request={request} related={related} /></div>
          <Section title="Financial control records" description="Budget, purchase order, CXP, journals, bank batches, payment, and reconciliation remain independently traceable.">
            <DefinitionGrid>
              <Definition label="Purchase / Service Order">{order?.poNumber || "-"}</Definition>
              {order?.paymentTermsSnapshot && <Definition label="Order payment terms"><PaymentTermsSummary terms={order.paymentTermsSnapshot} amount={order.paymentTermsSnapshot.quotationAmount} currency={order.paymentTermsSnapshot.quotationCurrency || order.currency} /></Definition>}
              <Definition label="PO remaining balance">{order ? formatCurrency(order.remainingAmount, order.currency, language) : "-"}</Definition>
              <Definition label="Payment operation">{request.payment?.operationNumber || request.payment?.confirmations?.at(-1)?.operationNumber || "-"}</Definition>
              <Definition label="Reconciliation">{(related.reconciliations || (related.reconciliation ? [related.reconciliation] : [])).map(record => `${record.bankReference}: ${formatCurrency(record.paidAmount, request.currency, language)}`).join("; ") || "-"}</Definition>
            </DefinitionGrid>

            {related.accountsPayable?.length > 0 && (
              <div className="subsection-block">
                <h4>{t("Accounts Payable records")}</h4>
                <DataTable
                  controls={false}
                  rows={related.accountsPayable}
                  columns={[
                    { key: "voucher", label: "Voucher", render: (row) => row.voucher?.series || row.voucher?.number ? `${row.voucher?.series || ""}-${row.voucher?.number || ""}` : "-" },
                    { key: "flowType", label: "Track", render: (row) => <span className={`track-pill track-${row.flowType}`}>{row.flowType || request.flowType}</span> },
                    { key: "status", label: "CXP status", render: (row) => <StatusBadge status={row.status} /> },
                    { key: "originalAmount", label: "Amount", align: "right", render: (row) => formatCurrency(row.originalAmount, row.currency, language) },
                    { key: "paymentTermsSnapshot", label: "Payment Terms", render: (row) => <PaymentTermsSummary terms={row.paymentTermsSnapshot} showAmounts={false} /> },
                    { key: "dueDate", label: "Due date", render: (row) => formatDate(row.dueDate, language) },
                    { key: "paymentPriority", label: "Priority", render: (row) => row.paymentPriority === "PRIORITY" ? <span className="priority-pill">{t("Priority")}</span> : t("Normal") },
                    { key: "paymentBatch", label: "Bank batch", render: (row) => row.paymentBatch?.batchNumber || "-" },
                    { key: "destination", label: "Payment Destination Snapshot", render: (row) => row.bankAccountSnapshot?.bank ? `${row.bankAccountSnapshot.bank} · ${row.bankAccountSnapshot.sourceType || "SUPPLIER"}` : "-" },
                    { key: "bouncedPayment", label: "Bounce", render: (row) => row.bouncedPayment?.bouncedAt ? `${row.bouncedPayment.reason || "-"} · ${formatDateTime(row.bouncedPayment.bouncedAt, language)}` : "-" }
                  ]}
                />
              </div>
            )}

            {related.paymentBatches?.length > 0 && (
              <div className="subsection-block">
                <h4>{t("Payment batches")}</h4>
                <DataTable
                  controls={false}
                  rows={related.paymentBatches}
                  columns={[
                    { key: "batchNumber", label: "Batch" },
                    { key: "bank", label: "Bank" },
                    { key: "paymentDate", label: "Payment date", render: (row) => formatDate(row.paymentDate, language) },
                    { key: "totalAmount", label: "Amount", align: "right", render: (row) => formatCurrency(row.totalAmount, row.currency, language) },
                    { key: "priority", label: "Priority" },
                    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> }
                  ]}
                />
              </div>
            )}

            {request.payment?.confirmations?.length > 0 && (
              <div className="subsection-block">
                <h4>{t("Payment confirmations")}</h4>
                <DataTable
                  controls={false}
                  rows={request.payment.confirmations}
                  rowKey="operationNumber"
                  columns={[
                    { key: "operationNumber", label: "Operation" },
                    { key: "amount", label: "Amount", align: "right", render: (row) => formatCurrency(row.amount, row.currency || request.currency, language) },
                    { key: "paidAt", label: "Paid at", render: (row) => formatDateTime(row.paidAt, language) },
                    { key: "comments", label: "Comments" }
                  ]}
                />
              </div>
            )}

          </Section>

          <div hidden={activeTab !== "Accounting"} className="workspace-panel">            {journalLines.length > 0 && (
              <div className="subsection-block">
                <h4>{t("Journal lines")}</h4>
                <DataTable
                  controls={false}
                  rows={journalLines}
                  columns={[
                    { key: "entryNumber", label: "Entry" },
                    { key: "entryType", label: "Type" },
                    { key: "accountNumber", label: "Account" },
                    { key: "description", label: "Description" },
                    { key: "debit", label: "Debit", align: "right", render: (row) => formatCurrency(row.debit, request.currency, language) },
                    { key: "credit", label: "Credit", align: "right", render: (row) => formatCurrency(row.credit, request.currency, language) },
                    { key: "period", label: "Period" }
                  ]}
                />
              </div>
            )}
</div>
          {["ENTREGA_RENDIR", "REEMBOLSO_SIN_SUSTENTO"].includes(request.requestType) && (
            <div hidden={!["Documents", "Payment"].includes(activeTab)}><OfficialRenditionWorkspace request={request} masters={masters} user={user} onReload={load} /></div>
          )}
        </div>

        <aside className="request-detail-side" id="request-actions">
          {(permissions.modifiable || permissions.canWithdraw || permissions.canApprove || permissions.canCommitBudget || permissions.canIssueOrder || permissions.canClose || permissions.canVoid) && (
            <div className="workspace-panel action-panel">
              <div className="section-heading"><div><h3>{t("Available actions")}</h3></div></div>
              {permissions.canWithdraw && (
                <div className="action-item">
                  <div><strong>{t("Withdraw request")}</strong><span>{t("Possible until your first approver approves it.")}</span></div>
                  <button type="button" className="secondary-button" disabled={processing} onClick={() => decision("withdraw")}><Undo2 size={16} /><span>{t("Withdraw")}</span></button>
                </div>
              )}
              {permissions.modifiable && (
                <div className="action-item">
                  <div><strong>{t("Submit for approval")}</strong><span>{missingDocuments.length ? t("Required documents are incomplete.") : t("Starts the configured approval route.")}</span></div>
                  <button type="button" className="primary-button" disabled={processing || missingDocuments.length > 0} title={missingDocuments.length ? t("Upload all required documents before submission.") : undefined} onClick={submitRequest}><Send size={16} /><span>{t("Submit")}</span></button>
                </div>
              )}
              {permissions.canApprove && (
                <div className="action-buttons">
                  {permissions.canApprove && isChainApprovalStep && (
                    <>
                      <button type="button" className="primary-button approve-button" onClick={() => decision("approve", false)}><CheckCircle2 size={16} /><span>{t("Approve and finalize")}</span></button>
                      {canForwardChain && <button type="button" className="secondary-button" title={forwardToName ? `${t("Send to my jefe")}: ${forwardToName}` : undefined} onClick={() => decision("approve", true)}><Forward size={16} /><span>{t("Send to my jefe")}</span></button>}
                    </>
                  )}
                  {permissions.canApprove && !isChainApprovalStep && <button type="button" className="primary-button" onClick={() => decision("approve")}><CheckCircle2 size={16} /><span>{t("Approve")}</span></button>}
                  {permissions.canObserve && <button type="button" className="secondary-button" onClick={() => decision("observe")}><MessageSquareWarning size={16} /><span>{t("Observe")}</span></button>}
                  {permissions.canReturn && <button type="button" className="secondary-button" onClick={() => decision("return")}><CornerUpLeft size={16} /><span>{t("Return")}</span></button>}
                  {permissions.canReject && <button type="button" className="danger-button subtle" onClick={() => decision("reject")}><XCircle size={16} /><span>{t("Reject")}</span></button>}
                </div>
              )}
              {permissions.canCommitBudget && (
                <button type="button" className="primary-button" onClick={confirmCommitBudget}><CheckCircle2 size={16} /><span>{t("Commit budget")}</span></button>
              )}
              {permissions.canIssueOrder && (
                <button type="button" className="primary-button" onClick={confirmIssueOrder}><ShoppingCart size={16} /><span>{t("Issue order")}</span></button>
              )}
              {permissions.canClose && (
                <button type="button" className="primary-button" onClick={confirmClose}><CheckCircle2 size={16} /><span>{t("Close request")}</span></button>
              )}
              {permissions.canVoid && (
                <button type="button" className="danger-button subtle" onClick={() => setConfirm({
                  type: "void",
                  title: "Annul this request?",
                  description: "Any unexecuted reservation is released idempotently and the action is audited.",
                  confirmLabel: "Annul request",
                  tone: "danger",
                  inputLabel: "Annulment reason",
                  inputRequired: true,
                  details: [{ label: "Request", value: request.requestNumber }, { label: "Result", value: "Status changes to ANULADO." }]
                })}><Trash2 size={16} /><span>{t("Annul request")}</span></button>
              )}
            </div>
          )}

          <div hidden={activeTab !== "Approvals"} className="workspace-panel timeline-panel">
            <div className="section-heading"><div><h3>{t("Approval timeline")}</h3><p>{t("Electronic sign-offs, SLA dates, and workflow decisions.")}</p></div></div>
            <ApprovalTimeline history={[...(request.approvalHistory || [])].reverse()} />
          </div>

          <div hidden={activeTab !== "History"} className="workspace-panel timeline-panel">
            <div className="section-heading"><div><h3>{t("Immutable audit")}</h3><p>{t("Application audit records are append-only.")}</p></div></div>
            <div className="compact-lines">
              {(related.audit || []).slice().reverse().map((item) => (
                <div key={item._id}>
                  <span>{formatDateTime(item.createdAt, language)} · {item.user?.name || "System"}</span>
                  <strong>{item.action}</strong>
                </div>
              ))}
              {!related.audit?.length && <p>{t("No audit events available.")}</p>}
            </div>
          </div>
        </aside>
      </div>

      {stickyAction && (
        <div className="request-sticky-actions" role="region" aria-label={t("Main action")}>
          {availableActionCount > 1 && <a className="secondary-button" href="#request-actions">{t("More actions")}</a>}
          {stickyAction.href
            ? <a className="primary-button" href={stickyAction.href} onClick={stickyAction.onClick}><StickyIcon size={16} aria-hidden="true" /><span>{t(stickyAction.label)}</span></a>
            : <button type="button" className={stickyAction.className || "primary-button"} disabled={processing || stickyAction.disabled} onClick={stickyAction.onClick}><StickyIcon size={16} aria-hidden="true" /><span>{t(stickyAction.label)}</span></button>}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title}
        description={confirm?.description}
        details={confirm?.details}
        confirmLabel={confirm?.confirmLabel}
        tone={confirm?.tone}
        inputLabel={confirm?.inputLabel}
        inputRequired={confirm?.inputRequired}
        loading={processing}
        onClose={() => !processing && setConfirm(null)}
        onConfirm={(comments) => runAction(confirm.type, comments, confirm.forward)}
      />
    </section></DetailTab.Provider>
  );
}
