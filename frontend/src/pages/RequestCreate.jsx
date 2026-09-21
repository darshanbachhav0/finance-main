import FileUploadInput from "../components/FileUploadInput.jsx";
import MotionSurface from "../components/MotionSurface.jsx";
import MotionList from "../components/MotionList.jsx";
import useWorkDraft, { useDraftResume } from "../hooks/useWorkDraft.js";
import DraftPanel from "../components/DraftPanel.jsx";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileCheck2,
  FileText,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import api from "../api/client.js";
import Message from "../components/Message.jsx";
import RequestItemLine from "../components/RequestItemLine.jsx";
import { restoreEditorLine, editRequestLine, requestLinePayload } from "../utils/requestLineEditor.js";
import PageHeader from "../components/PageHeader.jsx";
import WorkspaceSkeleton from "../components/WorkspaceSkeleton.jsx";
import SearchSelect from "../components/SearchSelect.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import QuotationPaymentTerms from "../components/QuotationPaymentTerms.jsx";
import QuotationComparison from "../components/QuotationComparison.jsx";
import BudgetRemainingSummary from "../components/BudgetRemainingSummary.jsx";
import { normalizePaymentTerms, validatePaymentTerms } from "../../../shared/paymentTerms.mjs";
import WorkflowStepper from "../components/WorkflowStepper.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
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
  requestTypeForFlow
} from "../utils/options.js";

const steps = ["Request information", "Supplier", "Documents", "Review and submit"];
const officialTypes = new Set(["CAPEX", "OPEX"]);
const supplierStatus = (supplier) => supplier?.homologationStatus || supplier?.status || "PENDING_VALIDATION";
const supplierName = (supplier) => supplier?.legalName || supplier?.name || "";
const supplierId = (value) => value?._id || value || "";
const attachmentId = (value) => value?._id || value || "";

const emptyLine = (costCenter = "", expenseType = "") => ({
  clientId: `${Date.now()}-${Math.random()}`,
  itemDescription: "",
  quantity: "1",
  unitOfMeasure: "UNIT",
  unitPrice: "",
  priceIncludesIGV: true,
  subtotal: 0,
  costCenter,
  expenseType,
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
  const today = new Date().toISOString().slice(0, 10);
  return {
    flowType: "A1",
    requestType: "OPEX",
    expenseNature: "SERVICES",
    priority: "MEDIA",
    requesterCostCenter: "",
    defaultExpenseType: "",
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

function money(value) {
  return Number(value || 0).toFixed(2);
}

export default function RequestCreate() {
  const [showOptionalDocuments, setShowOptionalDocuments] = useState(false);
  const { id } = useParams();
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const isEditing = Boolean(id);
  const draftKey = `erp_request_autosave_${user._id}_${id || "new"}`;
  const [masters, setMasters] = useState({ suppliers: [], costCenters: [], expenseTypes: [], projects: [], periods: [] });
  const [form, setForm] = useState(initialForm);
  const [capex, setCapex] = useState(initialCapex);
  const [opexFrequency, setOpexFrequency] = useState("ONE_OFF");
  const [lines, setLines] = useState([emptyLine()]);
  const [quotations, setQuotations] = useState([]);
  const [quotationFiles, setQuotationFiles] = useState({});
  const [files, setFiles] = useState(Object.fromEntries(documentDefinitions.map((item) => [item.key, []])));
  const [existingAttachments, setExistingAttachments] = useState([]);
  const [formPolicy, setFormPolicy] = useState({ documentRequirements: [], quotationPolicy: { enabled: false, minimumCount: 3 } });
  const [budgetPreview, setBudgetPreview] = useState({ status: "PENDING_VALIDATION", lines: [] });
  const [budgetRefresh, setBudgetRefresh] = useState(0);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState([]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [hydratedRecord, setHydratedRecord] = useState(null);
  const [sourceVersion, setSourceVersion] = useState("");
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
          api.get("/expense-types", { params: { pageSize: 100, active: true } }),
          api.get("/projects", { params: { pageSize: 100, active: true } }),
          api.get("/accounting-periods", { params: { pageSize: 100 } })
        ];
        if (isEditing) calls.push(api.get(`/requests/${id}`));
        const [suppliersResponse, centersResponse, expensesResponse, projectsResponse, periodsResponse, requestResponse] = await Promise.all(calls);
        if (!active) return;
        const nextMasters = {
          suppliers: suppliersResponse.data.data,
          costCenters: centersResponse.data.data,
          expenseTypes: expensesResponse.data.data.filter((item) => item.active),
          projects: projectsResponse.data.data.filter((item) => item.active),
          periods: periodsResponse.data.data
        };
        setMasters(nextMasters);

        if (requestResponse) {
          const request = requestResponse.data.data;
          setSourceVersion(request.updatedAt || "");
          const owner = request.requester?._id || request.solicitor?._id;
          if (!['BORRADOR', 'OBSERVADO', 'OBSERVADO_PRESUPUESTO', 'OBSERVADO_SUNAT', 'OBSERVADO_MONTO_EXCEDIDO', 'OBSERVADO_CARGA_MASIVA', 'DEVUELTO'].includes(request.status) || (user.role !== "Admin" && owner !== user._id)) {
            navigate(`/requests/${id}`, { replace: true });
            return;
          }
          const requestFlowType = request.flowType || (request.requestType === "ENTREGA_RENDIR" ? "C" : "A1");
          const serverForm = {
            ...initialForm(),
            flowType: requestFlowType,
            requestType: requestTypeForFlow(requestFlowType, request.requestType),
            expenseNature: request.expenseNature || "SERVICES",
            priority: request.priority || "MEDIA",
            requesterCostCenter: supplierId(request.requesterCostCenter),
            defaultExpenseType: supplierId(request.lines?.[0]?.expenseType),
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
            expenseType: supplierId(line.expenseType),
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
          const localDraft = localStorage.getItem(draftKey);
          const parsed = localDraft ? JSON.parse(localDraft) : null;
          const useLocal = parsed?.savedAt && new Date(parsed.savedAt) > new Date(request.updatedAt);
          const localForm = parsed?.form
            ? {
                ...parsed.form,
                requestType: requestTypeForFlow(parsed.form.flowType || requestFlowType, parsed.form.requestType)
              }
            : null;
          setForm(useLocal && localForm ? localForm : serverForm);
          setCapex(useLocal ? parsed.capex || serverCapex : serverCapex);
          setOpexFrequency(useLocal ? parsed.opexFrequency || request.opexDetails?.expenseFrequency || "ONE_OFF" : request.opexDetails?.expenseFrequency || "ONE_OFF");
          setLines((useLocal && parsed.lines?.length ? parsed.lines : serverLines).map(restoreEditorLine));
          setQuotations(useLocal ? parsed.quotations || serverQuotations : serverQuotations);
          setExistingAttachments(request.attachments || []);
        } else {
          const localDraft = localStorage.getItem(draftKey);
          if (localDraft) {
            const parsed = JSON.parse(localDraft);
            const restoredForm = parsed.form || initialForm();
            setForm({
              ...restoredForm,
              requestType: requestTypeForFlow(restoredForm.flowType || "A1", restoredForm.requestType)
            });
            setCapex(parsed.capex || initialCapex);
            setOpexFrequency(parsed.opexFrequency || "ONE_OFF");
            setLines(parsed.lines?.length ? parsed.lines.map(restoreEditorLine) : [emptyLine()]);
            setQuotations(parsed.quotations || []);
          } else {
            const defaultCenter = supplierId(user.costCenter) || nextMasters.costCenters[0]?._id || "";
            setForm((current) => ({ ...current, requesterCostCenter: defaultCenter, schoolOrDepartment: user.area || "" }));
            setLines([emptyLine(defaultCenter)]);
          }
        }
        const createdSupplierId = location.state?.createdSupplierId;
        if (createdSupplierId) {
          setForm((current) => ({ ...current, supplier: current.supplier || createdSupplierId }));
          setQuotations((current) => {
            const target = current.length ? current : [emptyQuotation()];
            const emptyIndex = target.findIndex((item) => !item.supplier);
            return target.map((item, index) => index === (emptyIndex < 0 ? 0 : emptyIndex) ? { ...item, supplier: createdSupplierId } : item);
          });
          notify("Supplier proposal linked to the request quotation.", "success");
          navigate(location.pathname, { replace: true, state: null });
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
            return Array.from({ length: policy.quotationPolicy.minimumCount }, emptyQuotation);
          });
        } else {
          setQuotations((current) => current.some(quotationHasData) ? current : []);
        }
      })
      .catch((err) => active && setError(err.message));
    return () => { active = false; };
  }, [form.flowType, form.requestType, form.expenseNature, hydrated]);

  const draft = useWorkDraft({ scope: "request", recordId: id || "new", title: "Financial request", enabled: hydrated && !loading && hydratedRecord === (id || "new"), sourceVersion,
    value: { form, capex, opexFrequency, lines, quotations, files, quotationFiles, step, maxStep, completedSteps },
    restore: data => { if (!data) return; setForm(data.form); setCapex(data.capex); setOpexFrequency(data.opexFrequency); setLines(data.lines.map(restoreEditorLine)); setQuotations(data.quotations); setFiles(data.files || Object.fromEntries(documentDefinitions.map(item => [item.key, []]))); setQuotationFiles(data.quotationFiles || {}); setStep(data.step || 0); setMaxStep(data.maxStep || 0); setCompletedSteps(data.completedSteps || []); }
  });
  useEffect(() => { if (draft.ready) void draft.flush(); }, [step]);
  useEffect(() => { if (draft.status === "saved") localStorage.removeItem(draftKey); }, [draft.status, draftKey]);

  const budgetPayload = useMemo(() => ({
    flowType: form.flowType, requestType: form.requestType, expenseNature: form.expenseNature,
    issueDate: form.issueDate, accountingPeriod: form.accountingPeriod, currency: form.currency,
    project: form.requestType === "CAPEX" ? capex.projectPep || masters.projects.find(item => item._id === capex.projectId)?.code : undefined,
    lines: lines.map(requestLinePayload)
  }), [form.flowType, form.requestType, form.expenseNature, form.issueDate, form.accountingPeriod, form.currency, capex.projectPep, capex.projectId, masters.projects, lines]);

  useEffect(() => {
    if (!hydrated || !form.accountingPeriod || lines.some((line) => !line.costCenter || !line.expenseType || !(Number(line.totalAmount) > 0))) {
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
  const quotationPolicy = formPolicy.quotationPolicy || { enabled: false, minimumCount: 3 };
  const eligibleSuppliers = useMemo(() => masters.suppliers.filter((supplier) => {
    const status = supplierStatus(supplier);
    return !["REJECTED", "INACTIVE"].includes(status) || supplier._id === form.supplier;
  }), [masters.suppliers, form.supplier]);
  const allowedExpenseTypes = useMemo(() => masters.expenseTypes.filter((item) => {
    const typeAllowed = !item.permittedRequestTypes?.length || item.permittedRequestTypes.includes(form.requestType);
    const natureAllowed = !item.permittedExpenseNatures?.length || item.permittedExpenseNatures.includes(form.expenseNature);
    const categoryAllowed = !["CAPEX", "OPEX"].includes(form.requestType) || item.category === form.requestType;
    return typeAllowed && natureAllowed && categoryAllowed;
  }), [masters.expenseTypes, form.requestType, form.expenseNature]);
  const totals = useMemo(() => {
    const cents = lines.reduce((result, line) => ({ net: result.net + Math.round(Number(line.netAmount || 0) * 100), igv: result.igv + Math.round(Number(line.igvAmount || 0) * 100), total: result.total + Math.round(Number(line.totalAmount || 0) * 100) }), { net: 0, igv: 0, total: 0 });
    return { net: cents.net / 100, igv: cents.igv / 100, total: cents.total / 100 };
  }, [lines]);
  useEffect(() => {
    if (!hydrated) return;
    const selected = allowedExpenseTypes.find(item => item._id === form.defaultExpenseType)?._id;
    const automatic = selected || (allowedExpenseTypes.length === 1 ? allowedExpenseTypes[0]._id : "");
    if (automatic && !form.defaultExpenseType) setForm(current => ({ ...current, defaultExpenseType: automatic }));
    if (automatic) setLines(current => current.some(line => !line.expenseType) ? current.map(line => line.expenseType ? line : { ...line, expenseType: automatic }) : current);
  }, [hydrated, form.defaultExpenseType, allowedExpenseTypes]);

  function setDefaultExpenseType(value) {
    const previous = form.defaultExpenseType;
    setForm(current => ({ ...current, defaultExpenseType: value }));
    setLines(current => current.map(line => !line.expenseType || line.expenseType === previous ? { ...line, expenseType: value } : line));
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

  function validationForStep(index, submitting) {
    const next = {};
    if (index === 0) {
      ["requestType", "expenseNature", "priority", "requesterCostCenter", "issueDate", "accountingPeriod", "currency", "description"].forEach((field) => {
        if (!String(form[field] || "").trim()) next[field] = "This field is required.";
      });
      if (["A1", "B"].includes(form.flowType) && !requestCreationClassifications.includes(form.requestType)) {
        next.requestType = "Select CAPEX or OPEX.";
      }
      if (form.flowType === "C" && form.requestType !== "ENTREGA_RENDIR") {
        next.requestType = "Track C is an advance to render and is classified at rendition validation.";
      }
      if (officialRequest && submitting) {
        [["title", "Requirement title is required."], ["detailedDescription", "Detailed description is required."], ["businessJustification", "Business justification is required."], ["nonApprovalRisk", "Risk if not approved is required."]].forEach(([field, message]) => {
          if (!String(form[field] || "").trim()) next[field] = message;
        });
      }
      const period = masters.periods.find((item) => item.period === form.accountingPeriod);
      if (form.accountingPeriod && (!period || period.status !== "OPEN")) next.accountingPeriod = "Accounting period must be open.";
    }
    if (index === 0) {
      if (!lines.length) next.lines = "At least one request line is required.";
      lines.forEach((line, lineIndex) => {
        if (!String(line.itemDescription || "").trim() && (!line.legacyAmounts || officialRequest && submitting)) next[`lines.${lineIndex}.itemDescription`] = "Item description is required.";
        if (!line.costCenter) next[`lines.${lineIndex}.costCenter`] = "Select a Cost Center.";
        if (!line.expenseType || !allowedExpenseTypes.some(item => item._id === line.expenseType)) next[`lines.${lineIndex}.expenseType`] = "Select an expense account.";
        if (!(Number(line.totalAmount) > 0)) next[`lines.${lineIndex}.totalAmount`] = "Total must be greater than zero.";
        if (!line.legacyAmounts) {
          if (!(Number(line.quantity) > 0) || !Number.isFinite(Number(line.quantity))) next[`lines.${lineIndex}.quantity`] = "Enter a valid quantity.";
          if (!(Number(line.unitPrice) > 0) || !Number.isFinite(Number(line.unitPrice))) next[`lines.${lineIndex}.unitPrice`] = "Enter a valid unit price.";
          if (!line.unitOfMeasure) next[`lines.${lineIndex}.unitOfMeasure`] = "Select a unit of measure.";
          if (line.calculationError) next[`lines.${lineIndex}.${line.calculationError.includes("quantity") || line.calculationError.includes("Quantity") ? "quantity" : "unitPrice"}`] = line.calculationError;
        }
      });
    }
    if (index === 1) {
      if (form.flowType === "A1") quotations.forEach((quotation, quoteIndex) => {
        validatePaymentTerms(quotation, { requireComplete: submitting }).forEach(({ field, message }) => {
          next[`quotations.${quoteIndex}.${field}`] = message;
        });
      });
      if (quotationPolicy.enabled && submitting) {
        if (new Set(quotations.map((item) => item.supplier).filter(Boolean)).size < quotationPolicy.minimumCount) next.quotations = `At least ${quotationPolicy.minimumCount} different supplier quotations are required.`;
        quotations.forEach((quotation, quoteIndex) => {
          if (!quotation.supplier) next[`quotations.${quoteIndex}.supplier`] = "Select a supplier.";
          if (!(Number(quotation.amount) > 0)) next[`quotations.${quoteIndex}.amount`] = "Quotation amount must be greater than zero.";
          if (!quotation.attachment && !quotationFiles[quotation.clientId]) next[`quotations.${quoteIndex}.attachment`] = "Quotation evidence is required.";
        });
        const recommended = quotations.filter((item) => item.recommended);
        if (recommended.length !== 1) next.recommended = "Select exactly one recommended supplier.";
        if (!form.supplierSelectionReason.trim()) next.supplierSelectionReason = "Supplier selection reason is required.";
      }
      if (!quotationPolicy.enabled && submitting && !form.supplier && form.flowType !== "C") next.supplier = "Select a supplier.";
    }
    if (index === 2 && submitting) {
      formPolicy.documentRequirements.forEach((rule) => {
        if (rule.kind === "QUOTATION") return;
        const definition = documentDefinitions.find((item) => item.kind === rule.kind);
        if (!definition) return;
        const count = existingAttachments.filter((item) => item.kind === rule.kind).length + (files[definition.key]?.length || 0);
        if (count < rule.minCount) next[definition.key] = t("A minimum of {count} {document} file(s) is required.").replace("{document}", t(definition.label)).replace("{count}", String(rule.minCount));
      });
    }
    return next;
  }

  function nextStep() {
    const nextErrors = validationForStep(step, false);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      notify("Review the highlighted fields before continuing.", "error");
      validationFocusRef.current = window.requestAnimationFrame(() => {
        const error = window.document.querySelector(".field-error-text");
        error?.scrollIntoView({ behavior: "smooth", block: "center" });
        error?.closest(".field, .document-upload")?.querySelector("input, select, textarea, button")?.focus({ preventScroll: true });
      });
      return;
    }
    setCompletedSteps((current) => [...new Set([...current, step])]);
    setStep((current) => Math.min(3, current + 1));
    setMaxStep((current) => Math.max(current, step + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(sendForApproval) {
    if (!draft.ready || draft.status === "conflict") return;
    const validations = [0, 1, 2].map((index) => validationForStep(index, sendForApproval));
    const firstInvalid = validations.findIndex((item) => Object.keys(item).length);
    if (firstInvalid >= 0) {
      setErrors(validations[firstInvalid]);
      setStep(firstInvalid);
      notify("Review the highlighted fields before continuing.", "error");
      return;
    }
    setSaving(true);
    setError("");
    const data = new FormData();
    const payloadForm = {
      ...form,
      requestType: requestTypeForFlow(form.flowType, form.requestType),
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
    data.append("quotations", JSON.stringify(quotations.map((quotation) => ({
      ...quotation,
      clientId: undefined,
      attachment: quotationFiles[quotation.clientId] ? undefined : quotation.attachment
    }))));
    data.append("submit", String(sendForApproval));
    Object.entries(files).forEach(([key, selectedFiles]) => selectedFiles.forEach((file) => data.append(key, file)));
    quotations.forEach((quotation) => {
      const file = quotationFiles[quotation.clientId];
      if (file) data.append("quotation", file);
    });
    try {
      const response = isEditing
        ? await api.put(`/requests/${id}`, data, { headers: { "Content-Type": "multipart/form-data" }, onUploadProgress: event => setUploadProgress(event.total ? Math.min(100, Math.round(event.loaded / event.total * 100)) : null) })
        : await api.post("/requests", data, { headers: { "Content-Type": "multipart/form-data" }, onUploadProgress: event => setUploadProgress(event.total ? Math.min(100, Math.round(event.loaded / event.total * 100)) : null) });
      await draft.complete();
      localStorage.removeItem(draftKey);
      notify(sendForApproval ? "Request submitted for approval." : isEditing ? "Draft request updated." : "Draft request created.");
      navigate(`/requests/${response.data.data._id}`);
    } catch (err) {
      const detailErrors = err.details?.errors || err.details?.missing || [];
      const details = detailErrors.map((item) => t(item.code || item.label || "Validation error")).join(" ");
      setError(`${err.message}${details ? ` ${details}` : ""}`);
      notify(err.message, "error");
    } finally {
      setSaving(false); setUploadProgress(null);
    }
  }

  if (loading) return <WorkspaceSkeleton label={isEditing ? "Loading request..." : "Loading form data..."} />;

  return <section>
    {saving && <div role="status" className="upload-progress"><progress max="100" value={uploadProgress ?? undefined} /><span>{t(uploadProgress === 100 ? "Upload sent. Validating and saving..." : "Uploading...")}{uploadProgress !== null && uploadProgress < 100 ? ` ${uploadProgress}%` : ""}</span></div>}
    <PageHeader
      title={isEditing ? "Edit request" : "Create request"}
      description="RCO-FOR-001 request information, commercial comparison, and existing financial controls in one workflow."
      actions={null}
    />
    <DraftPanel busy={saving} draft={draft} onDiscard={() => { localStorage.removeItem(draftKey); navigate("/requests"); }}>
    <Message type="error">{error}</Message>
    <div className="request-wizard official-request-wizard">
      <WorkflowStepper steps={steps} current={step} completedSteps={completedSteps} maxAccessible={maxStep} onSelect={(next) => next <= maxStep && setStep(next)} />
      <div className="wizard-financial-context"><span>{t("Step {step} of {total}").replace("{step}", step + 1).replace("{total}", steps.length)} · {t(steps[step])}</span><span>{t("Total amount")}<strong>{form.currency} {money(totals.total)}</strong></span><small>{t("Fields marked * are required.")}</small></div>
      <div className="wizard-workspace">
        <MotionSurface changeKey={step} directional>
        {step === 0 && <div className="wizard-step">
          <div className="section-heading"><div><h3>{t("General information")}</h3><p>{t("Identify the request, authorized CECO, period, and institutional need.")}</p></div></div>
          <div className="form-grid two-column-form">
            <label className="field"><span>{t("Operational track")} *</span><select value={form.flowType} onChange={(event) => { const flowType = event.target.value; setForm((current) => ({ ...current, flowType, requestType: requestTypeForFlow(flowType, current.requestType), supplier: flowType === "C" ? "" : current.supplier })); }}>{flowTypes.filter((type) => type !== "A2").map((type) => <option key={type} value={type}>{t(optionLabel(type, flowTypeLabels))}</option>)}</select><small>{t(form.flowType === "A1" ? "Formal purchase with quotations and PO." : form.flowType === "B" ? "Direct invoice / advance payment with mandatory XML + PDF." : "Advance to render / petty cash; expense budget is executed at rendition validation.")}</small></label>
            {form.flowType !== "C" && <label className={`field${errors.requestType ? " field-error" : ""}`}><span>CAPEX / OPEX *</span><select value={form.requestType} onChange={(event) => setForm((current) => ({ ...current, requestType: event.target.value }))}>{requestCreationClassifications.map((type) => <option key={type} value={type}>{t(optionLabel(type, expenditureClassificationLabels))}</option>)}</select>{errors.requestType && <small className="field-error-text">{t(errors.requestType)}</small>}<small>{t("The operational track defines how the transaction is processed; CAPEX / OPEX defines the economic classification of the spend.")}</small></label>}
            <label className="field"><span>{t("Expense nature")} *</span><select value={form.expenseNature} onChange={(event) => setForm((current) => ({ ...current, expenseNature: event.target.value }))}>{expenseNatures.map((item) => <option key={item} value={item}>{t(optionLabel(item, expenseNatureLabels))}</option>)}</select></label>
            <label className="field"><span>{t("Priority")} *</span><select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}>{requestPriorities.map((item) => <option key={item}>{t(item)}</option>)}</select></label>
            <label className="field"><span>{t("Requesting area")}</span><input value={user.area || "General"} disabled title={t("Assigned from the signed-in user profile.")} /></label>
            <div className="form-span-two"><SearchSelect label="Cost Center / CECO" value={form.requesterCostCenter} options={masters.costCenters} onChange={setHeaderCostCenter} getOptionLabel={(item) => `${item.code} - ${item.name}${item.area ? ` (${item.area})` : ""}`} error={errors.requesterCostCenter} required searchPlaceholder="Search authorized CECO..." /><small className="field-hint">{t("Only Cost Centers assigned to your profile are available.")}</small></div>
            <label className="field"><span>{t("Area correlative")}</span><input value={form.areaCorrelative} onChange={(event) => setForm((current) => ({ ...current, areaCorrelative: event.target.value }))} /></label>
            <label className="field"><span>{t("School / department")}</span><input value={form.schoolOrDepartment} onChange={(event) => setForm((current) => ({ ...current, schoolOrDepartment: event.target.value }))} /></label>
            <label className="field"><span>{t("Issue date")} *</span><input type="date" value={form.issueDate} onChange={(event) => setForm((current) => ({ ...current, issueDate: event.target.value, accountingPeriod: event.target.value.slice(0, 7) }))} /></label>
            <label className={`field${errors.accountingPeriod ? " field-error" : ""}`}><span>{t("Request month")} *</span><select value={form.accountingPeriod} onChange={(event) => setForm((current) => ({ ...current, accountingPeriod: event.target.value }))}><option value="">{t("Select")}</option>{masters.periods.map((period) => <option key={period._id} value={period.period} disabled={period.status !== "OPEN"}>{period.period} - {t(period.status)}</option>)}</select>{errors.accountingPeriod && <small className="field-error-text">{t(errors.accountingPeriod)}</small>}</label>
            <label className="field"><span>{t("Currency")} *</span><select value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
            <label className="field"><span>{t("Requirement title")} *</span><input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />{errors.title && <small className="field-error-text">{t(errors.title)}</small>}</label>
            <label className="field form-span-two"><span>{t("Detailed description")} *</span><textarea rows="4" value={form.detailedDescription} onChange={(event) => setForm((current) => ({ ...current, detailedDescription: event.target.value, description: event.target.value }))} />{errors.detailedDescription && <small className="field-error-text">{t(errors.detailedDescription)}</small>}</label>
            <label className="field form-span-two"><span>{t("Business justification")} *</span><textarea rows="3" value={form.businessJustification} onChange={(event) => setForm((current) => ({ ...current, businessJustification: event.target.value }))} />{errors.businessJustification && <small className="field-error-text">{t(errors.businessJustification)}</small>}</label>
            <label className="field form-span-two"><span>{t("Risk if not approved")} *</span><textarea rows="3" value={form.nonApprovalRisk} onChange={(event) => setForm((current) => ({ ...current, nonApprovalRisk: event.target.value }))} />{errors.nonApprovalRisk && <small className="field-error-text">{t(errors.nonApprovalRisk)}</small>}</label>
          </div>

          {form.flowType === "C" && <div className="inline-alert alert-info"><FileCheck2 size={18} /><div><strong>{t("Track C - Advance to render")}</strong><span>{t("CAPEX / OPEX is not selected when the advance is created. The final expense is recognized when Accounting validates the rendition.")}</span></div></div>}

          {form.flowType === "B" && form.requestType === "CAPEX" && <div className="inline-alert alert-warning"><AlertTriangle size={18} /><div><strong>{t("Direct CAPEX purchase")}</strong><span>{t("Track B has no prior Purchase Order. Provide a clear business justification and the required supporting evidence for this capital expenditure.")}</span></div></div>}

          {form.requestType === "CAPEX" && <div className="official-subsection"><div className="section-heading compact"><div><h3>{t("CAPEX financial information")}</h3><p>{t("Planning information is recorded only; no depreciation or NPV calculation is generated.")}</p></div></div><div className="form-grid three-column-form">
            <label className="field"><span>{t("Project / PEP")}</span><select value={capex.projectId} onChange={(event) => { const project = masters.projects.find((item) => item._id === event.target.value); setCapex((current) => ({ ...current, projectId: event.target.value, projectPep: project?.code || current.projectPep })); }}><option value="">{t("No project")}</option>{masters.projects.map((project) => <option key={project._id} value={project._id}>{project.code} - {project.name}</option>)}</select></label>
            <label className="field"><span>{t("Fixed asset category")}</span><select value={capex.assetCategory} onChange={(event) => setCapex((current) => ({ ...current, assetCategory: event.target.value }))}><option value="">{t("Select")}</option>{["INFRASTRUCTURE", "MACHINERY", "IT_HARDWARE", "SOFTWARE_LICENSES"].map((value) => <option key={value} value={value}>{t(value)}</option>)}</select></label>
            <label className="field"><span>{t("Useful life (years)")}</span><input type="number" min="0" step="1" value={capex.usefulLifeYears} onChange={(event) => setCapex((current) => ({ ...current, usefulLifeYears: event.target.value }))} /></label>
            <label className="field"><span>{t("NPV / VAN amount")}</span><input type="number" step="0.01" value={capex.npvAmount} onChange={(event) => setCapex((current) => ({ ...current, npvAmount: event.target.value }))} /></label>
            <label className="field"><span>{t("NPV currency")}</span><select value={capex.npvCurrency} onChange={(event) => setCapex((current) => ({ ...current, npvCurrency: event.target.value }))}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
            <div className="field"><span>{t("Payback")}</span><div className="compound-field"><input aria-label={t("Payback value")} type="number" min="0" step="0.01" value={capex.paybackValue} onChange={(event) => setCapex((current) => ({ ...current, paybackValue: event.target.value }))} /><select aria-label={t("Payback unit")} value={capex.paybackUnit} onChange={(event) => setCapex((current) => ({ ...current, paybackUnit: event.target.value }))}><option value="MONTHS">{t("Months")}</option><option value="YEARS">{t("Years")}</option></select></div></div>
          </div></div>}

          <div className="official-subsection request-default-account"><SearchSelect label="Expense category for these items" value={form.defaultExpenseType || ""} options={allowedExpenseTypes} onChange={setDefaultExpenseType} getOptionLabel={item => item.name} searchPlaceholder="Search expense category..." required /><p className="section-note">{t("Choose the expense category for these items.")}</p></div>

          {form.requestType === "OPEX" && <div className="official-subsection"><div className="section-heading compact"><div><h3>{t("OPEX financial information")}</h3><p>{t("The expense account remains controlled by the configured accounting master.")}</p></div></div><label className="field field-narrow"><span>{t("Expense frequency")}</span><select value={opexFrequency} onChange={(event) => setOpexFrequency(event.target.value)}><option value="ONE_OFF">{t("One-off")}</option><option value="MONTHLY_RECURRING">{t("Monthly recurring")}</option><option value="EVERY_3_MONTHS">{language === "es" ? "Cada 3 meses" : "Every 3 months"}</option><option value="ANNUAL_RENEWAL">{t("Annual renewal")}</option></select></label></div>}
          <div className="section-heading"><div><h3>{t("Item / service breakdown")}</h3><p>{t("Enter the quantity and unit price. We calculate IGV and the final total for you.")}</p></div><button type="button" className="secondary-button" onClick={() => setLines(current => [...current, emptyLine(form.requesterCostCenter, form.defaultExpenseType)])}><Plus size={16} /><span>{t("Add line")}</span></button></div>
          <MotionList className="official-line-list">{lines.map((line, index) => <RequestItemLine key={line.clientId} line={line} index={index} currency={form.currency} errors={errors} onChange={patch => updateLine(index, patch)} canRemove={lines.length > 1} onRemove={() => setLines(current => current.filter((_, currentIndex) => currentIndex !== index))} />)}</MotionList>
          <div className="request-items-total"><span>{t("Request total")}</span><strong>{form.currency} {Number(totals.total).toLocaleString(language === "es" ? "es-PE" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
          <details className="request-budget-adjustments" open={Object.keys(errors).some(key => /lines\.\d+\.(costCenter|expenseType)/.test(key)) ? true : undefined}>
            <summary>{t("Adjust budget allocation")}</summary>
            <p className="section-note">{t("Items inherit the request's cost center and expense account. Adjust only when an item uses a different budget.")}</p>
            {lines.map((line, index) => <div className="request-budget-line" key={line.clientId}><strong>{t("Item")} {index + 1}: {line.itemDescription || t("Item / service description")}</strong><div className="form-grid two-column-form"><SearchSelect label="Cost Center / CECO" value={line.costCenter} options={masters.costCenters} onChange={value => updateLine(index, { costCenter: value })} getOptionLabel={item => item.code + " - " + item.name} error={errors["lines." + index + ".costCenter"]} required searchPlaceholder="Search authorized CECO..." /><SearchSelect label="Expense type" value={line.expenseType} options={allowedExpenseTypes} onChange={value => updateLine(index, { expenseType: value })} getOptionLabel={item => item.name} error={errors["lines." + index + ".expenseType"]} required searchPlaceholder="Search expense category..." /></div></div>)}
          </details>

        </div>}

        {step === 1 && <div className="wizard-step">{form.flowType === "C" && <p>{t("The advance is paid to the requester. No supplier is required.")}</p>}
          {form.flowType !== "C" && !quotationPolicy.enabled && <div className="official-subsection"><div className="section-heading compact"><div><h3>{t("Supplier")}</h3><p>{t("Select the supplier linked to this request. Pending or observed suppliers may continue through review but must be homologated before budget commitment.")}</p></div></div><div className="form-grid two-column-form"><SearchSelect label="Supplier" value={form.supplier} options={eligibleSuppliers} onChange={(value) => setForm((current) => ({ ...current, supplier: value }))} getOptionLabel={(item) => `${item.supplierCode ? `${item.supplierCode} - ` : ""}${item.rucDni} - ${supplierName(item)} - ${t(supplierStatus(item))}`} error={errors.supplier} required searchPlaceholder="Search name or RUC/DNI..." />{selectedSupplier && <div className="supplier-inline-status"><div><strong>{supplierName(selectedSupplier)}</strong><span>{selectedSupplier.rucDni}{selectedSupplier.supplierCode ? ` - ${selectedSupplier.supplierCode}` : ""}</span></div><StatusBadge status={supplierStatus(selectedSupplier)} /></div>}</div><Link className="inline-link" to={`/suppliers?mode=new&returnTo=${encodeURIComponent(isEditing ? `/requests/${id}/edit` : "/requests/new")}`}>{t("Supplier not found? Open the official supplier proposal flow")}</Link></div>}

          {form.flowType !== "C" && <div className="official-subsection quotation-section"><div className="section-heading"><div><h3>{t("Supplier quotations")}</h3><p>{quotationPolicy.enabled ? t("The configured policy requires {count} different suppliers with evidence.").replace("{count}", quotationPolicy.minimumCount) : t("Quotation comparison is optional for this classification.")}</p></div><button type="button" className="secondary-button" onClick={() => setQuotations((current) => [...current, emptyQuotation()])}><Plus size={16} /><span>{t("Add quotation")}</span></button></div>
            {errors.quotations && <Message type="error">{errors.quotations}</Message>}
            <MotionList className="quotation-grid">{quotations.map((quotation, index) => {
              const supplier = masters.suppliers.find((item) => item._id === quotation.supplier);
              const status = supplierStatus(supplier);
              const blocked = ["REJECTED", "INACTIVE"].includes(status);
              const evidence = existingAttachments.find((item) => String(item._id) === String(quotation.attachment));
              return <article className={`quotation-card${quotation.recommended ? " recommended" : ""}`} key={quotation.clientId} data-motion-key={quotation.clientId}><div className="quotation-card-head"><span>{t("Quotation")} {index + 1}</span>{supplier && <StatusBadge status={status} />}</div>
                <SearchSelect label="Supplier" value={quotation.supplier} options={masters.suppliers} onChange={(value) => updateQuotation(index, { supplier: value, recommended: false })} getOptionLabel={(item) => `${item.supplierCode ? `${item.supplierCode} - ` : ""}${item.rucDni} - ${supplierName(item)} - ${t(supplierStatus(item))}`} error={errors[`quotations.${index}.supplier`]} required searchPlaceholder="Search name or RUC/DNI..." />
                {supplier && <div className="supplier-inline-status"><div><strong>{supplierName(supplier)}</strong><span>{supplier.rucDni}{supplier.supplierCode ? ` - ${supplier.supplierCode}` : ""}</span></div></div>}
                <div className="form-grid two-column-form"><label className="field"><span>{t("Amount")} *</span><input type="number" min="0" step="0.01" value={quotation.amount} onChange={(event) => updateQuotation(index, { amount: event.target.value })} /></label><label className="field"><span>{t("Currency")}</span><select value={quotation.currency} onChange={(event) => updateQuotation(index, { currency: event.target.value })}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label><label className="field"><span>{t("Delivery period")}</span><input value={quotation.deliveryPeriod} onChange={(event) => updateQuotation(index, { deliveryPeriod: event.target.value })} /></label></div>
                <QuotationPaymentTerms quotation={quotation} onChange={(changes) => updateQuotation(index, changes)} errors={errors} errorPrefix={`quotations.${index}.`} />
                <label className="field"><span>{t("Commercial conditions")}</span><textarea rows="2" value={quotation.commercialConditions} onChange={(event) => updateQuotation(index, { commercialConditions: event.target.value })} /></label>
                <label className={`quotation-evidence${errors[`quotations.${index}.attachment`] ? " field-error" : ""}`}><FileText size={18} /><span><strong>{quotationFiles[quotation.clientId]?.name || evidence?.originalName || t("Attach quotation evidence")}</strong><small>{quotationFiles[quotation.clientId] || evidence ? t("Evidence attached") : t("Evidence missing")}</small></span><FileUploadInput type="file" accept=".pdf,.doc,.docx,.xlsx,.jpg,.jpeg,.png" onChange={(event) => setQuotationFiles((current) => ({ ...current, [quotation.clientId]: event.target.files?.[0] }))} /></label>
                <div className="quotation-actions"><label className={`recommend-option${blocked ? " disabled" : ""}`} title={blocked ? t("Rejected or inactive suppliers cannot be recommended.") : ""}><input type="radio" name="recommended-quotation" checked={quotation.recommended} disabled={blocked || !quotation.supplier} onChange={() => { updateQuotation(index, { recommended: true }); setForm((current) => ({ ...current, supplier: quotation.supplier })); }} /><CheckCircle2 size={17} /><span>{t("Recommend supplier")}</span></label><button type="button" className="icon-button danger" onClick={() => setQuotations((current) => current.filter((_, currentIndex) => currentIndex !== index))} title={t("Remove quotation")}><Trash2 size={16} /></button></div>
              </article>;
            })}</MotionList>
            {quotations.some(quotationHasData) && <QuotationComparison quotations={quotations.filter(quotationHasData)} suppliers={masters.suppliers} />}
            <Link className="inline-link" to={`/suppliers?mode=new&returnTo=${encodeURIComponent(isEditing ? `/requests/${id}/edit` : "/requests/new")}`}>{t("Supplier not found? Open the official supplier proposal flow")}</Link>
            <label className="field"><span>{t("Supplier selection reason")} {quotationPolicy.enabled ? "*" : ""}</span><textarea rows="3" value={form.supplierSelectionReason} onChange={(event) => setForm((current) => ({ ...current, supplierSelectionReason: event.target.value }))} placeholder={t("Explain price, delivery, technical suitability, exclusivity, or commercial conditions.")} />{errors.supplierSelectionReason && <small className="field-error-text">{t(errors.supplierSelectionReason)}</small>}</label>
          </div>}

          <BudgetRemainingSummary payload={budgetPayload} preview={budgetPreview} loading={budgetLoading} onRefresh={() => setBudgetRefresh(value => value + 1)} expenseTypes={masters.expenseTypes} />
        </div>}

        {step === 2 && <div className="wizard-step"><div className="section-heading"><div><h3>{t("Supporting documents")}</h3><p>{t("Quotation evidence is attached to each supplier above; other configured evidence is uploaded here.")}</p></div></div><div className="document-requirement required"><FileText size={20} /><div><strong>{t("Mandatory document checklist")}</strong><p>{formPolicy.documentRequirements.length ? formPolicy.documentRequirements.map((rule) => `${t(rule.labelKey)} x ${rule.minCount}`).join(" - ") : t("No additional configured evidence for this classification.")}</p></div></div><button type="button" className="text-button" aria-expanded={showOptionalDocuments} onClick={() => setShowOptionalDocuments(value => !value)}>{t(showOptionalDocuments ? "Hide optional documents" : "Additional documents")}</button><div className="document-grid">{documentDefinitions.map((document) => {
          const rule = formPolicy.documentRequirements.find((item) => item.kind === document.kind);
          const existing = existingAttachments.filter((item) => item.kind === document.kind);
          const attached = existing.length + (files[document.key]?.length || 0);
          return <label hidden={!showOptionalDocuments && !rule && !attached && !errors[document.key]} className={`document-upload${attached ? " is-attached" : ""}${errors[document.key] ? " field-error" : ""}`} key={document.key}><FileText size={22} /><span><strong>{t(document.label)}{rule ? ` *${rule.minCount > 1 ? ` (${rule.minCount})` : ""}` : ""}</strong><small className="document-state">{t(attached ? "Files attached" : rule ? "Required document" : "Optional document")}{attached ? ` · ${attached}` : ""}</small></span><FileUploadInput aria-label={t(document.label)} aria-invalid={Boolean(errors[document.key])} type="file" accept={document.accept} multiple={document.multiple} onChange={(event) => setFiles((current) => ({ ...current, [document.key]: Array.from(event.target.files || []) }))} /><div className="file-list">{existing.map((file) => <span key={file._id}>{file.originalName} - {t("Already uploaded")}</span>)}{files[document.key].map((file) => <span key={`${file.name}-${file.size}`}>{file.name} - {(file.size / 1024).toFixed(0)} KB</span>)}</div>{errors[document.key] && <small className="field-error-text">{t(errors[document.key])}</small>}</label>;
        })}</div></div>}

        {step === 3 && <div className="wizard-step"><div className="section-heading"><div><h3>{t("Review and submit")}</h3><p>{t("Confirm the official request and financial-control information before submission.")}</p></div></div>{form.flowType === "A1" && quotations.some(quotationHasData) && <QuotationComparison quotations={quotations.filter(quotationHasData)} suppliers={masters.suppliers} />}<div className="review-layout"><div className="review-section"><div className="section-heading compact"><h3>{t("Requirement")}</h3><button type="button" className="text-button" onClick={() => setStep(0)}>{t("Edit")}</button></div><dl className="detail-grid"><div><dt>{t("Operational track")}</dt><dd>{t(optionLabel(form.flowType, flowTypeLabels))}</dd></div><div><dt>CAPEX / OPEX</dt><dd>{form.flowType === "C" ? t("Defined at rendition validation") : t(form.requestType)}</dd></div><div><dt>{t("CECO")}</dt><dd>{masters.costCenters.find((item) => item._id === form.requesterCostCenter)?.code || "-"}</dd></div><div><dt>{t("Title")}</dt><dd>{form.title || "-"}</dd></div><div><dt>{t("Priority")}</dt><dd>{t(form.priority)}</dd></div><div className="wide"><dt>{t("Business justification")}</dt><dd>{form.businessJustification || "-"}</dd></div><div className="wide"><dt>{t("Risk if not approved")}</dt><dd>{form.nonApprovalRisk || "-"}</dd></div></dl></div><div className="review-section"><div className="section-heading compact"><h3>{t("Items and totals")}</h3><button type="button" className="text-button" onClick={() => setStep(0)}>{t("Edit")}</button></div><div className="review-lines">{lines.map((line, index) => <div key={line.clientId}><span>{index + 1}</span><div><strong>{line.itemDescription || t("Accounting line")}</strong><small>{masters.costCenters.find((item) => item._id === line.costCenter)?.code} - {masters.expenseTypes.find((item) => item._id === line.expenseType)?.name}</small></div><strong>{form.currency} {money(line.totalAmount)}</strong></div>)}</div><div className="review-total"><span>{t("Total amount")}</span><strong>{form.currency} {money(totals.total)}</strong></div></div>{form.flowType !== "C" && <div className="review-section"><div className="section-heading compact"><h3>{t("Recommended supplier")}</h3><button type="button" className="text-button" onClick={() => setStep(1)}>{t("Edit")}</button></div>{selectedSupplier ? <div className="recommended-summary"><div><strong>{supplierName(selectedSupplier)}</strong><span>{selectedSupplier.rucDni}{selectedSupplier.supplierCode ? ` - ${selectedSupplier.supplierCode}` : ""}</span></div><StatusBadge status={supplierStatus(selectedSupplier)} /><p>{form.supplierSelectionReason || "-"}</p></div> : <p>{t("No recommended supplier selected.")}</p>}</div>}<div className="review-section"><div className="section-heading compact"><h3>{t("Budget and documents")}</h3><button type="button" className="text-button" onClick={() => setStep(2)}>{t("Edit")}</button></div><dl className="detail-grid"><div><dt>{t("Budget status")}</dt><dd><StatusBadge status={budgetPreview.status} /></dd></div><div><dt>{t("Quotation evidence")}</dt><dd>{quotations.filter((item) => item.attachment || quotationFiles[item.clientId]).length}/{quotations.length}</dd></div><div><dt>{t("Other documents")}</dt><dd>{existingAttachments.filter((item) => item.kind !== "QUOTATION").length + Object.values(files).flat().length}</dd></div></dl></div></div></div>}

        </MotionSurface>
      <footer className="wizard-actions"><button type="button" className="secondary-button" disabled={step === 0 || saving} onClick={() => setStep((current) => Math.max(0, current - 1))}><ChevronLeft size={16} /><span>{t("Back")}</span></button><div className="wizard-actions-right"><button type="button" className="secondary-button" disabled={saving} onClick={() => save(false)}><Save size={16} /><span>{t(saving ? "Saving..." : "Save draft")}</span></button>{step < 3 ? <button type="button" className="primary-button" onClick={nextStep}><span>{t("Continue")}</span><ChevronRight size={16} /></button> : <button type="button" className="primary-button" disabled={saving} onClick={() => save(true)}><Send size={16} /><span>{t(saving ? "Submitting..." : "Submit for approval")}</span></button>}</div></footer>
      </div>
    </div>
    </DraftPanel>
  </section>;
}
