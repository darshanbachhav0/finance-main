import ReadinessPanel from "../components/ReadinessPanel.jsx";
import MotionSurface from "../components/MotionSurface.jsx";
import { validationSummary } from "../utils/validationMessages.js";
import MotionList from "../components/MotionList.jsx";
import useWorkDraft from "../hooks/useWorkDraft.js";
import DraftPanel from "../components/DraftPanel.jsx";
import ContinueWork from "../components/ContinueWork.jsx";
import UploadedFileList, { openLocalFile } from "../components/UploadedFileList.jsx";
import ProtectedAssetButton from "../components/ProtectedAssetButton.jsx";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileCheck2,
  FileText,
  Plus,
  Save,
  Send,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import api from "../api/client.js";
import Message from "../components/Message.jsx";
import RequestItemLine from "../components/RequestItemLine.jsx";
import DateInput from "../components/DateInput.jsx";
import RequestFormBlock from "../components/RequestFormBlock.jsx";
import { OPTIONAL_REQUEST_FIELDS, REQUEST_FORM_BLOCKS, isRequestFormField, requestBlockStatuses } from "../utils/requestFormBlocks.js";
import { openPeriodError, positiveAmountError, requiredError } from "../utils/fieldValidation.js";
import { formatIsoMonth, todayIso } from "../utils/dateInput.js";
import { restoreEditorLine, editRequestLine, requestLinePayload } from "../utils/requestLineEditor.js";
import PageHeader from "../components/PageHeader.jsx";
import WorkspaceSkeleton from "../components/WorkspaceSkeleton.jsx";
import SearchSelect from "../components/SearchSelect.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import QuotationPaymentTerms from "../components/QuotationPaymentTerms.jsx";
import QuotationComparison from "../components/QuotationComparison.jsx";
import RequestReview from "../components/RequestReview.jsx";
import BudgetRemainingSummary from "../components/BudgetRemainingSummary.jsx";
import { normalizePaymentTerms, validatePaymentTerms } from "../../../shared/paymentTerms.mjs";
import WorkflowStepper from "../components/WorkflowStepper.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { formatCurrency } from "../utils/formatters.js";
import { coversKind, isAnyDocument, isEitherOf, isQuoteOrInvoice, presentCount, ruleForKind } from "../utils/documentRequirements.js";
import InvoiceDropZone from "../components/InvoiceDropZone.jsx";
import InvoiceMatchStrip from "../components/InvoiceMatchStrip.jsx";
import TrackPicker from "../components/TrackPicker.jsx";
import QuickRequestForm, { quickExtraDocuments } from "../components/QuickRequestForm.jsx";
import { invoiceFileKey, linesFromInvoice } from "../utils/invoiceAutofill.js";
import { defaultOpenPeriod, quickTrack, showCapexDetails, titleFromDescription } from "../utils/quickRequest.js";
import { celebrate } from "../utils/celebrate.js";
import {
  currencies,
  expenditureClassificationLabels,
  expenseNatureLabels,
  flowTypeLabels,
  flowTypes,
  expenseNatures,
  optionLabel,
  requestCreationClassifications,
  requestPriorities,
  requestTypeForFlow,
  trackCRequestTypeLabels,
  trackCRequestTypes
} from "../utils/options.js";

// Steps by id. "need" and "budget" used to be one long first step; Track C pays the requester,
// so it has no Supplier step.
const STEP_LABELS = { need: "What and why", budget: "Budget and items", supplier: "Supplier", documents: "Documents", review: "Review and submit" };
const stepsFor = (flowType) => flowType === "C" ? ["need", "budget", "documents", "review"] : ["need", "budget", "supplier", "documents", "review"];
// Drafts saved before the split stored a step index into this list.
const LEGACY_STEPS = ["need", "supplier", "documents", "review"];
const officialTypes = new Set(["CAPEX", "OPEX"]);
const blockInfo = Object.fromEntries(REQUEST_FORM_BLOCKS.map(({ id, title, description }) => [id, { id, title, description }]));
const supplierStatus = (supplier) => supplier?.homologationStatus || supplier?.status || "PENDING_VALIDATION";
const supplierName = (supplier) => supplier?.legalName || supplier?.name || "";
const supplierId = (value) => value?._id || value || "";
// The simple form's answers (see QuickRequestForm): who gets the money, what the requester has
// from the supplier, what an employee needs, whether it is CAPEX, and the amount as typed.
const initialQuick = { payee: "supplier", route: "order", employeeNeed: "advance", capex: false, amount: "" };
const quickFromForm = (form = {}, amount = "") => ({ payee: form.flowType === "C" ? "employee" : "supplier", route: form.flowType === "B" ? "direct" : "order", employeeNeed: form.requestType === "REEMBOLSO_SIN_SUSTENTO" ? "reimbursement" : "advance", capex: form.requestType === "CAPEX", amount });
const attachmentId = (value) => value?._id || value || "";

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
    priority: "MEDIA",
    requesterCostCenter: "",
    schoolOrDepartment: "",
    areaCorrelative: "",
    issueDate: today,
    accountingPeriod: today.slice(0, 7),
    currency: "PEN",
    supplier: "",
    title: "",
    detailedDescription: "",
    businessJustification: "",
    nonApprovalRisk: "",
    description: "",
    supplierSelectionReason: ""
  };
}

const initialCapex = {
  projectPep: "",
  projectId: "",
  assetCategory: "",
  usefulLifeYears: "",
  npvAmount: "",
  npvCurrency: "PEN",
  paybackValue: "",
  paybackUnit: "MONTHS"
};

// "Repeat this request" copies the need, supplier, cost centers and amounts into a new draft dated
// today. Documents, quotations and their evidence stay with the original: each request has its own.
function copiedRequestForm(request) {
  const today = todayIso();
  const flowType = request.flowType || (trackCRequestTypes.includes(request.requestType) ? "C" : "A1");
  const capexDetails = request.capexDetails || {};
  return {
    form: {
      ...initialForm(),
      flowType,
      requestType: requestTypeForFlow(flowType, request.requestType),
      expenseNature: request.expenseNature || "SERVICES",
      priority: request.priority || "MEDIA",
      requesterCostCenter: supplierId(request.requesterCostCenter),
      schoolOrDepartment: request.schoolOrDepartment || "",
      areaCorrelative: "",
      issueDate: today,
      accountingPeriod: today.slice(0, 7),
      currency: request.currency || "PEN",
      supplier: flowType === "C" ? "" : supplierId(request.supplier),
      title: request.title || "",
      detailedDescription: request.detailedDescription || request.description || "",
      businessJustification: request.businessJustification || "",
      nonApprovalRisk: request.nonApprovalRisk || "",
      description: request.description || "",
      supplierSelectionReason: request.supplierSelectionReason || ""
    },
    capex: {
      ...initialCapex,
      projectPep: capexDetails.projectPep || "",
      projectId: supplierId(capexDetails.projectSnapshot?.id),
      assetCategory: capexDetails.assetCategory || "",
      usefulLifeYears: capexDetails.usefulLifeYears ?? "",
      npvAmount: capexDetails.npv?.amount ?? "",
      npvCurrency: capexDetails.npv?.currency || request.currency || "PEN",
      paybackValue: capexDetails.payback?.value ?? "",
      paybackUnit: capexDetails.payback?.unit || "MONTHS"
    },
    opexFrequency: request.opexDetails?.expenseFrequency || "ONE_OFF",
    lines: (request.lines || []).map((line) => ({
      clientId: `${Date.now()}-${Math.random()}`,
      itemDescription: line.itemDescription || "",
      quantity: line.quantity ?? "",
      unitOfMeasure: line.unitOfMeasure || "",
      unitPrice: line.unitPrice ?? "",
      priceIncludesIGV: line.priceIncludesIGV,
      costCenter: supplierId(line.costCenter),
      budgetItem: line.budgetItem || "",
      projectId: line.projectId || "",
      netAmount: line.netAmount,
      igvAmount: line.igvAmount,
      totalAmount: line.totalAmount
    }))
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

export default function RequestCreate() {
  const [showOptionalDocuments, setShowOptionalDocuments] = useState(false);
  const { id } = useParams();
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const isEditing = Boolean(id);
  const [masters, setMasters] = useState({ suppliers: [], costCenters: [], projects: [], periods: [] });
  const [form, setForm] = useState(initialForm);
  const [capex, setCapex] = useState(initialCapex);
  const [opexFrequency, setOpexFrequency] = useState("ONE_OFF");
  const [lines, setLines] = useState([emptyLine()]);
  const [quotations, setQuotations] = useState([]);
  const [quotationFiles, setQuotationFiles] = useState({});
  const [files, setFiles] = useState(Object.fromEntries(documentDefinitions.map((item) => [item.key, []])));
  // Files already on the request; the ones marked for removal leave it when the form is saved.
  const [storedAttachments, setStoredAttachments] = useState([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState([]);
  const existingAttachments = storedAttachments.filter((item) => !removedAttachmentIds.includes(String(item._id)));
  const [formPolicy, setFormPolicy] = useState({ documentRequirements: [], quotationPolicy: { enabled: false, minimumCount: 1 } });
  const [budgetPreview, setBudgetPreview] = useState({ status: "PENDING_VALIDATION", lines: [] });
  const [budgetRefresh, setBudgetRefresh] = useState(0);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [stepId, setStepId] = useState("need");
  // New requests open the simple three-question form; editing, a copied request or a draft saved
  // from the full form open the full form. Either one can switch to the other at any time.
  const [mode, setMode] = useState(() => (id || new URLSearchParams(location.search).get("from") ? "full" : "quick"));
  const [quick, setQuick] = useState(initialQuick);
  const [visitedSteps, setVisitedSteps] = useState(["need"]);
  const [completedSteps, setCompletedSteps] = useState([]);
  const [errors, setErrors] = useState({});
  const [blurredFields, setBlurredFields] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [hydratedRecord, setHydratedRecord] = useState(null);
  const [sourceVersion, setSourceVersion] = useState("");
  // The supplier's factura read on this form (dropped in step 1 or attached in Documents):
  // { status: "reading" | "done" | "error", fileName, file, invoice, supplier, source, error }.
  const [invoiceCheck, setInvoiceCheck] = useState(null);
  const repeatFrom = !isEditing ? new URLSearchParams(location.search).get("from") : null;
  const validationFocusRef = useRef(null);
  useEffect(() => () => window.cancelAnimationFrame(validationFocusRef.current), []);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const calls = [
          api.get("/suppliers", { params: { pageSize: 100 } }),
          api.get("/requests/authorized-cost-centers"),
          api.get("/projects", { params: { pageSize: 100, active: true } }),
          api.get("/accounting-periods", { params: { pageSize: 100 } })
        ];
        if (isEditing) calls.push(api.get(`/requests/${id}`));
        else if (repeatFrom) calls.push(api.get(`/requests/${repeatFrom}`).catch(() => null));
        const [suppliersResponse, centersResponse, projectsResponse, periodsResponse, requestResponse] = await Promise.all(calls);
        if (!active) return;
        const nextMasters = {
          suppliers: suppliersResponse.data.data,
          costCenters: centersResponse.data.data,
          projects: projectsResponse.data.data.filter((item) => item.active),
          periods: periodsResponse.data.data
        };
        setMasters(nextMasters);

        if (requestResponse && isEditing) {
          const request = requestResponse.data.data;
          setSourceVersion(request.updatedAt || "");
          const owner = request.requester?._id || request.solicitor?._id;
          if (!request.allowedActions?.includes("EDIT") || (user.role !== "Admin" && owner !== user._id)) {
            navigate(`/requests/${id}`, { replace: true });
            return;
          }
          const requestFlowType = request.flowType || (trackCRequestTypes.includes(request.requestType) ? "C" : "A1");
          const serverForm = {
            ...initialForm(),
            flowType: requestFlowType,
            requestType: requestTypeForFlow(requestFlowType, request.requestType),
            expenseNature: request.expenseNature || "SERVICES",
            priority: request.priority || "MEDIA",
            requesterCostCenter: supplierId(request.requesterCostCenter),
            schoolOrDepartment: request.schoolOrDepartment || "",
            areaCorrelative: request.areaCorrelative || "",
            issueDate: request.issueDate.slice(0, 10),
            accountingPeriod: request.accountingPeriod,
            currency: request.currency,
            supplier: supplierId(request.supplier),
            title: request.title || "",
            detailedDescription: request.detailedDescription || request.description || "",
            businessJustification: request.businessJustification || "",
            nonApprovalRisk: request.nonApprovalRisk || "",
            description: request.description || "",
            supplierSelectionReason: request.supplierSelectionReason || ""
          };
          const serverLines = (request.lines || []).map((line) => ({
            clientId: line._id,
            itemDescription: line.itemDescription || "",
            quantity: line.quantity ?? "",
            unitOfMeasure: line.unitOfMeasure || "",
            unitPrice: line.unitPrice ?? "",
            priceIncludesIGV: line.priceIncludesIGV,
            costCenter: supplierId(line.costCenter),
            budgetItem: line.budgetItem || "",
            projectId: line.projectId || "",
            netAmount: line.netAmount,
            igvAmount: line.igvAmount,
            totalAmount: line.totalAmount
          }));
          const serverQuotations = (request.quotations || []).map((quotation) => ({
            clientId: quotation._id,
            supplier: supplierId(quotation.supplier),
            amount: quotation.amount ?? "",
            currency: quotation.currency || request.currency,
            deliveryPeriod: quotation.deliveryPeriod || "",
            ...normalizePaymentTerms(quotation),
            commercialConditions: quotation.commercialConditions || "",
            attachment: attachmentId(quotation.attachment),
            recommended: Boolean(quotation.recommended)
          }));
          const capexDetails = request.capexDetails || {};
          const serverCapex = {
            projectPep: capexDetails.projectPep || "",
            projectId: supplierId(capexDetails.projectSnapshot?.id),
            assetCategory: capexDetails.assetCategory || "",
            usefulLifeYears: capexDetails.usefulLifeYears ?? "",
            npvAmount: capexDetails.npv?.amount ?? "",
            npvCurrency: capexDetails.npv?.currency || request.currency,
            paybackValue: capexDetails.payback?.value ?? "",
            paybackUnit: capexDetails.payback?.unit || "MONTHS"
          };
          setForm(serverForm);
          setCapex(serverCapex);
          setOpexFrequency(request.opexDetails?.expenseFrequency || "ONE_OFF");
          setLines(serverLines.map(restoreEditorLine));
          setQuotations(serverQuotations);
          setStoredAttachments(request.attachments || []);
        } else if (requestResponse?.data?.data) {
          const source = requestResponse.data.data;
          const copy = copiedRequestForm(source);
          setForm(copy.form);
          setCapex(copy.capex);
          setOpexFrequency(copy.opexFrequency);
          setLines(copy.lines.map(restoreEditorLine));
          notify(t("Copied from {request}. Check the amounts and attach this request's documents.").replace("{request}", source.requestNumber), "info");
        } else {
          // Filled in from what the platform already knows: the requester's cost center (or the only
          // one they may use), their unit, and an open month.
          const defaultCenter = supplierId(user.costCenter) || nextMasters.costCenters[0]?._id || "";
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

  // Advances and reimbursements (Track C) are not invoices: their lines carry no IGV, so the
  // amount typed is the amount paid. Lines follow the track as the answers change it.
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
      .then((response) => {
        if (!active) return;
        const policy = response.data.data;
        setFormPolicy(policy);
        if (policy.quotationPolicy?.enabled) {
          setQuotations((current) => {
            if (current.length) return current;
            // At least one quotation is required; the requester adds or removes more freely.
            return Array.from({ length: Math.max(1, policy.quotationPolicy.minimumCount || 1) }, emptyQuotation);
          });
        } else {
          setQuotations((current) => current.some(quotationHasData) ? current : []);
        }
      })
      .catch((err) => active && setError(err.message));
    return () => { active = false; };
  }, [form.flowType, form.requestType, form.expenseNature, hydrated]);

  // "New request" always opens a blank request; unfinished ones are listed above it.
  const draft = useWorkDraft({ scope: "request", recordId: id || "new", title: String(form.title || "").trim() || "Financial request", resumeLatest: isEditing, enabled: hydrated && !loading && hydratedRecord === (id || "new"), sourceVersion,
    value: { form, capex, opexFrequency, lines, quotations, files, quotationFiles, removedAttachmentIds, stepId, visitedSteps, completedSteps, mode, quick },
    restore: data => {
      if (!data) return;
      setForm(data.form); setCapex(data.capex); setOpexFrequency(data.opexFrequency); setLines(data.lines.map(restoreEditorLine)); setQuotations(data.quotations); setFiles(data.files || Object.fromEntries(documentDefinitions.map(item => [item.key, []]))); setQuotationFiles(data.quotationFiles || {}); setRemovedAttachmentIds(data.removedAttachmentIds || []);
      const legacy = (index) => LEGACY_STEPS[index] || "need";
      setStepId(data.stepId || legacy(data.step || 0));
      setVisitedSteps(data.visitedSteps || LEGACY_STEPS.slice(0, (data.maxStep || 0) + 1));
      setCompletedSteps((data.completedSteps || []).map((item) => typeof item === "number" ? legacy(item) : item));
      // Drafts from before the simple form were made with the full form.
      setMode(data.mode || "full");
      // Drafts from before "how is it paid?" carried evidence: invoice meant direct payment.
      const saved = data.quick && !data.quick.route ? { ...data.quick, route: data.quick.evidence === "invoice" ? "direct" : "order" } : data.quick;
      setQuick({ ...initialQuick, ...(saved || quickFromForm(data.form)) });
    }
  });
  useEffect(() => { if (draft.ready) void draft.flush(); }, [stepId]);
  // The address names the saved new-request draft, so a reload or a return link reopens it.
  // history.replaceState keeps the router (and this form) as they are.
  const draftSearch = draft.session.revision ? `?${new URLSearchParams({ workDraft: draft.session.id, workScope: "request", workRecord: "new" })}` : "";
  useEffect(() => {
    if (isEditing || !draft.ready) return;
    if (window.location.search !== draftSearch) window.history.replaceState(window.history.state, "", `${location.pathname}${draftSearch}`);
  }, [isEditing, draft.ready, draftSearch]);
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
  // A supplier registered from this form is linked once the draft has been restored.
  const createdSupplier = useRef(location.state?.createdSupplierId || "");
  useEffect(() => {
    const createdSupplierId = createdSupplier.current;
    if (!draft.ready || !createdSupplierId) return;
    createdSupplier.current = "";
    setForm((current) => ({ ...current, supplier: current.supplier || createdSupplierId }));
    setQuotations((current) => {
      const target = current.length ? current : [emptyQuotation()];
      const emptyIndex = target.findIndex((item) => !item.supplier);
      return target.map((item, index) => index === (emptyIndex < 0 ? 0 : emptyIndex) ? { ...item, supplier: createdSupplierId } : item);
    });
    notify("Supplier proposal linked to the request quotation.", "success");
    ownNavigation.current = true;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [draft.ready]);

  const budgetPayload = useMemo(() => ({
    flowType: form.flowType, requestType: form.requestType, expenseNature: form.expenseNature,
    issueDate: form.issueDate, accountingPeriod: form.accountingPeriod, currency: form.currency,
    project: form.requestType === "CAPEX" ? capex.projectPep || masters.projects.find(item => item._id === capex.projectId)?.code : undefined,
    lines: lines.map(requestLinePayload)
  }), [form.flowType, form.requestType, form.expenseNature, form.issueDate, form.accountingPeriod, form.currency, capex.projectPep, capex.projectId, masters.projects, lines]);

  useEffect(() => {
    if (!hydrated || !form.accountingPeriod || lines.some((line) => !line.costCenter || !(Number(line.totalAmount) > 0))) {
      setBudgetPreview({ status: "PENDING_VALIDATION", lines: [] });
      setBudgetLoading(false);
      return undefined;
    }
    let active = true;
    setBudgetLoading(true);
    const timer = window.setTimeout(async () => {
      setBudgetLoading(true);
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

  const selectedSupplier = masters.suppliers.find((supplier) => supplier._id === form.supplier);
  const officialRequest = form.flowType === "A1" && officialTypes.has(form.requestType);
  const quotationPolicy = formPolicy.quotationPolicy || { enabled: false, minimumCount: 1 };
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

  // Reads a factura with the platform's own reader (nothing is stored until the request is saved).
  // `fill`: the factura was dropped to start the request, so an empty form takes its supplier,
  // currency and amounts; otherwise it is only compared with what was typed.
  async function readInvoice(file, { fill = false } = {}) {
    if (!file) return;
    setInvoiceCheck({ status: "reading", fileName: file.name, file });
    try {
      const data = new FormData();
      data.append(invoiceFileKey(file), file);
      const response = await api.post("/requests/invoice-preview", data, { headers: { "Content-Type": "multipart/form-data" } });
      const result = { status: "done", fileName: file.name, file, ...response.data.data };
      setInvoiceCheck(result);
      if (fill) applyInvoice(result);
    } catch (err) {
      setInvoiceCheck({ status: "error", fileName: file.name, file, error: err.message });
    }
  }

  // Track B carries its invoice, so the dropped file becomes the request's XML / factura PDF.
  function attachInvoiceFile(file) {
    if (!file) return;
    setFiles((current) => ({ ...current, [invoiceFileKey(file)]: [file] }));
  }

  function applyInvoice({ invoice, supplier, file }) {
    if (supplier?._id) setMasters((current) => current.suppliers.some((item) => item._id === supplier._id) ? current : { ...current, suppliers: [...current.suppliers, supplier] });
    const label = t("Invoice {number} from {supplier}").replace("{number}", invoice.invoiceNumber || "").replace("{supplier}", supplier?.legalName || supplier?.name || `RUC ${invoice.ruc || "-"}`);
    setForm((current) => ({
      ...current,
      currency: invoice.currency || current.currency,
      supplier: current.flowType !== "C" && supplier?._id ? supplier._id : current.supplier,
      title: current.title || label,
      detailedDescription: current.detailedDescription || label,
      description: current.description || label
    }));
    // The simple form always takes the invoice's items: its amount was only typed to start with.
    const fill = linesAreEmpty || mode === "quick";
    if (fill && Number(invoice.totalAmount) > 0) {
      const invoiceLines = linesFromInvoice(invoice, { costCenter: form.requesterCostCenter, description: label });
      setLines(invoiceLines);
      setQuick((current) => ({ ...current, amount: String(invoice.totalAmount) }));
    }
    if (form.flowType !== "C") attachInvoiceFile(file);
    notify(fill ? "Filled from the invoice: check the supplier, currency and amounts." : "Invoice read. Your amounts were kept; compare them with the invoice in the next step.", "info");
  }

  function setHeaderCostCenter(value) {
    setForm((current) => {
      const previous = current.requesterCostCenter;
      setLines((currentLines) => currentLines.map((line) => ({ ...line, costCenter: !line.costCenter || line.costCenter === previous ? value : line.costCenter })));
      return { ...current, requesterCostCenter: value };
    });
  }

  function updateLine(index, patch) {
    window.cancelAnimationFrame(validationFocusRef.current);
    setLines((current) => current.map((line, currentIndex) => currentIndex === index ? editRequestLine(line, patch) : line));
    setErrors(current => {
      const next = { ...current };
      Object.keys(patch).forEach(field => delete next[`lines.${index}.${field}`]);
      if (["quantity", "unitPrice", "priceIncludesIGV"].some(field => Object.hasOwn(patch, field))) delete next[`lines.${index}.totalAmount`];
      return next;
    });
  }

  function updateQuotation(index, patch) {
    window.cancelAnimationFrame(validationFocusRef.current);
    setErrors(current => {
      const next = { ...current };
      Object.keys(patch).forEach(field => delete next[`quotations.${index}.${field}`]);
      return next;
    });
    setQuotations((current) => current.map((quotation, currentIndex) => {
      if (patch.recommended === true) return { ...quotation, recommended: currentIndex === index };
      return currentIndex === index ? { ...quotation, ...patch } : quotation;
    }));
    if (patch.recommended === true) {
      const nextSupplier = quotations[index]?.supplier;
      if (nextSupplier) setForm((current) => ({ ...current, supplier: nextSupplier }));
    }
  }

  // A1 and B are sent with a quote, the invoice, or both.
  const invoiceAttached = ["xml", "pdf", "feeReceipt"].some((key) => files[key]?.length) || existingAttachments.some((item) => ["XML", "PDF", "FEE_RECEIPT"].includes(item.kind));
  const quotedWithEvidence = quotations.filter((quotation) => quotationFiles[quotation.clientId] && !quotation.attachment).length;

  function validationForStep(id, submitting) {
    const next = {};
    if (id === "need") {
      ["requestType", "expenseNature", "priority", "description"].forEach((field) => {
        if (!String(form[field] || "").trim()) next[field] = "This field is required.";
      });
      if (["A1", "B"].includes(form.flowType) && !requestCreationClassifications.includes(form.requestType)) {
        next.requestType = "Select CAPEX or OPEX.";
      }
      if (form.flowType === "C" && !trackCRequestTypes.includes(form.requestType)) {
        next.requestType = "Select an advance to render or an undocumented reimbursement.";
      }
      // The title defaults to the description's first line and the risk is optional (one "why").
      if (officialRequest && submitting) {
        [["detailedDescription", "Detailed description is required."], ["businessJustification", "Business justification is required."]].forEach(([field, message]) => {
          if (!String(form[field] || "").trim()) next[field] = message;
        });
      }
    }
    if (id === "budget") {
      ["requesterCostCenter", "issueDate", "accountingPeriod", "currency"].forEach((field) => {
        if (!String(form[field] || "").trim()) next[field] = "This field is required.";
      });
      const period = masters.periods.find((item) => item.period === form.accountingPeriod);
      if (form.accountingPeriod && (!period || period.status !== "OPEN")) next.accountingPeriod = "Accounting period must be open.";
      if (!lines.length) next.lines = "At least one request line is required.";
      lines.forEach((line, lineIndex) => {
        if (!String(line.itemDescription || "").trim() && (!line.legacyAmounts || officialRequest && submitting)) next[`lines.${lineIndex}.itemDescription`] = "Item description is required.";
        if (!line.costCenter) next[`lines.${lineIndex}.costCenter`] = "Select a Cost Center.";
        if (!(Number(line.totalAmount) > 0)) next[`lines.${lineIndex}.totalAmount`] = "Total must be greater than zero.";
        if (!line.legacyAmounts) {
          if (!(Number(line.quantity) > 0) || !Number.isFinite(Number(line.quantity))) next[`lines.${lineIndex}.quantity`] = "Enter a valid quantity.";
          if (!(Number(line.unitPrice) > 0) || !Number.isFinite(Number(line.unitPrice))) next[`lines.${lineIndex}.unitPrice`] = "Enter a valid unit price.";
          if (!line.unitOfMeasure) next[`lines.${lineIndex}.unitOfMeasure`] = "Select a unit of measure.";
          if (line.calculationError) next[`lines.${lineIndex}.${line.calculationError.includes("quantity") || line.calculationError.includes("Quantity") ? "quantity" : "unitPrice"}`] = line.calculationError;
        }
      });
    }
    if (id === "supplier") {
      if (["A1", "B"].includes(form.flowType)) quotations.forEach((quotation, quoteIndex) => {
        validatePaymentTerms(quotation, { requireComplete: submitting }).forEach(({ field, message }) => {
          next[`quotations.${quoteIndex}.${field}`] = message;
        });
      });
      // A1 and B: a quote or the invoice, at least one. With only the invoice there is nothing to
      // compare; any quotation that was started is checked in full.
      const invoiceOnly = quotationPolicy.invoiceInstead && invoiceAttached && !quotations.some(quotationHasData);
      if (quotationPolicy.enabled && submitting && !invoiceOnly) {
        if (new Set(quotations.map((item) => item.supplier).filter(Boolean)).size < quotationPolicy.minimumCount) next.quotations = quotationPolicy.invoiceInstead ? "Attach a quote or the invoice (at least one)." : "At least one supplier quotation is required.";
        quotations.forEach((quotation, quoteIndex) => {
          if (!quotationHasData(quotation) && quotations.some(quotationHasData)) return;
          if (!quotation.supplier) next[`quotations.${quoteIndex}.supplier`] = "Select a supplier.";
          if (!(Number(quotation.amount) > 0)) next[`quotations.${quoteIndex}.amount`] = "Quotation amount must be greater than zero.";
          if (!quotation.attachment && !quotationFiles[quotation.clientId]) next[`quotations.${quoteIndex}.attachment`] = "Quotation evidence is required.";
        });
        const recommended = quotations.filter((item) => item.recommended);
        if (recommended.length !== 1) next.recommended = "Select exactly one recommended supplier.";
        // A reason is asked only when there was a choice between suppliers.
        if (new Set(quotations.map((item) => item.supplier).filter(Boolean)).size > 1 && !form.supplierSelectionReason.trim()) next.supplierSelectionReason = "Supplier selection reason is required.";
      }
      // A saved request always names its supplier, so "Save draft" needs it as well.
      if (!form.supplier && form.flowType !== "C") {
        if (!quotationPolicy.enabled || invoiceOnly) next.supplier = "Select a supplier.";
        else next.recommended ||= "Select exactly one recommended supplier.";
      }
    }
    if (id === "documents" && submitting) {
      formPolicy.documentRequirements.forEach((rule) => {
        if (rule.kind === "QUOTATION") return;
        // The invoice is satisfied by its XML or its factura PDF: either card counts.
        const definitions = documentDefinitions.filter((item) => coversKind(rule, item.kind));
        if (!definitions.length) return;
        const count = presentCount(rule, existingAttachments, Object.fromEntries(definitions.map((item) => [item.kind, files[item.key]?.length || 0]))) + (isQuoteOrInvoice(rule) ? quotedWithEvidence : 0);
        if (count >= rule.minCount) return;
        const message = isQuoteOrInvoice(rule)
          ? t("Attach a quote or the invoice (at least one).")
          : isAnyDocument(rule)
          ? t("Upload at least one document: any of these files is enough.")
          : isEitherOf(rule)
          ? t("Upload one of these files (one is enough): {documents}.").replace("{documents}", definitions.map((item) => t(item.label)).join(" / "))
          : t("A minimum of {count} {document} file(s) is required.").replace("{document}", t(definitions[0].label)).replace("{count}", String(rule.minCount));
        definitions.forEach((item) => { next[item.key] = message; });
      });
    }
    return next;
  }

  // What the first two steps still need right now: the Continue / Submit rules (submitting =
  // true, so it matches what approval requires) plus checks that help while typing. It feeds the
  // messages shown when a field is left and the "Complete" badge of each block.
  function liveProblems() {
    const problems = { ...validationForStep("need", true), ...validationForStep("budget", true) };
    if (!problems.issueDate && form.issueDate && form.issueDate.slice(0, 7) === form.accountingPeriod) {
      const outside = openPeriodError(form.issueDate, masters.periods, "The issue date must fall within an open accounting period.");
      if (outside) problems.issueDate = outside;
    }
    return problems;
  }

  function setFieldError(key, message) {
    setErrors((current) => {
      if ((current[key] || "") === (message || "")) return current;
      const next = { ...current };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });
  }

  // Validation runs after the blur has been rendered, so a value committed on blur (the
  // date field completes "30/09/26" when it is left) is the one checked.
  function validateField(...keys) {
    setBlurredFields({ keys });
  }

  useEffect(() => {
    if (!blurredFields) return;
    const problems = liveProblems();
    blurredFields.keys.forEach((key) => setFieldError(key, problems[key]));
  }, [blurredFields]);

  // A message disappears as soon as the field is fixed; new ones only appear on blur or submit.
  useEffect(() => {
    if (!hydrated) return;
    const problems = liveProblems();
    setErrors((current) => {
      const fixed = Object.keys(current).filter((key) => isRequestFormField(key) && !problems[key]);
      if (!fixed.length) return current;
      const next = { ...current };
      fixed.forEach((key) => delete next[key]);
      return next;
    });
  }, [hydrated, form, lines, masters.periods, officialRequest]);

  function validateQuotationAmount(index) {
    setFieldError(`quotations.${index}.amount`, positiveAmountError(quotations[index]?.amount, { required: quotationPolicy.enabled, message: "Quotation amount must be greater than zero." }));
  }

  function goToStep(id) {
    setStepId(id);
    setVisitedSteps((current) => current.includes(id) ? current : [...current, id]);
  }

  // Shows the field messages and one summary, then moves focus to the first problem (after the
  // step that holds it has rendered).
  function showProblems(problems) {
    setErrors(problems);
    setError(validationSummary(problems, t));
    window.cancelAnimationFrame(validationFocusRef.current);
    validationFocusRef.current = window.requestAnimationFrame(() => {
      const error = window.document.querySelector(".field-error-text");
      error?.scrollIntoView({ behavior: "smooth", block: "center" });
      error?.closest(".field, .document-upload, .search-select")?.querySelector("input, select, textarea, button")?.focus({ preventScroll: true });
    });
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
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(sendForApproval) {
    if (!draft.ready || draft.status === "conflict") return;
    const checkedSteps = stepIds.filter((item) => item !== "review");
    const validations = checkedSteps.map((item) => validationForStep(item, sendForApproval));
    const firstInvalid = validations.findIndex((item) => Object.keys(item).length);
    if (firstInvalid >= 0) {
      // Something the simple form does not ask: the full form opens where it goes.
      if (mode === "quick") {
        setMode("full");
        notify("A few details are missing. The full form opened where they go.", "info");
      }
      goToStep(checkedSteps[firstInvalid]);
      showProblems(validations[firstInvalid]);
      return;
    }
    setSaving(true);
    setError("");
    const data = new FormData();
    const payloadForm = {
      ...form,
      requestType: requestTypeForFlow(form.flowType, form.requestType),
      title: String(form.title || "").trim() || titleFromDescription(form.detailedDescription || form.description),
      description: form.description || form.detailedDescription
    };
    Object.entries(payloadForm).forEach(([key, value]) => data.append(key, value ?? ""));
    data.append("capexDetails", JSON.stringify(form.requestType === "CAPEX" ? {
      projectPep: capex.projectPep,
      projectSnapshot: { id: capex.projectId || undefined },
      assetCategory: capex.assetCategory || undefined,
      usefulLifeYears: capex.usefulLifeYears,
      npv: { amount: capex.npvAmount, currency: capex.npvCurrency },
      payback: { value: capex.paybackValue, unit: capex.paybackUnit }
    } : {}));
    data.append("opexDetails", JSON.stringify(form.requestType === "OPEX" ? { expenseFrequency: opexFrequency } : {}));
    data.append("lines", JSON.stringify(lines.map(requestLinePayload)));
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

  // ---- The simple form (QuickRequestForm). Its answers choose the track, its amount is the one
  // request line and its quote the one recommended quotation; the full form shows the same data.
  function clearErrors(keys) {
    setErrors((current) => {
      const next = { ...current };
      keys.forEach((key) => delete next[key]);
      return next;
    });
    setError("");
  }

  function changeQuick(patch) {
    clearErrors(["quote", "invoice", "supplier"]);
    const next = { ...quick, ...patch };
    setQuick(next);
    if (!["payee", "route", "employeeNeed", "capex"].some((key) => Object.hasOwn(patch, key))) return;
    const track = quickTrack(next);
    setForm((current) => ({ ...current, ...track, supplier: track.flowType === "C" ? "" : current.supplier }));
    // The employee's own money: no supplier invoice or quotes.
    if (patch.payee === "employee") {
      setFiles((current) => ({ ...current, xml: [], pdf: [] }));
      setInvoiceCheck(null);
      setQuotations([]);
    }
  }

  function changeQuickForm(patch) {
    clearErrors(Object.keys(patch));
    setForm((current) => ({ ...current, ...patch }));
    if (Object.hasOwn(patch, "detailedDescription") && !invoiceCheck?.invoice) {
      setLines((current) => current.length === 1 ? [{ ...current[0], itemDescription: titleFromDescription(patch.detailedDescription) }] : current);
    }
  }

  // One line, one unit, IGV included: what the requester types is the total.
  const simpleAmount = lines.length <= 1 && !lines[0]?.legacyAmounts && Number(lines[0]?.quantity || 1) === 1;
  function changeQuickAmount(value) {
    clearErrors(["lines", "lines.0.totalAmount", "lines.0.unitPrice", "lines.0.quantity"]);
    setQuick((current) => ({ ...current, amount: value }));
    setLines((current) => {
      const base = current[0] || emptyLine(form.requesterCostCenter);
      return [editRequestLine(base, { quantity: "1", unitOfMeasure: base.unitOfMeasure || "UNIT", unitPrice: value, priceIncludesIGV: true, igvExempt, itemDescription: base.itemDescription || titleFromDescription(form.detailedDescription) })];
    });
  }

  // The quotes (A1 and B): the first is the chosen supplier's, for the request total and
  // recommended; more can be added to compare suppliers. A quote or the invoice: at least one.
  const quoteEvidence = (quotation) => Boolean(quotation && (quotationFiles[quotation.clientId] || quotation.attachment));
  const firstQuoteAttached = quoteEvidence(quotations[0]);
  function changeQuoteFile(index, file) {
    clearErrors(["quote", `quotations.${index}.attachment`]);
    const list = quotations.length ? quotations : [emptyQuotation()];
    if (!quotations.length) setQuotations(list);
    const quotation = list[index];
    if (quotation) setQuotationFiles((current) => ({ ...current, [quotation.clientId]: file || undefined }));
  }
  function changeQuickQuote(index, patch) {
    clearErrors(Object.keys(patch).map((key) => `quotations.${index}.${key}`));
    setQuotations((current) => current.map((quotation, position) => position === index ? { ...quotation, ...patch } : quotation));
  }
  const addQuickQuote = () => setQuotations((current) => [...(current.length ? current : [emptyQuotation()]), { ...emptyQuotation(), currency: form.currency }]);
  const removeQuickQuote = (index) => setQuotations((current) => current.filter((_, position) => position !== index));

  // The first quote follows the chosen supplier and the request total; without its file it is
  // left blank, so a request sent with only the invoice carries no empty quotation.
  useEffect(() => {
    if (mode !== "quick" || form.flowType === "C") return;
    setQuotations((current) => {
      const [first = emptyQuotation(), ...rest] = current;
      const synced = firstQuoteAttached
        ? { ...first, supplier: form.supplier, amount: totals.total > 0 ? String(totals.total) : "", currency: form.currency, recommended: Boolean(form.supplier) }
        : { ...first, supplier: "", amount: "", recommended: false };
      return [synced, ...rest.map((quotation) => ({ ...quotation, recommended: false }))];
    });
  }, [mode, form.flowType, form.supplier, form.currency, totals.total, quotations.length, firstQuoteAttached]);

  const quickDocuments = quickExtraDocuments(formPolicy.documentRequirements, documentDefinitions, { evidence: invoiceAttached ? "invoice" : "quote", flowType: form.flowType });
  const quotedSuppliers = new Set(quotations.filter(quoteEvidence).map((quotation) => quotation.supplier).filter(Boolean));

  function submitQuick() {
    const problems = {};
    if (!String(form.detailedDescription || "").trim()) problems.detailedDescription = "Tell us what you need.";
    if (!(totals.total > 0)) problems["lines.0.totalAmount"] = "Enter the total amount.";
    if (form.flowType === "A1" && !String(form.businessJustification || "").trim()) problems.businessJustification = "Tell us why it is needed.";
    if (form.flowType !== "C") {
      if (!form.supplier) problems.supplier = "Select the supplier.";
      if (!quotations.some(quoteEvidence) && !invoiceAttached) problems.quote = "Attach a quote or the invoice (at least one).";
      quotations.slice(1).forEach((quotation, position) => {
        const index = position + 1;
        if (!quotationHasData(quotation) && !quoteEvidence(quotation)) return;
        if (!quotation.supplier) problems[`quotations.${index}.supplier`] = "Select a supplier.";
        if (!(Number(quotation.amount) > 0)) problems[`quotations.${index}.amount`] = "Quotation amount must be greater than zero.";
        if (!quoteEvidence(quotation)) problems[`quotations.${index}.attachment`] = "Quotation evidence is required.";
      });
      if (quotedSuppliers.size > 1 && !String(form.supplierSelectionReason || "").trim()) problems.supplierSelectionReason = "Supplier selection reason is required.";
    }
    quickDocuments.forEach(({ definition }) => { if (!files[definition.key]?.length && !existingAttachments.some((item) => item.kind === definition.kind)) problems[definition.key] = "Attach this document."; });
    if (Object.keys(problems).length) {
      showProblems(problems);
      return;
    }
    void save(true);
  }

  function openFullForm() {
    setErrors({});
    setError("");
    setMode("full");
    window.scrollTo({ top: 0 });
  }

  function openQuickForm() {
    setErrors({});
    setError("");
    setQuick(quickFromForm(form, totals.total > 0 ? String(totals.total) : ""));
    setMode("quick");
    window.scrollTo({ top: 0 });
  }

  const quickCostCenter = masters.costCenters.find((item) => item._id === form.requesterCostCenter);
  // The request is charged to the requester's own CECO; another one only when the profile authorizes it.
  const ownCostCenter = masters.costCenters.find((item) => item._id === supplierId(user.costCenter));
  const ownCostCenterHint = !form.requesterCostCenter || !ownCostCenter
    ? t("Only Cost Centers assigned to your profile are available.")
    : form.requesterCostCenter === ownCostCenter._id
      ? t("Charged to your own CECO. Its remaining budget is shown below.")
      : t("Charged to {ceco}, a CECO you are authorized for. Your own CECO is {own}.").replace("{ceco}", quickCostCenter?.code || "").replace("{own}", ownCostCenter.code);
  const capexOpen = showCapexDetails({ total: totals.total, threshold: formPolicy.capexDetailsThreshold ?? 50000, capex });

  const blockStatuses = requestBlockStatuses(hydrated ? liveProblems() : {}, {
    optional: officialRequest ? [] : ["why"],
    filled: { why: Boolean(String(form.businessJustification || "").trim()) }
  });

  if (loading) return <WorkspaceSkeleton label={isEditing ? "Loading request..." : "Loading form data..."} />;

  return <section>
    <PageHeader
      title={isEditing ? "Edit request" : mode === "quick" ? "New request" : "Create request"}
      description={mode === "quick" ? "Three quick questions. Your progress saves automatically." : "Describe what you need, where it is charged and who supplies it. Your progress saves automatically."}
      actions={!isEditing && mode === "full" ? <button type="button" className="secondary-button" onClick={openQuickForm}>{t("Back to the simple form")}</button> : null}
    />
    {!isEditing && <ContinueWork scope="request" recordId="new" exclude={draft.session.id} />}
    <DraftPanel busy={saving} draft={draft} onDiscard={() => navigate(isEditing ? `/requests/${id}` : "/requests")}>
    {stepId === "review" && <ReadinessPanel defaultOpen payload={{ ...form, lines, quotations: quotations.map(q => ({ ...q, attachment: quotationFiles[q.clientId] ? "preview-only" : q.attachment })), attachments: [...existingAttachments, ...Object.values(quotationFiles).filter(Boolean).map(file => ({ kind: "QUOTATION", name: file.name, url: "preview-only" })), ...documentDefinitions.flatMap(def => (files[def.key] || []).map(file => ({ kind: def.kind, name: file.name, url: "preview-only" })))] }} />}

    {mode === "quick" ? <QuickRequestForm
      form={form}
      onFormChange={changeQuickForm}
      quick={quick}
      onQuickChange={changeQuick}
      totals={totals}
      lines={lines}
      simpleAmount={simpleAmount}
      onAmountChange={changeQuickAmount}
      masters={masters}
      suppliers={eligibleSuppliers}
      supplierProposalPath={`/suppliers?mode=new&returnTo=${encodeURIComponent(isEditing ? `/requests/${id}/edit` : `/requests/new${draftSearch}`)}`}
      invoiceCheck={invoiceCheck}
      onInvoiceFile={(file) => { clearErrors(["invoice"]); readInvoice(file, { fill: true }); }}
      quotations={quotations}
      quotationFiles={quotationFiles}
      onQuoteFile={changeQuoteFile}
      onQuoteChange={changeQuickQuote}
      onAddQuote={addQuickQuote}
      onRemoveQuote={removeQuickQuote}
      compareSuppliers={quotedSuppliers.size > 1}
      extraDocuments={quickDocuments}
      files={files}
      onDocumentFiles={(key, chosen) => { clearErrors([key]); setFiles((current) => ({ ...current, [key]: chosen })); }}
      costCenterLabel={quickCostCenter ? `${quickCostCenter.code} - ${quickCostCenter.name}` : ""}
      onCostCenterChange={setHeaderCostCenter}
      period={form.accountingPeriod}
      errors={errors}
      error={error}
      saving={saving}
      disabled={!draft.ready || draft.status === "conflict"}
      onSaveDraft={() => save(false)}
      onSubmit={submitQuick}
      onFullForm={openFullForm}
    /> : <div className="request-wizard official-request-wizard">
      <WorkflowStepper steps={stepIds.map((item) => STEP_LABELS[item])} current={step} completedSteps={completedSteps.map((item) => stepIds.indexOf(item)).filter((index) => index >= 0)} maxAccessible={maxStep} onSelect={(next) => next <= maxStep && goToStep(stepIds[next])} />
      <div className="wizard-financial-context"><span>{t("Step {step} of {total}").replace("{step}", step + 1).replace("{total}", stepIds.length)} · {t(STEP_LABELS[stepId])}</span><span>{t("Total amount")}<strong>{formatCurrency(totals.total, form.currency, language)}</strong></span><small>{t("Fields marked * are required.")}</small></div>
      <div className="wizard-workspace">
        <MotionSurface changeKey={step} directional>
        {stepId === "need" && <div className="wizard-step request-form-blocks">
          {form.flowType !== "C" && <InvoiceDropZone check={invoiceCheck} onFile={(file) => readInvoice(file, { fill: true })} supplierProposalPath={`/suppliers?mode=new&returnTo=${encodeURIComponent(isEditing ? `/requests/${id}/edit` : `/requests/new${draftSearch}`)}`} />}
          {form.flowType === "A1" && mode === "full" && invoiceCheck?.status === "done" && <div className="inline-alert alert-info"><FileCheck2 size={18} /><div><strong>{t("You already have the invoice")}</strong><span>{t("If no quotation or purchase order is needed, Track B (direct payment) is faster: the invoice is checked now and the request goes to payment once approved.")}</span></div><button type="button" className="secondary-button" onClick={() => { setForm((current) => ({ ...current, flowType: "B" })); attachInvoiceFile(invoiceCheck.file); }}>{t("Switch to Track B")}</button></div>}

          <RequestFormBlock {...blockInfo.need} status={blockStatuses.need}>
          <TrackPicker onChoose={(choice) => setForm((current) => ({ ...current, flowType: choice.flowType, requestType: choice.flowType === "C" ? choice.requestType : requestTypeForFlow(choice.flowType, current.requestType), supplier: choice.flowType === "C" ? "" : current.supplier }))} />
          <div className="form-grid two-column-form">
            <label className="field"><span>{t("Operational track")} *</span><select value={form.flowType} onChange={(event) => { const flowType = event.target.value; setForm((current) => ({ ...current, flowType, requestType: requestTypeForFlow(flowType, current.requestType), supplier: flowType === "C" ? "" : current.supplier })); }}>{flowTypes.filter((type) => type !== "A2").map((type) => <option key={type} value={type}>{t(optionLabel(type, flowTypeLabels))}</option>)}</select><small>{t(form.flowType === "A1" ? "Formal purchase with quotations and PO." : form.flowType === "B" ? "Direct invoice / advance payment with its invoice XML or factura PDF." : "Advance to render / petty cash; expense budget is executed at rendition validation.")}</small></label>
            {form.flowType !== "C" && <label className={`field${errors.requestType ? " field-error" : ""}`}><span>CAPEX / OPEX *</span><select value={form.requestType} onChange={(event) => setForm((current) => ({ ...current, requestType: event.target.value }))} onBlur={() => validateField("requestType")} aria-invalid={Boolean(errors.requestType)}>{requestCreationClassifications.map((type) => <option key={type} value={type}>{t(optionLabel(type, expenditureClassificationLabels))}</option>)}</select>{errors.requestType && <small className="field-error-text">{t(errors.requestType)}</small>}<small>{t("The operational track defines how the transaction is processed; CAPEX / OPEX defines the economic classification of the spend.")}</small></label>}
            {form.flowType === "C" && <label className={`field${errors.requestType ? " field-error" : ""}`}><span>{t("Track C request type")} *</span><select value={form.requestType} onChange={(event) => setForm((current) => ({ ...current, requestType: event.target.value }))} onBlur={() => validateField("requestType")} aria-invalid={Boolean(errors.requestType)}>{trackCRequestTypes.map((type) => <option key={type} value={type}>{t(trackCRequestTypeLabels[type])}</option>)}</select>{errors.requestType && <small className="field-error-text">{t(errors.requestType)}</small>}<small>{t(form.requestType === "REEMBOLSO_SIN_SUSTENTO" ? "Reimburses an expense you already paid and could not support with a fiscal receipt. After approval you sign the declaration, Accounting reviews it and Treasury pays your verified account." : "UMA pays you first; you then render the advance with receipts within the configured working-day deadline.")}</small></label>}
            <label className={`field${errors.expenseNature ? " field-error" : ""}`}><span>{t("Expense nature")} *</span><select value={form.expenseNature} onChange={(event) => setForm((current) => ({ ...current, expenseNature: event.target.value }))} onBlur={() => validateField("expenseNature")} aria-invalid={Boolean(errors.expenseNature)}>{expenseNatures.map((item) => <option key={item} value={item}>{t(optionLabel(item, expenseNatureLabels))}</option>)}</select>{errors.expenseNature && <small className="field-error-text">{t(errors.expenseNature)}</small>}</label>
            <label className={`field${errors.title ? " field-error" : ""}`}><span>{t("Requirement title")}</span><input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} onBlur={() => validateField("title")} aria-invalid={Boolean(errors.title)} />{errors.title ? <small className="field-error-text">{t(errors.title)}</small> : <small className="field-hint">{t("If left empty, the first line of the description is used.")}</small>}</label>
            <label className={`field form-span-two${errors.detailedDescription || errors.description ? " field-error" : ""}`}><span>{t("Detailed description")} *</span><textarea rows="4" value={form.detailedDescription} onChange={(event) => setForm((current) => ({ ...current, detailedDescription: event.target.value, description: event.target.value }))} onBlur={() => validateField("detailedDescription", "description")} aria-invalid={Boolean(errors.detailedDescription || errors.description)} />{(errors.detailedDescription || errors.description) && <small className="field-error-text">{t(errors.detailedDescription || errors.description)}</small>}</label>
          </div>

          {form.flowType === "C" && form.requestType !== "REEMBOLSO_SIN_SUSTENTO" && <div className="inline-alert alert-info"><FileCheck2 size={18} /><div><strong>{t("Track C - Advance to render")}</strong><span>{t("CAPEX / OPEX is not selected when the advance is created. The final expense is recognized when Accounting validates the rendition.")}</span></div></div>}
          {form.flowType === "C" && form.requestType === "REEMBOLSO_SIN_SUSTENTO" && <div className="inline-alert alert-info"><FileCheck2 size={18} /><div><strong>{t("Track C - Undocumented reimbursement")}</strong><span>{t("Use a non-deductible expense account. No advance is paid: once approved, submit the undocumented-expense declaration with a verified PEN reimbursement account.")}</span></div></div>}

          {form.flowType === "B" && form.requestType === "CAPEX" && <div className="inline-alert alert-warning"><AlertTriangle size={18} /><div><strong>{t("Direct CAPEX purchase")}</strong><span>{t("Track B has no prior Purchase Order. Provide a clear business justification and the required supporting evidence for this capital expenditure.")}</span></div></div>}

          <details className="request-optional-fields" open={OPTIONAL_REQUEST_FIELDS.some((field) => errors[field]) ? true : undefined}>
            <summary><span>{t("More details (optional)")}</span><small>{t("Priority")}: {t(form.priority)}{form.areaCorrelative ? ` · ${form.areaCorrelative}` : ""}{form.schoolOrDepartment ? ` · ${form.schoolOrDepartment}` : ""}</small></summary>
            <div className="form-grid two-column-form">
              <label className={`field${errors.priority ? " field-error" : ""}`}><span>{t("Priority")}</span><select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))} onBlur={() => validateField("priority")}>{requestPriorities.map((item) => <option key={item} value={item}>{t(item)}</option>)}</select>{errors.priority ? <small className="field-error-text">{t(errors.priority)}</small> : <small className="field-hint">{t("Medium by default; raise it only when the need is urgent.")}</small>}</label>
              <label className="field"><span>{t("Area correlative")}</span><input value={form.areaCorrelative} onChange={(event) => setForm((current) => ({ ...current, areaCorrelative: event.target.value }))} /></label>
              <label className="field"><span>{t("School / department")}</span><input value={form.schoolOrDepartment} onChange={(event) => setForm((current) => ({ ...current, schoolOrDepartment: event.target.value }))} /></label>
            </div>
          </details>
          </RequestFormBlock>

          <RequestFormBlock {...blockInfo.why} status={blockStatuses.why}>
          <div className="form-grid two-column-form">
            <label className={`field form-span-two${errors.businessJustification ? " field-error" : ""}`}><span>{t("Business justification")}{officialRequest ? " *" : ""}</span><textarea rows="3" value={form.businessJustification} onChange={(event) => setForm((current) => ({ ...current, businessJustification: event.target.value }))} onBlur={() => validateField("businessJustification")} aria-invalid={Boolean(errors.businessJustification)} />{errors.businessJustification && <small className="field-error-text">{t(errors.businessJustification)}</small>}</label>
            <label className={`field form-span-two${errors.nonApprovalRisk ? " field-error" : ""}`}><span>{t("Risk if not approved")}</span><textarea rows="3" value={form.nonApprovalRisk} onChange={(event) => setForm((current) => ({ ...current, nonApprovalRisk: event.target.value }))} onBlur={() => validateField("nonApprovalRisk")} aria-invalid={Boolean(errors.nonApprovalRisk)} />{errors.nonApprovalRisk && <small className="field-error-text">{t(errors.nonApprovalRisk)}</small>}</label>
          </div>
          </RequestFormBlock>
        </div>}

        {stepId === "budget" && <div className="wizard-step request-form-blocks">
          <RequestFormBlock {...blockInfo.budget} status={blockStatuses.budget}>
          <div className="form-grid two-column-form">
            <label className="field"><span>{t("Requesting area")}</span><input value={user.area || "General"} disabled title={t("Assigned from the signed-in user profile.")} /></label>
            <div className="form-span-two"><SearchSelect label="Cost Center / CECO" value={form.requesterCostCenter} options={masters.costCenters} onChange={setHeaderCostCenter} getOptionLabel={(item) => `${item.code} - ${item.name}${item.area ? ` (${item.area})` : ""}`} error={errors.requesterCostCenter} required searchPlaceholder="Search authorized CECO..." /><small className="field-hint">{ownCostCenterHint}</small></div>
            <label className={`field${errors.issueDate ? " field-error" : ""}`}><span>{t("Issue date")} *</span><DateInput required value={form.issueDate} onChange={(event) => setForm((current) => ({ ...current, issueDate: event.target.value, accountingPeriod: event.target.value.slice(0, 7) }))} onBlur={() => validateField("issueDate", "accountingPeriod")} aria-invalid={Boolean(errors.issueDate)} />{errors.issueDate && <small className="field-error-text">{t(errors.issueDate)}</small>}</label>
            <label className={`field${errors.accountingPeriod ? " field-error" : ""}`}><span>{t("Request month")} *</span><select value={form.accountingPeriod} onChange={(event) => setForm((current) => ({ ...current, accountingPeriod: event.target.value }))} onBlur={() => validateField("accountingPeriod")} aria-invalid={Boolean(errors.accountingPeriod)}><option value="">{t("Select")}</option>{masters.periods.map((period) => <option key={period._id} value={period.period} disabled={period.status !== "OPEN"}>{formatIsoMonth(period.period) || period.period} - {t(period.status)}</option>)}</select>{errors.accountingPeriod && <small className="field-error-text">{t(errors.accountingPeriod)}</small>}</label>
            <label className={`field${errors.currency ? " field-error" : ""}`}><span>{t("Currency")} *</span><select value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))} onBlur={() => validateField("currency")}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select>{errors.currency && <small className="field-error-text">{t(errors.currency)}</small>}</label>
          </div>

          {form.requestType === "CAPEX" && <details className="official-subsection capex-details" open={capexOpen || undefined}><summary><strong>{t("CAPEX financial information")}</strong><small>{t(capexOpen ? "Planning information is recorded only; no depreciation or NPV calculation is generated." : "Optional for this amount: Budget or Accounting can complete it.")}</small></summary><div className="form-grid three-column-form">
            <label className="field"><span>{t("Project / PEP")}</span><select value={capex.projectId} onChange={(event) => { const project = masters.projects.find((item) => item._id === event.target.value); setCapex((current) => ({ ...current, projectId: event.target.value, projectPep: project?.code || current.projectPep })); }}><option value="">{t("No project")}</option>{masters.projects.map((project) => <option key={project._id} value={project._id}>{project.code} - {project.name}</option>)}</select></label>
            <label className="field"><span>{t("Fixed asset category")}</span><select value={capex.assetCategory} onChange={(event) => setCapex((current) => ({ ...current, assetCategory: event.target.value }))}><option value="">{t("Select")}</option>{["INFRASTRUCTURE", "MACHINERY", "IT_HARDWARE", "SOFTWARE_LICENSES"].map((value) => <option key={value} value={value}>{t(value)}</option>)}</select></label>
            <label className="field"><span>{t("Useful life (years)")}</span><input type="number" min="0" step="1" value={capex.usefulLifeYears} onChange={(event) => setCapex((current) => ({ ...current, usefulLifeYears: event.target.value }))} /></label>
            <label className="field"><span>{t("NPV / VAN amount")}</span><input type="number" step="0.01" value={capex.npvAmount} onChange={(event) => setCapex((current) => ({ ...current, npvAmount: event.target.value }))} /></label>
            <label className="field"><span>{t("NPV currency")}</span><select value={capex.npvCurrency} onChange={(event) => setCapex((current) => ({ ...current, npvCurrency: event.target.value }))}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
            <div className="field"><span>{t("Payback")}</span><div className="compound-field"><input aria-label={t("Payback value")} type="number" min="0" step="0.01" value={capex.paybackValue} onChange={(event) => setCapex((current) => ({ ...current, paybackValue: event.target.value }))} /><select aria-label={t("Payback unit")} value={capex.paybackUnit} onChange={(event) => setCapex((current) => ({ ...current, paybackUnit: event.target.value }))}><option value="MONTHS">{t("Months")}</option><option value="YEARS">{t("Years")}</option></select></div></div>
          </div></details>}

          {form.requestType === "OPEX" && <div className="official-subsection"><div className="section-heading compact"><div><h3>{t("OPEX financial information")}</h3><p>{t("Accounting assigns the accounting account when it processes the invoice.")}</p></div></div><label className="field field-narrow"><span>{t("Expense frequency")}</span><select value={opexFrequency} onChange={(event) => setOpexFrequency(event.target.value)}><option value="ONE_OFF">{t("One-off")}</option><option value="MONTHLY_RECURRING">{t("Monthly recurring")}</option><option value="EVERY_3_MONTHS">{t("Every 3 months")}</option><option value="ANNUAL_RENEWAL">{t("Annual renewal")}</option></select></label></div>}
          </RequestFormBlock>

          <RequestFormBlock {...blockInfo.items} status={blockStatuses.items} action={<button type="button" className="secondary-button" onClick={() => setLines(current => [...current, emptyLine(form.requesterCostCenter)])}><Plus size={16} /><span>{t("Add line")}</span></button>}>
          {errors.lines && <small className="field-error-text">{t(errors.lines)}</small>}
          <MotionList className="official-line-list">{lines.map((line, index) => <RequestItemLine key={line.clientId} line={line} index={index} currency={form.currency} errors={errors} onChange={patch => updateLine(index, patch)} onFieldBlur={field => validateField(`lines.${index}.${field}`)} canRemove={lines.length > 1} onRemove={() => setLines(current => current.filter((_, currentIndex) => currentIndex !== index))} />)}</MotionList>
          <div className="request-items-total"><span>{t("Request total")}</span><strong>{formatCurrency(totals.total, form.currency, language)}</strong></div>
          {form.flowType !== "C" && invoiceCheck?.invoice && <InvoiceMatchStrip invoice={invoiceCheck.invoice} form={form} totals={totals} supplier={selectedSupplier} flowType={form.flowType} />}
          <details className="request-budget-adjustments" open={Object.keys(errors).some(key => /lines\.\d+\.costCenter/.test(key)) ? true : undefined}>
            <summary>{t("Adjust budget allocation")}</summary>
            <p className="section-note">{t("Items inherit the request's cost center. Adjust only when an item uses a different cost center budget.")}</p>
            {lines.map((line, index) => <div className="request-budget-line" key={line.clientId}><strong>{t("Item")} {index + 1}: {line.itemDescription || t("Item / service description")}</strong><div className="form-grid two-column-form"><SearchSelect label="Cost Center / CECO" value={line.costCenter} options={masters.costCenters} onChange={value => updateLine(index, { costCenter: value })} getOptionLabel={item => item.code + " - " + item.name} error={errors["lines." + index + ".costCenter"]} required searchPlaceholder="Search authorized CECO..." /></div></div>)}
          </details>
          </RequestFormBlock>

          <BudgetRemainingSummary payload={budgetPayload} preview={budgetPreview} loading={budgetLoading} onRefresh={() => setBudgetRefresh(value => value + 1)} />
        </div>}

        {stepId === "supplier" && <div className="wizard-step">
          {form.flowType !== "C" && (!quotationPolicy.enabled || !quotations.some(quotationHasData)) && <div className="official-subsection"><div className="section-heading compact"><div><h3>{t("Supplier")}</h3><p>{t("Select the supplier linked to this request. A new supplier can be saved in a draft; the request is sent once the proposer's jefe approves the supplier.")}</p></div></div><div className="form-grid two-column-form"><SearchSelect label="Supplier" value={form.supplier} options={eligibleSuppliers} onChange={(value) => setForm((current) => ({ ...current, supplier: value }))} getOptionLabel={(item) => `${item.supplierCode ? `${item.supplierCode} - ` : ""}${item.rucDni} - ${supplierName(item)} - ${t(supplierStatus(item))}`} error={errors.supplier} required searchPlaceholder="Search name or RUC/DNI..." />{selectedSupplier && <div className="supplier-inline-status"><div><strong>{supplierName(selectedSupplier)}</strong><span>{selectedSupplier.rucDni}{selectedSupplier.supplierCode ? ` - ${selectedSupplier.supplierCode}` : ""}</span></div><StatusBadge status={supplierStatus(selectedSupplier)} /></div>}</div></div>}

          {form.flowType !== "C" && <div className="official-subsection quotation-section"><div className="section-heading"><div><h3>{t("Supplier quotations")}</h3><p>{quotationPolicy.enabled ? t("At least one supplier quotation with evidence is required. Add or remove further quotations as needed.") : t("Quotation comparison is optional for this classification.")}</p></div><button type="button" className="secondary-button" onClick={() => setQuotations((current) => [...current, emptyQuotation()])}><Plus size={16} /><span>{t("Add quotation")}</span></button></div>
            {errors.quotations && <Message type="error">{errors.quotations}</Message>}
            <MotionList className="quotation-grid">{quotations.map((quotation, index) => {
              const supplier = masters.suppliers.find((item) => item._id === quotation.supplier);
              const status = supplierStatus(supplier);
              const blocked = ["REJECTED", "INACTIVE"].includes(status);
              const evidence = existingAttachments.find((item) => String(item._id) === String(quotation.attachment));
              return <article className={`quotation-card${quotation.recommended ? " recommended" : ""}`} key={quotation.clientId} data-motion-key={quotation.clientId}><div className="quotation-card-head"><span>{t("Quotation")} {index + 1}</span>{supplier && <StatusBadge status={status} />}</div>
                <SearchSelect label="Supplier" value={quotation.supplier} options={eligibleSuppliers} onChange={(value) => updateQuotation(index, { supplier: value, recommended: false })} getOptionLabel={(item) => `${item.supplierCode ? `${item.supplierCode} - ` : ""}${item.rucDni} - ${supplierName(item)} - ${t(supplierStatus(item))}`} error={errors[`quotations.${index}.supplier`]} required searchPlaceholder="Search name or RUC/DNI..." />
                {supplier && <div className="supplier-inline-status"><div><strong>{supplierName(supplier)}</strong><span>{supplier.rucDni}{supplier.supplierCode ? ` - ${supplier.supplierCode}` : ""}</span></div></div>}
                <div className="form-grid two-column-form"><label className={`field${errors[`quotations.${index}.amount`] ? " field-error" : ""}`}><span>{t("Amount")} *</span><input type="number" min="0" step="0.01" value={quotation.amount} onChange={(event) => updateQuotation(index, { amount: event.target.value })} onBlur={() => validateQuotationAmount(index)} aria-invalid={Boolean(errors[`quotations.${index}.amount`])} />{errors[`quotations.${index}.amount`] && <small className="field-error-text">{t(errors[`quotations.${index}.amount`])}</small>}</label><label className="field"><span>{t("Currency")}</span><select value={quotation.currency} onChange={(event) => updateQuotation(index, { currency: event.target.value })}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label><label className="field"><span>{t("Delivery period")}</span><input value={quotation.deliveryPeriod} onChange={(event) => updateQuotation(index, { deliveryPeriod: event.target.value })} /></label></div>
                <QuotationPaymentTerms quotation={quotation} onChange={(changes) => updateQuotation(index, changes)} errors={errors} errorPrefix={`quotations.${index}.`} />
                <label className="field"><span>{t("Commercial conditions")}</span><textarea rows="2" value={quotation.commercialConditions} onChange={(event) => updateQuotation(index, { commercialConditions: event.target.value })} /></label>
                <label className={`quotation-evidence${errors[`quotations.${index}.attachment`] ? " field-error" : ""}`}><FileText size={18} /><span><strong>{quotationFiles[quotation.clientId]?.name || evidence?.originalName || t("Attach quotation evidence")}</strong><small>{quotationFiles[quotation.clientId] || evidence ? t("Evidence attached") : t("Evidence missing")}</small></span>{quotationFiles[quotation.clientId]
                  ? <span className="quotation-evidence-actions"><button type="button" className="icon-button quiet" onClick={() => openLocalFile(quotationFiles[quotation.clientId])} title={t("View document")} aria-label={`${t("View document")}: ${quotationFiles[quotation.clientId].name}`}><Eye size={15} aria-hidden="true" /></button><button type="button" className="icon-button quiet danger" onClick={() => setQuotationFiles((current) => ({ ...current, [quotation.clientId]: undefined }))} title={t("Remove document")} aria-label={`${t("Remove document")}: ${quotationFiles[quotation.clientId].name}`}><Trash2 size={15} aria-hidden="true" /></button></span>
                  : evidence && <span className="quotation-evidence-actions"><ProtectedAssetButton className="icon-button quiet" resourcePath={evidence.url} fileName={evidence.originalName} preview title="View document" ariaLabel={`${t("View document")}: ${evidence.originalName}`}><Eye size={15} aria-hidden="true" /></ProtectedAssetButton></span>}<input type="file" accept=".pdf,.doc,.docx,.xlsx,.jpg,.jpeg,.png" onChange={(event) => { const file = event.target.files?.[0]; setQuotationFiles((current) => ({ ...current, [quotation.clientId]: file })); event.target.value = ""; }} /></label>
                <div className="quotation-actions"><label className={`recommend-option${blocked ? " disabled" : ""}`} title={blocked ? t("Rejected or inactive suppliers cannot be recommended.") : ""}><input type="radio" name="recommended-quotation" checked={quotation.recommended} disabled={blocked || !quotation.supplier} onChange={() => { updateQuotation(index, { recommended: true }); setForm((current) => ({ ...current, supplier: quotation.supplier })); }} /><CheckCircle2 size={17} /><span>{t("Recommend supplier")}</span></label><button type="button" className="icon-button danger" onClick={() => setQuotations((current) => current.filter((_, currentIndex) => currentIndex !== index))} title={t("Remove quotation")} aria-label={t("Remove quotation")}><Trash2 size={16} /></button></div>
              </article>;
            })}</MotionList>
            {quotations.some(quotationHasData) && <QuotationComparison quotations={quotations.filter(quotationHasData)} suppliers={masters.suppliers} />}
            <label className={`field${errors.supplierSelectionReason ? " field-error" : ""}`}><span>{t("Supplier selection reason")} {quotationPolicy.enabled && new Set(quotations.map((item) => item.supplier).filter(Boolean)).size > 1 ? "*" : ""}</span><textarea rows="3" value={form.supplierSelectionReason} onChange={(event) => { setForm((current) => ({ ...current, supplierSelectionReason: event.target.value })); if (event.target.value.trim()) setFieldError("supplierSelectionReason", ""); }} onBlur={() => quotationPolicy.enabled && new Set(quotations.map((item) => item.supplier).filter(Boolean)).size > 1 && setFieldError("supplierSelectionReason", requiredError(form.supplierSelectionReason, "Supplier selection reason is required."))} placeholder={t("Explain price, delivery, technical suitability, exclusivity, or commercial conditions.")} />{errors.supplierSelectionReason && <small className="field-error-text">{t(errors.supplierSelectionReason)}</small>}</label>
          </div>}
          <Link className="inline-link" to={`/suppliers?mode=new&returnTo=${encodeURIComponent(isEditing ? `/requests/${id}/edit` : `/requests/new${draftSearch}`)}`}>{t("Supplier not found? Open the official supplier proposal flow")}</Link>
        </div>}

        {stepId === "documents" && <div className="wizard-step"><div className="section-heading"><div><h3>{t("Supporting documents")}</h3><p>{t("Quotation evidence is attached to each supplier above; other configured evidence is uploaded here.")}</p></div></div><div className="document-requirement required"><FileText size={20} /><div><strong>{t("Mandatory document checklist")}</strong><p>{formPolicy.documentRequirements.length ? formPolicy.documentRequirements.map((rule) => isEitherOf(rule) ? t(rule.labelKey) : `${t(rule.labelKey)} x ${rule.minCount}`).join(" - ") : t("No additional configured evidence for this classification.")}</p></div></div><button type="button" className="text-button" aria-expanded={showOptionalDocuments} onClick={() => setShowOptionalDocuments(value => !value)}>{t(showOptionalDocuments ? "Hide optional documents" : "Additional documents")}</button><div className="document-grid">{documentDefinitions.map((document) => {
          const rule = ruleForKind(formPolicy.documentRequirements, document.kind);
          const existing = existingAttachments.filter((item) => item.kind === document.kind);
          const removed = storedAttachments.filter((item) => item.kind === document.kind && removedAttachmentIds.includes(String(item._id)));
          const attached = existing.length + (files[document.key]?.length || 0);
          // "Invoice XML or factura PDF": each card says the other one also does, and once either is
          // attached the other is optional.
          const alternatives = isEitherOf(rule) ? documentDefinitions.filter((item) => item.key !== document.key && coversKind(rule, item.kind)) : [];
          const quoted = isQuoteOrInvoice(rule) && (quotedWithEvidence > 0 || existingAttachments.some((file) => file.kind === "QUOTATION"));
          const metByAlternative = quoted || alternatives.some((item) => existingAttachments.some((file) => file.kind === item.kind) || files[item.key]?.length);
          const required = rule && !metByAlternative;
          const state = attached ? t("Files attached") : quoted ? t("Optional: the quote is attached") : metByAlternative ? t("Optional document") : isQuoteOrInvoice(rule) ? t("A quote or the invoice: one is enough") : isAnyDocument(rule) ? t("Any one document is enough") : alternatives.length ? t("Required: this or {other}").replace("{other}", alternatives.map((item) => t(item.label)).join(" / ")) : t(rule ? "Required document" : "Optional document");
          // The fee receipt card is for professional fees.
          const offTopic = isQuoteOrInvoice(rule) && document.kind === "FEE_RECEIPT" && form.expenseNature !== "PROFESSIONAL_FEES";
          return <label hidden={(!showOptionalDocuments || offTopic) && (!rule || offTopic) && !attached && !removed.length && !errors[document.key]} className={`document-upload${attached ? " is-attached" : ""}${errors[document.key] ? " field-error" : ""}`} key={document.key}><FileText size={22} /><span><strong>{t(document.label)}{required && !alternatives.length && !isQuoteOrInvoice(rule) ? ` *${rule.minCount > 1 ? ` (${rule.minCount})` : ""}` : ""}</strong><small className="document-state">{state}{attached ? ` · ${attached}` : ""}</small></span><input aria-label={t(document.label)} aria-invalid={Boolean(errors[document.key])} type="file" accept={document.accept} multiple={document.multiple} onChange={(event) => { const chosen = Array.from(event.target.files || []); setFiles((current) => ({ ...current, [document.key]: chosen })); if (["xml", "pdf"].includes(document.key) && form.flowType === "B" && chosen[0]) readInvoice(chosen[0]); event.target.value = ""; }} /><UploadedFileList
            stored={existing}
            removed={removed}
            chosen={files[document.key]}
            onRemoveStored={(file) => setRemovedAttachmentIds((current) => [...current, String(file._id)])}
            onRestoreStored={(file) => setRemovedAttachmentIds((current) => current.filter((item) => item !== String(file._id)))}
            onRemoveChosen={(index) => setFiles((current) => ({ ...current, [document.key]: current[document.key].filter((_, position) => position !== index) }))}
          />{errors[document.key] && <small className="field-error-text">{t(errors[document.key])}</small>}</label>;
        })}</div></div>}

        {stepId === "review" && <div className="wizard-step"><div className="section-heading"><div><h3>{t("Review and submit")}</h3><p>{t("Confirm the official request and financial-control information before submission.")}</p></div></div>
          {form.flowType !== "C" && invoiceCheck?.invoice && <InvoiceMatchStrip invoice={invoiceCheck.invoice} form={form} totals={totals} supplier={selectedSupplier} flowType={form.flowType} />}
          {form.flowType === "A1" && quotations.some(quotationHasData) && <QuotationComparison quotations={quotations.filter(quotationHasData)} suppliers={masters.suppliers} />}
          <RequestReview form={form} capex={capex} opexFrequency={opexFrequency} lines={lines} quotations={quotations.filter(quotationHasData)} quotationFiles={quotationFiles} files={files} existingAttachments={existingAttachments} masters={masters} totals={totals} budgetPreview={budgetPreview} selectedSupplier={selectedSupplier} onEdit={goToStep} />
        </div>}

        </MotionSurface>
      <div className="wizard-error"><Message type="error">{error}</Message></div>
      <footer className="wizard-actions"><button type="button" className="secondary-button" disabled={step === 0 || saving} onClick={() => goToStep(stepIds[Math.max(0, step - 1)])}><ChevronLeft size={16} /><span>{t("Back")}</span></button><div className="wizard-actions-right"><button type="button" className="secondary-button" disabled={saving} onClick={() => save(false)}><Save size={16} /><span>{t(saving ? "Saving..." : "Save draft")}</span></button>{stepId !== "review" ? <button type="button" className="primary-button" onClick={nextStep}><span>{t("Continue")}</span><ChevronRight size={16} /></button> : <button type="button" className="primary-button" disabled={saving} onClick={() => save(true)}><Send size={16} /><span>{t(saving ? "Submitting..." : "Submit for approval")}</span></button>}</div></footer>
      </div>
    </div>}
    </DraftPanel>
  </section>;
}
