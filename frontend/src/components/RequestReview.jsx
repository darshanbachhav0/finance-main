import { AlertTriangle } from "lucide-react";
import StatusBadge from "./StatusBadge.jsx";
import PriorityBadge from "./PriorityBadge.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency, formatDate } from "../utils/formatters.js";
import { formatIsoMonth } from "../utils/dateInput.js";
import { bankAccountLabel } from "../utils/bankAccounts.js";
import { expenseNatureLabels, flowTypeLabels, optionLabel, requestFrequencyLabels, trackCRequestTypeLabels } from "../utils/options.js";
import { invoiceDueDate, supplierCreditDays } from "../../../shared/invoiceFinance.mjs";
import { allocationPercentages, splitByPercentages } from "../../../shared/costCenterAllocation.mjs";
import PaymentTermsSummary from "./PaymentTermsSummary.jsx";
import CostAllocationSummary from "./CostAllocationSummary.jsx";
import { costCenterTypeLabels } from "../utils/costAllocation.js";

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
  return <div className={wide ? "wide" : undefined}><dt>{t(label)}</dt><dd>{children == null || children === "" ? "-" : children}</dd></div>;
}

// The last step of the request form ("Resumen y envío"): everything the approver will see, in the
// order it was entered, each part with a link back to its step so it is corrected in place.
export default function RequestReview({ form, capex, lines, costAllocations = [], quotations, quotationFiles, files, existingAttachments, masters, totals, budgetPreview, selectedSupplier, selectedAccount, invoice, onEdit }) {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const center = (id) => masters.costCenters.find((item) => item._id === id) || masters.beneficiaryCenters?.find((item) => item._id === id);
  // Por Encargo: who bears the expense, with the share each takes of the total.
  const onBehalf = costAllocations.length > 0;
  const percentages = allocationPercentages(costAllocations);
  const shares = splitByPercentages(totals.total, percentages);
  const charged = costAllocations.map((allocation, index) => ({ costCenterSnapshot: center(allocation.costCenter) || {}, percentage: percentages[index], amount: shares[index] }));
  const project = masters.projects.find((item) => item._id === capex.projectId);
  const trackC = form.flowType === "C";
  const otherDocuments = existingAttachments.filter((item) => !["QUOTATION", "XML", "PDF", "FEE_RECEIPT"].includes(item.kind)).length
    + Object.entries(files).filter(([key]) => !["xml", "pdf", "feeReceipt"].includes(key)).flatMap(([, chosen]) => chosen).length;
  const quotesWithFile = quotations.filter((item) => item.attachment || quotationFiles[item.clientId]).length;
  const mismatch = selectedAccount && selectedAccount.currency !== form.currency;
  const terms = quotations.find(q => q.recommended && q.paymentCondition) || (form.supplierPaymentTerms?.paymentCondition ? form.supplierPaymentTerms : selectedSupplier?.paymentTerms);
  const dueDate = invoiceDueDate(invoice?.issueDate, terms);
  const creditDays = terms?.creditDays ?? (terms?.paymentCondition === "100%_ADVANCE" ? 0 : terms?.paymentCondition ? "No aplica" : supplierCreditDays(terms) ?? "Sin especificar");

  return <div className="review-layout">
    <Section title={trackC ? "Beneficiary" : "Supplier details"} step="supplier" onEdit={onEdit}>
      {trackC
        ? <dl className="detail-grid"><Item label="Request type">{t(trackCRequestTypeLabels[form.requestType] || form.requestType)}</Item><Item label="Paid to">{t("Your verified bank account")}</Item></dl>
        : selectedSupplier
          ? <dl className="detail-grid">
            <Item label="Supplier" wide><strong>{supplierName(selectedSupplier)}</strong> <StatusBadge status={supplierStatus(selectedSupplier)} /></Item>
            <Item label="Credit days">{creditDays}</Item>
          </dl>
          : <p>{t("No supplier selected.")}</p>}
      {!trackC && selectedSupplier && <details><summary>{t("Supplier details")}</summary><dl className="detail-grid">
            <Item label="PRV Code">{selectedSupplier.supplierCode}</Item>
            <Item label="RUC">{selectedSupplier.rucDni}</Item>
            <Item label="Account the supplier is paid into" wide>{selectedAccount ? bankAccountLabel(selectedAccount, t) : t("No account chosen")}</Item>
            <Item label="Payment currency">{selectedAccount?.currency || form.currency}</Item>
          </dl></details>}
      {mismatch && <div className="inline-alert alert-warning"><AlertTriangle size={16} aria-hidden="true" /><span>{t("The account is in {account} and the request in {request}. Nothing is converted: choose an account in {request} or change the currency.").replace("{account}", selectedAccount.currency).replaceAll("{request}", form.currency)}</span></div>}
    </Section>

    {!trackC && invoice && <Section title="Receipt" step="invoice" onEdit={onEdit}>
      <dl className="detail-grid">
        <Item label="Receipt">{invoice.attached ? invoice.number || t("Attached") : t("Pending")}</Item>
        <Item label="Receipt issue date">{invoice.attached && invoice.issueDate ? formatDate(invoice.issueDate, language) : t("Pending")}</Item>
        {dueDate && <Item label="Due date">{formatDate(dueDate, language)}</Item>}
      </dl>
      <details><summary>{t("Additional details")}</summary><dl className="detail-grid">
        <Item label="Receipt total">{invoice.attached && invoice.totalAmount !== "" ? formatCurrency(invoice.totalAmount, invoice.currency || form.currency, language) : "-"}</Item>
        <Item label="IGV">{invoice.attached && invoice.igvAmount !== "" ? formatCurrency(invoice.igvAmount, invoice.currency || form.currency, language) : "-"}</Item>
        <Item label="Quotations">{quotations.length ? `${quotesWithFile}/${quotations.length}` : "0"}</Item>
        {quotations.length > 1 && <Item label="Supplier selection reason" wide>{form.supplierSelectionReason}</Item>}
      </dl></details>
    </Section>}

    <Section title="Requirement details" step="details" onEdit={onEdit}>
      <dl className="detail-grid">
        <Item label="Detailed description" wide>{form.detailedDescription || form.description}</Item>
        <Item label="Priority"><PriorityBadge priority={form.priority} /></Item>
        <Item label="Frequency">{t(requestFrequencyLabels[form.frequency] || form.frequency)}</Item>
        <Item label="Requirement date">{formatDate(form.issueDate, language)}</Item>
        <Item label="Total amount">{formatCurrency(totals.total, form.currency, language)}</Item>
        {!trackC && <Item label="Cost center type">{t(costCenterTypeLabels[onBehalf ? "POR_ENCARGO" : "PROPIO"])}</Item>}
        {onBehalf && <Item label="Requesting area">{user?.area}</Item>}
        {onBehalf && <Item label="Charged to" wide><CostAllocationSummary allocations={charged} currency={form.currency} /></Item>}
        {!trackC && form.supplierPaymentTerms?.paymentCondition && <Item label="Payment condition"><PaymentTermsSummary terms={terms} /></Item>}
      </dl>
      <details><summary>{t("Additional details")}</summary><dl className="detail-grid">
        <Item label="Business justification" wide>{form.businessJustification}</Item>
        <Item label="Operational track">{t(optionLabel(form.flowType, flowTypeLabels))}</Item>
        {!trackC && <Item label="CAPEX / OPEX">{t(form.requestType)}</Item>}
        <Item label="Expense nature">{t(optionLabel(form.expenseNature, expenseNatureLabels))}</Item>
        <Item label="Request month">{formatIsoMonth(form.accountingPeriod) || form.accountingPeriod}</Item>
        <Item label={onBehalf ? "Requesting CECO" : "CECO"}>{center(form.requesterCostCenter) ? `${center(form.requesterCostCenter).code} - ${center(form.requesterCostCenter).name}` : ""}</Item>
        {form.observations && <Item label="Additional observations" wide>{form.observations}</Item>}
        {form.nonApprovalRisk && <Item label="Risk if not approved" wide>{form.nonApprovalRisk}</Item>}
        {form.requestType === "CAPEX" && <>
          <Item label="Project / PEP">{project ? `${project.code} - ${project.name}` : capex.projectPep}</Item>
          <Item label="Fixed asset category">{capex.assetCategory ? t(capex.assetCategory) : ""}</Item>
          <Item label="Useful life (years)">{capex.usefulLifeYears}</Item>
          <Item label="NPV / VAN amount">{capex.npvAmount !== "" ? formatCurrency(capex.npvAmount, capex.npvCurrency, language) : ""}</Item>
          <Item label="Payback">{capex.paybackValue !== "" ? `${capex.paybackValue} ${t(capex.paybackUnit === "YEARS" ? "Years" : "Months")}` : ""}</Item>
        </>}
      </dl></details>
    </Section>

    <details><summary>{t("Items and totals")}</summary><Section title="Items and totals" step="details" onEdit={onEdit}>
      <div className="review-lines">{lines.map((line, index) => <div key={line.clientId}><span>{index + 1}</span><div><strong>{line.itemDescription || t("Accounting line")}</strong><small>{center(line.costCenter) ? `${center(line.costCenter).code} - ${center(line.costCenter).name}` : ""}</small></div><strong>{formatCurrency(line.totalAmount, form.currency, language)}</strong></div>)}</div>
      <div className="review-total"><span>{t("Total amount")} ({form.currency})</span><strong>{formatCurrency(totals.total, form.currency, language)}</strong></div>
      <dl className="detail-grid"><Item label="Budget status"><StatusBadge status={budgetPreview.status} /></Item><Item label="Supporting documents">{String(otherDocuments)}</Item></dl>
    </Section></details>
  </div>;
}
