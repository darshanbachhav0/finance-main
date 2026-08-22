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
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import api from "../api/client.js";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SearchSelect from "../components/SearchSelect.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import WorkflowStepper from "../components/WorkflowStepper.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import {
  currencies,
  expenseNatureLabels,
  flowTypeLabels,
  flowTypes,
  expenseNatures,
  optionLabel,
  requestPriorities,
  requestTypeLabels,
  requestTypes
} from "../utils/options.js";

const steps = ["Request information", "Items and quotations", "Documents", "Review and submit"];
const officialTypes = new Set(["CAPEX", "OPEX"]);
const supplierStatus = (supplier) => supplier?.homologationStatus || supplier?.status || "PENDING_VALIDATION";
const supplierName = (supplier) => supplier?.legalName || supplier?.name || "";
const supplierId = (value) => value?._id || value || "";
const attachmentId = (value) => value?._id || value || "";

const emptyLine = (costCenter = "") => ({
  clientId: `${Date.now()}-${Math.random()}`,
  itemDescription: "",
  quantity: "1",
  unitOfMeasure: "UNIT",
  unitPrice: "",
  costCenter,
  expenseType: "",
  budgetItem: "",
  projectId: "",
  netAmount: "",
  igvAmount: "",
  totalAmount: ""
});

const emptyQuotation = () => ({
  clientId: `${Date.now()}-${Math.random()}`,
  supplier: "",
  amount: "",
  currency: "PEN",
  deliveryPeriod: "",
  paymentConditions: "",
  commercialConditions: "",
  attachment: "",
  recommended: false
});

const quotationHasData = (quotation) => Boolean(
  quotation.supplier || quotation.amount || quotation.deliveryPeriod || quotation.paymentConditions ||
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
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState([]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [savedStatus, setSavedStatus] = useState("");

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
          const owner = request.requester?._id || request.solicitor?._id;
          if (!['BORRADOR', 'RECHAZADO', 'OBSERVADO', 'OBSERVADO_PRESUPUESTO', 'OBSERVADO_SUNAT', 'OBSERVADO_MONTO_EXCEDIDO', 'OBSERVADO_CARGA_MASIVA', 'DEVUELTO'].includes(request.status) || (user.role !== "Admin" && owner !== user._id)) {
            navigate(`/requests/${id}`, { replace: true });
            return;
          }
          const serverForm = {
            ...initialForm(),
            flowType: request.flowType || (request.requestType === "ENTREGA_RENDIR" ? "C" : "A1"),
            requestType: request.requestType,
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
            paymentConditions: quotation.paymentConditions || "",
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
          setForm(useLocal ? parsed.form : serverForm);
          setCapex(useLocal ? parsed.capex || serverCapex : serverCapex);
          setOpexFrequency(useLocal ? parsed.opexFrequency || request.opexDetails?.expenseFrequency || "ONE_OFF" : request.opexDetails?.expenseFrequency || "ONE_OFF");
          setLines(useLocal && parsed.lines?.length ? parsed.lines : serverLines);
          setQuotations(useLocal ? parsed.quotations || serverQuotations : serverQuotations);
          if (useLocal) setSavedStatus(t("Recovered local draft"));
          setExistingAttachments(request.attachments || []);
        } else {
          const localDraft = localStorage.getItem(draftKey);
          if (localDraft) {
            const parsed = JSON.parse(localDraft);
            setForm(parsed.form || initialForm());
            setCapex(parsed.capex || initialCapex);
            setOpexFrequency(parsed.opexFrequency || "ONE_OFF");
            setLines(parsed.lines?.length ? parsed.lines : [emptyLine()]);
            setQuotations(parsed.quotations || []);
            setSavedStatus(t("Recovered local draft"));
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

  useEffect(() => {
    if (!hydrated) return undefined;
    setSavedStatus(t("Saving locally..."));
    const timer = window.setTimeout(() => {
      localStorage.setItem(draftKey, JSON.stringify({ form, capex, opexFrequency, lines, quotations, savedAt: new Date().toISOString() }));
      setSavedStatus(`${t("Saved locally")} - ${new Date().toLocaleTimeString(language === "es" ? "es-PE" : "en-US", { hour: "2-digit", minute: "2-digit" })}`);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [form, capex, opexFrequency, lines, quotations, hydrated, draftKey, language]);

  useEffect(() => {
    if (!hydrated || !form.accountingPeriod || lines.some((line) => !line.costCenter || !line.expenseType || !(Number(line.totalAmount) > 0))) {
      setBudgetPreview({ status: "PENDING_VALIDATION", lines: [] });
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      setBudgetLoading(true);
      try {
        const response = await api.post("/requests/budget-preview", {
          flowType: form.flowType,
          requestType: form.requestType,
          expenseNature: form.expenseNature,
          issueDate: form.issueDate,
          accountingPeriod: form.accountingPeriod,
          currency: form.currency,
          lines
        });
        if (active) setBudgetPreview(response.data.data);
      } catch (err) {
        if (active) setBudgetPreview({ status: "PENDING_VALIDATION", reason: err.code, lines: [] });
      } finally {
        if (active) setBudgetLoading(false);
      }
    }, 500);
    return () => { active = false; window.clearTimeout(timer); };
  }, [hydrated, form.flowType, form.requestType, form.expenseNature, form.issueDate, form.accountingPeriod, form.currency, lines]);

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
    return typeAllowed && natureAllowed;
  }), [masters.expenseTypes, form.requestType, form.expenseNature]);
  const totals = useMemo(() => lines.reduce((result, line) => ({
    net: result.net + Number(line.netAmount || 0),
    igv: result.igv + Number(line.igvAmount || 0),
    total: result.total + Number(line.totalAmount || 0),
    commercial: result.commercial + Number(line.quantity || 0) * Number(line.unitPrice || 0)
  }), { net: 0, igv: 0, total: 0, commercial: 0 }), [lines]);
  const accountingDifference = Number((totals.net + totals.igv - totals.total).toFixed(2));
  const commercialDifference = Number((totals.commercial - totals.total).toFixed(2));

  function setHeaderCostCenter(value) {
    setForm((current) => {
      const previous = current.requesterCostCenter;
      setLines((currentLines) => currentLines.map((line) => ({ ...line, costCenter: !line.costCenter || line.costCenter === previous ? value : line.costCenter })));
      return { ...current, requesterCostCenter: value };
    });
  }

  function updateLine(index, patch) {
    setLines((current) => current.map((line, currentIndex) => currentIndex === index ? { ...line, ...patch } : line));
  }

  function updateQuotation(index, patch) {
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
      if (officialRequest && submitting) {
        [["title", "Requirement title is required."], ["detailedDescription", "Detailed description is required."], ["businessJustification", "Business justification is required."], ["nonApprovalRisk", "Risk if not approved is required."]].forEach(([field, message]) => {
          if (!String(form[field] || "").trim()) next[field] = message;
        });
      }
      const period = masters.periods.find((item) => item.period === form.accountingPeriod);
      if (form.accountingPeriod && (!period || period.status !== "OPEN")) next.accountingPeriod = "Accounting period must be open.";
    }
    if (index === 1) {
      if (!lines.length) next.lines = "At least one request line is required.";
      lines.forEach((line, lineIndex) => {
        if (!line.itemDescription && officialRequest && submitting) next[`lines.${lineIndex}.itemDescription`] = "Item description is required.";
        if (!line.costCenter) next[`lines.${lineIndex}.costCenter`] = "Select a Cost Center.";
        if (!line.expenseType) next[`lines.${lineIndex}.expenseType`] = "Select an expense account.";
        if (!(Number(line.totalAmount) > 0)) next[`lines.${lineIndex}.totalAmount`] = "Total must be greater than zero.";
        if (line.quantity !== "" && Number(line.quantity) < 0) next[`lines.${lineIndex}.quantity`] = "Enter a valid quantity.";
        if (line.unitPrice !== "" && Number(line.unitPrice) < 0) next[`lines.${lineIndex}.unitPrice`] = "Enter a valid unit price.";
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
      return;
    }
    setCompletedSteps((current) => [...new Set([...current, step])]);
    setStep((current) => Math.min(3, current + 1));
    setMaxStep((current) => Math.max(current, step + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(sendForApproval) {
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
    const payloadForm = { ...form, description: form.description || form.detailedDescription };
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
    data.append("lines", JSON.stringify(lines.map(({ clientId, ...line }) => line)));
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
        ? await api.put(`/requests/${id}`, data, { headers: { "Content-Type": "multipart/form-data" } })
        : await api.post("/requests", data, { headers: { "Content-Type": "multipart/form-data" } });
      localStorage.removeItem(draftKey);
      notify(sendForApproval ? "Request submitted for approval." : isEditing ? "Draft request updated." : "Draft request created.");
      navigate(`/requests/${response.data.data._id}`);
    } catch (err) {
      const detailErrors = err.details?.errors || err.details?.missing || [];
      const details = detailErrors.map((item) => t(item.code || item.label || "Validation error")).join(" ");
      setError(`${err.message}${details ? ` ${details}` : ""}`);
      notify(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="page-loader">{t(isEditing ? "Loading request..." : "Loading form data...")}</div>;

  return <section>
    <PageHeader
      title={isEditing ? "Edit request" : "Create request"}
      description="RCO-FOR-001 request information, commercial comparison, and existing financial controls in one workflow."
      actions={<span className="autosave-status" role="status"><FileCheck2 size={15} />{savedStatus || t("Autosave ready")}</span>}
    />
    <Message type="error">{error}</Message>
    <div className="request-wizard official-request-wizard">
      <WorkflowStepper steps={steps} current={step} completedSteps={completedSteps} maxAccessible={maxStep} onSelect={(next) => next <= maxStep && setStep(next)} />
      <div className="wizard-workspace">
        {step === 0 && <div className="wizard-step">
          <div className="section-heading"><div><h3>{t("General information")}</h3><p>{t("Identify the request, authorized CECO, period, and institutional need.")}</p></div></div>
          <div className="form-grid two-column-form">
            <label className="field"><span>{t("Operational track")} *</span><select value={form.flowType} onChange={(event) => { const flowType = event.target.value; setForm((current) => ({ ...current, flowType, requestType: flowType === "C" ? "ENTREGA_RENDIR" : (current.requestType === "ENTREGA_RENDIR" ? "OPEX" : current.requestType), supplier: flowType === "C" ? "" : current.supplier })); }}>{flowTypes.filter((type) => type !== "A2").map((type) => <option key={type} value={type}>{t(optionLabel(type, flowTypeLabels))}</option>)}</select><small>{t(form.flowType === "A1" ? "Formal purchase with quotations and PO." : form.flowType === "B" ? "Direct invoice / advance payment with mandatory XML + PDF." : "Advance to render / petty cash; expense budget is executed at rendition validation.")}</small></label>
            <label className={`field${errors.requestType ? " field-error" : ""}`}><span>{t("Request type")} *</span><select value={form.requestType} disabled={form.flowType === "C"} onChange={(event) => setForm((current) => ({ ...current, requestType: event.target.value }))}>{requestTypes.map((type) => <option key={type} value={type}>{t(optionLabel(type, requestTypeLabels))}</option>)}</select></label>
            <label className="field"><span>{t("Expense nature")} *</span><select value={form.expenseNature} onChange={(event) => setForm((current) => ({ ...current, expenseNature: event.target.value }))}>{expenseNatures.map((item) => <option key={item} value={item}>{t(optionLabel(item, expenseNatureLabels))}</option>)}</select></label>
            <label className="field"><span>{t("Priority")} *</span><select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}>{requestPriorities.map((item) => <option key={item}>{t(item)}</option>)}</select></label>
            <label className="field"><span>{t("Requesting area")}</span><input value={user.area || "General"} disabled title={t("Assigned from the signed-in user profile.")} /></label>
            <div className="form-span-two"><SearchSelect label="Cost Center / CECO" value={form.requesterCostCenter} options={masters.costCenters} onChange={setHeaderCostCenter} getOptionLabel={(item) => `${item.code} - ${item.name}${item.area ? ` (${item.area})` : ""}`} error={errors.requesterCostCenter} required searchPlaceholder="Search authorized CECO..." /><small className="field-hint">{t("Only Cost Centers assigned to your profile are available.")}</small></div>
            <label className="field"><span>{t("Area correlative")}</span><input value={form.areaCorrelative} onChange={(event) => setForm((current) => ({ ...current, areaCorrelative: event.target.value }))} /></label>
            <label className="field"><span>{t("School / department")}</span><input value={form.schoolOrDepartment} onChange={(event) => setForm((current) => ({ ...current, schoolOrDepartment: event.target.value }))} /></label>
            <label className="field"><span>{t("Issue date")} *</span><input type="date" value={form.issueDate} onChange={(event) => setForm((current) => ({ ...current, issueDate: event.target.value, accountingPeriod: event.target.value.slice(0, 7) }))} /></label>
            <label className={`field${errors.accountingPeriod ? " field-error" : ""}`}><span>{t("Accounting period")} *</span><select value={form.accountingPeriod} onChange={(event) => setForm((current) => ({ ...current, accountingPeriod: event.target.value }))}><option value="">{t("Select")}</option>{masters.periods.map((period) => <option key={period._id} value={period.period} disabled={period.status !== "OPEN"}>{period.period} - {t(period.status)}</option>)}</select>{errors.accountingPeriod && <small className="field-error-text">{t(errors.accountingPeriod)}</small>}</label>
            <label className="field"><span>{t("Currency")} *</span><select value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
            <label className="field"><span>{t("Requirement title")} *</span><input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />{errors.title && <small className="field-error-text">{t(errors.title)}</small>}</label>
            <label className="field form-span-two"><span>{t("Detailed description")} *</span><textarea rows="4" value={form.detailedDescription} onChange={(event) => setForm((current) => ({ ...current, detailedDescription: event.target.value, description: event.target.value }))} />{errors.detailedDescription && <small className="field-error-text">{t(errors.detailedDescription)}</small>}</label>
            <label className="field form-span-two"><span>{t("Business justification")} *</span><textarea rows="3" value={form.businessJustification} onChange={(event) => setForm((current) => ({ ...current, businessJustification: event.target.value }))} />{errors.businessJustification && <small className="field-error-text">{t(errors.businessJustification)}</small>}</label>
            <label className="field form-span-two"><span>{t("Risk if not approved")} *</span><textarea rows="3" value={form.nonApprovalRisk} onChange={(event) => setForm((current) => ({ ...current, nonApprovalRisk: event.target.value }))} />{errors.nonApprovalRisk && <small className="field-error-text">{t(errors.nonApprovalRisk)}</small>}</label>
          </div>

          {form.requestType === "CAPEX" && <div className="official-subsection"><div className="section-heading compact"><div><h3>{t("CAPEX financial information")}</h3><p>{t("Planning information is recorded only; no depreciation or NPV calculation is generated.")}</p></div></div><div className="form-grid three-column-form">
            <label className="field"><span>{t("Project / PEP")}</span><select value={capex.projectId} onChange={(event) => { const project = masters.projects.find((item) => item._id === event.target.value); setCapex((current) => ({ ...current, projectId: event.target.value, projectPep: project?.code || current.projectPep })); }}><option value="">{t("No project")}</option>{masters.projects.map((project) => <option key={project._id} value={project._id}>{project.code} - {project.name}</option>)}</select></label>
            <label className="field"><span>{t("Fixed asset category")}</span><select value={capex.assetCategory} onChange={(event) => setCapex((current) => ({ ...current, assetCategory: event.target.value }))}><option value="">{t("Select")}</option>{["INFRASTRUCTURE", "MACHINERY", "IT_HARDWARE", "SOFTWARE_LICENSES"].map((value) => <option key={value} value={value}>{t(value)}</option>)}</select></label>
            <label className="field"><span>{t("Useful life (years)")}</span><input type="number" min="0" step="1" value={capex.usefulLifeYears} onChange={(event) => setCapex((current) => ({ ...current, usefulLifeYears: event.target.value }))} /></label>
            <label className="field"><span>{t("NPV / VAN amount")}</span><input type="number" step="0.01" value={capex.npvAmount} onChange={(event) => setCapex((current) => ({ ...current, npvAmount: event.target.value }))} /></label>
            <label className="field"><span>{t("NPV currency")}</span><select value={capex.npvCurrency} onChange={(event) => setCapex((current) => ({ ...current, npvCurrency: event.target.value }))}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
            <div className="field"><span>{t("Payback")}</span><div className="compound-field"><input aria-label={t("Payback value")} type="number" min="0" step="0.01" value={capex.paybackValue} onChange={(event) => setCapex((current) => ({ ...current, paybackValue: event.target.value }))} /><select aria-label={t("Payback unit")} value={capex.paybackUnit} onChange={(event) => setCapex((current) => ({ ...current, paybackUnit: event.target.value }))}><option value="MONTHS">{t("Months")}</option><option value="YEARS">{t("Years")}</option></select></div></div>
          </div></div>}

          {form.requestType === "OPEX" && <div className="official-subsection"><div className="section-heading compact"><div><h3>{t("OPEX financial information")}</h3><p>{t("The expense account remains controlled by the configured accounting master.")}</p></div></div><label className="field field-narrow"><span>{t("Expense frequency")}</span><select value={opexFrequency} onChange={(event) => setOpexFrequency(event.target.value)}><option value="ONE_OFF">{t("One-off")}</option><option value="MONTHLY_RECURRING">{t("Monthly recurring")}</option><option value="ANNUAL_RENEWAL">{t("Annual renewal")}</option></select></label></div>}
        </div>}

        {step === 1 && <div className="wizard-step">
          <div className="section-heading"><div><h3>{t("Item / service breakdown")}</h3><p>{t("Commercial values and accounting dimensions remain on the same request line.")}</p></div><button type="button" className="secondary-button" onClick={() => setLines((current) => [...current, emptyLine(form.requesterCostCenter)])}><Plus size={16} /><span>{t("Add line")}</span></button></div>
          <div className="official-line-list">{lines.map((line, index) => {
            const lineDifference = Number((Number(line.netAmount || 0) + Number(line.igvAmount || 0) - Number(line.totalAmount || 0)).toFixed(2));
            const commercialTotal = Number(line.quantity || 0) * Number(line.unitPrice || 0);
            return <div className="official-line" key={line.clientId}><div className="official-line-head"><strong>{t("Line")} {index + 1}</strong><button type="button" className="icon-button danger" onClick={() => setLines((current) => current.filter((_, currentIndex) => currentIndex !== index))} disabled={lines.length === 1} title={t("Remove line")}><Trash2 size={16} /></button></div><div className="form-grid four-column-form">
              <label className="field form-span-two"><span>{t("Item / service description")} *</span><input value={line.itemDescription} onChange={(event) => updateLine(index, { itemDescription: event.target.value })} />{errors[`lines.${index}.itemDescription`] && <small className="field-error-text">{t(errors[`lines.${index}.itemDescription`])}</small>}</label>
              <label className="field"><span>{t("Quantity")}</span><input type="number" min="0" step="0.01" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} /></label>
              <label className="field"><span>{t("Unit of measure")}</span><input value={line.unitOfMeasure} onChange={(event) => updateLine(index, { unitOfMeasure: event.target.value })} /></label>
              <label className="field"><span>{t("Unit price")}</span><input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => updateLine(index, { unitPrice: event.target.value })} /></label>
              <label className="field"><span>{t("Commercial total")}</span><input value={`${form.currency} ${money(commercialTotal)}`} disabled title={t("Calculated by the server as quantity multiplied by unit price.")} /></label>
              <div className="form-span-two"><SearchSelect label="Cost Center / CECO" value={line.costCenter} options={masters.costCenters} onChange={(value) => updateLine(index, { costCenter: value })} getOptionLabel={(item) => `${item.code} - ${item.name}`} error={errors[`lines.${index}.costCenter`]} required searchPlaceholder="Search authorized CECO..." /></div>
              <div className="form-span-two"><SearchSelect label="Expense type / account" value={line.expenseType} options={allowedExpenseTypes} onChange={(value) => updateLine(index, { expenseType: value })} getOptionLabel={(item) => `${item.accountNumber} - ${item.name}`} error={errors[`lines.${index}.expenseType`]} required searchPlaceholder="Search expense account..." /></div>
              <label className="field"><span>{t("Budget item")}</span><input value={line.budgetItem} onChange={(event) => updateLine(index, { budgetItem: event.target.value })} /></label>
              <label className="field"><span>{t("Net")}</span><input type="number" min="0" step="0.01" value={line.netAmount} onChange={(event) => updateLine(index, { netAmount: event.target.value })} /></label>
              <label className="field"><span>{t("IGV")}</span><input type="number" min="0" step="0.01" value={line.igvAmount} onChange={(event) => updateLine(index, { igvAmount: event.target.value })} /></label>
              <label className="field"><span>{t("Accounting total")} *</span><input type="number" min="0" step="0.01" value={line.totalAmount} onChange={(event) => updateLine(index, { totalAmount: event.target.value })} />{errors[`lines.${index}.totalAmount`] && <small className="field-error-text">{t(errors[`lines.${index}.totalAmount`])}</small>}</label>
            </div>{lineDifference !== 0 && <div className="line-warning"><AlertTriangle size={15} /><span>{t("Net + IGV differs from Total by {amount}.").replace("{amount}", money(Math.abs(lineDifference)))}</span></div>}</div>;
          })}</div>
          <div className="totals-bar official-totals"><div><span>{t("Commercial total")}</span><strong>{form.currency} {money(totals.commercial)}</strong></div><div><span>{t("Accounting total")}</span><strong>{form.currency} {money(totals.total)}</strong></div><div><span>{t("Difference")}</span><strong className={commercialDifference ? "text-warning" : "text-success"}>{form.currency} {money(commercialDifference)}</strong></div><div><span>{t("Reconciliation status")}</span><StatusBadge status={!totals.commercial ? "NOT_APPLICABLE" : commercialDifference ? "MISMATCH" : "MATCH"} /></div></div>
          {accountingDifference !== 0 && <div className="inline-warning"><AlertTriangle size={16} /><span>{t("Combined Net + IGV does not equal Total.")}</span></div>}

          {form.flowType !== "C" && !quotationPolicy.enabled && <div className="official-subsection"><div className="section-heading compact"><div><h3>{t("Supplier")}</h3><p>{t("Select the supplier linked to this request. Pending or observed suppliers may continue through review but must be homologated before budget commitment.")}</p></div></div><div className="form-grid two-column-form"><SearchSelect label="Supplier" value={form.supplier} options={eligibleSuppliers} onChange={(value) => setForm((current) => ({ ...current, supplier: value }))} getOptionLabel={(item) => `${item.supplierCode ? `${item.supplierCode} - ` : ""}${item.rucDni} - ${supplierName(item)} - ${t(supplierStatus(item))}`} error={errors.supplier} required searchPlaceholder="Search name or RUC/DNI..." />{selectedSupplier && <div className="supplier-inline-status"><div><strong>{supplierName(selectedSupplier)}</strong><span>{selectedSupplier.rucDni}{selectedSupplier.supplierCode ? ` - ${selectedSupplier.supplierCode}` : ""}</span></div><StatusBadge status={supplierStatus(selectedSupplier)} /></div>}</div><Link className="inline-link" to={`/suppliers?mode=new&returnTo=${encodeURIComponent(isEditing ? `/requests/${id}/edit` : "/requests/new")}`}>{t("Supplier not found? Open the official supplier proposal flow")}</Link></div>}

          {form.flowType !== "C" && <div className="official-subsection quotation-section"><div className="section-heading"><div><h3>{t("Supplier quotations")}</h3><p>{quotationPolicy.enabled ? t("The configured policy requires {count} different suppliers with evidence.").replace("{count}", quotationPolicy.minimumCount) : t("Quotation comparison is optional for this classification.")}</p></div><button type="button" className="secondary-button" onClick={() => setQuotations((current) => [...current, emptyQuotation()])}><Plus size={16} /><span>{t("Add quotation")}</span></button></div>
            {errors.quotations && <Message type="error">{errors.quotations}</Message>}
            <div className="quotation-grid">{quotations.map((quotation, index) => {
              const supplier = masters.suppliers.find((item) => item._id === quotation.supplier);
              const status = supplierStatus(supplier);
              const blocked = ["REJECTED", "INACTIVE"].includes(status);
              const evidence = existingAttachments.find((item) => String(item._id) === String(quotation.attachment));
              return <article className={`quotation-card${quotation.recommended ? " recommended" : ""}`} key={quotation.clientId}><div className="quotation-card-head"><span>{t("Quotation")} {index + 1}</span>{supplier && <StatusBadge status={status} />}</div>
                <SearchSelect label="Supplier" value={quotation.supplier} options={masters.suppliers} onChange={(value) => updateQuotation(index, { supplier: value, recommended: false })} getOptionLabel={(item) => `${item.supplierCode ? `${item.supplierCode} - ` : ""}${item.rucDni} - ${supplierName(item)} - ${t(supplierStatus(item))}`} error={errors[`quotations.${index}.supplier`]} required searchPlaceholder="Search name or RUC/DNI..." />
                {supplier && <div className="supplier-inline-status"><div><strong>{supplierName(supplier)}</strong><span>{supplier.rucDni}{supplier.supplierCode ? ` - ${supplier.supplierCode}` : ""}</span></div><small>{supplier.taxpayerValidation?.providerMode === "MANUAL" ? t("Manual taxpayer validation") : t(supplier.taxpayerValidation?.providerMode || "NOT_CONFIGURED")}</small></div>}
                <div className="form-grid two-column-form"><label className="field"><span>{t("Amount")} *</span><input type="number" min="0" step="0.01" value={quotation.amount} onChange={(event) => updateQuotation(index, { amount: event.target.value })} /></label><label className="field"><span>{t("Currency")}</span><select value={quotation.currency} onChange={(event) => updateQuotation(index, { currency: event.target.value })}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label><label className="field"><span>{t("Delivery period")}</span><input value={quotation.deliveryPeriod} onChange={(event) => updateQuotation(index, { deliveryPeriod: event.target.value })} /></label><label className="field"><span>{t("Payment conditions")}</span><input value={quotation.paymentConditions} onChange={(event) => updateQuotation(index, { paymentConditions: event.target.value })} /></label><label className="field form-span-two"><span>{t("Commercial conditions")}</span><textarea rows="2" value={quotation.commercialConditions} onChange={(event) => updateQuotation(index, { commercialConditions: event.target.value })} /></label></div>
                <label className={`quotation-evidence${errors[`quotations.${index}.attachment`] ? " field-error" : ""}`}><FileText size={18} /><span><strong>{quotationFiles[quotation.clientId]?.name || evidence?.originalName || t("Attach quotation evidence")}</strong><small>{quotationFiles[quotation.clientId] || evidence ? t("Evidence attached") : t("Evidence missing")}</small></span><input type="file" accept=".pdf,.doc,.docx,.xlsx,.jpg,.jpeg,.png" onChange={(event) => setQuotationFiles((current) => ({ ...current, [quotation.clientId]: event.target.files?.[0] }))} /></label>
                <div className="quotation-actions"><label className={`recommend-option${blocked ? " disabled" : ""}`} title={blocked ? t("Rejected or inactive suppliers cannot be recommended.") : ""}><input type="radio" name="recommended-quotation" checked={quotation.recommended} disabled={blocked || !quotation.supplier} onChange={() => { updateQuotation(index, { recommended: true }); setForm((current) => ({ ...current, supplier: quotation.supplier })); }} /><CheckCircle2 size={17} /><span>{t("Recommend supplier")}</span></label><button type="button" className="icon-button danger" onClick={() => setQuotations((current) => current.filter((_, currentIndex) => currentIndex !== index))} title={t("Remove quotation")}><Trash2 size={16} /></button></div>
              </article>;
            })}</div>
            <Link className="inline-link" to={`/suppliers?mode=new&returnTo=${encodeURIComponent(isEditing ? `/requests/${id}/edit` : "/requests/new")}`}>{t("Supplier not found? Open the official supplier proposal flow")}</Link>
            <label className="field"><span>{t("Supplier selection reason")} {quotationPolicy.enabled ? "*" : ""}</span><textarea rows="3" value={form.supplierSelectionReason} onChange={(event) => setForm((current) => ({ ...current, supplierSelectionReason: event.target.value }))} placeholder={t("Explain price, delivery, technical suitability, exclusivity, or commercial conditions.")} />{errors.supplierSelectionReason && <small className="field-error-text">{t(errors.supplierSelectionReason)}</small>}</label>
          </div>}

          <div className="official-subsection budget-preview"><div className="section-heading"><div><h3>{t("Budget preview")}</h3><p>{t("Read-only result from the existing Budget service. No funds are reserved here.")}</p></div>{budgetLoading ? <RefreshCw className="spin" size={18} /> : <StatusBadge status={budgetPreview.status} />}</div>{budgetPreview.lines?.length ? <div className="budget-preview-lines">{budgetPreview.lines.map((item, index) => <div key={`${item.costCenter}-${item.expenseType}-${index}`}><div><strong>{item.costCenterSnapshot?.code || t("Pending validation")}</strong><span>{item.budgetItem || t("No budget item")}</span></div><span>{t("Requested")}: PEN {money(item.amount)}</span><span>{t("Available")}: {item.available === undefined ? "-" : `PEN ${money(item.available)}`}</span><span>{t("Projected")}: {item.projectedBalance === undefined ? "-" : `PEN ${money(item.projectedBalance)}`}</span><StatusBadge status={item.status} /></div>)}</div> : <div className="empty-inline"><BarChart3 size={20} /><span>{t("Complete the accounting dimensions to calculate the budget preview.")}</span></div>}</div>
        </div>}

        {step === 2 && <div className="wizard-step"><div className="section-heading"><div><h3>{t("Supporting documents")}</h3><p>{t("Quotation evidence is attached to each supplier above; other configured evidence is uploaded here.")}</p></div></div><div className="document-requirement required"><FileText size={20} /><div><strong>{t("Mandatory document checklist")}</strong><p>{formPolicy.documentRequirements.length ? formPolicy.documentRequirements.map((rule) => `${t(rule.labelKey)} x ${rule.minCount}`).join(" - ") : t("No additional configured evidence for this classification.")}</p></div></div><div className="document-grid">{documentDefinitions.map((document) => {
          const rule = formPolicy.documentRequirements.find((item) => item.kind === document.kind);
          const existing = existingAttachments.filter((item) => item.kind === document.kind);
          return <label className={`document-upload${errors[document.key] ? " field-error" : ""}`} key={document.key}><FileText size={22} /><span><strong>{t(document.label)}{rule ? ` *${rule.minCount > 1 ? ` (${rule.minCount})` : ""}` : ""}</strong><small>{t("Choose file")}</small></span><input type="file" accept={document.accept} multiple={document.multiple} onChange={(event) => setFiles((current) => ({ ...current, [document.key]: Array.from(event.target.files || []) }))} /><div className="file-list">{existing.map((file) => <span key={file._id}>{file.originalName} - {t("Already uploaded")}</span>)}{files[document.key].map((file) => <span key={`${file.name}-${file.size}`}>{file.name} - {(file.size / 1024).toFixed(0)} KB</span>)}</div>{errors[document.key] && <small className="field-error-text">{t(errors[document.key])}</small>}</label>;
        })}</div></div>}

        {step === 3 && <div className="wizard-step"><div className="section-heading"><div><h3>{t("Review and submit")}</h3><p>{t("Confirm the official request and financial-control information before submission.")}</p></div></div><div className="review-layout"><div className="review-section"><div className="section-heading compact"><h3>{t("Requirement")}</h3><button type="button" className="text-button" onClick={() => setStep(0)}>{t("Edit")}</button></div><dl className="detail-grid"><div><dt>{t("Operational track")}</dt><dd>{t(optionLabel(form.flowType, flowTypeLabels))}</dd></div><div><dt>{t("Request type")}</dt><dd>{t(form.requestType)}</dd></div><div><dt>{t("CECO")}</dt><dd>{masters.costCenters.find((item) => item._id === form.requesterCostCenter)?.code || "-"}</dd></div><div><dt>{t("Title")}</dt><dd>{form.title || "-"}</dd></div><div><dt>{t("Priority")}</dt><dd>{t(form.priority)}</dd></div><div className="wide"><dt>{t("Business justification")}</dt><dd>{form.businessJustification || "-"}</dd></div><div className="wide"><dt>{t("Risk if not approved")}</dt><dd>{form.nonApprovalRisk || "-"}</dd></div></dl></div><div className="review-section"><div className="section-heading compact"><h3>{t("Items and totals")}</h3><button type="button" className="text-button" onClick={() => setStep(1)}>{t("Edit")}</button></div><div className="review-lines">{lines.map((line, index) => <div key={line.clientId}><span>{index + 1}</span><div><strong>{line.itemDescription || t("Accounting line")}</strong><small>{masters.costCenters.find((item) => item._id === line.costCenter)?.code} - {masters.expenseTypes.find((item) => item._id === line.expenseType)?.accountNumber}</small></div><strong>{form.currency} {money(line.totalAmount)}</strong></div>)}</div><div className="review-total"><span>{t("Total amount")}</span><strong>{form.currency} {money(totals.total)}</strong></div></div>{form.flowType !== "C" && <div className="review-section"><div className="section-heading compact"><h3>{t("Recommended supplier")}</h3><button type="button" className="text-button" onClick={() => setStep(1)}>{t("Edit")}</button></div>{selectedSupplier ? <div className="recommended-summary"><div><strong>{supplierName(selectedSupplier)}</strong><span>{selectedSupplier.rucDni}{selectedSupplier.supplierCode ? ` - ${selectedSupplier.supplierCode}` : ""}</span></div><StatusBadge status={supplierStatus(selectedSupplier)} /><p>{form.supplierSelectionReason || "-"}</p></div> : <p>{t("No recommended supplier selected.")}</p>}</div>}<div className="review-section"><div className="section-heading compact"><h3>{t("Budget and documents")}</h3><button type="button" className="text-button" onClick={() => setStep(2)}>{t("Edit")}</button></div><dl className="detail-grid"><div><dt>{t("Budget status")}</dt><dd><StatusBadge status={budgetPreview.status} /></dd></div><div><dt>{t("Quotation evidence")}</dt><dd>{quotations.filter((item) => item.attachment || quotationFiles[item.clientId]).length}/{quotations.length}</dd></div><div><dt>{t("Other documents")}</dt><dd>{existingAttachments.filter((item) => item.kind !== "QUOTATION").length + Object.values(files).flat().length}</dd></div></dl></div></div></div>}

        <footer className="wizard-actions"><button type="button" className="secondary-button" disabled={step === 0 || saving} onClick={() => setStep((current) => Math.max(0, current - 1))}><ChevronLeft size={16} /><span>{t("Back")}</span></button><div className="wizard-actions-right"><button type="button" className="secondary-button" disabled={saving} onClick={() => save(false)}><Save size={16} /><span>{t(saving ? "Saving..." : "Save draft")}</span></button>{step < 3 ? <button type="button" className="primary-button" onClick={nextStep}><span>{t("Continue")}</span><ChevronRight size={16} /></button> : <button type="button" className="primary-button" disabled={saving} onClick={() => save(true)}><Send size={16} /><span>{t(saving ? "Submitting..." : "Submit for approval")}</span></button>}</div></footer>
      </div>
    </div>
  </section>;
}
