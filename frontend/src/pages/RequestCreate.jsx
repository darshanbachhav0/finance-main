import ReadinessPanel from "../components/ReadinessPanel.jsx";
import SubmissionPreviewPanel from "../components/SubmissionPreviewPanel.jsx";
import MotionSurface from "../components/MotionSurface.jsx";
import { validationSummary } from "../utils/validationMessages.js";
import MotionList from "../components/MotionList.jsx";
import useWorkDraft from "../hooks/useWorkDraft.js";
import DraftPanel from "../components/DraftPanel.jsx";
import ContinueWork from "../components/ContinueWork.jsx";
import UploadedFileList, { openLocalFile } from "../components/UploadedFileList.jsx";
import {
  AlertTriangle,
  Building2,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileClock,
  HandCoins,
  Landmark,
  ListPlus,
  Paperclip,
  Plus,
  Save,
  Send,
  ShoppingCart,
  Split,
  Trash2,
  UserPlus,
  UserRound,
  Wallet,
  Zap
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import api from "../api/client.js";
import Message from "../components/Message.jsx";
import RequestItemLine from "../components/RequestItemLine.jsx";
import DateInput from "../components/DateInput.jsx";
import { formatIsoMonth, todayIso } from "../utils/dateInput.js";
import { restoreEditorLine, editRequestLine, requestLinePayload } from "../utils/requestLineEditor.js";
import PageHeader from "../components/PageHeader.jsx";
import WorkspaceSkeleton from "../components/WorkspaceSkeleton.jsx";
import SearchSelect from "../components/SearchSelect.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import QuotationComparison from "../components/QuotationComparison.jsx";
import RequestReview from "../components/RequestReview.jsx";
import BudgetRemainingSummary from "../components/BudgetRemainingSummary.jsx";
import CostAllocationEditor, { newCostAllocation } from "../components/CostAllocationEditor.jsx";
import { costAllocationProblems } from "../../../shared/costCenterAllocation.mjs";
import { normalizePaymentTerms, validatePaymentTerms } from "../../../shared/paymentTerms.mjs";
import { supplierCreditDays } from "../../../shared/invoiceFinance.mjs";
import SupplierPaymentCondition from "../components/SupplierPaymentCondition.jsx";
import PaymentTermsSummary from "../components/PaymentTermsSummary.jsx";
import WorkflowStepper from "../components/WorkflowStepper.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { formatCurrency } from "../utils/formatters.js";
import { extraSubmissionDocuments } from "../utils/documentRequirements.js";
import InvoiceDropZone from "../components/InvoiceDropZone.jsx";
import InvoiceMatchStrip from "../components/InvoiceMatchStrip.jsx";
import { invoiceFileKey, linesFromInvoice, replaceInvoiceFile } from "../utils/invoiceAutofill.js";
import { defaultOpenPeriod, quickTrack, quickTrackText, showCapexDetails, titleFromDescription } from "../utils/quickRequest.js";
import { celebrate } from "../utils/celebrate.js";
import BankAccountFields from "../components/suppliers/BankAccountFields.jsx";
import SupplierQuickRegister from "../components/suppliers/SupplierQuickRegister.jsx";
import { bankAccountLabel, bankAccountPayload, bankAccountProblems, emptyBankAccount } from "../utils/bankAccounts.js";
import {
  creationExpenseNatures,
  currencies,
  expenseNatureLabels,
  optionLabel,
  requestFrequencies,
  requestFrequencyLabels,
  requestPriorities,
  requestPriorityHints,
  requestPriorityLabels,
  requestTypeForFlow,
  trackCRequestTypeLabels,
  trackCRequestTypes
} from "../utils/options.js";
import "../styles/requestWizard.css";
import "../styles/umaProcessSelection.css";
import { requestFlowFromProcess, processByCode } from "../utils/umaProcessSelection.js";

// One request form in four steps, in the order the work happens: who is paid (the supplier and
// the account it is paid into), its receipt (read automatically), the details of the need, and
// the summary. An advance or a reimbursement for the requester (Track C) has no supplier and no
// receipt yet, so its first step is the beneficiary and there is no receipt step.
const STEP_LABELS = { supplier: "Supplier details", invoice: "Receipt and automation", details: "Requirement details", review: "Summary and submit" };
const stepsFor = (flowType) => flowType === "C" ? ["supplier", "details", "review"] : ["supplier", "invoice", "details", "review"];
const stepLabel = (id, flowType) => id === "supplier" && flowType === "C" ? "Beneficiary" : STEP_LABELS[id];
// Drafts saved by the earlier forms open on the step that now holds the same fields.
const LEGACY_STEPS = { need: "details", budget: "details", documents: "invoice" };
const LEGACY_STEP_ORDER = ["need", "supplier", "documents", "review"];
const supplierStatus = (supplier) => supplier?.homologationStatus || supplier?.status || "PENDING_VALIDATION";
const supplierName = (supplier) => supplier?.legalName || supplier?.name || "";
const idOf = (value) => value?._id || value || "";
const digits = (value) => String(value || "").replace(/\D/g, "");
const payableAccounts = (supplier) => (supplier?.bankAccounts || []).filter((account) => account.active !== false && ["CURRENT", "SAVINGS"].includes(account.accountType));

const emptyLine = (costCenter = "") => ({
  clientId: `${Date.now()}-${Math.random()}`,
  itemDescription: "",
  quantity: "1",
  unitOfMeasure: "UNIT",
  unitPrice: "",
  priceIncludesIGV: true,
  subtotal: 0,
  costCenter,
  budgetItem: "",
  projectId: "",
  netAmount: 0,
  igvAmount: 0,
  totalAmount: 0
});

const emptyQuotation = () => ({
  clientId: `${Date.now()}-${Math.random()}`,
  supplier: "",
  amount: "",
  currency: "PEN",
  deliveryPeriod: "",
  ...normalizePaymentTerms(),
  commercialConditions: "",
  attachment: "",
  recommended: false
});

const quotationHasData = (quotation) => Boolean(
  quotation.supplier || quotation.amount || quotation.deliveryPeriod || quotation.paymentConditions || quotation.paymentCondition || quotation.paymentNotes ||
  quotation.commercialConditions || quotation.attachment || quotation.recommended
);

function initialForm() {
  const today = todayIso();
  return {
    flowType: "A1",
    requestType: "OPEX",
    expenseNature: "SERVICES",
    priority: "P3",
    urgencyJustification: "",
    dueDate: "",
    frequency: "ONE_OFF",
    requesterCostCenter: "",
    // Propio: the requester's own CECO. Por Encargo: another school or department's (costAllocations).
    costCenterType: "PROPIO",
    schoolOrDepartment: "",
    areaCorrelative: "",
    issueDate: today,
    accountingPeriod: today.slice(0, 7),
    currency: "PEN",
    supplier: "",
    paymentAccount: "",
    title: "",
    detailedDescription: "",
    businessJustification: "",
    nonApprovalRisk: "",
    observations: "",
    description: "",
    supplierSelectionReason: "",
    supplierPaymentTerms: normalizePaymentTerms()
  };
}

const initialCapex = {
  businessCaseCode: "",
  projectPep: "",
  projectId: "",
  assetCategory: "",
  usefulLifeYears: "",
  npvAmount: "",
  npvCurrency: "PEN",
  paybackValue: "",
  paybackUnit: "MONTHS"
};

// The receipt as read from its file (XML exactly, a factura PDF as far as it can be read) and
// checked by the requester. It is not final: Accounting validates the voucher itself later.
const emptyInvoiceDetails = () => ({ source: "", documentType: "", number: "", issueDate: "", ruc: "", supplierName: "", currency: "", totalAmount: "", igvAmount: "" });
function invoiceDetailsFrom(invoice = {}, source = "") {
  return {
    source,
    documentType: invoice.voucherType || invoice.documentTypeCode || "",
    number: invoice.invoiceNumber || "",
    issueDate: String(invoice.issueDate || "").slice(0, 10),
    ruc: invoice.ruc || "",
    supplierName: invoice.supplierName || "",
    currency: invoice.currency || "",
    totalAmount: invoice.totalAmount ?? "",
    igvAmount: invoice.igvAmount ?? ""
  };
}

const documentDefinitions = [
  { key: "xml", kind: "XML", label: "Invoice XML", accept: ".xml" },
  { key: "pdf", kind: "PDF", label: "Invoice / receipt PDF", accept: ".pdf" },
  { key: "feeReceipt", kind: "FEE_RECEIPT", label: "Recibo por Honorarios", accept: ".pdf" },
  { key: "purchaseOrder", kind: "PURCHASE_ORDER", label: "Purchase order", accept: ".pdf,.doc,.docx,.xlsx" },
  { key: "contract", kind: "CONTRACT", label: "Signed contract", accept: ".pdf,.doc,.docx" },
  { key: "conformity", kind: "CONFORMITY", label: "Conformity report", accept: ".pdf,.doc,.docx" },
  { key: "activityReport", kind: "ACTIVITY_REPORT", label: "Activity report", accept: ".pdf,.doc,.docx" },
  { key: "supporting", kind: "SUPPORTING", label: "Supporting documents", accept: ".pdf,.doc,.docx,.xlsx,.jpg,.jpeg,.png,.csv,.txt", multiple: true }
];
const INVOICE_KINDS = ["XML", "PDF", "FEE_RECEIPT"];
const RECEIPT_NUMBER_EXAMPLE = "F001-00012345";

function Choice({ name, value, current, icon: Icon, title, hint, onChange }) {
  const { t } = useLanguage();
  const selected = value === current;
  return (
    <label className={`quick-choice${selected ? " is-selected" : ""}`}>
      <input type="radio" name={name} value={value} checked={selected} onChange={() => onChange(value)} />
      {Icon && <Icon size={20} aria-hidden="true" />}
      <span><strong>{t(title)}</strong>{hint && <small>{t(hint)}</small>}</span>
    </label>
  );
}

function WizardSection({ title, description, icon: Icon, children, action }) {
  const { t } = useLanguage();
  return (
    <section className="wizard-section">
      <header>
        {Icon && <span className="section-icon"><Icon size={17} aria-hidden="true" /></span>}
        <div><h3>{t(title)}</h3>{description && <p>{t(description)}</p>}</div>
        {action}
      </header>
      {children}
    </section>
  );
}

export default function RequestCreate() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const isEditing = Boolean(id);
  const [masters, setMasters] = useState({ suppliers: [], costCenters: [], beneficiaryCenters: [], projects: [], periods: [] });
  const [supplierScope, setSupplierScope] = useState(null);
  const [supplierSearching, setSupplierSearching] = useState(false);
  const initialProcess = useRef(new URLSearchParams(location.search).get("process"));
  const [form, setForm] = useState(() => ({
    ...initialForm(),
    ...(requestFlowFromProcess(initialProcess.current) || {})
  }));
  const [capex, setCapex] = useState(initialCapex);
  const [lines, setLines] = useState([emptyLine()]);
  const [costAllocations, setCostAllocations] = useState([]);
  const [showItems, setShowItems] = useState(false);
  const [quotations, setQuotations] = useState([]);
  const [quotationFiles, setQuotationFiles] = useState({});
  const [files, setFiles] = useState(Object.fromEntries(documentDefinitions.map((item) => [item.key, []])));
  // Files already on the request; the ones marked for removal leave it when the form is saved.
  const [storedAttachments, setStoredAttachments] = useState([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState([]);
  const existingAttachments = storedAttachments.filter((item) => !removedAttachmentIds.includes(String(item._id)));
  const [invoiceDetails, setInvoiceDetails] = useState(emptyInvoiceDetails);
  const [formPolicy, setFormPolicy] = useState({ documentRequirements: [], quotationPolicy: { enabled: false, minimumCount: 1 } });
  const [budgetPreview, setBudgetPreview] = useState({ status: "PENDING_VALIDATION", lines: [] });
  const [budgetRefresh, setBudgetRefresh] = useState(0);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [stepId, setStepId] = useState("supplier");
  const [visitedSteps, setVisitedSteps] = useState(["supplier"]);
  const [completedSteps, setCompletedSteps] = useState([]);
  const [registering, setRegistering] = useState(false);
  const [newAccount, setNewAccount] = useState(null);
  const [newAccountErrors, setNewAccountErrors] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [hydratedRecord, setHydratedRecord] = useState(null);
  const [sourceVersion, setSourceVersion] = useState("");
  // The supplier's receipt read on this form: { status: "reading" | "done" | "error", fileName,
  // file, invoice, supplier, supplierElsewhere, source, error }.
  const [invoiceCheck, setInvoiceCheck] = useState(null);
  const invoiceReadVersion = useRef(0);
  const validationFocusRef = useRef(null);
  useEffect(() => () => window.cancelAnimationFrame(validationFocusRef.current), []);

  const mergeSuppliers = (incoming = []) => setMasters((current) => {
    const byId = new Map(current.suppliers.map((supplier) => [String(supplier._id), supplier]));
    for (const supplier of incoming) if (supplier?._id) byId.set(String(supplier._id), { ...byId.get(String(supplier._id)), ...supplier });
    return { ...current, suppliers: [...byId.values()] };
  });

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const calls = [
          api.get("/suppliers", { params: { pageSize: 100 } }),
          api.get("/requests/authorized-cost-centers"),
          api.get("/projects", { params: { pageSize: 100, active: true } }),
          api.get("/accounting-periods", { params: { pageSize: 100 } }),
          // Por Encargo's schools and departments; Propio requests work without them.
          api.get("/requests/beneficiary-cost-centers").catch(() => ({ data: { data: [] } }))
        ];
        if (isEditing) calls.push(api.get(`/requests/${id}`));
        const [suppliersResponse, centersResponse, projectsResponse, periodsResponse, beneficiaryResponse, requestResponse] = await Promise.all(calls);
        if (!active) return;
        const nextMasters = {
          suppliers: suppliersResponse.data.data,
          costCenters: centersResponse.data.data,
          beneficiaryCenters: beneficiaryResponse.data.data || [],
          projects: projectsResponse.data.data.filter((item) => item.active),
          periods: periodsResponse.data.data
        };
        setSupplierScope(suppliersResponse.data.scope || null);
        setMasters(nextMasters);

        if (requestResponse && isEditing) {
          const request = requestResponse.data.data;
          setSourceVersion(request.updatedAt || "");
          const owner = request.requester?._id || request.solicitor?._id;
          if (!request.allowedActions?.includes("EDIT") || (user.role !== "Admin" && owner !== user._id)) {
            navigate(`/requests/${id}`, { replace: true });
            return;
          }
          const flowType = request.flowType || (trackCRequestTypes.includes(request.requestType) ? "C" : "A1");
          // A request's supplier is always on the form, even if it is no longer in the first page.
          if (request.supplier?._id && !nextMasters.suppliers.some((item) => item._id === request.supplier._id)) {
            const detail = await api.get(`/suppliers/${request.supplier._id}`).catch(() => null);
            if (active) mergeSuppliers([detail?.data?.data || request.supplier]);
          }
          setForm({
            ...initialForm(),
            flowType,
            requestType: requestTypeForFlow(flowType, request.requestType),
            expenseNature: request.expenseNature || "SERVICES",
            priority: ({ ALTA: "P2", MEDIA: "P3", BAJA: "P3" })[request.priority] || request.priority || "P3",
            urgencyJustification: request.urgencyJustification || "",
            dueDate: request.dueDate ? request.dueDate.slice(0, 10) : "",
            frequency: request.frequency || request.opexDetails?.expenseFrequency || "ONE_OFF",
            requesterCostCenter: idOf(request.requesterCostCenter),
            costCenterType: request.costCenterType === "POR_ENCARGO" ? "POR_ENCARGO" : "PROPIO",
            schoolOrDepartment: request.schoolOrDepartment || "",
            areaCorrelative: request.areaCorrelative || "",
            issueDate: request.issueDate.slice(0, 10),
            accountingPeriod: request.accountingPeriod,
            currency: request.currency,
            supplier: idOf(request.supplier),
            paymentAccount: idOf(request.paymentAccount?.account),
            title: request.title || "",
            detailedDescription: request.detailedDescription || request.description || "",
            businessJustification: request.businessJustification || "",
            nonApprovalRisk: request.nonApprovalRisk || "",
            observations: request.observations || "",
            description: request.description || "",
            supplierSelectionReason: request.supplierSelectionReason || "",
            supplierPaymentTerms: request.supplierPaymentTerms || normalizePaymentTerms()
          });
          const capexDetails = request.capexDetails || {};
          setCapex({
            businessCaseCode: capexDetails.businessCaseCode || "",
            projectPep: capexDetails.projectPep || "",
            projectId: idOf(capexDetails.projectSnapshot?.id),
            assetCategory: capexDetails.assetCategory || "",
            usefulLifeYears: capexDetails.usefulLifeYears ?? "",
            npvAmount: capexDetails.npv?.amount ?? "",
            npvCurrency: capexDetails.npv?.currency || request.currency,
            paybackValue: capexDetails.payback?.value ?? "",
            paybackUnit: capexDetails.payback?.unit || "MONTHS"
          });
          const serverLines = (request.lines || []).map((line) => restoreEditorLine({
            clientId: line._id,
            itemDescription: line.itemDescription || "",
            quantity: line.quantity ?? "",
            unitOfMeasure: line.unitOfMeasure || "",
            unitPrice: line.unitPrice ?? "",
            priceIncludesIGV: line.priceIncludesIGV,
            costCenter: idOf(line.costCenter),
            budgetItem: line.budgetItem || "",
            projectId: line.projectId || "",
            netAmount: line.netAmount,
            igvAmount: line.igvAmount,
            totalAmount: line.totalAmount
          }));
          setLines(serverLines);
          setCostAllocations((request.costAllocations || []).map((allocation) => ({ ...newCostAllocation(String(allocation.percentage ?? "")), costCenter: idOf(allocation.costCenter) })));
          setShowItems(serverLines.length > 1 || serverLines.some((line) => line.legacyAmounts || Number(line.quantity || 1) !== 1));
          setQuotations((request.quotations || []).map((quotation) => ({
            clientId: quotation._id,
            supplier: idOf(quotation.supplier),
            amount: quotation.amount ?? "",
            currency: quotation.currency || request.currency,
            deliveryPeriod: quotation.deliveryPeriod || "",
            ...normalizePaymentTerms(quotation),
            commercialConditions: quotation.commercialConditions || "",
            attachment: idOf(quotation.attachment),
            recommended: Boolean(quotation.recommended)
          })));
          setStoredAttachments(request.attachments || []);
          if (request.invoiceDetails?.status === "ATTACHED") setInvoiceDetails({ ...emptyInvoiceDetails(), ...request.invoiceDetails, issueDate: String(request.invoiceDetails.issueDate || "").slice(0, 10), totalAmount: request.invoiceDetails.totalAmount ?? "", igvAmount: request.invoiceDetails.igvAmount ?? "" });
        } else {
          // Filled in from what the platform already knows: the requester's cost center (or the only
          // one they may use), their unit, and an open month.
          const defaultCenter = idOf(user.costCenter) || nextMasters.costCenters[0]?._id || "";
          setForm((current) => ({ ...current, requesterCostCenter: defaultCenter, schoolOrDepartment: user.organizationalUnit || user.area || "", accountingPeriod: defaultOpenPeriod(nextMasters.periods, current.accountingPeriod) || current.accountingPeriod }));
          setLines([emptyLine(defaultCenter)]);
        }
        setHydratedRecord(id || "new");
        setHydrated(true);
      } catch (err) {
        setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [id]);

  // Por Encargo (a supplier request only: Track C stays on the requester's own CECO). Its lines
  // carry the first beneficiary's CECO, as the server saves them.
  const onBehalf = form.flowType !== "C" && form.costCenterType === "POR_ENCARGO";
  const beneficiaryCenter = onBehalf ? costAllocations[0]?.costCenter || "" : "";
  useEffect(() => {
    if (!onBehalf) return;
    setLines((current) => current.some((line) => line.costCenter !== beneficiaryCenter) ? current.map((line) => ({ ...line, costCenter: beneficiaryCenter })) : current);
  }, [onBehalf, beneficiaryCenter, lines]);
  const allocationProblems = onBehalf ? costAllocationProblems(costAllocations) : [];

  // Advances and reimbursements (Track C) are not invoices: their lines carry no IGV, so the
  // amount typed is the amount paid. Lines follow the track as it changes.
  const igvExempt = form.flowType === "C";
  useEffect(() => {
    setLines((current) => current.some((line) => Boolean(line.igvExempt) !== igvExempt)
      ? current.map((line) => {
        if (Boolean(line.igvExempt) === igvExempt) return line;
        if (line.legacyAmounts || line.unitPrice === "" || line.unitPrice === undefined) return { ...line, igvExempt, ...(igvExempt ? { netAmount: line.totalAmount, igvAmount: 0 } : {}) };
        return editRequestLine({ ...line, igvExempt }, { priceIncludesIGV: line.priceIncludesIGV ?? true });
      })
      : current);
  }, [igvExempt, lines.length]);

  useEffect(() => {
    if (!hydrated || !form.requestType || !form.expenseNature) return undefined;
    let active = true;
    api.get("/requests/form-policy", { params: { flowType: form.flowType, requestType: form.requestType, expenseNature: form.expenseNature } })
      .then((response) => active && setFormPolicy(response.data.data))
      .catch((err) => active && setError(err.message));
    return () => { active = false; };
  }, [form.flowType, form.requestType, form.expenseNature, hydrated]);

  // "New request" always opens a blank request; unfinished ones are listed above it.
  const draft = useWorkDraft({ scope: "request", recordId: id || "new", title: String(form.title || form.detailedDescription || "").trim().split(/\r?\n/)[0] || "Financial request", resumeLatest: isEditing, enabled: hydrated && !loading && hydratedRecord === (id || "new"), sourceVersion,
    value: { form, capex, lines, costAllocations, showItems, quotations, files, quotationFiles, removedAttachmentIds, invoiceDetails, stepId, visitedSteps, completedSteps },
    restore: (data) => {
      if (!data) return;
      // Drafts from the earlier forms lack the newer fields and kept the frequency with OPEX.
      setForm({ ...initialForm(), ...data.form, frequency: data.form?.frequency || data.opexFrequency || "ONE_OFF" });
      setCapex(data.capex || initialCapex);
      setLines((data.lines || [emptyLine()]).map(restoreEditorLine));
      setCostAllocations(data.costAllocations || []);
      setShowItems(Boolean(data.showItems) || (data.lines || []).length > 1);
      setQuotations(data.quotations || []);
      setFiles(data.files || Object.fromEntries(documentDefinitions.map((item) => [item.key, []])));
      setQuotationFiles(data.quotationFiles || {});
      setRemovedAttachmentIds(data.removedAttachmentIds || []);
      setInvoiceDetails({ ...emptyInvoiceDetails(), ...(data.invoiceDetails || {}) });
      const stepOf = (value) => (typeof value === "number" ? LEGACY_STEP_ORDER[value] : value);
      const map = (value) => LEGACY_STEPS[stepOf(value)] || stepOf(value) || "supplier";
      setStepId(map(data.stepId ?? data.step ?? "supplier"));
      setVisitedSteps([...new Set((data.visitedSteps || ["supplier"]).map(map))]);
      setCompletedSteps([...new Set((data.completedSteps || []).map(map))]);
    }
  });
  useEffect(() => { if (draft.ready) void draft.flush(); }, [stepId]);
  // The address names the saved new-request draft, so a reload or a return link reopens it.
  const draftSearch = draft.session.revision ? `?${new URLSearchParams({ workDraft: draft.session.id, workScope: "request", workRecord: "new" })}` : "";
  useEffect(() => {
    if (isEditing || !draft.ready) return;
    if (window.location.search !== draftSearch) window.history.replaceState(window.history.state, "", `${location.pathname}${draftSearch}`);
  }, [isEditing, draft.ready, draftSearch]);
  // The full supplier proposal (Suppliers page) returns here; an invoice's unregistered RUC goes along.
  const invoiceRuc = !invoiceCheck?.supplier && /^\d{11}$/.test(invoiceCheck?.invoice?.ruc || "") ? invoiceCheck.invoice.ruc : "";
  const supplierProposalPath = `/suppliers?${new URLSearchParams({ mode: "new", ...(invoiceRuc && { ruc: invoiceRuc }), returnTo: isEditing ? `/requests/${id}/edit` : `/requests/new/form${draftSearch}` })}`;
  // "New request" clicked while a request is open: that draft stays in Continue your work and a
  // blank request starts.
  const ownNavigation = useRef(false);
  const navigationKey = useRef(location.key);
  useEffect(() => {
    if (navigationKey.current === location.key) return;
    navigationKey.current = location.key;
    if (ownNavigation.current) { ownNavigation.current = false; return; }
    if (isEditing || new URLSearchParams(location.search).get("workDraft")) return;
    window.scrollTo({ top: 0 });
    const edited = draft.session.revision || draft.session.signature !== draft.session.savedSignature;
    if (draft.ready && edited) void draft.startAnother?.();
  }, [location.key]);
  // A supplier proposed on the Suppliers page is selected once the draft has been restored.
  const createdSupplier = useRef(location.state?.createdSupplierId || "");
  useEffect(() => {
    const createdSupplierId = createdSupplier.current;
    if (!draft.ready || !createdSupplierId) return;
    createdSupplier.current = "";
    api.get(`/suppliers/${createdSupplierId}`).then((response) => {
      mergeSuppliers([response.data.data]);
      setForm((current) => ({ ...current, supplier: current.supplier || createdSupplierId, paymentAccount: current.supplier ? current.paymentAccount : "" }));
      notify("Supplier proposal linked to the request.", "success");
    }).catch((err) => setError(err.message));
    ownNavigation.current = true;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [draft.ready]);

  const budgetPayload = useMemo(() => ({
    flowType: form.flowType, requestType: form.requestType, expenseNature: form.expenseNature,
    issueDate: form.issueDate, accountingPeriod: form.accountingPeriod, currency: form.currency,
    project: form.requestType === "CAPEX" ? capex.projectPep || masters.projects.find(item => item._id === capex.projectId)?.code : undefined,
    lines: lines.map(requestLinePayload),
    // Por Encargo previews each beneficiary's budget with its share.
    ...(onBehalf ? { costCenterType: "POR_ENCARGO", costAllocations: costAllocations.map(({ costCenter, percentage }) => ({ costCenter, percentage })) } : {})
  }), [form.flowType, form.requestType, form.expenseNature, form.issueDate, form.accountingPeriod, form.currency, capex.projectPep, capex.projectId, masters.projects, lines, onBehalf, costAllocations]);

  useEffect(() => {
    if (!hydrated || !form.accountingPeriod || allocationProblems.length || lines.some((line) => !line.costCenter || !(Number(line.totalAmount) > 0))) {
      setBudgetPreview({ status: "PENDING_VALIDATION", lines: [] });
      setBudgetLoading(false);
      return undefined;
    }
    let active = true;
    setBudgetLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.post("/requests/budget-preview", budgetPayload, { timeout: 15000 });
        if (active) setBudgetPreview(response.data.data);
      } catch (err) {
        if (active) setBudgetPreview({ status: "PENDING_VALIDATION", reason: err.code, errorMessage: err.message, lines: [] });
      } finally {
        if (active) setBudgetLoading(false);
      }
    }, 500);
    return () => { active = false; window.clearTimeout(timer); };
  }, [hydrated, budgetPayload, budgetRefresh]);

  const payee = form.flowType === "C" ? "employee" : "supplier";
  const route = form.flowType === "B" ? "direct" : "order";
  const selectedSupplier = masters.suppliers.find((supplier) => supplier._id === form.supplier);
  const accounts = payableAccounts(selectedSupplier);
  const selectedAccount = accounts.find((account) => account._id === form.paymentAccount);
  const officialRequest = form.flowType === "A1" && ["CAPEX", "OPEX"].includes(form.requestType);
  const eligibleSuppliers = useMemo(() => masters.suppliers.filter((supplier) => {
    const status = supplierStatus(supplier);
    return !["REJECTED", "INACTIVE"].includes(status) || supplier._id === form.supplier || quotations.some((quotation) => quotation.supplier === supplier._id);
  }), [masters.suppliers, form.supplier, quotations]);
  const stepIds = stepsFor(form.flowType);
  const step = Math.max(0, stepIds.indexOf(stepId));
  const maxStep = Math.max(...visitedSteps.map((item) => stepIds.indexOf(item)), 0);
  const totals = useMemo(() => {
    const cents = lines.reduce((result, line) => ({ net: result.net + Math.round(Number(line.netAmount || 0) * 100), igv: result.igv + Math.round(Number(line.igvAmount || 0) * 100), total: result.total + Math.round(Number(line.totalAmount || 0) * 100) }), { net: 0, igv: 0, total: 0 });
    return { net: cents.net / 100, igv: cents.igv / 100, total: cents.total / 100 };
  }, [lines]);
  const linesAreEmpty = lines.every((line) => !(Number(line.totalAmount) > 0) && !String(line.itemDescription || "").trim());
  // One line, one unit, IGV included: what the requester types is the total.
  const simpleAmount = !showItems && lines.length <= 1 && !lines[0]?.legacyAmounts && Number(lines[0]?.quantity || 1) === 1;

  // The supplier's account: when the supplier changes, its preferred account in the request's
  // currency (or its only account) is chosen; the requester can pick another.
  useEffect(() => {
    if (!hydrated || payee !== "supplier") return;
    if (form.paymentAccount && accounts.some((account) => account._id === form.paymentAccount)) return;
    const best = accounts.find((account) => account.currency === form.currency && account.preferred)
      || accounts.find((account) => account.currency === form.currency)
      || (accounts.length === 1 ? accounts[0] : null);
    // Like a pick by hand, the account's currency becomes the request's while nothing set it yet.
    const takeCurrency = best && linesAreEmpty && !invoiceDetails.currency;
    setForm((current) => (current.paymentAccount === (best?._id || "") ? current : { ...current, paymentAccount: best?._id || "", currency: takeCurrency ? best.currency : current.currency }));
  }, [hydrated, form.supplier, selectedSupplier?.bankAccounts, payee]);

  // Server-side supplier search (the first page is loaded with the form).
  async function searchSuppliers(query) {
    if (query.length < 2) return;
    setSupplierSearching(true);
    try {
      const response = await api.get("/suppliers", { params: { search: query, pageSize: 50 } });
      mergeSuppliers(response.data.data);
    } catch {
      // The list already loaded stays usable.
    } finally {
      setSupplierSearching(false);
    }
  }

  function clearErrors(keys) {
    setErrors((current) => {
      const next = { ...current };
      keys.forEach((key) => delete next[key]);
      return next;
    });
    setError("");
  }

  function changeForm(patch) {
    clearErrors(Object.keys(patch));
    setForm((current) => ({ ...current, ...patch }));
  }

  // Who is paid and how: a supplier through a purchase order (A1) or directly (B), or the
  // requester (C: an advance to render or an undocumented reimbursement).
  function changeTrack(patch) {
    const next = { payee, route, employeeNeed: form.requestType === "REEMBOLSO_SIN_SUSTENTO" ? "reimbursement" : "advance", capex: form.requestType === "CAPEX", ...patch };
    const track = quickTrack(next);
    clearErrors(["requestType", "supplier", "paymentAccount"]);
    setForm((current) => ({ ...current, ...track, supplier: track.flowType === "C" ? "" : current.supplier, paymentAccount: track.flowType === "C" ? "" : current.paymentAccount, costCenterType: track.flowType === "C" ? "PROPIO" : current.costCenterType }));
    if (track.flowType === "C") {
      // An advance or reimbursement is charged to the requester's own CECO.
      if (onBehalf) setLines((current) => current.map((line) => ({ ...line, costCenter: form.requesterCostCenter })));
      invoiceReadVersion.current += 1;
      setFiles((current) => ({ ...current, xml: [], pdf: [], feeReceipt: [] }));
      setInvoiceCheck(null);
      setInvoiceDetails(emptyInvoiceDetails());
      setQuotations([]);
      setRegistering(false);
    }
  }

  function selectSupplier(supplierId, supplier) {
    if (supplier) mergeSuppliers([supplier]);
    clearErrors(["supplier", "paymentAccount", "invoice"]);
    const known = supplier || masters.suppliers.find(item => item._id === supplierId);
    const days = supplierCreditDays(known?.paymentTerms);
    setForm((current) => ({ ...current, supplier: supplierId || "", paymentAccount: "", supplierPaymentTerms: normalizePaymentTerms(days > 0 ? { paymentCondition: "CREDIT", creditDays: days, creditStart: "INVOICE" } : {}) }));
    setNewAccount(null);
  }

  // The account the supplier is paid into decides the currency it is paid in: the request takes
  // it unless a receipt already set the currency (a different one is flagged, never converted).
  function chooseAccount(account) {
    clearErrors(["paymentAccount"]);
    setForm((current) => ({ ...current, paymentAccount: account._id, currency: invoiceDetails.currency || current.currency === account.currency || !linesAreEmpty ? current.currency : account.currency }));
  }

  async function useExistingSupplier(found) {
    try {
      const response = await api.get(`/suppliers/${found._id}`);
      selectSupplier(found._id, response.data.data);
      setRegistering(false);
    } catch (err) {
      setError(err.message);
    }
  }

  function supplierRegistered(supplier, warnings = []) {
    selectSupplier(supplier._id, supplier);
    setRegistering(false);
    // The account in the request's currency when there is one, else the first registered.
    const registered = payableAccounts(supplier);
    const first = registered.find((account) => account.currency === form.currency) || registered[registered.length - 1];
    if (first) setForm((current) => ({ ...current, supplier: supplier._id, paymentAccount: first._id, currency: linesAreEmpty && !invoiceDetails.currency ? first.currency : current.currency }));
    notify(t("Supplier {code} registered. Accounting reviews its documentation.").replace("{code}", supplier.supplierCode || supplierName(supplier)), "success");
    warnings.filter((warning) => warning.message).forEach((warning) => notify(warning.message, "info"));
  }

  async function addAccount() {
    const problems = bankAccountProblems(newAccount);
    setNewAccountErrors(problems);
    if (Object.keys(problems).length) return;
    try {
      const response = await api.post(`/suppliers/${form.supplier}/bank-accounts`, bankAccountPayload(newAccount));
      const detail = await api.get(`/suppliers/${form.supplier}`);
      mergeSuppliers([detail.data.data]);
      const created = response.data.data?._id || response.data.data?.account?._id;
      if (created) setForm((current) => ({ ...current, paymentAccount: created }));
      setNewAccount(null);
      notify("Bank account added. Accounting verifies it before Treasury pays it.", "success");
    } catch (err) {
      setNewAccountErrors({ accountNumber: err.message });
    }
  }

  // ---- The receipt. The platform's own reader takes the XML exactly and a factura PDF as far as
  // it can be read; nothing is stored until the request is saved, and the requester checks it.
  async function readInvoice(file) {
    if (!file) return;
    clearErrors(["invoice", "quote"]);
    const version = ++invoiceReadVersion.current;
    setInvoiceDetails(emptyInvoiceDetails());
    setInvoiceCheck({ status: "reading", fileName: file.name, file });
    const key = invoiceFileKey(file);
    setFiles((current) => replaceInvoiceFile(current, file));
    setRemovedAttachmentIds((current) => [...new Set([...current, ...storedAttachments.filter((item) => INVOICE_KINDS.includes(item.kind)).map((item) => String(item._id))])]);
    try {
      const data = new FormData();
      data.append(key, file);
      const response = await api.post("/requests/invoice-preview", data, { headers: { "Content-Type": "multipart/form-data" } });
      if (version !== invoiceReadVersion.current) return;
      const result = { status: "done", fileName: file.name, file, ...response.data.data };
      setInvoiceCheck(result);
      applyInvoice(result);
    } catch (err) {
      if (version !== invoiceReadVersion.current) return;
      setInvoiceCheck({ status: "error", fileName: file.name, file, error: err.message });
    }
  }

  function applyInvoice({ invoice, source }) {
    const read = invoiceDetailsFrom(invoice, source);
    // A receipt without the issuer's name takes it from the chosen supplier when the RUC is theirs.
    if (!read.supplierName && selectedSupplier && digits(read.ruc) === digits(selectedSupplier.normalizedIdentifier || selectedSupplier.rucDni)) read.supplierName = supplierName(selectedSupplier);
    setInvoiceDetails(read);
    const label = t("Invoice {number} from {supplier}").replace("{number}", invoice.invoiceNumber || "").replace("{supplier}", supplierName(selectedSupplier) || invoice.supplierName || `RUC ${invoice.ruc || "-"}`);
    setForm((current) => ({
      ...current,
      currency: invoice.currency || current.currency,
      detailedDescription: current.detailedDescription || label,
      description: current.description || label
    }));
    // The receipt's items become the request's amounts unless amounts were already typed.
    if (linesAreEmpty && Number(invoice.totalAmount) > 0) {
      const invoiceLines = linesFromInvoice(invoice, { costCenter: form.requesterCostCenter, description: label });
      setLines(invoiceLines);
      setShowItems(invoiceLines.length > 1);
    }
    notify(linesAreEmpty ? "Read from the receipt: check its data below." : "Receipt read. Your amounts were kept; compare them below.", "info");
  }

  function changeInvoiceDetail(patch) {
    clearErrors(Object.keys(patch).map((key) => `invoice.${key}`));
    // Corrected by hand: the request says so, and Accounting still checks the voucher itself.
    setInvoiceDetails((current) => ({ ...current, ...patch, source: "MANUAL" }));
  }

  function removeInvoice() {
    invoiceReadVersion.current += 1;
    setFiles((current) => ({ ...current, xml: [], pdf: [], feeReceipt: [] }));
    setRemovedAttachmentIds((current) => [...new Set([...current, ...storedAttachments.filter((item) => INVOICE_KINDS.includes(item.kind)).map((item) => String(item._id))])]);
    setInvoiceCheck(null);
    setInvoiceDetails(emptyInvoiceDetails());
  }

  const invoiceFiles = [...(files.xml || []), ...(files.pdf || []), ...(files.feeReceipt || [])];
  const storedInvoice = existingAttachments.filter((item) => INVOICE_KINDS.includes(item.kind));
  const invoiceAttached = invoiceFiles.length > 0 || storedInvoice.length > 0;
  // The receipt was issued by another RUC than the selected supplier: once approved it could not be
  // registered against the order, so the request is not sent like this.
  const invoiceIssuerRuc = digits(invoiceDetails.ruc || invoiceCheck?.invoice?.ruc);
  const selectedSupplierRuc = digits(selectedSupplier?.normalizedIdentifier || selectedSupplier?.rucDni);
  const invoiceFromOtherRuc = payee === "supplier" && invoiceAttached && Boolean(invoiceIssuerRuc && selectedSupplierRuc) && invoiceIssuerRuc !== selectedSupplierRuc ? invoiceIssuerRuc : "";

  // The quotes: the first is the chosen supplier's, for the request total and recommended; more
  // can be added to compare suppliers. A quote or the receipt: at least one.
  const quoteEvidence = (quotation) => Boolean(quotation && (quotationFiles[quotation.clientId] || quotation.attachment));
  const firstQuoteAttached = quoteEvidence(quotations[0]);
  const quotedSuppliers = new Set(quotations.filter(quoteEvidence).map((quotation) => quotation.supplier).filter(Boolean));
  function changeQuoteFile(index, file) {
    clearErrors(["quote", `quotations.${index}.attachment`]);
    const list = quotations.length ? quotations : [emptyQuotation()];
    if (!quotations.length) setQuotations(list);
    const quotation = list[index];
    if (quotation) setQuotationFiles((current) => ({ ...current, [quotation.clientId]: file || undefined }));
  }
  function changeQuote(index, patch) {
    clearErrors(Object.keys(patch).map((key) => `quotations.${index}.${key}`));
    setQuotations((current) => current.map((quotation, position) => position === index ? { ...quotation, ...patch } : quotation));
  }
  const addQuote = () => setQuotations((current) => [...(current.length ? current : [emptyQuotation()]), { ...emptyQuotation(), currency: form.currency }]);
  const removeQuote = (index) => setQuotations((current) => current.filter((_, position) => position !== index));
  // Without its file the first quote is left blank, so a request sent with only the receipt
  // carries no empty quotation.
  useEffect(() => {
    if (payee !== "supplier") return;
    setQuotations((current) => {
      if (!current.length && !firstQuoteAttached) return current;
      const [first = emptyQuotation(), ...rest] = current;
      const synced = firstQuoteAttached
        ? { ...first, supplier: form.supplier, amount: totals.total > 0 ? String(totals.total) : "", currency: form.currency, recommended: Boolean(form.supplier) }
        : { ...first, supplier: "", amount: "", recommended: false };
      return [synced, ...rest.map((quotation) => ({ ...quotation, recommended: false }))];
    });
  }, [payee, form.supplier, form.currency, totals.total, quotations.length, firstQuoteAttached]);

  const extraDocuments = extraSubmissionDocuments(formPolicy.documentRequirements, documentDefinitions, { invoiceAttached, flowType: form.flowType });

  function changeDescription(value) {
    clearErrors(["detailedDescription", "description"]);
    setForm((current) => ({ ...current, detailedDescription: value, description: value }));
    if (!invoiceCheck?.invoice) setLines((current) => current.length === 1 ? [{ ...current[0], itemDescription: titleFromDescription(value) }] : current);
  }

  function changeAmount(value) {
    clearErrors(["lines", "lines.0.totalAmount", "lines.0.unitPrice", "lines.0.quantity"]);
    setLines((current) => {
      const base = current[0] || emptyLine(form.requesterCostCenter);
      return [editRequestLine(base, { quantity: "1", unitOfMeasure: base.unitOfMeasure || "UNIT", unitPrice: value, priceIncludesIGV: true, igvExempt, itemDescription: base.itemDescription || titleFromDescription(form.detailedDescription) })];
    });
  }

  function setHeaderCostCenter(value) {
    clearErrors(["requesterCostCenter"]);
    setForm((current) => {
      const previous = current.requesterCostCenter;
      setLines((currentLines) => currentLines.map((line) => ({ ...line, costCenter: !line.costCenter || line.costCenter === previous ? value : line.costCenter })));
      return { ...current, requesterCostCenter: value };
    });
  }

  // Propio needs nothing more. Por Encargo asks for the school or department the request is for;
  // going back to Propio returns the lines to the requester's CECO.
  function changeCostCenterType(value) {
    clearErrors(["costCenterType", "costAllocations", ...Object.keys(errors).filter((key) => key.startsWith("costAllocations."))]);
    setForm((current) => ({ ...current, costCenterType: value }));
    if (value === "POR_ENCARGO") setCostAllocations((current) => (current.length ? current : [newCostAllocation("100")]));
    else if (onBehalf) setLines((current) => current.map((line) => ({ ...line, costCenter: form.requesterCostCenter })));
  }

  function changeCostAllocations(next) {
    clearErrors(["costAllocations", ...Object.keys(errors).filter((key) => key.startsWith("costAllocations."))]);
    setCostAllocations(next);
  }

  function updateLine(index, patch) {
    window.cancelAnimationFrame(validationFocusRef.current);
    setLines((current) => current.map((line, currentIndex) => currentIndex === index ? editRequestLine(line, patch) : line));
    clearErrors(Object.keys(patch).map((field) => `lines.${index}.${field}`).concat(`lines.${index}.totalAmount`));
  }

  // ---- What each step needs. Continue checks its step; Submit checks every step, as the server does.
  function validationForStep(id, submitting) {
    const next = {};
    if (id === "supplier") {
      if (payee === "employee") {
        if (!trackCRequestTypes.includes(form.requestType)) next.requestType = "Select an advance to render or an undocumented reimbursement.";
      } else if (!form.supplier) {
        next.supplier = "Select the supplier or register a new one.";
      } else if (accounts.length && !form.paymentAccount) {
        next.paymentAccount = "Choose the account the supplier is paid into.";
      }
    }
    if (id === "invoice" && payee === "supplier") {
      if (!invoiceAttached && !quotations.some(quoteEvidence)) next.quote = "Attach the receipt or the supplier's quote (at least one).";
      if (invoiceFromOtherRuc) next.invoice = "The receipt was issued by another RUC than the selected supplier. Attach this supplier's receipt, or go back and choose the supplier that issued it.";
      if (invoiceAttached && !invoiceDetails.issueDate) next["invoice.issueDate"] = "Enter the receipt's issue date.";
      if (invoiceDetails.issueDate && invoiceDetails.issueDate > todayIso()) next["invoice.issueDate"] = "The receipt's issue date cannot be later than today.";
      if (invoiceDetails.ruc && !/^(\d{8}|\d{11})$/.test(digits(invoiceDetails.ruc))) next["invoice.ruc"] = "The receipt's RUC must have 11 digits.";
      quotations.slice(1).forEach((quotation, position) => {
        const index = position + 1;
        if (!quotationHasData(quotation) && !quoteEvidence(quotation)) return;
        if (!quotation.supplier) next[`quotations.${index}.supplier`] = "Select a supplier.";
        if (!(Number(quotation.amount) > 0)) next[`quotations.${index}.amount`] = "Quotation amount must be greater than zero.";
        if (!quoteEvidence(quotation)) next[`quotations.${index}.attachment`] = "Quotation evidence is required.";
      });
      if (quotedSuppliers.size > 1 && !String(form.supplierSelectionReason || "").trim()) next.supplierSelectionReason = "Supplier selection reason is required.";
    }
    if (id === "details") {
      if (!String(form.detailedDescription || "").trim()) next.detailedDescription = "Describe the requirement.";
      if (submitting && form.flowType === "A1" && !String(form.businessJustification || "").trim()) next.businessJustification = "Tell us why it is needed.";
      if (!form.expenseNature) next.expenseNature = "This field is required.";
      if (!requestPriorities.includes(form.priority)) next.priority = "Choose the payment priority.";
      if (submitting && ["P1", "P2"].includes(form.priority) && !String(form.urgencyJustification || "").trim()) next.urgencyJustification = "Explain why it cannot wait for the fortnightly payment.";
      if (submitting && form.requestType === "CAPEX" && payee === "supplier" && !/^CN-\d{4}-\d{3}$/.test(String(capex.businessCaseCode || "").trim().toUpperCase())) next.businessCaseCode = "Enter the business case code, for example CN-2026-014.";
      if (!requestFrequencies.includes(form.frequency)) next.frequency = "Choose how often it is needed.";
      if (payee === "supplier" && !quotations.some(q => q.recommended && q.paymentCondition)) {
        for (const problem of validatePaymentTerms({ ...(form.supplierPaymentTerms || {}), amount: totals.total })) next[`supplierPaymentTerms.${problem.field}`] = problem.message;
      }
      ["requesterCostCenter", "issueDate", "accountingPeriod", "currency"].forEach((field) => {
        if (!String(form[field] || "").trim()) next[field] = "This field is required.";
      });
      if (form.issueDate && form.issueDate > todayIso()) next.issueDate = "The requirement date cannot be later than today.";
      const period = masters.periods.find((item) => item.period === form.accountingPeriod);
      if (form.accountingPeriod && (!period || period.status !== "OPEN")) next.accountingPeriod = "Accounting period must be open.";
      // Por Encargo: the same distribution rules the server applies (shared/costCenterAllocation.mjs).
      for (const problem of allocationProblems) next[problem.field] ||= problem.message;
      if (!lines.length) next.lines = "At least one request line is required.";
      lines.forEach((line, lineIndex) => {
        if (!line.costCenter && !onBehalf) next[`lines.${lineIndex}.costCenter`] = "Select a Cost Center.";
        if (!(Number(line.totalAmount) > 0)) next[`lines.${lineIndex}.totalAmount`] = simpleAmount ? "Enter the total amount." : "Total must be greater than zero.";
        if (simpleAmount) return;
        if (!String(line.itemDescription || "").trim() && (!line.legacyAmounts || officialRequest && submitting)) next[`lines.${lineIndex}.itemDescription`] = "Item description is required.";
        if (!line.legacyAmounts) {
          if (!(Number(line.quantity) > 0) || !Number.isFinite(Number(line.quantity))) next[`lines.${lineIndex}.quantity`] = "Enter a valid quantity.";
          if (!(Number(line.unitPrice) > 0) || !Number.isFinite(Number(line.unitPrice))) next[`lines.${lineIndex}.unitPrice`] = "Enter a valid unit price.";
          if (!line.unitOfMeasure) next[`lines.${lineIndex}.unitOfMeasure`] = "Select a unit of measure.";
        }
      });
      if (submitting) extraDocuments.forEach(({ definition }) => {
        if (!files[definition.key]?.length && !existingAttachments.some((item) => item.kind === definition.kind)) next[definition.key] = "Attach this document.";
      });
    }
    return next;
  }

  // A field's message shows when it is left, with the rules Continue applies. It is checked after
  // the blur has rendered, so a value committed on blur (the date field completes "30/09/26") is
  // the one checked; the message goes as soon as the field is fixed (clearErrors on change).
  const [blurredFields, setBlurredFields] = useState(null);
  const validateField = (...keys) => setBlurredFields({ keys });
  useEffect(() => {
    if (!blurredFields) return;
    const problems = validationForStep(stepId, true);
    setErrors((current) => {
      const next = { ...current };
      blurredFields.keys.forEach((key) => { if (problems[key]) next[key] = problems[key]; else delete next[key]; });
      return next;
    });
  }, [blurredFields]);

  // Shows the field messages and one summary, then moves focus to the first problem (after the
  // step that holds it has rendered).
  function showProblems(problems) {
    setErrors(problems);
    setError(validationSummary(problems, t));
    window.cancelAnimationFrame(validationFocusRef.current);
    validationFocusRef.current = window.requestAnimationFrame(() => {
      const element = window.document.querySelector(".field-error-text");
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      element?.closest(".field, .document-upload, .search-select, .wizard-section")?.querySelector("input, select, textarea, button")?.focus({ preventScroll: true });
    });
  }

  function goToStep(target) {
    setStepId(target);
    setVisitedSteps((current) => current.includes(target) ? current : [...current, target]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function nextStep() {
    const nextErrors = validationForStep(stepId, true);
    if (Object.keys(nextErrors).length) {
      showProblems(nextErrors);
      return;
    }
    setErrors({});
    setError("");
    setCompletedSteps((current) => [...new Set([...current, stepId])]);
    goToStep(stepIds[Math.min(stepIds.length - 1, step + 1)]);
  }

  function invoicePayload() {
    if (payee !== "supplier") return null;
    if (!invoiceAttached) return { status: "PENDING" };
    return { status: "ATTACHED", ...invoiceDetails, ruc: digits(invoiceDetails.ruc) };
  }

  async function save(sendForApproval) {
    if (invoiceCheck?.status === "reading") return;
    if (!draft.ready || draft.status === "conflict") return;
    // A saved draft needs who is paid, what is needed and its amount; sending it needs every step.
    // (Unsaved work is kept anyway: the form saves itself as it is typed.)
    const checkedSteps = sendForApproval ? stepIds.filter((item) => item !== "review") : ["supplier", "details"];
    const validations = checkedSteps.map((item) => validationForStep(item, sendForApproval));
    const firstInvalid = validations.findIndex((item) => Object.keys(item).length);
    if (firstInvalid >= 0) {
      goToStep(checkedSteps[firstInvalid]);
      showProblems(validations[firstInvalid]);
      return;
    }
    setSaving(true);
    setError("");
    const data = new FormData();
    const { paymentAccount, supplierPaymentTerms, ...formFields } = form;
    const payloadForm = {
      ...formFields,
      requestType: requestTypeForFlow(form.flowType, form.requestType),
      costCenterType: onBehalf ? "POR_ENCARGO" : "PROPIO",
      title: String(form.title || "").trim() || titleFromDescription(form.detailedDescription || form.description),
      description: form.description || form.detailedDescription
    };
    Object.entries(payloadForm).forEach(([key, value]) => data.append(key, value ?? ""));
    data.append("paymentAccount", payee === "supplier" ? paymentAccount || "" : "");
    if (payee === "supplier") data.append("supplierPaymentTerms", JSON.stringify(supplierPaymentTerms || {}));
    const receipt = invoicePayload();
    if (receipt) data.append("invoiceDetails", JSON.stringify(receipt));
    data.append("capexDetails", JSON.stringify(form.requestType === "CAPEX" ? {
      businessCaseCode: String(capex.businessCaseCode || "").trim().toUpperCase(),
      projectPep: capex.projectPep,
      projectSnapshot: { id: capex.projectId || undefined },
      assetCategory: capex.assetCategory || undefined,
      usefulLifeYears: capex.usefulLifeYears,
      npv: { amount: capex.npvAmount, currency: capex.npvCurrency },
      payback: { value: capex.paybackValue, unit: capex.paybackUnit }
    } : {}));
    data.append("opexDetails", JSON.stringify(form.requestType === "OPEX" ? { expenseFrequency: form.frequency } : {}));
    data.append("lines", JSON.stringify(lines.map(requestLinePayload)));
    data.append("costAllocations", JSON.stringify(onBehalf ? costAllocations.map(({ costCenter, percentage }) => ({ costCenter, percentage })) : []));
    data.append("quotations", JSON.stringify(quotations.filter(quotationHasData).map((quotation) => ({
      ...quotation,
      clientId: undefined,
      attachment: quotationFiles[quotation.clientId] ? undefined : quotation.attachment
    }))));
    data.append("submit", String(sendForApproval));
    if (removedAttachmentIds.length) data.append("removeAttachments", JSON.stringify(removedAttachmentIds));
    Object.entries(files).forEach(([key, selectedFiles]) => selectedFiles.forEach((file) => data.append(key, file)));
    quotations.filter(quotationHasData).forEach((quotation) => {
      const file = quotationFiles[quotation.clientId];
      if (file) data.append("quotation", file);
    });
    try {
      const response = isEditing
        ? await api.put(`/requests/${id}`, data, { headers: { "Content-Type": "multipart/form-data" } })
        : await api.post("/requests", data, { headers: { "Content-Type": "multipart/form-data" } });
      await draft.complete();
      notify(sendForApproval ? "Request submitted for approval." : isEditing ? "Draft request updated." : "Draft request created.");
      if (sendForApproval) celebrate("Sent for approval");
      navigate(`/requests/${response.data.data._id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // What the live panel checks: the manual's online validations, the approval route and the payment day.
  const previewPayload = useMemo(() => ({
    ...budgetPayload,
    id: isEditing ? id : undefined,
    requesterCostCenter: form.requesterCostCenter || undefined,
    costCenterType: onBehalf ? "POR_ENCARGO" : "PROPIO",
    priority: form.priority,
    urgencyJustification: form.urgencyJustification,
    dueDate: form.dueDate || undefined,
    supplier: payee === "supplier" ? form.supplier || undefined : undefined,
    paymentAccount: payee === "supplier" ? form.paymentAccount || undefined : undefined,
    invoiceDetails: payee === "supplier" ? (invoiceAttached ? { status: "ATTACHED", ...invoiceDetails, ruc: digits(invoiceDetails.ruc) } : { status: "PENDING" }) : undefined,
    capexDetails: form.requestType === "CAPEX" ? { businessCaseCode: capex.businessCaseCode } : {},
    quotations: quotations.filter(quotationHasData).map((quotation) => ({ ...quotation, clientId: undefined, attachment: quotationFiles[quotation.clientId] ? undefined : quotation.attachment })),
    quotationFileCount: quotations.filter((quotation) => quotationFiles[quotation.clientId] || quotation.attachment).length
  }), [budgetPayload, isEditing, id, form.requesterCostCenter, onBehalf, form.priority, form.urgencyJustification, form.dueDate, payee, form.supplier, form.paymentAccount, invoiceAttached, invoiceDetails, form.requestType, capex.businessCaseCode, quotations, quotationFiles]);

  const fieldError = (key) => errors[key] && <small className="field-error-text">{t(errors[key])}</small>;
  const fieldClass = (key, base = "field") => `${base}${errors[key] ? " field-error" : ""}`;
  const costCenter = masters.costCenters.find((item) => item._id === form.requesterCostCenter);
  // The request is charged to the requester's own CECO; another one only when the profile authorizes it.
  const ownCostCenter = masters.costCenters.find((item) => item._id === idOf(user.costCenter));
  const ownCostCenterHint = !form.requesterCostCenter || !ownCostCenter
    ? t("Only Cost Centers assigned to your profile are available.")
    : form.requesterCostCenter === ownCostCenter._id
      ? t("Charged to your own CECO. Its remaining budget is shown below.")
      : t("Charged to {ceco}, a CECO you are authorized for. Your own CECO is {own}.").replace("{ceco}", costCenter?.code || "").replace("{own}", ownCostCenter.code);
  const capexOpen = showCapexDetails({ total: totals.total, threshold: formPolicy.capexDetailsThreshold ?? 50000, capex });
  const currencyMismatch = payee === "supplier" && selectedAccount && selectedAccount.currency !== form.currency;
  const trackText = quickTrackText(form);
  const userArea = supplierScope?.scoped ? supplierScope.department : "";
  const supplierLabel = (item) => `${item.supplierCode ? `${item.supplierCode} - ` : ""}${item.rucDni} - ${supplierName(item)}`;

  // A new request must originate from the eight-process chooser. Existing drafts and
  // edits still work, including older saved work and supplier-return URLs.
  if (!isEditing && !requestFlowFromProcess(initialProcess.current) && !new URLSearchParams(location.search).has("workDraft") && !draft.session.revision) {
    return <Navigate to="/requests/new" replace />;
  }
  if (loading) return <WorkspaceSkeleton label={isEditing ? "Loading request..." : "Loading form data..."} />;

  return <section>
    <PageHeader
      title={isEditing ? "Edit request" : "New request"}
      description={isEditing ? "Edite los datos de esta solicitud." : `Proceso ${form.flowType} · Complete los datos, documentos, controles y envío.`}
    />
    {!isEditing && <div className="uma-request-process-banner"><div><strong>Proceso elegido: {form.flowType}</strong><span>{processByCode(form.flowType)?.title || "Solicitud financiera"}</span></div><button type="button" className="secondary-button" onClick={() => navigate("/requests/new")}>Cambiar proceso</button></div>}
    {!isEditing && <ContinueWork scope="request" recordId="new" exclude={draft.session.id} />}
    <DraftPanel busy={saving} draft={draft} onDiscard={() => navigate(isEditing ? `/requests/${id}` : "/requests")}>
    {stepId === "review" && <ReadinessPanel defaultOpen payload={{ ...form, lines, quotations: quotations.map(q => ({ ...q, attachment: quotationFiles[q.clientId] ? "preview-only" : q.attachment })), attachments: [...existingAttachments, ...Object.values(quotationFiles).filter(Boolean).map(file => ({ kind: "QUOTATION", name: file.name, url: "preview-only" })), ...documentDefinitions.flatMap(def => (files[def.key] || []).map(file => ({ kind: def.kind, name: file.name, url: "preview-only" })))] }} />}

    <div className="request-wizard four-step-wizard">
      <WorkflowStepper steps={stepIds.map((item) => stepLabel(item, form.flowType))} current={step} completedSteps={completedSteps.map((item) => stepIds.indexOf(item)).filter((index) => index >= 0)} maxAccessible={maxStep} onSelect={(next) => next <= maxStep && goToStep(stepIds[next])} />
      <div className="wizard-financial-context"><span>{t("Step {step} of {total}").replace("{step}", step + 1).replace("{total}", stepIds.length)} · {t(stepLabel(stepId, form.flowType))}</span><span>{t("Total amount")}<strong>{formatCurrency(totals.total, form.currency, language)}</strong></span><small>{t("Fields marked * are required.")}</small></div>
      <div className="wizard-workspace">
        <MotionSurface changeKey={step} directional>

        {stepId === "supplier" && <div className="wizard-step">
          <WizardSection title="Who is paid?">
            {!isEditing ? <p className="quick-note">{payee === "employee" ? "Beneficiario: colaborador de UMA. Elija abajo si es entrega a rendir o reembolso." : "Beneficiario: proveedor. La selección del proceso anterior determina si existe OC."}</p> : <fieldset className="quick-choices" aria-label={t("Who gets the money?")}>
              <legend className="sr-only">{t("Who gets the money?")}</legend>
              <Choice name="request-payee" value="supplier" current={payee} icon={Building2} title="A supplier" hint="A company or person who sells to UMA" onChange={() => changeTrack({ payee: "supplier" })} />
              <Choice name="request-payee" value="employee" current={payee} icon={UserRound} title="Me" hint="An advance or a reimbursement for you" onChange={() => changeTrack({ payee: "employee" })} />
            </fieldset>}
          </WizardSection>

          {payee === "employee" && <WizardSection title="What do you need?" description="Petty cash and reimbursements are handled here, in Track C.">
            <fieldset className="quick-choices">
              <legend className="sr-only">{t("What do you need?")}</legend>
              <Choice name="request-employee" value="ENTREGA_RENDIR" current={form.requestType} icon={Wallet} title="Money in advance" hint="I will present the receipts afterwards" onChange={() => changeTrack({ employeeNeed: "advance" })} />
              <Choice name="request-employee" value="REEMBOLSO_SIN_SUSTENTO" current={form.requestType} icon={HandCoins} title="I already paid, without a receipt" hint="I sign a declaration after approval" onChange={() => changeTrack({ employeeNeed: "reimbursement" })} />
            </fieldset>
            {fieldError("requestType")}
            <p className="quick-note">{t(form.requestType === "REEMBOLSO_SIN_SUSTENTO" ? "Nothing now: after approval you sign the declaration with your bank account." : "Nothing now: after you receive the money you present the receipts.")}</p>
          </WizardSection>}

          {payee === "supplier" && <WizardSection icon={Building2} title="Supplier details" description={userArea ? t("Your area's suppliers ({area}) and the ones shared with every area.").replace("{area}", userArea) : "Search by name, RUC or PRV code."}>
            {!registering && <>
              <SearchSelect label="Supplier" value={form.supplier} options={eligibleSuppliers} onChange={selectSupplier} getOptionLabel={supplierLabel} error={errors.supplier} required searchPlaceholder="Search name, RUC or PRV..." onSearch={searchSuppliers} searching={supplierSearching} />
              <button type="button" className="text-button" onClick={() => { setRegistering(true); clearErrors(["supplier"]); }}><UserPlus size={15} aria-hidden="true" />{t("Not in the list? Register a new supplier")}</button>
            </>}
            {registering && <SupplierQuickRegister initialRuc={invoiceRuc} need={form.detailedDescription} currency={form.currency} onRegistered={supplierRegistered} onUseExisting={useExistingSupplier} onCancel={() => setRegistering(false)} />}

            {selectedSupplier && !registering && <div className="selected-supplier-card">
              <div className="selected-supplier-head">
                <div><strong>{supplierName(selectedSupplier)}</strong><span>{[selectedSupplier.supplierCode, `RUC ${selectedSupplier.rucDni}`].filter(Boolean).join(" · ")}</span></div>
                <StatusBadge status={supplierStatus(selectedSupplier)} />
              </div>
              <small>Días de crédito: {supplierCreditDays(selectedSupplier.paymentTerms) ?? "Sin especificar"}</small>
              {supplierStatus(selectedSupplier) === "PENDING_VALIDATION" && <p className="section-note">{t("This supplier is waiting for approval: your jefe approves it together with this request.")}</p>}

              <fieldset className={`account-choices${errors.paymentAccount ? " field-error" : ""}`}>
                <legend><Landmark size={15} aria-hidden="true" /> {t("Account the supplier is paid into")} {accounts.length > 0 && "*"}</legend>
                {accounts.map((account) => <label key={account._id} className={`account-choice${form.paymentAccount === account._id ? " is-selected" : ""}`}>
                  <input type="radio" name="payment-account" checked={form.paymentAccount === account._id} onChange={() => chooseAccount(account)} />
                  <span><strong>{bankAccountLabel(account, t)}</strong><small>{account.accountHolderName || ""}</small></span>
                  <StatusBadge status={account.verificationStatus} />
                </label>)}
                {!accounts.length && <p className="section-note">{t("This supplier has no bank account yet. Treasury cannot pay it until one is registered and verified.")}</p>}
                {fieldError("paymentAccount")}
              </fieldset>
              {currencyMismatch && <div className="inline-alert alert-warning"><AlertTriangle size={16} aria-hidden="true" /><span>{t("The account is in {account} and the request in {request}. Nothing is converted: choose an account in {request} or change the currency.").replace("{account}", selectedAccount.currency).replaceAll("{request}", form.currency)}</span></div>}
              {selectedSupplier.permissions?.canAddBankAccount && !newAccount && <button type="button" className="text-button" onClick={() => setNewAccount(emptyBankAccount(supplierName(selectedSupplier), form.currency))}><Plus size={15} aria-hidden="true" />{t("Add another account (e.g. in dollars)")}</button>}
              {!selectedSupplier.permissions?.canAddBankAccount && !accounts.length && <p className="section-note">{t("Ask Accounting to register the supplier's account.")}</p>}
              {newAccount && <div className="bank-account-card">
                <BankAccountFields value={newAccount} onChange={(patch) => { setNewAccountErrors({}); setNewAccount((current) => ({ ...current, ...patch })); }} errors={newAccountErrors} />
                <div className="inline-form-actions"><button type="button" className="secondary-button" onClick={() => setNewAccount(null)}>{t("Cancel")}</button><button type="button" className="primary-button" onClick={addAccount}><Save size={15} aria-hidden="true" /><span>{t("Add account")}</span></button></div>
              </div>}
            </div>}
          </WizardSection>}
        </div>}

        {stepId === "invoice" && <div className="wizard-step">
          <WizardSection icon={Paperclip} title="The supplier's receipt" description="Drop the factura's XML or PDF: we read the RUC, number, date, currency, IGV and total. Check them before continuing.">
            <InvoiceDropZone check={invoiceCheck} onFile={readInvoice} supplierProposalPath={supplierProposalPath} />
            {invoiceCheck?.supplierElsewhere && <div className="inline-alert alert-warning"><AlertTriangle size={16} aria-hidden="true" /><span>{t("The receipt's supplier ({code}) belongs to another area's list.").replace("{code}", invoiceCheck.supplierElsewhere.supplierCode || invoiceCheck.supplierElsewhere.legalName || "")}</span></div>}
            {fieldError("invoice")}
            {(invoiceFiles.length > 0 || storedInvoice.length > 0) && <div className="receipt-files">
              {invoiceFiles.map((file) => <span className="receipt-file" key={`${file.name}-${file.size}`}><Paperclip size={14} aria-hidden="true" />{file.name}<button type="button" className="icon-button quiet" onClick={() => openLocalFile(file)} title={t("View document")} aria-label={`${t("View document")}: ${file.name}`}><Eye size={14} aria-hidden="true" /></button></span>)}
              {storedInvoice.map((file) => <span className="receipt-file" key={file._id}><Paperclip size={14} aria-hidden="true" />{file.originalName}</span>)}
              <button type="button" className="text-button" onClick={removeInvoice}><Trash2 size={14} aria-hidden="true" />{t("Remove receipt")}</button>
            </div>}

            {invoiceAttached ? <div className="receipt-review">
              <p className="receipt-review-note">{t(invoiceDetails.source === "MANUAL" ? "Corrected by you. Accounting validates the receipt itself before it is paid." : invoiceDetails.source ? "Read automatically. Check each value: Accounting validates the receipt before it is paid." : "Enter the receipt's data.")}</p>
              <div className="form-grid three-column-form">
                <label className="field"><span>{t("Receipt number")}</span><input value={invoiceDetails.number} onChange={(event) => changeInvoiceDetail({ number: event.target.value })} placeholder={RECEIPT_NUMBER_EXAMPLE} /></label>
                <label className={fieldClass("invoice.issueDate")}><span>{t("Receipt issue date")} *</span><DateInput max={todayIso()} value={invoiceDetails.issueDate} onChange={(event) => changeInvoiceDetail({ issueDate: event.target.value })} onBlur={() => validateField("invoice.issueDate")} aria-invalid={Boolean(errors["invoice.issueDate"])} />{fieldError("invoice.issueDate")}</label>
                <details className="form-span-two" open={errors["invoice.ruc"] ? true : undefined}><summary>{t("Additional details")}</summary><div className="form-grid two-column-form">
                <label className={fieldClass("invoice.ruc")}><span>{t("Supplier RUC")}</span><input inputMode="numeric" maxLength="11" value={invoiceDetails.ruc} onChange={(event) => changeInvoiceDetail({ ruc: digits(event.target.value) })} onBlur={() => validateField("invoice.ruc", "invoice")} />{fieldError("invoice.ruc")}</label>
                <label className="field form-span-two"><span>{t("Legal name")}</span><input value={invoiceDetails.supplierName} onChange={(event) => changeInvoiceDetail({ supplierName: event.target.value })} /></label>
                <label className="field"><span>{t("Currency")}</span><select value={invoiceDetails.currency} onChange={(event) => changeInvoiceDetail({ currency: event.target.value })}><option value="">-</option>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
                <label className="field"><span>{t("IGV")}</span><input type="number" min="0" step="0.01" inputMode="decimal" value={invoiceDetails.igvAmount} onChange={(event) => changeInvoiceDetail({ igvAmount: event.target.value })} /></label>
                </div></details>
                <label className="field"><span>{t("Receipt total")}</span><input type="number" min="0" step="0.01" inputMode="decimal" value={invoiceDetails.totalAmount} onChange={(event) => changeInvoiceDetail({ totalAmount: event.target.value })} /></label>
              </div>
              {invoiceDetails.currency && invoiceDetails.currency !== form.currency && <div className="inline-alert alert-warning"><AlertTriangle size={16} aria-hidden="true" /><span>{t("The receipt is in {receipt} and the request in {request}.").replace("{receipt}", invoiceDetails.currency).replace("{request}", form.currency)}</span><button type="button" className="secondary-button" onClick={() => changeForm({ currency: invoiceDetails.currency })}>{t("Use {currency}").replace("{currency}", invoiceDetails.currency)}</button></div>}
              {invoiceCheck?.invoice && <InvoiceMatchStrip invoice={invoiceCheck.invoice} form={form} totals={totals} supplier={selectedSupplier} flowType={form.flowType} />}
            </div> : <div className="receipt-pending"><FileClock size={18} aria-hidden="true" /><div><strong>{t("Receipt pending")}</strong><span>{t("No receipt yet? Continue with the supplier's quote: the receipt is registered when it arrives.")}</span></div></div>}
          </WizardSection>

          <WizardSection icon={Paperclip} title="The supplier's quote" description={invoiceAttached ? "Optional when the receipt is attached." : "Needed while there is no receipt."}>
            {errors.quote && <small className="field-error-text">{t(errors.quote)}</small>}
            <label className={`quick-file${errors.quote ? " field-error" : ""}${firstQuoteAttached ? " is-attached" : ""}`}>
              <Paperclip size={18} aria-hidden="true" />
              <span><strong>{quotationFiles[quotations[0]?.clientId]?.name || (quotations[0]?.attachment ? t("Attached") : t("Attach the supplier's quote"))}</strong><small>{t(firstQuoteAttached ? "Attached" : "PDF, Word, Excel or a photo")}</small></span>
              <input type="file" accept=".pdf,.doc,.docx,.xlsx,.jpg,.jpeg,.png" aria-label={t("Attach the supplier's quote")} onChange={(event) => { changeQuoteFile(0, event.target.files?.[0] || null); event.target.value = ""; }} />
            </label>
            {firstQuoteAttached && quotationFiles[quotations[0]?.clientId] && <button type="button" className="text-button" onClick={() => changeQuoteFile(0, null)}><Trash2 size={14} aria-hidden="true" />{t("Remove quote")}</button>}
            <details className="request-optional-fields" open={quotations.length > 1 || undefined}>
              <summary><span>{t("Compare with other suppliers (optional)")}</span></summary>
              <MotionList className="quick-quotes">{quotations.slice(1).map((quotation, position) => {
                const index = position + 1;
                const name = quotationFiles[quotation.clientId]?.name || (quotation.attachment ? t("Attached") : "");
                return <div className="quick-quote-row" key={quotation.clientId} data-motion-key={quotation.clientId}>
                  <SearchSelect label="Supplier" value={quotation.supplier} options={eligibleSuppliers} onChange={(supplier) => changeQuote(index, { supplier })} getOptionLabel={supplierLabel} error={errors[`quotations.${index}.supplier`]} required searchPlaceholder="Search name, RUC or PRV..." onSearch={searchSuppliers} searching={supplierSearching} />
                  <label className={fieldClass(`quotations.${index}.amount`)}><span>{t("Amount")} *</span><input type="number" inputMode="decimal" min="0" step="0.01" value={quotation.amount} onChange={(event) => changeQuote(index, { amount: event.target.value })} onBlur={() => validateField(`quotations.${index}.amount`)} />{fieldError(`quotations.${index}.amount`)}</label>
                  <label className={`quick-file${errors[`quotations.${index}.attachment`] ? " field-error" : ""}${name ? " is-attached" : ""}`}>
                    <Paperclip size={18} aria-hidden="true" />
                    <span><strong>{name || t("Attach this quote")}</strong><small>{t(name ? "Attached" : "PDF, Word, Excel or a photo")}</small></span>
                    <input type="file" accept=".pdf,.doc,.docx,.xlsx,.jpg,.jpeg,.png" aria-label={t("Attach this quote")} onChange={(event) => { changeQuoteFile(index, event.target.files?.[0] || null); event.target.value = ""; }} />
                    {fieldError(`quotations.${index}.attachment`)}
                  </label>
                  <button type="button" className="icon-button danger" onClick={() => removeQuote(index)} title={t("Remove quotation")} aria-label={t("Remove quotation")}><Trash2 size={16} /></button>
                </div>;
              })}</MotionList>
              <button type="button" className="text-button" onClick={addQuote}><Plus size={16} aria-hidden="true" />{t("Add another supplier's quote")}</button>
              {quotedSuppliers.size > 1 && <label className={fieldClass("supplierSelectionReason")}><span>{t("Why this supplier?")} *</span><textarea rows="2" value={form.supplierSelectionReason} placeholder={t("Explain price, delivery, technical suitability, exclusivity, or commercial conditions.")} onChange={(event) => changeForm({ supplierSelectionReason: event.target.value })} />{fieldError("supplierSelectionReason")}</label>}
              {quotations.filter(quotationHasData).length > 1 && <QuotationComparison quotations={quotations.filter(quotationHasData)} suppliers={masters.suppliers} />}
            </details>
          </WizardSection>

          <WizardSection icon={Paperclip} title="Other supporting documents (optional)">
            <label className={`quick-file${files.supporting?.length ? " is-attached" : ""}`}>
              <Paperclip size={18} aria-hidden="true" />
              <span><strong>{t("Supporting documents")}</strong><small>{files.supporting?.length ? files.supporting.map((file) => file.name).join(", ") : t("Contracts, reports, photos: any file that supports the request.")}</small></span>
              <input type="file" multiple accept=".pdf,.doc,.docx,.xlsx,.jpg,.jpeg,.png,.csv,.txt" aria-label={t("Supporting documents")} onChange={(event) => { const chosen = Array.from(event.target.files || []); setFiles((current) => ({ ...current, supporting: [...(current.supporting || []), ...chosen] })); event.target.value = ""; }} />
            </label>
            <UploadedFileList stored={existingAttachments.filter((item) => item.kind === "SUPPORTING")} removed={storedAttachments.filter((item) => item.kind === "SUPPORTING" && removedAttachmentIds.includes(String(item._id)))} chosen={files.supporting} onRemoveStored={(file) => setRemovedAttachmentIds((current) => [...current, String(file._id)])} onRestoreStored={(file) => setRemovedAttachmentIds((current) => current.filter((item) => item !== String(file._id)))} onRemoveChosen={(index) => setFiles((current) => ({ ...current, supporting: current.supporting.filter((_, position) => position !== index) }))} />
          </WizardSection>
        </div>}

        {stepId === "details" && <div className="wizard-step">
          <WizardSection title="The requirement">
            <label className={fieldClass("detailedDescription")}>
              <span>{t("Describe it in a few words")} *</span>
              <textarea rows="3" value={form.detailedDescription} placeholder={t("E.g. 2 toners for the Nursing laboratory printer")} onChange={(event) => changeDescription(event.target.value)} onBlur={() => validateField("detailedDescription")} aria-invalid={Boolean(errors.detailedDescription)} />
              {fieldError("detailedDescription")}
            </label>
            <label className={fieldClass("businessJustification")}>
              <span>{t("Why is it needed?")}{form.flowType === "A1" ? " *" : ""}</span>
              <textarea rows="2" value={form.businessJustification} placeholder={t("E.g. Practical classes start on Monday")} onChange={(event) => changeForm({ businessJustification: event.target.value })} onBlur={() => validateField("businessJustification")} aria-invalid={Boolean(errors.businessJustification)} />
              {fieldError("businessJustification")}
            </label>
            <div className="form-grid two-column-form">
              {payee === "supplier" && <div className="field form-span-two"><span>{t("Request type")} *</span>
                {!isEditing ? <strong className="field-static">{form.flowType} · {route === "order" ? "Compra con OC" : "Factura directa"}</strong> : <fieldset className="quick-choices compact-choices">
                  <legend className="sr-only">{t("How is it paid?")}</legend>
                  <Choice name="request-route" value="order" current={route} icon={ShoppingCart} title="With a purchase order" hint="Procurement places the order after approval" onChange={() => changeTrack({ route: "order" })} />
                  <Choice name="request-route" value="direct" current={route} icon={Zap} title="Direct payment" hint="No order needed: paid once approved" onChange={() => changeTrack({ route: "direct" })} />
                </fieldset>}
              </div>}
              <label className={fieldClass("expenseNature")}><span>{t("Type of expense")} *</span><select value={form.expenseNature} onChange={(event) => changeForm({ expenseNature: event.target.value })}>{[...new Set([...creationExpenseNatures, form.expenseNature])].map((item) => <option key={item} value={item}>{t(optionLabel(item, expenseNatureLabels))}</option>)}</select>{fieldError("expenseNature")}</label>
              {payee === "supplier" && <label className="quick-check"><input type="checkbox" checked={form.requestType === "CAPEX"} onChange={(event) => changeTrack({ capex: event.target.checked })} /><span>{t("It is equipment or a work that lasts more than a year (CAPEX)")}</span></label>}
              {payee === "employee" && <div className="field"><span>{t("Request type")}</span><strong className="field-static">{t(trackCRequestTypeLabels[form.requestType] || form.requestType)}</strong></div>}
            </div>
          </WizardSection>

          <WizardSection title="Payment priority and frequency">
            <div className="form-grid two-column-form">
              <div className={fieldClass("priority")}>
                <span id="request-priority-label">{t("Payment priority")} *</span>
                <div className="segmented-control priority-control" role="radiogroup" aria-labelledby="request-priority-label">
                  {requestPriorities.map((value) => <label key={value} data-level={value.toLowerCase()} className={form.priority === value ? "active" : undefined}><input type="radio" className="sr-only" name="request-priority" value={value} checked={form.priority === value} onChange={() => changeForm({ priority: value })} /><span>{t(requestPriorityLabels[value])}</span></label>)}
                </div>
                {fieldError("priority") || <small className="field-hint">{t(requestPriorityHints[form.priority] || requestPriorityHints.P3)} {t("It never skips an approval or a control.")}</small>}
              </div>
              <label className={fieldClass("dueDate")}><span>{t("Due date")}</span><DateInput min={todayIso()} value={form.dueDate} onChange={(event) => changeForm({ dueDate: event.target.value })} />{fieldError("dueDate") || <small className="field-hint">{t("When the supplier must be paid. P4 (and P3 when it comes first) is paid on the last payment day before it.")}</small>}</label>
              {["P1", "P2"].includes(form.priority) && <label className={`${fieldClass("urgencyJustification")} form-span-two`}><span>{t("Justification of the urgency")} *</span><textarea rows="2" value={form.urgencyJustification} onBlur={() => validateField("urgencyJustification")} onChange={(event) => changeForm({ urgencyJustification: event.target.value })} />{fieldError("urgencyJustification") || <small className="field-hint">{t("Why it cannot wait for the fortnightly payment. Urgent payments should stay at 10% or less.")}</small>}</label>}
              <label className={fieldClass("frequency")}><span>{t("Frequency")} *</span><select value={form.frequency} onChange={(event) => changeForm({ frequency: event.target.value })}>{requestFrequencies.map((value) => <option key={value} value={value}>{t(requestFrequencyLabels[value])}</option>)}</select>{fieldError("frequency") || <small className="field-hint">{t("Recorded with the request. Nothing is requested or paid again automatically.")}</small>}</label>
            </div>
          </WizardSection>

          <WizardSection title="Amount and budget">
            {payee === "supplier" && <div className="field"><span>{t("Cost center type")} *</span>
              <fieldset className="quick-choices compact-choices">
                <legend className="sr-only">{t("Cost center type")}</legend>
                <Choice name="cost-center-type" value="PROPIO" current={onBehalf ? "POR_ENCARGO" : "PROPIO"} icon={Building2} title="Own cost center" hint="Charged to your area's cost center." onChange={changeCostCenterType} />
                <Choice name="cost-center-type" value="POR_ENCARGO" current={onBehalf ? "POR_ENCARGO" : "PROPIO"} icon={Split} title="On behalf of another area" hint="For another school or department, charged to its cost center." onChange={changeCostCenterType} />
              </fieldset>
            </div>}
            {onBehalf && <CostAllocationEditor allocations={costAllocations} centers={masters.beneficiaryCenters} ownCostCenter={form.requesterCostCenter} total={totals.total} currency={form.currency} errors={errors} onChange={changeCostAllocations} onFieldBlur={validateField} />}
            <div className="form-grid two-column-form">
              <div className="field"><span>{t(onBehalf ? "Requesting area" : "Area")}</span><strong className="field-static">{user.area || "-"}</strong></div>
              {onBehalf
                ? <div className="field"><span>{t("Requesting CECO")}</span><strong className="field-static">{costCenter ? `${costCenter.code} - ${costCenter.name}` : "-"}</strong>{fieldError("requesterCostCenter")}</div>
                : masters.costCenters.length > 1
                ? <div><SearchSelect label="Cost Center / CECO" value={form.requesterCostCenter} options={masters.costCenters} onChange={setHeaderCostCenter} getOptionLabel={(item) => `${item.code} - ${item.name}${item.area ? ` (${item.area})` : ""}`} error={errors.requesterCostCenter} required searchPlaceholder="Search authorized CECO..." /><small className="field-hint">{ownCostCenterHint}</small></div>
                : <div className="field"><span>{t("Cost Center / CECO")}</span><strong className="field-static">{costCenter ? `${costCenter.code} - ${costCenter.name}` : "-"}</strong>{fieldError("requesterCostCenter")}</div>}
              <label className={fieldClass("issueDate")}><span>{t("Requirement date")} *</span><DateInput required max={todayIso()} value={form.issueDate} onChange={(event) => changeForm({ issueDate: event.target.value, accountingPeriod: event.target.value.slice(0, 7) })} onBlur={() => validateField("issueDate", "accountingPeriod")} aria-invalid={Boolean(errors.issueDate)} />{fieldError("issueDate") || <small className="field-hint">{t("Today in Lima unless the need started earlier.")}</small>}</label>
              <label className={fieldClass("accountingPeriod")}><span>{t("Request month")} *</span><select value={form.accountingPeriod} onChange={(event) => changeForm({ accountingPeriod: event.target.value })} onBlur={() => validateField("accountingPeriod")} aria-invalid={Boolean(errors.accountingPeriod)}><option value="">{t("Select")}</option>{masters.periods.map((period) => <option key={period._id} value={period.period} disabled={period.status !== "OPEN"}>{formatIsoMonth(period.period) || period.period} - {t(period.status)}</option>)}</select>{fieldError("accountingPeriod")}</label>
            </div>

            {simpleAmount ? <div className="form-grid two-column-form">
              <label className={fieldClass("lines.0.totalAmount")}><span>{t(igvExempt ? "Total amount" : "Total amount (IGV included)")} *</span><input type="number" inputMode="decimal" min="0" step="0.01" value={lines[0]?.unitPrice ?? ""} onChange={(event) => changeAmount(event.target.value)} onBlur={() => validateField("lines.0.totalAmount")} aria-invalid={Boolean(errors["lines.0.totalAmount"])} />{fieldError("lines.0.totalAmount") || fieldError("lines.0.costCenter")}</label>
              <label className={fieldClass("currency")}><span>{t("Currency")} *</span><select value={form.currency} onChange={(event) => changeForm({ currency: event.target.value })}>{currencies.map((currency) => <option key={currency} value={currency}>{t(currency === "USD" ? "Dollars (USD)" : "Soles (PEN)")}</option>)}</select>{fieldError("currency")}</label>
            </div> : <>
              <label className={`${fieldClass("currency")} field-narrow`}><span>{t("Currency")} *</span><select value={form.currency} onChange={(event) => changeForm({ currency: event.target.value })}>{currencies.map((currency) => <option key={currency} value={currency}>{t(currency === "USD" ? "Dollars (USD)" : "Soles (PEN)")}</option>)}</select></label>
              {errors.lines && <small className="field-error-text">{t(errors.lines)}</small>}
              <MotionList className="official-line-list">{lines.map((line, index) => <RequestItemLine key={line.clientId} line={line} index={index} currency={form.currency} errors={errors} onChange={(patch) => updateLine(index, patch)} onFieldBlur={(field) => validateField(`lines.${index}.${field}`)} canRemove={lines.length > 1} onRemove={() => setLines((current) => current.filter((_, currentIndex) => currentIndex !== index))} />)}</MotionList>
              <button type="button" className="secondary-button" onClick={() => setLines((current) => [...current, emptyLine(form.requesterCostCenter)])}><Plus size={16} aria-hidden="true" /><span>{t("Add line")}</span></button>
            </>}
            {simpleAmount && <button type="button" className="text-button" onClick={() => setShowItems(true)}><ListPlus size={15} aria-hidden="true" />{t("Detail it by items")}</button>}
            <div className="request-items-total"><span>{t("Request total")}</span><strong>{formatCurrency(totals.total, form.currency, language)}</strong></div>
            {currencyMismatch && <div className="inline-alert alert-warning"><AlertTriangle size={16} aria-hidden="true" /><span>{t("The account is in {account} and the request in {request}. Nothing is converted: choose an account in {request} or change the currency.").replace("{account}", selectedAccount.currency).replaceAll("{request}", form.currency)}</span></div>}
            {!onBehalf && masters.costCenters.length > 1 && lines.length > 1 && <details className="request-budget-adjustments" open={Object.keys(errors).some(key => /lines\.\d+\.costCenter/.test(key)) ? true : undefined}>
              <summary>{t("Adjust budget allocation")}</summary>
              <p className="section-note">{t("Items inherit the request's cost center. Adjust only when an item uses a different cost center budget.")}</p>
              {lines.map((line, index) => <div className="request-budget-line" key={line.clientId}><strong>{t("Item")} {index + 1}: {line.itemDescription || t("Item / service description")}</strong><div className="form-grid two-column-form"><SearchSelect label="Cost Center / CECO" value={line.costCenter} options={masters.costCenters} onChange={value => updateLine(index, { costCenter: value })} getOptionLabel={item => item.code + " - " + item.name} error={errors["lines." + index + ".costCenter"]} required searchPlaceholder="Search authorized CECO..." /></div></div>)}
            </details>}
            <BudgetRemainingSummary payload={budgetPayload} preview={budgetPreview} loading={budgetLoading} onRefresh={() => setBudgetRefresh(value => value + 1)} />
          </WizardSection>

          {payee === "supplier" && <div className="wizard-section">
            {quotations.some(q => q.recommended && q.paymentCondition)
              ? <PaymentTermsSummary terms={quotations.find(q => q.recommended)} />
              : <SupplierPaymentCondition value={form.supplierPaymentTerms} onChange={value => changeForm({ supplierPaymentTerms: value })} amount={totals.total} currency={form.currency} />}
            {Object.entries(errors).filter(([key]) => key.startsWith("supplierPaymentTerms.")).map(([key, message]) => <small key={key} className="field-error-text">{t(message)}</small>)}
          </div>}
          {form.requestType === "CAPEX" && payee === "supplier" && <div className="form-grid two-column-form">
            <label className={fieldClass("businessCaseCode")}><span>{t("Business case code")} *</span><input value={capex.businessCaseCode} placeholder="CN-2026-014" onChange={(event) => { clearErrors(["businessCaseCode"]); setCapex((current) => ({ ...current, businessCaseCode: event.target.value.toUpperCase() })); }} />{fieldError("businessCaseCode") || <small className="field-hint">{t("From the business case app, with the decision Viable or Ejecutar.")}</small>}</label>
          </div>}
          {form.requestType === "CAPEX" && <details className="official-subsection capex-details" open={capexOpen || undefined}><summary><strong>{t("CAPEX financial information")}</strong><small>{t(capexOpen ? "Planning information is recorded only; no depreciation or NPV calculation is generated." : "Optional for this amount: Budget or Accounting can complete it.")}</small></summary><div className="form-grid three-column-form">
            <label className="field"><span>{t("Project / PEP")}</span><select value={capex.projectId} onChange={(event) => { const project = masters.projects.find((item) => item._id === event.target.value); setCapex((current) => ({ ...current, projectId: event.target.value, projectPep: project?.code || current.projectPep })); }}><option value="">{t("No project")}</option>{masters.projects.map((project) => <option key={project._id} value={project._id}>{project.code} - {project.name}</option>)}</select></label>
            <label className="field"><span>{t("Fixed asset category")}</span><select value={capex.assetCategory} onChange={(event) => setCapex((current) => ({ ...current, assetCategory: event.target.value }))}><option value="">{t("Select")}</option>{["INFRASTRUCTURE", "MACHINERY", "IT_HARDWARE", "SOFTWARE_LICENSES"].map((value) => <option key={value} value={value}>{t(value)}</option>)}</select></label>
            <label className="field"><span>{t("Useful life (years)")}</span><input type="number" min="0" step="1" value={capex.usefulLifeYears} onChange={(event) => setCapex((current) => ({ ...current, usefulLifeYears: event.target.value }))} /></label>
            <label className="field"><span>{t("NPV / VAN amount")}</span><input type="number" step="0.01" value={capex.npvAmount} onChange={(event) => setCapex((current) => ({ ...current, npvAmount: event.target.value }))} /></label>
            <label className="field"><span>{t("NPV currency")}</span><select value={capex.npvCurrency} onChange={(event) => setCapex((current) => ({ ...current, npvCurrency: event.target.value }))}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
            <div className="field"><span>{t("Payback")}</span><div className="compound-field"><input aria-label={t("Payback value")} type="number" min="0" step="0.01" value={capex.paybackValue} onChange={(event) => setCapex((current) => ({ ...current, paybackValue: event.target.value }))} /><select aria-label={t("Payback unit")} value={capex.paybackUnit} onChange={(event) => setCapex((current) => ({ ...current, paybackUnit: event.target.value }))}><option value="MONTHS">{t("Months")}</option><option value="YEARS">{t("Years")}</option></select></div></div>
          </div></details>}

          {extraDocuments.length > 0 && <WizardSection icon={Paperclip} title="Documents this type of expense needs">
            {extraDocuments.map(({ rule, definition }) => <label key={definition.key} className={`quick-file${errors[definition.key] ? " field-error" : ""}${files[definition.key]?.length || existingAttachments.some((item) => item.kind === definition.kind) ? " is-attached" : ""}`}>
              <Paperclip size={18} aria-hidden="true" />
              <span><strong>{t(definition.label)} *</strong><small>{files[definition.key]?.length ? files[definition.key].map((file) => file.name).join(", ") : existingAttachments.some((item) => item.kind === definition.kind) ? t("Attached") : t(rule.labelKey || "Required document")}</small></span>
              <input type="file" accept={definition.accept} multiple={definition.multiple} aria-label={t(definition.label)} onChange={(event) => { clearErrors([definition.key]); const chosen = Array.from(event.target.files || []); setFiles((current) => ({ ...current, [definition.key]: chosen })); event.target.value = ""; }} />
              {fieldError(definition.key)}
            </label>)}
          </WizardSection>}

          <details className="request-optional-fields">
            <summary><span>{t("More details (optional)")}</span></summary>
            <div className="form-grid two-column-form">
              <label className="field form-span-two"><span>{t("Additional observations")}</span><textarea rows="2" value={form.observations} onChange={(event) => changeForm({ observations: event.target.value })} /></label>
              <label className="field form-span-two"><span>{t("Risk if not approved")}</span><textarea rows="2" value={form.nonApprovalRisk} onChange={(event) => changeForm({ nonApprovalRisk: event.target.value })} /></label>
              <label className="field"><span>{t("Requirement title")}</span><input value={form.title} onChange={(event) => changeForm({ title: event.target.value })} /><small className="field-hint">{t("If left empty, the first line of the description is used.")}</small></label>
              <label className="field"><span>{t("Area correlative")}</span><input value={form.areaCorrelative} onChange={(event) => changeForm({ areaCorrelative: event.target.value })} /></label>
            </div>
          </details>
          {trackText && <p className="quick-track" role="status"><strong>{t("How it goes")}:</strong> {t(trackText)}</p>}
        </div>}

        {stepId === "review" && <div className="wizard-step">
          <div className="section-heading"><div><h3>{t("Summary and submit")}</h3><p>{t("Check everything once. Change any part without starting again.")}</p></div></div>
          {payee === "supplier" && invoiceCheck?.invoice && <InvoiceMatchStrip invoice={invoiceCheck.invoice} form={form} totals={totals} supplier={selectedSupplier} flowType={form.flowType} />}
          <RequestReview form={form} capex={capex} lines={lines} costAllocations={onBehalf ? costAllocations : []} quotations={quotations.filter(quotationHasData)} quotationFiles={quotationFiles} files={files} existingAttachments={existingAttachments} masters={masters} totals={totals} budgetPreview={budgetPreview} selectedSupplier={selectedSupplier} selectedAccount={selectedAccount} invoice={payee === "supplier" ? { attached: invoiceAttached, ...invoiceDetails } : null} onEdit={goToStep} />
        </div>}

        </MotionSurface>
      {["details", "review"].includes(stepId) && <SubmissionPreviewPanel payload={previewPayload} enabled={hydrated && totals.total > 0} />}
      <div className="wizard-error"><Message type="error">{error}</Message></div>
      <footer className="wizard-actions"><button type="button" className="secondary-button" disabled={step === 0 || saving} onClick={() => goToStep(stepIds[Math.max(0, step - 1)])}><ChevronLeft size={16} /><span>{t("Back")}</span></button><div className="wizard-actions-right"><button type="button" className="secondary-button" disabled={saving || !draft.ready || draft.status === "conflict"} onClick={() => save(false)}><Save size={16} /><span>{t(saving ? "Saving..." : "Save draft")}</span></button>{stepId !== "review" ? <button type="button" className="primary-button" onClick={nextStep}><span>{t("Continue")}</span><ChevronRight size={16} /></button> : <button type="button" className="primary-button" disabled={saving || !draft.ready || draft.status === "conflict"} onClick={() => save(true)}><Send size={16} /><span>{t(saving ? "Submitting..." : "Submit request")}</span></button>}</div></footer>
      </div>
    </div>
    </DraftPanel>
  </section>;
}
