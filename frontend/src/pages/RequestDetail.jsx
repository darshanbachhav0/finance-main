import ApprovalStatusSummary from "../components/ApprovalStatusSummary.jsx";
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
  Download,
  Eye,
  FileCheck2,
  FileText,
  Forward,
  History as HistoryIcon,
  Landmark,
  MessageSquare,
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
import DigitalActaPanel from "../components/DigitalActaPanel.jsx";
import ApprovalTimeline from "../components/ApprovalTimeline.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import Tabs from "../components/Tabs.jsx";
import InfoPopover from "../components/InfoPopover.jsx";
import WorkspaceSkeleton from "../components/WorkspaceSkeleton.jsx";
import ProtectedAssetButton from "../components/ProtectedAssetButton.jsx";
import DuplicateInvoiceHelp from "../components/DuplicateInvoiceHelp.jsx";
import UploadedFileList from "../components/UploadedFileList.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import OfficialRenditionWorkspace from "../components/rendition/OfficialRenditionWorkspace.jsx";
import SimpleRenditionForm from "../components/rendition/SimpleRenditionForm.jsx";
import AdvanceRenditionCard from "../components/rendition/AdvanceRenditionCard.jsx";
import { RENDITION_STAGES } from "../utils/simpleRendition.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import EmptyState from "../components/EmptyState.jsx";
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
  requestFrequencyLabels,
  requestTypeLabels,
  transferPurposeLabels,
  treasuryAccountKindLabels
} from "../utils/options.js";
import { isTransfer, transferRoute } from "../utils/treasuryTransfer.js";
import { bankDisplayName } from "../../../shared/peruBanks.mjs";
import PriorityBadge from "../components/PriorityBadge.jsx";
import RequestSummaryFacts from "../components/RequestSummaryFacts.jsx";
import CostAllocationSummary from "../components/CostAllocationSummary.jsx";
import { beneficiaryNames, costCenterTypeLabels, isOnBehalf } from "../utils/costAllocation.js";

import { coversKind, isEitherOf, presentCount } from "../utils/documentRequirements.js";
import { invoiceMismatchLines } from "../utils/validationMessages.js";
import RequestJourney from "../components/RequestJourney.jsx";
import NextStepCard from "../components/NextStepCard.jsx";
import { nextStepFor } from "../utils/nextStep.js";
import { journeySummary } from "../utils/requestJourney.js";
import { REQUESTER_INVOICE_PROBLEMS, usesPlainStatuses } from "../utils/plainStatus.js";
import RenditionCountdown from "../components/RenditionCountdown.jsx";
import RequestComments from "../components/RequestComments.jsx";
import { RECORD_CHANGED_EVENT } from "../hooks/useLiveEvents.js";
import { celebrate } from "../utils/celebrate.js";
import { laterStagesText, mustSendUp } from "../utils/approvalOptions.js";
import { PERMISSIONS, ROLES, hasRole, userCan } from "../utils/access.js";

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

// capexDetails.projectSnapshot carries code and name once the backend resolves the project.
function capexProjectLabel(capexDetails = {}) {
  const snapshot = capexDetails.projectSnapshot || {};
  const named = [snapshot.code, snapshot.name].filter(Boolean).join(" - ");
  return named || capexDetails.projectPep || null;
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== "";
}

// Track D: one of UMA's own accounts as it was when the transfer was registered.
function TransferAccount({ account }) {
  const { t } = useLanguage();
  if (!account) return "-";
  return <div className="primary-cell"><strong>{account.code || "-"}</strong><span>{[bankDisplayName(account.bank), account.currency, account.accountNumber].filter(Boolean).join(" · ")}</span>{(account.cci || account.ledgerAccount) && <small>{[account.cci && `CCI ${account.cci}`, account.ledgerAccount && `${t("Ledger account")} ${account.ledgerAccount}`, account.kind && t(treasuryAccountKindLabels[account.kind] || account.kind)].filter(Boolean).join(" · ")}</small>}</div>;
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
const tabIcons = { General: FileText, Documents: FileCheck2, Approvals: CheckCircle2, Comments: MessageSquare, Budget: WalletCards, Accounting: BookOpenCheck, Payment: Landmark, History: HistoryIcon };
const sectionTabs = { "Budget preview": "Budget", "Budget commitment": "Budget", "Procurement Readiness": "Budget", "Documents and fiscal validation": "Documents", "Register A1 invoice and conformity": "Documents", "Register the invoice": "Documents", "Invoice control register": "Accounting", "Financial control records": "Payment" };
function Section({ title, description, children, className = "", skip = false }) {
  const { t } = useLanguage();
  const activeTab = useContext(DetailTab);
  const [expanded, setExpanded] = useState(true);
  if (skip) return null;
  const sectionId = `request-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div hidden={activeTab !== (sectionTabs[title] || "General")} className={`workspace-panel detail-section ${className}`.trim()} id={sectionId}>
      <h3 className="request-section-heading"><button type="button" className="request-section-toggle" aria-expanded={expanded} aria-controls={`${sectionId}-content`} onClick={() => setExpanded((value) => !value)}><span><strong>{t(title)}</strong></span><span aria-hidden="true">{expanded ? "−" : "+"}</span></button>{description && <InfoPopover label="About this section" align="end"><p>{t(description)}</p></InfoPopover>}</h3>
      <MotionCollapse className="request-section-content" id={`${sectionId}-content`} open={expanded}>{children}</MotionCollapse>
    </div>
  );
}

export default function RequestDetail() {
  // A comment notification links to #comments, which opens the conversation tab.
  const [activeTab, setActiveTab] = useState(() => (window.location.hash === "#comments" ? "Comments" : "General"));
  const [showAllPhases, setShowAllPhases] = useState(false);
  const [replacingInvoice, setReplacingInvoice] = useState(false);
  const { id } = useParams();
  const { user, readOnly } = useAuth();
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
  // Invoice registration errors stay next to the invoice form, far down the Documents tab.
  const [invoiceError, setInvoiceError] = useState("");
  // An invoice already registered is explained with where it is and how to correct it.
  const [invoiceDuplicate, setInvoiceDuplicate] = useState(null);

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

  // Live updates: a notification about this request (approved, paid, commented...) reloads it.
  useEffect(() => {
    const refresh = (event) => { if (String(event.detail?.entityId) === String(id)) load(); };
    window.addEventListener(RECORD_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(RECORD_CHANGED_EVENT, refresh);
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
  // approver has an active jefe who is not on leave (GET /approvals/:id/options). The same options
  // name a supplier that still waits for approval: its jefe approves it with the request.
  const [approvalOptions, setApprovalOptions] = useState(null);
  useEffect(() => {
    let active = true;
    setApprovalOptions(null);
    if (!permissions.canApprove) return undefined;
    api.get(`/approvals/${id}/options`).then((response) => { if (active) setApprovalOptions(response.data.data || null); }).catch(() => { if (active) setApprovalOptions(null); });
    return () => { active = false; };
  }, [id, permissions.canApprove, activeApprovalStep?._id]);
  const canForwardChain = isChainApprovalStep && Boolean(approvalOptions?.canForward);
  const forwardToName = approvalOptions?.forwardTo?.name || "";
  // Above the superior-approval threshold the jefe cannot finalize: "Approve" sends it up.
  const sendUp = isChainApprovalStep && mustSendUp(approvalOptions);
  // The approve button's forward choice: finalize (false) unless it must go up; none outside a chain.
  const approveForward = isChainApprovalStep ? sendUp : undefined;
  const laterStages = laterStagesText(approvalOptions, t);

  const attachments = request?.attachments || [];
  const missingDocuments = useMemo(() => requirements
    .map((rule) => ({
      ...rule,
      present: presentCount(rule, attachments)
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
    setError("");
    try {
      let decided;
      if (["approve", "observe", "return", "reject"].includes(type)) {
        decided = await api.post(`/approvals/${id}/${type}`, type === "approve" ? { comments, ...(typeof forward === "boolean" && { forward }) } : { comments });
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
      // The approval route is complete (not just one more level): a small celebration.
      if (type === "approve" && decided?.data?.data?.status && decided.data.data.status !== "PENDIENTE_APROBACION") celebrate("Request approved");
      if (type === "close") celebrate("Request closed");
      setConfirm(null);
      await load();
    } catch (err) {
      setError(`${err.message}${err.code ? ` (${err.code})` : ""}`);
      setConfirm(null);
    } finally {
      setProcessing(false);
    }
  }

  async function submitRequest() {
    setProcessing(true);
    setError("");
    try {
      await api.post(`/requests/${id}/submit`);
      notify("Request submitted for approval.");
      celebrate("Sent for approval");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  const invoiceDraft = useWorkDraft({ scope: "invoice-files", recordId: id, title: "Invoice and conformity files", enabled: Boolean(permissions.canRegisterInvoice), value: invoiceFiles, restore: setInvoiceFiles });
  // Removing a chosen file also empties its file picker (a new key mounts a fresh input).
  const [invoiceInputKeys, setInvoiceInputKeys] = useState({});
  function changeInvoiceFile(key, file) {
    setInvoiceError("");
    setInvoiceDuplicate(null);
    setInvoiceFiles((current) => ({ ...current, [key]: file }));
  }
  function removeInvoiceFile(key) {
    changeInvoiceFile(key, null);
    setInvoiceInputKeys((current) => ({ ...current, [key]: (current[key] || 0) + 1 }));
  }

  async function submitInvoice(event) {
    event.preventDefault(); if (!invoiceDraft.ready || invoiceDraft.status === "conflict") return;
    const form = event.currentTarget;
    setInvoiceError("");
    if (invoiceRequirements.some((item) => !item.kind || !invoiceDocumentFields.some((field) => coversKind(item, field.kind)))) {
      setInvoiceError(t("Invoice document requirements could not be loaded correctly. Refresh the page; if this continues, contact Admin to review the document rules."));
      return;
    }
    // The invoice needs its XML or its factura PDF (one is enough); other requirements need their file.
    const fieldsFor = (requirement) => invoiceDocumentFields.filter((field) => coversKind(requirement, field.kind));
    const missingInvoiceFiles = invoiceRequirements.filter((requirement) => !fieldsFor(requirement).some((field) => invoiceFiles[field.key]));
    if (missingInvoiceFiles.length) {
      setInvoiceError(`${t("Required invoice documents are missing")}: ${missingInvoiceFiles.map((item) => fieldsFor(item).map((field) => t(field.label)).join(" / ") || t(item.labelKey || item.kind)).join(", ")}.`);
      return;
    }
    setInvoiceSubmitting(true);
    setInvoiceError("");
    setInvoiceDuplicate(null);
    try {
      const data = new FormData();
      invoiceDocumentFields.forEach((field) => { if (invoiceFiles[field.key]) data.append(field.key, invoiceFiles[field.key]); });
      const response = await api.post(`/requests/${id}/invoice`, data);
      await invoiceDraft.complete();
      notify(response.data.observed ? "Invoice isolated for correction; the observation is now traceable." : "Invoice validated, matched to the PO and provisioned in CXP.");
      if (response.data.duplicate) setInvoiceDuplicate(response.data.duplicate);
      setInvoiceFiles(Object.fromEntries(invoiceDocumentFields.map((field) => [field.key, null])));
      form.reset();
      await load();
    } catch (err) {
      if (err.code === "DUPLICATE_VOUCHER") setInvoiceDuplicate(err.details || {});
      else setInvoiceError(`${err.message}${err.code ? ` (${err.code})` : ""}`);
    } finally {
      setInvoiceSubmitting(false);
    }
  }

  function decision(type, forward) {
    const details = { label: "Request", value: request.requestNumber };
    const actions = {
      approve: isChainApprovalStep ? (forward && sendUp ? {
        title: forwardToName ? t("Approve and send to {name}?").replace("{name}", forwardToName) : "Approve and send to your jefe?",
        description: "Above this amount your approval cannot finalize the request: it goes to your superior, who decides next.",
        confirmLabel: forwardToName ? t("Approve and send to {name}").replace("{name}", forwardToName) : "Send to my jefe",
        tone: "success",
        inputLabel: "Approval comments",
        details: [details, ...(forwardToName ? [{ label: "Next approver", value: forwardToName }] : []), ...(laterStages ? [{ label: "Then", value: laterStages }] : []), { label: "Result", value: "This step is marked approved and your superior decides next." }]
      } : forward ? {
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
        details: [details, ...(laterStages ? [{ label: "Then", value: laterStages }] : []), { label: "Result", value: transfer ? "The next approval step follows; once both approvals are in, Treasury makes the transfer." : "The configured route advances; budget remains a separate controlled stage." }]
      },
      observe: {
        title: "Send this request back?",
        description: "The requester makes the changes you ask for and sends it again. Nothing is lost.",
        confirmLabel: "Send back",
        tone: "danger",
        inputLabel: "What should be changed?",
        inputRequired: true,
        details: [details, { label: "Result", value: "It goes back to the requester with your comments." }]
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
    const confirmation = actions[type];
    setConfirm({ type, forward, ...confirmation });
  }

  if (loading && !request) return <WorkspaceSkeleton label="Loading request..." />;
  if (!request) return <section><Message type="error">{error || "Request not found."}</Message></section>;

  const supplier = request.supplier;
  const transfer = isTransfer(request) ? request.treasuryTransfer || {} : null;
  const order = request.purchaseOrder;
  const invoiceCorrection = Boolean(order) && ["OBSERVADO_SUNAT", "OBSERVADO_MONTO_EXCEDIDO", "OBSERVADO_CARGA_MASIVA"].includes(request.status);
  const approvedExceptionAfterObservation = request.status === "OBSERVADO_SUNAT"
    && request.observation?.code === "OBSERVADO_SUNAT"
    && related.sunatVouchers?.some((voucher) => voucher.validationStatus === "MANUAL_EXCEPTION"
      && new Date(voucher.manualOverride?.overriddenAt) > new Date(request.observation?.observedAt));
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
  const isOwner = String(request.requester?._id || request.requester) === String(user._id);
  // The employee's own paid advance: one card saying what to do, the receipts, and the history.
  // Invoice validation, document phases and the accounting detail stay with Finance.
  const simpleAdvance = isOwner && request.flowType === "C" && request.requestType === "ENTREGA_RENDIR" && RENDITION_STAGES.includes(request.rendition?.status);
  const advanceOpen = !["CERRADO", "ANULADO", "RECHAZADO"].includes(request.status);
  const openReceipts = () => { setActiveTab("Documents"); window.requestAnimationFrame(() => document.getElementById("official-rendition")?.scrollIntoView({ behavior: "smooth", block: "start" })); };
  // "Your turn": what the viewer has to do now, with the button that does it (utils/nextStep.js).
  const journey = journeySummary(request, { activeStep: activeApprovalStep, orderApplies: related.procurementReadiness?.applicable !== false, viewerId: user._id });
  const step = nextStepFor({ request, user, permissions, related, missingDocuments: missingDocuments.length, invoiceCorrection, ownAdvance: simpleAdvance, journey });
  // A step's place on the page: its tab, then the section itself, briefly highlighted.
  const openStep = ({ tab, target } = {}) => {
    if (tab) setActiveTab(tab);
    if (!target) return;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const element = document.getElementById(target);
      if (!element) return;
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      element.classList.add("is-step-target");
      window.setTimeout(() => element.classList.remove("is-step-target"), 2400);
    }));
  };
  const runStep = (run) => ({
    approve: () => decision("approve", approveForward),
    observe: () => decision("observe"),
    budget: confirmCommitBudget,
    submit: submitRequest,
    order: confirmIssueOrder,
    close: confirmClose
  })[run]?.();
  // Phones: the main action the page offers stays within reach in a bar above the bottom
  // navigation. It reuses the action panel's handlers; the full panel stays at #request-actions.
  const stickyAction = permissions.canApprove
    ? (isChainApprovalStep
      ? { label: "Approve", icon: CheckCircle2, onClick: () => decision("approve", approveForward), className: "primary-button approve-button" }
      : { label: "Approve", icon: CheckCircle2, onClick: () => decision("approve") })
    : permissions.canCommitBudget ? { label: "Commit budget", icon: CheckCircle2, onClick: confirmCommitBudget }
    : permissions.modifiable && !transfer && !missingDocuments.length ? { label: "Submit", icon: Send, onClick: submitRequest, disabled: processing }
    : permissions.canIssueOrder ? { label: "Issue order", icon: ShoppingCart, onClick: confirmIssueOrder }
    : permissions.canClose ? { label: "Close request", icon: CheckCircle2, onClick: confirmClose }
    : step?.mine && step.review ? { label: "Review receipts", icon: FileText, href: "#next-step", onClick: () => openStep({ target: "next-step" }) }
    : step?.mine && step.action?.open ? { label: step.action.label, icon: FileText, href: `#${step.action.open.target || "next-step"}`, onClick: () => openStep(step.action.open) }
    : null;
  const availableActionCount = [permissions.canWithdraw, permissions.modifiable, permissions.canApprove, permissions.canApprove && isChainApprovalStep && canForwardChain && !sendUp, permissions.canApprove && (permissions.canObserve || permissions.canReturn), permissions.canApprove && permissions.canReject, permissions.canCommitBudget, permissions.canIssueOrder, permissions.canClose, permissions.canVoid].filter(Boolean).length;
  const StickyIcon = stickyAction?.icon;
  const requestDescription = transfer
    ? `${t(optionLabel(request.requestType, requestTypeLabels))} - ${transferRoute(request)}`
    : request.flowType === "C"
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
          </div>
        )}
      />

      <Message type="error">{error}</Message>
      {step?.mine && <NextStepCard step={step} request={request} processing={processing} onRun={runStep} onOpen={openStep} onReload={load} />}
      {/* The readiness checklist is Finance's; a requester's "Your turn" card already says what is needed. */}
      {!simpleAdvance && !usesPlainStatuses(user) && <ReadinessPanel requestId={id} revision={request.updatedAt} />}

      <dl className="request-overview">
        <div><dt>{t("Total amount")}</dt><dd>{formatCurrency(request.totalAmount, request.currency, language)}</dd></div>
        <div><dt>{t("Requester")}</dt><dd>{requesterName(request)}</dd></div>
        {isOnBehalf(request) && <div><dt>{t("On behalf of")}</dt><dd>{beneficiaryNames(request)}</dd></div>}
        <div><dt>{t("Title")}</dt><dd>{request.title || request.description}</dd></div>
      </dl>
      <ApprovalStatusSummary request={request} holder={journey.holder} onHistory={() => { setActiveTab("Approvals"); window.requestAnimationFrame(() => document.getElementById("request-approval-history")?.scrollIntoView({ block: "start", behavior: "smooth" })); }} />
      <RequestSummaryFacts request={request} vouchers={related.sunatVouchers} payables={related.accountsPayable} />
      <RequestJourney request={request} payables={related.accountsPayable} activeStep={activeApprovalStep} orderApplies={related.procurementReadiness?.applicable !== false} viewerId={user._id} viewerRole={user.role} viewerName={user.name} />
      {simpleAdvance ? <AdvanceRenditionCard request={request} onOpen={openReceipts} /> : <RenditionCountdown request={request} mine={isOwner} onOpen={openReceipts} />}
      {step && !step.mine && <NextStepCard step={step} request={request} />}
      {/* An invoice from another supplier, or already registered, is explained in full by the card above. */}
      {invoiceCorrection && request.observation?.detail && (approvedExceptionAfterObservation || !REQUESTER_INVOICE_PROBLEMS.includes(request.observation.code)) && <Message type={approvedExceptionAfterObservation ? "warning" : "error"}>{t(approvedExceptionAfterObservation
        ? "Accounting has recorded a manual SUNAT exception. Invoice posting is still pending. Open Documents and retry with the same invoice files; any remaining blocker will be shown."
        : request.observation.detail)}</Message>}
      {/* Requesters follow the journey above; the detailed stage row is Finance's. */}
      {simpleAdvance || usesPlainStatuses(user) ? null : <div className="stage-row" role="group" aria-label={t("Current status")}>
        <FinancialProgressSummary request={request} financialProgress={related.financialProgress} renditionRequirements={trackCRenditionRequirements} compact />
        <RequestStageIndicator request={request} financialProgress={related.financialProgress} />
        {request.status === "PENDIENTE_APROBACION" && activeApprovalStep && <p className="muted-text"><strong>{t("Pending with")}:</strong> {activeApprovalStep.approverSnapshot?.name || t(activeApprovalStep.tier || activeApprovalStep.approvalLevel)}{activeApprovalStep.coveringForSnapshot?.name ? ` · ${t("on behalf of {name}").replace("{name}", activeApprovalStep.coveringForSnapshot.name)}` : ""}</p>}
        <InfoPopover label="What do these statuses mean?" align="end"><div className="workflow-details"><RequestStatusFlow request={{ ...request, status: displayedRequestStatus(request, related.financialProgress) }} /></div></InfoPopover>
      </div>}
      <Tabs idPrefix="request" label="Request sections" value={activeTab} onChange={setActiveTab} tabs={simpleAdvance
        ? [{ id: "General", label: "Summary", icon: tabIcons.General }, { id: "Documents", label: "Receipts", icon: tabIcons.Documents }, { id: "Approvals", label: "History", icon: tabIcons.History }]
        : (usesPlainStatuses(user) ? ["General", "Documents", "Approvals", "Comments", "Payment"] : ["General", "Documents", "Approvals", "Comments", "Budget", ...(user.role === "Accounting" ? ["Accounting"] : []), "Payment", "History"]).map((tab) => ({ id: tab, label: tab, icon: tabIcons[tab] }))} />

      <div className="request-detail-layout">
        <div className="request-detail-main">
          <div id="request-approval-history" hidden={activeTab !== "Approvals"} className="workspace-panel timeline-panel">
            <div className="section-heading"><div><h3>{t("Approval timeline")}</h3><p>{t("Electronic sign-offs, SLA dates, and workflow decisions.")}</p></div></div>
            <ApprovalTimeline history={[...(request.approvalHistory || [])].reverse()} />
          </div>

          <div hidden={!(activeTab === "Comments" || (simpleAdvance && activeTab === "Approvals"))}><RequestComments requestId={id} canWrite={!readOnly} /></div>

          <div hidden={activeTab !== "History"} className="workspace-panel timeline-panel">
            <div className="section-heading"><div><h3>{t("Immutable audit")}</h3><p>{t("Application audit records are append-only.")}</p></div></div>
            <div className="compact-lines">
              {(related.audit || []).slice().reverse().map((item) => (
                <div key={item._id}>
                  <span>{formatDateTime(item.createdAt, language)} · {item.user?.name || "System"}</span>
                  <strong>{item.action}</strong>
                  {(item.message || item.comments) && <small>{t(item.message || item.comments)}</small>}
                </div>
              ))}
              {!related.audit?.length && <EmptyState compact title="No audit events available." />}
            </div>
          </div>
          <Section title="Requirement and justification" description="Official request identity, responsible area and business need.">
            <DefinitionGrid>
              <Definition label="Request type">{t(optionLabel(request.requestType, requestTypeLabels))}</Definition>
              <Definition label="Track">{t(flowTypeLabels[request.flowType] || request.flowType)}</Definition>
              <Definition label="Expense nature">{t(optionLabel(request.expenseNature, expenseNatureLabels))}</Definition>
              <Definition label="Area / School">{request.schoolOrDepartment || request.requesterArea || request.requestingArea || "-"}</Definition>
              {!["C", "D"].includes(request.flowType) && <Definition label="Cost center type">{t(costCenterTypeLabels[isOnBehalf(request) ? "POR_ENCARGO" : "PROPIO"])}</Definition>}
              {isOnBehalf(request) && <>
                <Definition label="Requesting area">{[request.requesterArea || request.requestingArea, request.requesterCostCenterSnapshot?.code && `${request.requesterCostCenterSnapshot.code} - ${request.requesterCostCenterSnapshot.name || ""}`].filter(Boolean).join(" · ") || "-"}</Definition>
                <Definition label="Charged to"><CostAllocationSummary allocations={request.costAllocations} currency={request.currency} /></Definition>
                {request.costCenterReviewers?.length > 0 && <Definition label="Reviewed for the beneficiary area by">{request.costCenterReviewers.map((reviewer) => [reviewer.name, reviewer.jobTitle].filter(Boolean).join(" · ")).join(", ")}</Definition>}
              </>}
              <Definition label="Requirement date">{formatDate(request.issueDate, language)}</Definition>
              <Definition label="Accounting period">{request.accountingPeriod}</Definition>
              <Definition label="Priority"><PriorityBadge priority={request.priority} /></Definition>
              <Definition label="Frequency">{t(requestFrequencyLabels[request.frequency || request.opexDetails?.expenseFrequency || "ONE_OFF"])}</Definition>
              <Definition label="Currency">{request.currency}</Definition>
              <Definition label="Business justification">{request.businessJustification || request.detailedDescription || request.description || "-"}</Definition>
              <Definition label="Risk if not approved">{request.nonApprovalRisk || "-"}</Definition>
              {request.observations && <Definition label="Additional observations">{request.observations}</Definition>}
            </DefinitionGrid>
          </Section>

          {transfer && (
            <Section title="Transfer" description="Money moved between two of UMA's own bank accounts in the same currency. No supplier, budget or invoice is involved.">
              <DefinitionGrid>
                <Definition label="From account"><TransferAccount account={transfer.sourceAccount} /></Definition>
                <Definition label="To account"><TransferAccount account={transfer.destinationAccount} /></Definition>
                <Definition label="Amount">{formatCurrency(request.totalAmount, request.currency, language)}</Definition>
                <Definition label="Purpose">{t(transferPurposeLabels[transfer.purpose] || transfer.purpose || "-")}</Definition>
                {transfer.instrument && <Definition label="Instrument">{transfer.instrument}</Definition>}
                {transfer.reference && <Definition label="Reference">{transfer.reference}</Definition>}
                <Definition label="Operation number">{transfer.operationNumber || t("Not executed yet")}</Definition>
                {transfer.executedAt && <Definition label="Execution date">{formatDate(transfer.executedAt, language)}</Definition>}
              </DefinitionGrid>
              {userCan(user, PERMISSIONS.TREASURY_TRANSFER, PERMISSIONS.BATCH_APPROVE, PERMISSIONS.ACCOUNTING_PROVISION) && <Link className="text-link" to={`/treasury/transfers?request=${request._id}`}>{t("Open in Transfers")}</Link>}
            </Section>
          )}

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

          <Section skip={simpleAdvance || Boolean(transfer)} title="Item / service breakdown" description="All accounting dimensions and immutable commercial totals are shown per line.">
            <DataTable
              controls={false}
              rows={request.lines || []}
              columns={[
                { key: "itemDescription", label: "Description" },
                { key: "costCenter", label: "Cost center", render: (row) => `${row.costCenterSnapshot?.code || row.costCenter?.code || "-"} · ${row.costCenterSnapshot?.name || row.costCenter?.name || ""}` },
                // Accounting accounts are Accounting's decision; requesters and approvers never see them.
                ...(hasRole(user, ROLES.ACCOUNTING) ? [{ key: "expenseType", label: "Accounting account", render: (row) => `${row.expenseType?.accountNumber || row.expenseTypeSnapshot?.accountNumber || "-"} · ${row.expenseType?.name || row.expenseTypeSnapshot?.name || ""}` }] : []),
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

          {!["C", "D"].includes(request.flowType) && (
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

          {["A1", "A2", "B", "C"].includes(request.flowType) && <Section title="Acta digital" description="Receiver and responsible-area electronic approval; Vice-Rector above 5 UIT."><DigitalActaPanel request={request} user={user} readOnly={readOnly} onSaved={load} /></Section>}
          <Section skip={Boolean(transfer)} title="Budget commitment"><DefinitionGrid>              <Definition label="Budget status"><StatusBadge status={request.budgetCommitment?.status || "NO_BUDGET"} /></Definition>
              <Definition label="Budget amount">{request.budgetCommitment ? formatCurrency(request.budgetCommitment.totalAmount, "PEN", language) : "-"}</Definition>
              <Definition label="Executed budget">{request.budgetCommitment ? formatCurrency(request.budgetCommitment.executedAmount, "PEN", language) : "-"}</Definition>
              <Definition label="Paid budget">{request.budgetCommitment ? formatCurrency(request.budgetCommitment.paidAmount, "PEN", language) : "-"}</Definition>
</DefinitionGrid></Section>
          <Section skip={Boolean(transfer)} title="Budget preview" description="This is a current read-only calculation; the authoritative commitment remains in the budget ledger.">
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

          <Section skip={simpleAdvance || Boolean(transfer)} title="Documents and fiscal validation" description="Original evidence is protected and fiscal amounts come from server-side XML parsing.">
            <div className="document-phase-heading">
              <span>{t("Current document phase")}</span>
              <StatusBadge status={documentStatus.currentPhase || "SUBMISSION"} />
            </div>
            <div className={`evidence-summary ${missingDocuments.length ? "warning" : "success"}`}>
              <FileCheck2 size={19} />
              <div>
                <strong>{missingDocuments.length ? t("Required evidence incomplete") : t("Required evidence complete")}</strong>
                <p>{requirements.length
                  ? requirements.map((rule) => `${t(rule.labelKey)} ${presentCount(rule, attachments)}/${rule.minCount}`).join(" · ")
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
                { key: "download", label: "", sortable: false, render: (row) => <div className="row-actions"><ProtectedAssetButton className="icon-button" resourcePath={row.url} fileName={row.originalName} preview title="View document" ariaLabel={`${t("View document")}: ${row.originalName}`}><Eye size={16} aria-hidden="true" /></ProtectedAssetButton><ProtectedAssetButton className="icon-button" resourcePath={row.url} fileName={row.originalName} title="Download" ariaLabel={`${t("Download")}: ${row.originalName}`}><Download size={16} aria-hidden="true" /></ProtectedAssetButton></div> }
              ]}
            />
            <div className={`xml-result ${request.xmlValidation?.validated ? "valid" : request.xmlValidation?.status === "INVALID" ? "invalid" : "neutral"}`}>
              <FileCheck2 size={19} />
              <div>
                <strong>{t(request.xmlValidation?.validated ? (request.xmlValidation.source === "PDF" ? "Invoice verified from the factura PDF" : "XML validation passed") : "Invoice verification not passed")}</strong>
                {hasRole(user, ROLES.ACCOUNTING) && <details><summary>{t("Advanced validation details")}</summary><p>{request.xmlValidation
                  ? ["supplierMatch", "documentNumberMatch", "netMatch", "igvMatch", "totalMatch", "currencyMatch"].map((key) => `${t(key)}: ${request.xmlValidation[key] === true ? t("Yes") : request.xmlValidation[key] === false ? t("No") : "-"}`).join(" · ")
                  : t("No XML validation result is stored.")}</p></details>}
                {!request.xmlValidation?.validated && invoiceMismatchLines(request.xmlValidation, t).map((line) => <p key={line} className="text-danger">{line}</p>)}
              </div>
            </div>
          </Section>

          {permissions.canRegisterInvoice && (
            <Section title={request.flowType === "B" ? "Register the invoice" : "Register A1 invoice and conformity"} description={request.flowType === "B" ? "Approved with its quote: upload the supplier's invoice (XML or factura PDF). It must match the approved amounts; once checked it goes to Treasury for payment." : "Upload the invoice XML or its factura PDF (one is enough) and the other required documents. The amounts are read from the XML, or from the factura PDF when there is no XML."}>
              <DraftPanel busy={invoiceSubmitting} draft={invoiceDraft}><form className="invoice-registration-panel" onSubmit={submitInvoice}>
                <div className="file-upload-grid">
                  {invoiceDocumentFields.filter((field) => invoiceRequirements.some((item) => coversKind(item, field.kind))).map((field) => {
                    const rule = invoiceRequirements.find((item) => coversKind(item, field.kind));
                    const either = isEitherOf(rule);
                    const chosenElsewhere = invoiceDocumentFields.some((other) => other.key !== field.key && coversKind(rule, other.kind) && invoiceFiles[other.key]);
                    // Each chosen file (also one restored from a saved draft) can be viewed, downloaded or removed before sending.
                    return <label className="field" key={field.kind}><span>{t(field.label)}{either ? "" : " *"}</span><input key={invoiceInputKeys[field.key] || 0} type="file" accept={field.accept} onChange={(event) => changeInvoiceFile(field.key, event.target.files?.[0] || null)} required={!invoiceFiles[field.key] && !chosenElsewhere} />{either && <small className="field-hint">{t(chosenElsewhere ? "Optional document" : "This or the other invoice file: one is enough.")}</small>}<UploadedFileList chosen={invoiceFiles[field.key] ? [invoiceFiles[field.key]] : []} onRemoveChosen={() => removeInvoiceFile(field.key)} /></label>;
                  })}
                </div>
                {order && <div className="invoice-control-note">
                  <strong>{order?.poNumber}</strong>
                  <span>{t("Remaining PO balance")}: {formatCurrency(order?.remainingAmount, order?.currency || request.currency, language)}</span>
                  <span>{t("The server validates SUNAT, anti-duplication and the PO ceiling before creating CXP.")}</span>
                </div>}
                {invoiceDuplicate && <DuplicateInvoiceHelp details={invoiceDuplicate} linkRequest={hasRole(user, [ROLES.ACCOUNTING, ROLES.TREASURY])} />}
                <Message type="error">{invoiceError}</Message>
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
                        : userCan(user, PERMISSIONS.ACCOUNTING_PROVISION) && !["RECHAZADO", "ANULADO", "CERRADO", "PAGADO_CERRADO"].includes(request.status) && !row.accountsPayable && !row.batch && ["OBSERVED_SUNAT", "OBSERVED_AMOUNT_EXCEEDED", "PENDING"].includes(row.validationStatus)
                          && related.sunatVouchers.some((item) => item.accountsPayable && !item.supersededBy)
                        ? <details><summary>{t("Replace incorrect invoice")}</summary><form onSubmit={async (event) => {
                          event.preventDefault();
                          const values = new FormData(event.currentTarget);
                          setReplacingInvoice(true);
                          try {
                            await api.post(`/requests/${id}/invoice/${row._id}/replace`, { replacementId: values.get("replacementId"), reason: values.get("reason") });
                            notify("Invoice replacement recorded. Request progress updated.");
                            await load();
                          } catch (err) { setError(err.message); }
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

          {!simpleAdvance && !transfer && <div hidden={activeTab !== "Documents"}><FinancialValidationSummary request={request} related={related} /></div>}
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
                    { key: "scheduledPaymentDate", primary: true, label: "Scheduled payment date", render: row => row.scheduledFor || row.plannedPaymentDate ? formatDate(row.scheduledFor || row.plannedPaymentDate, language) : "Por programar" },
                    { key: "paidDate", primary: true, label: "Actual payment date", render: row => formatDate(row.paidDate, language) },
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
            simpleAdvance
              ? <div id="official-rendition" hidden={activeTab !== "Documents"}><SimpleRenditionForm request={request} onReload={load} /></div>
              : <div id="official-rendition" hidden={!["Documents", "Payment"].includes(activeTab)}><OfficialRenditionWorkspace request={request} masters={masters} user={user} onReload={load} /></div>
          )}
        </div>

        <aside className="request-detail-side" id="request-actions">
          {(permissions.modifiable || permissions.deletable || permissions.canWithdraw || permissions.canApprove || permissions.canCommitBudget || permissions.canIssueOrder || permissions.canClose || permissions.canVoid) && (
            <div className="workspace-panel action-panel">
              <div className="section-heading"><div><h3>{t("Available actions")}</h3></div></div>
              {permissions.canWithdraw && (
                <div className="action-item">
                  <div><strong>{t("Withdraw request")}</strong><span>{t("Possible until your first approver approves it.")}</span></div>
                  <button type="button" className="secondary-button" disabled={processing} onClick={() => decision("withdraw")}><Undo2 size={16} /><span>{t("Withdraw")}</span></button>
                </div>
              )}
              {permissions.modifiable && !transfer && (
                <div className="action-item">
                  <div><strong>{t("Submit for approval")}</strong><span id="request-submit-reason">{missingDocuments.length ? t("Upload the required documents before submission.") : t("Starts the configured approval route.")}</span></div>
                  <div className="action-item-buttons">
                    <Link className="secondary-button" to={`/requests/${id}/edit`}><Pencil size={16} /><span>{t("Edit request")}</span></Link>
                    <button type="button" className="primary-button" disabled={processing || missingDocuments.length > 0} aria-describedby="request-submit-reason" onClick={submitRequest}><Send size={16} /><span>{t("Submit")}</span></button>
                  </div>
                </div>
              )}
              {/* Three decisions: Approve, Send back, Reject. In a manager chain, "send it to my jefe"
                  stays available as a link under them. */}
              {permissions.canApprove && (
                <div className="action-buttons">
                  <button type="button" className="primary-button approve-button" onClick={() => decision("approve", approveForward)}><CheckCircle2 size={16} /><span>{sendUp && forwardToName ? t("Approve and send to {name}").replace("{name}", forwardToName) : t("Approve")}</span></button>
                  {(permissions.canObserve || permissions.canReturn) && <button type="button" className="secondary-button" onClick={() => decision("observe")}><MessageSquareWarning size={16} /><span>{t("Send back")}</span></button>}
                  {permissions.canReject && <button type="button" className="danger-button subtle" onClick={() => decision("reject")}><XCircle size={16} /><span>{t("Reject")}</span></button>}
                  {laterStages && <p className="muted-text">{t("Then")}: {laterStages}</p>}
                  {isChainApprovalStep && canForwardChain && !sendUp && <button type="button" className="text-button" title={forwardToName ? `${t("Send to my jefe")}: ${forwardToName}` : undefined} onClick={() => decision("approve", true)}><Forward size={16} /><span>{t("Approve and send it to my jefe")}</span></button>}
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
              {(permissions.canVoid || permissions.deletable) && <div className="action-panel-danger">
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
                  <Trash2 size={16} /><span>{t("Delete request")}</span>
                </button>
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
              </div>}
            </div>
          )}

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
        error={error}
        onClose={() => !processing && setConfirm(null)}
        onConfirm={(comments) => runAction(confirm.type, comments, confirm.forward)}
      />
    </section></DetailTab.Provider>
  );
}
