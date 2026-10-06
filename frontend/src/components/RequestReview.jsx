import StatusBadge from "./StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency, formatDate } from "../utils/formatters.js";
import { formatIsoMonth } from "../utils/dateInput.js";
import { expenseNatureLabels, flowTypeLabels, optionLabel, trackCRequestTypeLabels } from "../utils/options.js";

const frequencyLabels = { ONE_OFF: "One-off", MONTHLY_RECURRING: "Monthly recurring", EVERY_3_MONTHS: "Every 3 months", ANNUAL_RENEWAL: "Annual renewal" };
const supplierName = (supplier) => supplier?.legalName || supplier?.name || "";
const supplierStatus = (supplier) => supplier?.homologationStatus || supplier?.status || "PENDING_VALIDATION";

function Section({ title, step, onEdit, children }) {
  const { t } = useLanguage();
  return <div className="review-section">
    <div className="section-heading compact"><h3>{t(title)}</h3><button type="button" className="text-button" onClick={() => onEdit(step)}>{t("Edit")}</button></div>
    {children}
  </div>;
}

function Item({ label, wide = false, children }) {
  const { t } = useLanguage();
  return <div className={wide ? "wide" : undefined}><dt>{t(label)}</dt><dd>{children || "-"}</dd></div>;
}

// The last step of the request form: everything the approver will see, grouped by the step
// where it was entered, each with a link back to that step.
export default function RequestReview({ form, capex, opexFrequency, lines, quotations, quotationFiles, files, existingAttachments, masters, totals, budgetPreview, selectedSupplier, onEdit }) {
  const { t, language } = useLanguage();
  const center = (id) => masters.costCenters.find((item) => item._id === id);
  const project = masters.projects.find((item) => item._id === capex.projectId);
  const trackC = form.flowType === "C";
  const otherDocuments = existingAttachments.filter((item) => item.kind !== "QUOTATION").length + Object.values(files).flat().length;

  return <div className="review-layout">
    <Section title="Requirement" step="need" onEdit={onEdit}>
      <dl className="detail-grid">
        <Item label="Operational track">{t(optionLabel(form.flowType, flowTypeLabels))}</Item>
        <Item label={trackC ? "Track C request type" : "CAPEX / OPEX"}>{trackC ? t(trackCRequestTypeLabels[form.requestType] || form.requestType) : t(form.requestType)}</Item>
        <Item label="Expense nature">{t(optionLabel(form.expenseNature, expenseNatureLabels))}</Item>
        <Item label="Priority">{t(form.priority)}</Item>
        <Item label="Title" wide>{form.title}</Item>
        <Item label="Detailed description" wide>{form.detailedDescription || form.description}</Item>
        <Item label="Business justification" wide>{form.businessJustification}</Item>
        <Item label="Risk if not approved" wide>{form.nonApprovalRisk}</Item>
      </dl>
    </Section>

    <Section title="Budget" step="budget" onEdit={onEdit}>
      <dl className="detail-grid">
        <Item label="CECO">{center(form.requesterCostCenter) ? `${center(form.requesterCostCenter).code} - ${center(form.requesterCostCenter).name}` : ""}</Item>
        <Item label="Issue date">{formatDate(form.issueDate, language)}</Item>
        <Item label="Request month">{formatIsoMonth(form.accountingPeriod) || form.accountingPeriod}</Item>
        <Item label="Currency">{form.currency}</Item>
        {form.requestType === "OPEX" && <Item label="Expense frequency">{t(frequencyLabels[opexFrequency] || opexFrequency)}</Item>}
        {form.requestType === "CAPEX" && <>
          <Item label="Project / PEP">{project ? `${project.code} - ${project.name}` : capex.projectPep}</Item>
          <Item label="Fixed asset category">{capex.assetCategory ? t(capex.assetCategory) : ""}</Item>
          <Item label="Useful life (years)">{capex.usefulLifeYears}</Item>
          <Item label="NPV / VAN amount">{capex.npvAmount !== "" ? formatCurrency(capex.npvAmount, capex.npvCurrency, language) : ""}</Item>
          <Item label="Payback">{capex.paybackValue !== "" ? `${capex.paybackValue} ${t(capex.paybackUnit === "YEARS" ? "Years" : "Months")}` : ""}</Item>
        </>}
        <Item label="Budget status"><StatusBadge status={budgetPreview.status} /></Item>
      </dl>
    </Section>

    <Section title="Items and totals" step="budget" onEdit={onEdit}>
      <div className="review-lines">{lines.map((line, index) => <div key={line.clientId}><span>{index + 1}</span><div><strong>{line.itemDescription || t("Accounting line")}</strong><small>{center(line.costCenter) ? `${center(line.costCenter).code} - ${center(line.costCenter).name}` : ""}</small></div><strong>{formatCurrency(line.totalAmount, form.currency, language)}</strong></div>)}</div>
      <div className="review-total"><span>{t("Total amount")}</span><strong>{formatCurrency(totals.total, form.currency, language)}</strong></div>
    </Section>

    {!trackC && <Section title="Recommended supplier" step="supplier" onEdit={onEdit}>
      {selectedSupplier
        ? <div className="recommended-summary"><div><strong>{supplierName(selectedSupplier)}</strong><span>{selectedSupplier.rucDni}{selectedSupplier.supplierCode ? ` - ${selectedSupplier.supplierCode}` : ""}</span></div><StatusBadge status={supplierStatus(selectedSupplier)} /><p>{form.supplierSelectionReason || "-"}</p></div>
        : <p>{t("No recommended supplier selected.")}</p>}
      {quotations.length > 0 && <p className="section-note">{t("Quotation evidence")}: {quotations.filter((item) => item.attachment || quotationFiles[item.clientId]).length}/{quotations.length}</p>}
    </Section>}

    <Section title="Supporting documents" step="documents" onEdit={onEdit}>
      <dl className="detail-grid"><Item label="Other documents">{String(otherDocuments)}</Item></dl>
    </Section>
  </div>;
}
