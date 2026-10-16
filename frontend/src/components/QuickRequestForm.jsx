import { Building2, FileText, HandCoins, ListChecks, Paperclip, ReceiptText, Save, Send, UserRound, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency } from "../utils/formatters.js";
import { formatIsoMonth } from "../utils/dateInput.js";
import { coversKind, isAnyDocument } from "../utils/documentRequirements.js";
import { currencies, expenseNatureLabels, expenseNatures, optionLabel } from "../utils/options.js";
import { quickTrackText } from "../utils/quickRequest.js";
import InvoiceDropZone from "./InvoiceDropZone.jsx";
import Message from "./Message.jsx";
import SearchSelect from "./SearchSelect.jsx";

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

function Question({ number, title, children }) {
  const { t } = useLanguage();
  return (
    <section className="quick-question" aria-labelledby={`quick-question-${number}`}>
      <h3 id={`quick-question-${number}`}><span className="quick-number" aria-hidden="true">{number}</span>{t(title)}</h3>
      {children}
    </section>
  );
}

// The simple "New request": three questions - what you need, how much, and the quote or invoice
// you have. The track (A1, B or C) follows from the answers; everything else (area, cost center,
// month, currency, priority) is filled in from the requester's profile. Anything this view does
// not ask stays available in the full form, which keeps every answer given here.
export default function QuickRequestForm({
  form, onFormChange, quick, onQuickChange, totals, lines, simpleAmount, onAmountChange,
  masters, suppliers, supplierProposalPath, invoiceCheck, onInvoiceFile, quoteFile, onQuoteFile,
  extraDocuments, files, onDocumentFiles, costCenterLabel, onCostCenterChange, period,
  errors, error, saving, disabled, onSaveDraft, onSubmit, onFullForm
}) {
  const { t, language } = useLanguage();
  const supplierPayee = quick.payee !== "employee";
  const trackText = quickTrackText(form);
  const supplierLabel = (item) => `${item.rucDni} - ${item.legalName || item.name}`;
  const fieldError = (key) => errors[key] && <small className="field-error-text">{t(errors[key])}</small>;

  return (
    <div className="quick-request">
      <div className="quick-request-intro">
        <p>{t("Answer three questions. We fill in the rest from your profile.")}</p>
        <button type="button" className="text-button" onClick={onFullForm}><ListChecks size={16} aria-hidden="true" />{t("Use the full form")}</button>
      </div>

      <Question number={1} title="What do you need?">
        <fieldset className="quick-choices" aria-label={t("Who gets the money?")}>
          <legend className="quick-legend">{t("Who gets the money?")}</legend>
          <Choice name="quick-payee" value="supplier" current={quick.payee} icon={Building2} title="A supplier" hint="A company or person who sells to UMA" onChange={(payee) => onQuickChange({ payee })} />
          <Choice name="quick-payee" value="employee" current={quick.payee} icon={UserRound} title="Me" hint="An advance or a reimbursement for you" onChange={(payee) => onQuickChange({ payee })} />
        </fieldset>
        {!supplierPayee && <fieldset className="quick-choices" aria-label={t("What do you need?")}>
          <Choice name="quick-employee" value="advance" current={quick.employeeNeed} icon={Wallet} title="Money in advance" hint="I will present the receipts afterwards" onChange={(employeeNeed) => onQuickChange({ employeeNeed })} />
          <Choice name="quick-employee" value="reimbursement" current={quick.employeeNeed} icon={HandCoins} title="I already paid, without a receipt" hint="I sign a declaration after approval" onChange={(employeeNeed) => onQuickChange({ employeeNeed })} />
        </fieldset>}
        <label className={`field${errors.detailedDescription || errors.description ? " field-error" : ""}`}>
          <span>{t("Describe it in a few words")} *</span>
          <textarea rows="3" value={form.detailedDescription} placeholder={t("E.g. 2 toners for the Nursing laboratory printer")} onChange={(event) => onFormChange({ detailedDescription: event.target.value, description: event.target.value })} aria-invalid={Boolean(errors.detailedDescription || errors.description)} />
          {fieldError("detailedDescription") || fieldError("description")}
        </label>
        <label className={`field${errors.businessJustification ? " field-error" : ""}`}>
          <span>{t("Why is it needed?")}{form.flowType === "A1" ? " *" : ""}</span>
          <textarea rows="2" value={form.businessJustification} placeholder={t("E.g. Practical classes start on Monday")} onChange={(event) => onFormChange({ businessJustification: event.target.value })} aria-invalid={Boolean(errors.businessJustification)} />
          {fieldError("businessJustification")}
        </label>
        <div className="form-grid two-column-form">
          <label className="field"><span>{t("Type of expense")}</span><select value={form.expenseNature} onChange={(event) => onFormChange({ expenseNature: event.target.value })}>{expenseNatures.map((item) => <option key={item} value={item}>{t(optionLabel(item, expenseNatureLabels))}</option>)}</select></label>
          {supplierPayee && <label className="quick-check"><input type="checkbox" checked={quick.capex} onChange={(event) => onQuickChange({ capex: event.target.checked })} /><span>{t("It is equipment or a work that lasts more than a year (CAPEX)")}</span></label>}
        </div>
      </Question>

      <Question number={2} title="How much?">
        {simpleAmount ? <div className="form-grid two-column-form">
          <label className={`field${errors["lines.0.totalAmount"] || errors["lines.0.unitPrice"] ? " field-error" : ""}`}>
            <span>{t("Total amount (IGV included)")} *</span>
            <input type="number" inputMode="decimal" min="0" step="0.01" value={quick.amount} onChange={(event) => onAmountChange(event.target.value)} aria-invalid={Boolean(errors["lines.0.totalAmount"] || errors["lines.0.unitPrice"])} />
            {fieldError("lines.0.totalAmount") || fieldError("lines.0.unitPrice")}
          </label>
          <label className="field"><span>{t("Currency")}</span><select value={form.currency} onChange={(event) => onFormChange({ currency: event.target.value })}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
        </div> : <div className="quick-lines">
          <p>{t(invoiceCheck?.invoice ? "Items read from the invoice:" : "Items of this request:")}</p>
          <ul>{lines.map((line) => <li key={line.clientId}><span>{line.itemDescription || t("Item")} · {line.quantity}</span><strong>{formatCurrency(line.totalAmount || 0, form.currency, language)}</strong></li>)}</ul>
          <button type="button" className="text-button" onClick={onFullForm}>{t("Change the items in the full form")}</button>
        </div>}
        <p className="quick-total"><span>{t("Total")}</span><strong>{formatCurrency(totals.total, form.currency, language)}</strong></p>
        <div className="quick-facts">
          <span>{t("Charged to")}: {masters.costCenters.length > 1
            ? <select aria-label={t("Cost Center / CECO")} value={form.requesterCostCenter} onChange={(event) => onCostCenterChange(event.target.value)}>{masters.costCenters.map((item) => <option key={item._id} value={item._id}>{item.code} - {item.name}</option>)}</select>
            : <strong>{costCenterLabel || "-"}</strong>}</span>
          <span>{t("Month")}: <strong>{formatIsoMonth(period) || period || "-"}</strong></span>
        </div>
        {(errors.requesterCostCenter || errors.accountingPeriod) && <small className="field-error-text">{t(errors.requesterCostCenter || errors.accountingPeriod)}</small>}
      </Question>

      <Question number={3} title={supplierPayee ? "Attach the quote or the invoice" : "Anything to attach?"}>
        {supplierPayee && <fieldset className="quick-choices" aria-label={t("What do you have from the supplier?")}>
          <legend className="quick-legend">{t("What do you have from the supplier?")}</legend>
          <Choice name="quick-evidence" value="quote" current={quick.evidence} icon={FileText} title="A quote" hint="The purchase goes to approval first" onChange={(evidence) => onQuickChange({ evidence })} />
          <Choice name="quick-evidence" value="invoice" current={quick.evidence} icon={ReceiptText} title="The invoice" hint="XML or PDF: we read it for you" onChange={(evidence) => onQuickChange({ evidence })} />
        </fieldset>}

        {supplierPayee && quick.evidence === "invoice" && <InvoiceDropZone check={invoiceCheck} onFile={onInvoiceFile} supplierProposalPath={supplierProposalPath} />}
        {supplierPayee && quick.evidence === "invoice" && errors.invoice && <small className="field-error-text">{t(errors.invoice)}</small>}

        {supplierPayee && quick.evidence === "quote" && <label className={`quick-file${errors.quote ? " field-error" : ""}${quoteFile ? " is-attached" : ""}`}>
          <Paperclip size={18} aria-hidden="true" />
          <span><strong>{quoteFile?.name || t("Attach the quote")}</strong><small>{t(quoteFile ? "Attached" : "PDF, Word, Excel or a photo")}</small></span>
          <input type="file" accept=".pdf,.doc,.docx,.xlsx,.jpg,.jpeg,.png" aria-label={t("Attach the quote")} onChange={(event) => { onQuoteFile(event.target.files?.[0] || null); event.target.value = ""; }} />
          {fieldError("quote")}
        </label>}

        {supplierPayee && <div className="quick-supplier">
          <SearchSelect label="Supplier" value={form.supplier} options={suppliers} onChange={(supplier) => onFormChange({ supplier })} getOptionLabel={supplierLabel} error={errors.supplier} required searchPlaceholder="Search name or RUC/DNI..." />
          <Link className="inline-link" to={supplierProposalPath}>{t("Supplier not found? Propose it")}</Link>
        </div>}

        {!supplierPayee && <p className="quick-note">{t(quick.employeeNeed === "reimbursement" ? "Nothing now: after approval you sign the declaration with your bank account." : "Nothing now: after you receive the money you present the receipts.")}</p>}

        {extraDocuments.map(({ rule, definition }) => <label key={definition.key} className={`quick-file${errors[definition.key] ? " field-error" : ""}${files[definition.key]?.length ? " is-attached" : ""}`}>
          <Paperclip size={18} aria-hidden="true" />
          <span><strong>{t(definition.label)} *</strong><small>{files[definition.key]?.length ? files[definition.key].map((file) => file.name).join(", ") : t(rule.labelKey || "Required document")}</small></span>
          <input type="file" accept={definition.accept} multiple={definition.multiple} aria-label={t(definition.label)} onChange={(event) => { onDocumentFiles(definition.key, Array.from(event.target.files || [])); event.target.value = ""; }} />
          {fieldError(definition.key)}
        </label>)}
      </Question>

      {trackText && <p className="quick-track" role="status"><strong>{t("How it goes")}:</strong> {t(trackText)}</p>}
      <div className="wizard-error"><Message type="error">{error}</Message></div>
      <footer className="wizard-actions">
        <button type="button" className="secondary-button" disabled={saving || disabled} onClick={onSaveDraft}><Save size={16} /><span>{t(saving ? "Saving..." : "Save draft")}</span></button>
        <div className="wizard-actions-right"><button type="button" className="primary-button" disabled={saving || disabled} onClick={onSubmit}><Send size={16} /><span>{t(saving ? "Submitting..." : "Send for approval")}</span></button></div>
      </footer>
    </div>
  );
}

// The extra documents a configured rule requires that the quick form's own quote / invoice does
// not already cover: each gets its own upload in question 3.
export function quickExtraDocuments(requirements = [], definitions = [], { evidence, flowType, quoteIsDocument = false } = {}) {
  return requirements
    .filter((rule) => rule.kind !== "QUOTATION")
    // The quote, uploaded as a supporting document, already is "at least one document".
    .filter((rule) => !(quoteIsDocument && evidence === "quote" && isAnyDocument(rule)))
    .filter((rule) => !(flowType === "B" && evidence === "invoice" && ["XML", "PDF"].some((kind) => coversKind(rule, kind))))
    // "At least one supporting document": any file is enough, so it is offered as one upload.
    .map((rule) => ({ rule, definition: isAnyDocument(rule) ? definitions.find((item) => item.kind === "SUPPORTING") : definitions.find((item) => coversKind(rule, item.kind)) }))
    .filter((item) => item.definition);
}
