import { AlertTriangle, Building2, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, Landmark, Plus, RefreshCw, Save, Trash2, Truck, UserCheck, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../../context/LanguageContext.jsx";
import Message from "../Message.jsx";
import OptionalSection from "../OptionalSection.jsx";
import WorkflowStepper from "../WorkflowStepper.jsx";
import { dniError, identifierError, requiredError } from "../../utils/fieldValidation.js";
import { homologationChecklist, supplierStepProblems, supplierStepsFor } from "../../utils/supplierProposal.js";
import { bankAccountLabel, bankAccountPayload, emptyBankAccount } from "../../utils/bankAccounts.js";
import BankAccountFields from "./BankAccountFields.jsx";
import CreditDaysField from "./CreditDaysField.jsx";
import "../../styles/supplierForm.css";

// Checked when the field is left; Continue and Submit check the whole step (utils/supplierProposal.js).
const blurChecks = {
  rucDni: (values) => identifierError(values.rucDni),
  legalName: (values) => requiredError(values.legalName),
  representativeDocumentNumber: (values) => values.representativeDocumentType === "DNI" ? dniError(values.representativeDocumentNumber, { required: false }) : "",
  proposalJustification: (values) => requiredError(values.proposalJustification)
};

const STEP_LABELS = { identity: "Identification", conditions: "Contacts and conditions", bank: "Bank accounts", review: "Review and submit" };
const emptyContact = { name: "", position: "", phone: "", email: "" };

function normalizeRepresentativeDocumentType(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "DNI") return "DNI";
  if (normalized === "CE" || normalized.includes("EXTRANJER")) return "CE";
  return normalized || "DNI";
}

function initialValues(supplier, identifier, padronLookup) {
  const padron = padronLookup?.found ? padronLookup.data : null;
  return {
    rucDni: supplier?.rucDni || padron?.rucDni || identifier || "",
    legalName: supplier?.legalName || supplier?.name || padron?.legalName || "",
    commercialName: supplier?.commercialName || padron?.commercialName || "",
    personType: supplier?.personType || padron?.personType || "",
    fiscalAddress: supplier?.fiscalAddress || supplier?.taxAddress || padron?.fiscalAddress || "",
    district: supplier?.location?.district || padron?.location?.district || "",
    province: supplier?.location?.province || padron?.location?.province || "",
    department: supplier?.location?.department || padron?.location?.department || "",
    ubigeo: supplier?.location?.ubigeo || padron?.location?.ubigeo || "",
    website: supplier?.website || "",
    legalRepresentative: supplier?.legalRepresentative || "",
    representativeDocumentType: supplier?.legalRepresentativeDocument?.type || "DNI",
    representativeDocumentNumber: supplier?.legalRepresentativeDocument?.number || "",
    commercialContact: { ...emptyContact, ...(supplier?.commercialContact || {}) },
    operationsContact: { ...emptyContact, ...(supplier?.operationsContact || {}) },
    currency: supplier?.currency || "PEN",
    paymentTerms: supplier?.paymentTerms || { option: "", days: "" },
    goodsServicesProfile: supplier?.goodsServicesProfile || "",
    deliveryMethod: supplier?.delivery?.method || "CENTRAL_WAREHOUSE",
    deliveryOther: supplier?.delivery?.other || "",
    proposalJustification: supplier?.proposalJustification || "",
    // A supplier may be paid into more than one account (e.g. one in soles and one in dollars).
    bankAccounts: [emptyBankAccount(supplier?.legalName || supplier?.name || padron?.accountHolderName || padron?.legalName || "", supplier?.currency || "PEN")]
  };
}

// Drafts saved before several accounts were possible kept one account in flat fields.
function restoredForm(saved) {
  if (!saved || Array.isArray(saved.bankAccounts)) return saved;
  const { bank = "", accountType, accountNumber = "", cci = "", accountCurrency = "PEN", accountHolderName = "", ...rest } = saved;
  return { ...rest, bankAccounts: [{ ...emptyBankAccount(accountHolderName, accountCurrency), bank, accountType: accountType === "CURRENT" ? "CURRENT" : "SAVINGS", accountNumber, cci }] };
}

function Section({ icon: Icon, title, status, children }) {
  const { t } = useLanguage();
  return (
    <section className="supplier-form-section">
      <header>
        <span className="section-icon"><Icon size={17} aria-hidden="true" /></span>
        <div>
          <h3>{t(title)}</h3>
          {status && <small>{t(status)}</small>}
        </div>
      </header>
      {children}
    </section>
  );
}

function ContactFields({ legend, value, onChange }) {
  const { t } = useLanguage();
  return (
    <fieldset className="form-grid supplier-contact-fields">
      <legend className="sr-only">{t(legend)}</legend>
      <label className="field"><span>{t("Contact name")}</span><input value={value.name} onChange={(event) => onChange("name", event.target.value)} /></label>
      <label className="field"><span>{t("Position")}</span><input value={value.position} onChange={(event) => onChange("position", event.target.value)} /></label>
      <label className="field"><span>{t("Mobile phone")}</span><input value={value.phone} onChange={(event) => onChange("phone", event.target.value)} inputMode="tel" /></label>
      <label className="field"><span>{t("Email")}</span><input type="email" value={value.email} onChange={(event) => onChange("email", event.target.value)} /></label>
    </fieldset>
  );
}

// SUNAT lookups in one panel: taxpayer data (Consulta RUC, or the Padrón fallback) and legal
// representatives, one row each, instead of up to five stacked alerts.
function SunatStatus({ padronLookup, representativeLookup, padronData, legalName }) {
  const { t } = useLanguage();
  if (!padronLookup && !representativeLookup) return null;
  const representatives = representativeLookup?.data?.representatives || [];
  const taxpayer = padronLookup?.loading
    ? { tone: "info", icon: RefreshCw, spin: true, title: "Loading SUNAT details in the background", text: t("You can continue filling the form. Available SUNAT data will fill untouched fields automatically.") }
    : padronLookup?.found
      ? { tone: padronData?.eligibleForHomologation ? "success" : "warning", icon: padronData?.eligibleForHomologation ? CheckCircle2 : AlertTriangle, title: padronLookup.source === "SUNAT_CONSULTA_RUC" ? "SUNAT Consulta RUC data loaded automatically" : "SUNAT Padrón data loaded automatically", text: [padronData?.legalName || legalName, `${t("Status")}: ${padronData?.taxpayerStatus || "-"}`, `${t("Domicile condition")}: ${padronData?.domicileCondition || "-"}`, padronData?.location?.ubigeo && `${t("SUNAT UBIGEO")}: ${padronData.location.ubigeo}`, padronLookup.datasetDate && `${t("Dataset")}: ${padronLookup.datasetDate}`, padronLookup.fallback && t("Consulta RUC unavailable. Official Padrón fallback used.")].filter(Boolean).join(" · ") }
      : padronLookup
        ? { tone: "warning", icon: AlertTriangle, title: padronLookup.unavailable ? "SUNAT automatic lookup temporarily unavailable" : "RUC not found in the current SUNAT Padrón", text: padronLookup.message ? t(padronLookup.message) : t("Consulta RUC could not be reached and the Padrón fallback is unavailable. We will retry automatically; you can keep completing this form.") }
        : null;
  const people = representativeLookup?.loading
    ? { tone: "info", icon: RefreshCw, spin: true, title: "Checking SUNAT legal representatives...", text: t("The supplier form is already available while Consulta RUC is checked in the background.") }
    : representativeLookup?.error
      ? { tone: "warning", icon: AlertTriangle, title: "SUNAT representative lookup temporarily unavailable", text: `${representativeLookup.error} ${t("The Padrón validation above remains valid and supplier creation can continue.")}` }
      : representativeLookup?.data
        ? representatives.length === 1
          ? { tone: "success", icon: CheckCircle2, title: "SUNAT legal representatives", text: t("The single SUNAT representative was automatically copied into the Legal Representative fields below.") }
          : representatives.length > 1
            ? { tone: "info", icon: Users, title: "SUNAT legal representatives", text: t("SUNAT reports multiple representatives. Select the person UMA wants to record as the primary representative; the system will not guess automatically.") }
            : { tone: "warning", icon: AlertTriangle, title: "SUNAT legal representatives", text: t("SUNAT Consulta RUC did not return legal representatives for this RUC.") }
        : null;
  return (
    <div className="sunat-status" role="status">
      {[taxpayer, people].filter(Boolean).map((row) => {
        const Icon = row.icon;
        return <div key={row.title} className={`sunat-status-row tone-${row.tone}`}><Icon size={17} className={row.spin ? "spin" : undefined} aria-hidden="true" /><div><strong>{t(row.title)}</strong><span>{row.text}</span></div></div>;
      })}
    </div>
  );
}

export default function SupplierForm({ supplier, identifier, padronLookup = null, representativeLookup = null, includeInitialBank = false, loading = false, draftValue = null, onDraftChange, onSubmit, onCancel }) {
  const { t } = useLanguage();
  const [form, setForm] = useState(() => restoredForm(draftValue?.form) || initialValues(supplier, identifier, padronLookup));
  const steps = supplierStepsFor({ includeInitialBank });
  const [step, setStep] = useState(() => steps.includes(draftValue?.step) ? draftValue.step : "identity");
  const [completed, setCompleted] = useState([]);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const formRef = useRef(null);
  const stepIndex = steps.indexOf(step);

  function checkField(field) {
    setFieldErrors((current) => ({ ...current, [field]: blurChecks[field](form) }));
  }
  const fieldClass = (field, base = "field") => `${base}${fieldErrors[field] ? " field-error" : ""}`;
  const fieldMessage = (field) => fieldErrors[field] && <small className="field-error-text">{t(fieldErrors[field])}</small>;

  const padronData = padronLookup?.found ? padronLookup.data : null;
  const editedFields = useRef(new Set(draftValue?.form ? Object.keys(draftValue.form) : []));
  useEffect(() => { onDraftChange?.({ form, step }); }, [form, step]);

  useEffect(() => {
    if (supplier || !padronLookup?.found) return;
    const values = initialValues(null, identifier, padronLookup);
    setForm((current) => {
      const next = { ...current };
      for (const field of ["legalName", "commercialName", "personType", "fiscalAddress", "district", "province", "department", "ubigeo"]) {
        if (!editedFields.current.has(field) && !current[field] && values[field]) next[field] = values[field];
      }
      // The account holder is the supplier itself unless someone typed another name.
      const holder = values.bankAccounts[0].accountHolderName;
      if (holder) next.bankAccounts = (current.bankAccounts || []).map((account) => account.accountHolderName ? account : { ...account, accountHolderName: holder });
      return next;
    });
  }, [supplier, identifier, padronLookup]);

  const legalRepresentatives = representativeLookup?.data?.representatives || [];

  // When SUNAT reports exactly one legal representative, fill the representative fields. With
  // more than one, the person UMA records as primary is chosen by the user, never guessed.
  useEffect(() => {
    if (supplier || legalRepresentatives.length !== 1) return;
    const representative = legalRepresentatives[0];
    setForm((current) => {
      if (current.legalRepresentative || current.representativeDocumentNumber) return current;
      return { ...current, legalRepresentative: representative.fullName || "", representativeDocumentType: normalizeRepresentativeDocumentType(representative.documentType), representativeDocumentNumber: representative.documentNumber || "" };
    });
  }, [supplier, representativeLookup?.data?.queriedAt]);

  function setValue(field, value) {
    editedFields.current.add(field);
    // A message disappears as soon as the value is fixed.
    setFieldErrors((current) => {
      const values = { ...form, [field]: value };
      const fixed = Object.keys(current).filter((key) => current[key] && (blurChecks[key] ? !blurChecks[key](values) : key === field));
      if (!fixed.length) return current;
      const next = { ...current };
      fixed.forEach((key) => { next[key] = ""; });
      return next;
    });
    setForm((current) => ({ ...current, [field]: value }));
  }

  function setContact(group, field, value) {
    setForm((current) => ({ ...current, [group]: { ...current[group], [field]: value } }));
  }

  function useLegalRepresentative(representative) {
    setForm((current) => ({ ...current, legalRepresentative: representative.fullName || "", representativeDocumentType: normalizeRepresentativeDocumentType(representative.documentType), representativeDocumentNumber: representative.documentNumber || "" }));
  }

  function setAccount(index, patch) {
    setFieldErrors((current) => {
      const next = { ...current };
      Object.keys(patch).forEach((field) => { delete next[`bankAccounts.${index}.${field}`]; });
      return next;
    });
    setForm((current) => ({ ...current, bankAccounts: current.bankAccounts.map((account, position) => position === index ? { ...account, ...patch } : account) }));
  }

  function addAccount() {
    // The second account is usually the other currency (soles and dollars).
    setForm((current) => {
      const used = new Set(current.bankAccounts.map((account) => account.accountCurrency));
      const holder = current.bankAccounts[0]?.accountHolderName || current.legalName;
      return { ...current, bankAccounts: [...current.bankAccounts, emptyBankAccount(holder, used.has("PEN") && !used.has("USD") ? "USD" : "PEN")] };
    });
  }

  function removeAccount(index) {
    setFieldErrors({});
    setForm((current) => ({ ...current, bankAccounts: current.bankAccounts.length > 1 ? current.bankAccounts.filter((_, position) => position !== index) : [emptyBankAccount(current.legalName, current.currency)] }));
  }

  const accountErrors = (index) => Object.fromEntries(Object.entries(fieldErrors).filter(([key, value]) => value && key.startsWith(`bankAccounts.${index}.`)).map(([key, value]) => [key.split(".")[2], value]));

  // Field messages plus one summary next to the buttons; focus goes to the first problem.
  function showProblems(problems, target) {
    setFieldErrors((current) => ({ ...current, ...problems }));
    setError(Object.values(problems).map((message) => t(message)).join(" "));
    setStep(target);
    window.requestAnimationFrame(() => {
      const field = formRef.current?.querySelector(`[data-step="${target}"] .field-error input, [data-step="${target}"] .field-error select, [data-step="${target}"] .field-error textarea, [data-step="${target}"] .field-error button`);
      field?.focus();
      field?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function goTo(next) {
    setError("");
    setStep(next);
    formRef.current?.closest(".drawer-body")?.scrollTo?.({ top: 0 });
  }

  function next() {
    const problems = supplierStepProblems(step, form, { includeInitialBank });
    if (Object.keys(problems).length) return showProblems(problems, step);
    setCompleted((current) => [...new Set([...current, step])]);
    goTo(steps[stepIndex + 1]);
  }

  async function submit(event) {
    event.preventDefault();
    // A new proposal is sent from the review step only; Enter on an earlier step continues.
    if (!supplier && step !== "review") return next();
    if (!/^\d{8}$|^\d{11}$/.test(form.rucDni.replace(/\D/g, ""))) return showProblems({ rucDni: "Enter a valid 11-digit RUC or supported 8-digit DNI." }, "identity");
    for (const target of steps) {
      const problems = supplierStepProblems(target, form, { includeInitialBank });
      if (Object.keys(problems).length) return showProblems(problems, target);
    }
    const payload = new FormData();
    for (const field of ["rucDni", "legalName", "commercialName", "personType", "fiscalAddress", "website", "legalRepresentative", "currency", "goodsServicesProfile", "proposalJustification"]) payload.append(field, form[field]);
    payload.append("name", form.legalName);
    payload.append("paymentTerms", JSON.stringify(form.paymentTerms?.option ? form.paymentTerms : {}));
    payload.append("location", JSON.stringify({ district: form.district, province: form.province, department: form.department, ubigeo: form.ubigeo }));
    payload.append("legalRepresentativeDocument", JSON.stringify({ type: form.representativeDocumentType, number: form.representativeDocumentNumber }));
    payload.append("commercialContact", JSON.stringify(form.commercialContact));
    payload.append("operationsContact", JSON.stringify(form.operationsContact));
    payload.append("delivery", JSON.stringify({ method: form.deliveryMethod, other: form.deliveryOther }));
    // Every account with a bank chosen is sent (Continue refuses an account started without one,
    // so nothing is dropped silently).
    const accounts = includeInitialBank ? form.bankAccounts.filter((account) => account.bank).map(bankAccountPayload) : [];
    if (accounts.length) payload.append("bankAccounts", JSON.stringify(accounts));
    setError("");
    await onSubmit(payload);
  }

  const checklist = homologationChecklist(form);
  const accounts = form.bankAccounts.filter((account) => account.bank);
  const pane = (id) => ({ "data-step": id, hidden: step !== id });

  return (
    <form ref={formRef} className="supplier-official-form" onSubmit={submit} noValidate>
      <WorkflowStepper steps={steps.map((id) => STEP_LABELS[id])} current={stepIndex} completedSteps={completed.map((id) => steps.indexOf(id))} maxAccessible={steps.length - 1} onSelect={(index) => goTo(steps[index])} />
      <p className="supplier-form-legend">{t("* Required to submit.")}</p>

      <div {...pane("identity")}>
        {!supplier && <SunatStatus padronLookup={padronLookup} representativeLookup={representativeLookup} padronData={padronData} legalName={form.legalName} />}
        {!supplier && legalRepresentatives.length > 0 && (
          <details className="sunat-representatives" open={legalRepresentatives.length > 1 || undefined}>
            <summary>{t("Legal representatives of {ruc} - {name}").replace("{ruc}", representativeLookup.data.ruc || "").replace("{name}", representativeLookup.data.legalName || form.legalName)} ({legalRepresentatives.length})</summary>
            <p className="section-note">{t("This is what the taxpayer declared to SUNAT (Consulta RUC). It does not replace the supplier's supporting legal documents.")}</p>
            <div className="detail-stack">
              {legalRepresentatives.map((representative, index) => (
                <div className="detail-section" key={`${representative.documentType}-${representative.documentNumber}-${index}`}>
                  <dl className="supplier-detail-grid">
                    <div><dt>{t("Document")}</dt><dd>{representative.documentType || "-"}</dd></div>
                    <div><dt>{t("Document number")}</dt><dd>{representative.documentNumber || "-"}</dd></div>
                    <div><dt>{t("Name")}</dt><dd><strong>{representative.fullName || "-"}</strong></dd></div>
                    <div><dt>{t("Position")}</dt><dd>{representative.position || "-"}</dd></div>
                    <div><dt>{t("Effective From")}</dt><dd>{representative.dateFrom || "-"}</dd></div>
                  </dl>
                  <div className="supplier-form-actions"><button type="button" className="secondary-button" onClick={() => useLegalRepresentative(representative)}><UserCheck size={16} /><span>{t("Use as legal representative")}</span></button></div>
                </div>
              ))}
            </div>
          </details>
        )}

        <Section icon={Building2} title="Legal Identification">
          <div className="form-grid supplier-form-grid">
            <label className={fieldClass("rucDni")}><span>{t("RUC / identifier")} *</span><input value={form.rucDni} onChange={(event) => setValue("rucDni", event.target.value)} inputMode="numeric" readOnly={!supplier && Boolean(identifier)} required onBlur={() => checkField("rucDni")} aria-invalid={Boolean(fieldErrors.rucDni)} />{fieldMessage("rucDni")}</label>
            <label className="field"><span>{t("Person Type")}</span><select value={form.personType} onChange={(event) => setValue("personType", event.target.value)}><option value="">{t("Select")}</option><option value="LEGAL_ENTITY">{t("LEGAL_ENTITY")}</option><option value="NATURAL_PERSON_WITH_BUSINESS">{t("NATURAL_PERSON_WITH_BUSINESS")}</option></select></label>
            <label className={fieldClass("legalName", "field field-span-2")}><span>{t("Legal Name")} *</span><input value={form.legalName} onChange={(event) => setValue("legalName", event.target.value)} required onBlur={() => checkField("legalName")} aria-invalid={Boolean(fieldErrors.legalName)} />{fieldMessage("legalName")}</label>
            <label className="field field-span-2"><span>{t("Commercial Name")}</span><input value={form.commercialName} onChange={(event) => setValue("commercialName", event.target.value)} /></label>
            <label className="field field-span-2"><span>{t("Fiscal Address")}</span><input value={form.fiscalAddress} onChange={(event) => setValue("fiscalAddress", event.target.value)} /></label>
            <label className="field"><span>{t("District")}</span><input value={form.district} onChange={(event) => setValue("district", event.target.value)} /></label>
            <label className="field"><span>{t("Province")}</span><input value={form.province} onChange={(event) => setValue("province", event.target.value)} /></label>
            <label className="field"><span>{t("Department")}</span><input value={form.department} onChange={(event) => setValue("department", event.target.value)} /></label>
            <label className="field"><span>{t("SUNAT UBIGEO")}</span><input value={form.ubigeo} onChange={(event) => setValue("ubigeo", event.target.value)} inputMode="numeric" maxLength="6" /></label>
            <label className="field"><span>{t("Website")}</span><input type="url" value={form.website} onChange={(event) => setValue("website", event.target.value)} placeholder="https://" /></label>
            <label className="field field-span-2"><span>{t("Legal Representative")}</span><input value={form.legalRepresentative} onChange={(event) => setValue("legalRepresentative", event.target.value)} /></label>
            <label className="field"><span>{t("Representative document type")}</span><select value={form.representativeDocumentType} onChange={(event) => setValue("representativeDocumentType", event.target.value)}><option value="DNI">DNI</option><option value="CE">CE</option><option value="PASAPORTE">{t("Passport")}</option></select></label>
            <label className={fieldClass("representativeDocumentNumber")}><span>{t("Representative document number")}</span><input value={form.representativeDocumentNumber} onChange={(event) => setValue("representativeDocumentNumber", event.target.value)} inputMode={form.representativeDocumentType === "DNI" ? "numeric" : undefined} onBlur={() => checkField("representativeDocumentNumber")} aria-invalid={Boolean(fieldErrors.representativeDocumentNumber)} />{fieldMessage("representativeDocumentNumber")}</label>
          </div>
        </Section>
      </div>

      <div {...pane("conditions")}>
        <Section icon={Users} title="Commercial Contact">
          <ContactFields legend="Commercial Contact" value={form.commercialContact} onChange={(field, value) => setContact("commercialContact", field, value)} />
        </Section>
        <OptionalSection title="Operations / Logistics Contact" description="Optional contact for dispatch and delivery" initiallyOpen={Object.values(form.operationsContact || {}).some(Boolean)}>
          <ContactFields legend="Operations / Logistics Contact" value={form.operationsContact} onChange={(field, value) => setContact("operationsContact", field, value)} />
        </OptionalSection>
        <Section icon={Truck} title="Commercial Conditions">
          <div className="form-grid supplier-form-grid">
            <label className="field"><span>{t("Billing Currency")}</span><select value={form.currency} onChange={(event) => setValue("currency", event.target.value)}><option value="PEN">PEN</option><option value="USD">USD</option></select></label>
            <CreditDaysField value={form.paymentTerms} onChange={value => setValue("paymentTerms", value)} />
            <label className="field field-span-2"><span>{t("Goods / services profile")}</span><textarea rows="2" value={form.goodsServicesProfile} onChange={(event) => setValue("goodsServicesProfile", event.target.value)} /></label>
            <label className="field"><span>{t("Delivery Method")}</span><select value={form.deliveryMethod} onChange={(event) => setValue("deliveryMethod", event.target.value)}><option value="CENTRAL_WAREHOUSE">{t("CENTRAL_WAREHOUSE")}</option><option value="DESTINATION_SITE">{t("DESTINATION_SITE")}</option><option value="OTHER">{t("OTHER")}</option></select></label>
            {form.deliveryMethod === "OTHER" && <label className={fieldClass("deliveryOther")}><span>{t("Other delivery method")} *</span><input value={form.deliveryOther} onChange={(event) => setValue("deliveryOther", event.target.value)} aria-invalid={Boolean(fieldErrors.deliveryOther)} />{fieldMessage("deliveryOther")}</label>}
            <label className={fieldClass("proposalJustification", "field field-span-2")}><span>{t("Registration justification")} *</span><textarea rows="3" value={form.proposalJustification} onChange={(event) => setValue("proposalJustification", event.target.value)} required onBlur={() => checkField("proposalJustification")} aria-invalid={Boolean(fieldErrors.proposalJustification)} />{fieldMessage("proposalJustification")}</label>
          </div>
        </Section>
      </div>

      {includeInitialBank && <div {...pane("bank")}>
        <Section icon={Landmark} title="Bank accounts" status="Where the supplier is paid. Add one account per currency it is paid in. Accounting verifies each one before Treasury pays it.">
          <div className="bank-account-list">
            {form.bankAccounts.map((account, index) => (
              <div className="bank-account-card" key={account.clientId || index}>
                <div className="bank-account-card-head"><strong>{t("Account {number}").replace("{number}", index + 1)}</strong>{(form.bankAccounts.length > 1 || account.bank) && <button type="button" className="icon-button quiet danger" onClick={() => removeAccount(index)} title={t("Remove account")} aria-label={`${t("Remove account")} ${index + 1}`}><Trash2 size={15} aria-hidden="true" /></button>}</div>
                <BankAccountFields value={account} onChange={(patch) => setAccount(index, patch)} errors={accountErrors(index)} />
              </div>
            ))}
          </div>
          {form.bankAccounts.length < 4 && <button type="button" className="secondary-button" onClick={addAccount}><Plus size={16} aria-hidden="true" /><span>{t("Add another account (e.g. in dollars)")}</span></button>}
        </Section>
      </div>}

      <div {...pane("review")}>
        <section className="supplier-form-section supplier-review">
          <header><span className="section-icon"><CheckCircle2 size={17} aria-hidden="true" /></span><div><h3>{t("Review and submit")}</h3><small>{t("The supplier gets its PRV code when you register it; your jefe approves it before it can be paid.")}</small></div></header>
          <dl className="supplier-detail-grid">
            <div><dt>{t("RUC / identifier")}</dt><dd>{form.rucDni || "-"}</dd></div>
            <div><dt>{t("Legal Name")}</dt><dd><strong>{form.legalName || "-"}</strong></dd></div>
            <div><dt>{t("Legal Representative")}</dt><dd>{form.legalRepresentative || "-"}</dd></div>
            <div><dt>{t("Commercial Contact")}</dt><dd>{[form.commercialContact.name, form.commercialContact.email].filter(Boolean).join(" · ") || "-"}</dd></div>
            <div><dt>{t("Billing Currency")}</dt><dd>{form.currency}</dd></div>
            {includeInitialBank && <div className="wide"><dt>{t("Bank accounts")}</dt><dd>{accounts.length ? accounts.map((account) => <span className="review-account" key={account.clientId}>{bankAccountLabel({ ...account, currency: account.accountCurrency }, t)}</span>) : t("Add after saving")}</dd></div>}
            <div className="wide"><dt>{t("Registration justification")}</dt><dd>{form.proposalJustification || "-"}</dd></div>
          </dl>
          <h4>{t("What your jefe checks")}</h4>
          <ul className="homologation-checklist">
            {checklist.map((item) => <li key={item.key} className={item.done ? "is-done" : ""}>{item.done ? <CheckCircle2 size={15} aria-hidden="true" /> : <CircleDashed size={15} aria-hidden="true" />}<span>{t(item.label)}</span><small>{t(item.done ? "Done" : "Pending - your jefe needs it to approve")}</small><button type="button" className="text-button" onClick={() => goTo(item.step)}>{t("Edit")}</button></li>)}
          </ul>
        </section>
      </div>

      <div className="supplier-form-error"><Message type="error">{error}</Message></div>
      <footer className="supplier-form-actions">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={loading}>{t("Cancel")}</button>
        <span className="supplier-form-actions-spacer" />
        {stepIndex > 0 && <button type="button" className="secondary-button" onClick={() => goTo(steps[stepIndex - 1])} disabled={loading}><ChevronLeft size={16} aria-hidden="true" /><span>{t("Back")}</span></button>}
        {/* Corrections to an existing proposal can be saved from any step. Each button has its own
            key: if React reused the Continue element as the submit button, the click that opens the
            review step would also submit the form. */}
        {supplier && step !== "review" && <button key="save-corrections" type="submit" className="secondary-button" disabled={loading}><Save size={16} aria-hidden="true" /><span>{t(loading ? "Saving..." : "Save corrections")}</span></button>}
        {step !== "review"
          ? <button key="continue" type="button" className="primary-button" onClick={next} disabled={loading}><span>{t("Continue")}</span><ChevronRight size={16} aria-hidden="true" /></button>
          : <button key="submit" type="submit" className="primary-button" disabled={loading} aria-busy={loading}><Save size={16} aria-hidden="true" /><span>{t(loading ? "Saving..." : supplier ? "Save corrections" : "Create supplier proposal")}</span></button>}
      </footer>
    </form>
  );
}
