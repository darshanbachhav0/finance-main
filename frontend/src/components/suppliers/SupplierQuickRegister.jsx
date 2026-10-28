import { CheckCircle2, Loader2, Paperclip, Plus, Send, Trash2, UserPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import api from "../../api/client.js";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { bankAccountPayload, bankAccountProblems, emptyBankAccount } from "../../utils/bankAccounts.js";
import Message from "../Message.jsx";
import StatusBadge from "../StatusBadge.jsx";
import BankAccountFields from "./BankAccountFields.jsx";
import CreditDaysField from "./CreditDaysField.jsx";
import ConsultaRucLink from "./ConsultaRucLink.jsx";
import { supplierCreditDays } from "../../../../shared/invoiceFinance.mjs";
import { representativeDocumentType } from "../../../../shared/supplierSunat.mjs";
import SupplierSunatEvidence, { SunatRepresentativeNote } from "./SupplierSunatEvidence.jsx";
import { dniError } from "../../utils/fieldValidation.js";

// Registering a supplier without leaving the request (step 1, "Datos de proveedor"): the RUC is
// checked against the registry first (an existing supplier is used, another area's is asked for),
// SUNAT fills the legal name, and the requester adds the reason and the bank accounts. The supplier
// gets its PRV code now; Accounting reviews its evidence independently of request approvals.
// Contacts and delivery stay in the full proposal on the Suppliers page.
const digits = (value) => String(value || "").replace(/\D/g, "");

export default function SupplierQuickRegister({ initialRuc = "", need = "", currency = "PEN", onRegistered, onUseExisting, onCancel }) {
  const { t } = useLanguage();
  const [ruc, setRuc] = useState(digits(initialRuc));
  const currentRuc = useRef(ruc);
  currentRuc.current = ruc;
  const [check, setCheck] = useState({ status: "idle" });
  const [sunat, setSunat] = useState(null);
  const [legalName, setLegalName] = useState("");
  const [representative, setRepresentative] = useState({ fullName: "", documentType: "DNI", documentNumber: "" });
  const [representativeLookup, setRepresentativeLookup] = useState({ status: "idle" });
  const [justification, setJustification] = useState(need ? t("Supplier for: {need}").replace("{need}", need.split(/\r?\n/)[0].slice(0, 160)) : "");
  const [accounts, setAccounts] = useState([emptyBankAccount("", currency)]);
  const [certificate, setCertificate] = useState(null);
  const [paymentTerms, setPaymentTerms] = useState({ option: "", days: "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [accessAsked, setAccessAsked] = useState(false);
  const typedName = useRef(false);
  const typedRepresentative = useRef(false);
  const autoHolder = useRef("");

  // The RUC is looked up as soon as it is complete: registered (use it), another area's (ask for
  // it) or new (SUNAT fills the legal name while the rest is typed).
  useEffect(() => {
    const value = digits(ruc);
    setAccessAsked(false);
    setSunat(null);
    setRepresentativeLookup({ status: "idle" });
    setRepresentative({ fullName: "", documentType: "DNI", documentNumber: "" });
    typedRepresentative.current = false;
    typedName.current = false;
    setLegalName("");
    const previousHolder = autoHolder.current;
    autoHolder.current = "";
    if (previousHolder) setAccounts(current => current.map(account => account.accountHolderName === previousHolder ? { ...account, accountHolderName: "" } : account));
    if (!/^(\d{8}|\d{11})$/.test(value)) { setCheck({ status: "idle" }); setSunat(null); return undefined; }
    let active = true;
    setCheck({ status: "checking" });
    api.get(`/suppliers/lookup/${value}`, { timeout: 10000 }).then((response) => {
      if (!active) return;
      if (response.data.found) { setCheck({ status: response.data.restricted ? "restricted" : "found", data: response.data.data }); return; }
      setCheck({ status: "new" });
      if (value.length !== 11) return;
      setSunat({ status: "loading" });
      api.get(`/suppliers/padron/${value}`, { timeout: 35000 }).then((lookup) => {
        if (!active) return;
        setSunat({ status: lookup.data?.found ? "found" : "missing", data: lookup.data?.data, lookup: lookup.data });
        const name = lookup.data?.data?.legalName;
        if (name && !typedName.current) {
          setLegalName(name);
          setAccounts((current) => current.map((account) => account.accountHolderName ? account : { ...account, accountHolderName: name }));
          autoHolder.current = name;
        }
        // Padrón and representatives have different sources. A taxpayer fallback
        // must not suppress a separate Consulta RUC lookup (or its cached result).
        if (!lookup.data?.found || !name) return;
        void retryRepresentatives(value, name, () => active, lookup.data.representativesLookup);
      }).catch(error => active && setSunat({ status: "unavailable", error: error.message, assistedAvailable: error.details?.assistedAvailable === true }));
    }).catch((err) => active && setCheck({ status: "error", error: err.message }));
    return () => { active = false; };
  }, [ruc]);

  function applyAssistedProfile(profile) {
    if (profile.ruc !== digits(currentRuc.current)) return;
    setSunat({ status: profile.found ? "found" : "missing", data: profile.data, lookup: profile });
    const name = profile.data?.legalName;
    if (name && !typedName.current) {
      setLegalName(name);
      setAccounts(current => current.map(account => account.accountHolderName ? account : { ...account, accountHolderName: name }));
      autoHolder.current = name;
    }
    // Representatives are a separate lookup; a verified RUC must not be replaced
    // with the failure of a new headless session after assisted verification.
    if (profile.found && name) void retryRepresentatives(profile.ruc, name);
  }

  async function retryRepresentatives(rucValue = digits(ruc), name = sunat?.data?.legalName || legalName, stillActive = () => true, prefetched) {
    if (!/^\d{11}$/.test(rucValue) || !name || !stillActive()) return;
    setRepresentativeLookup({ status: "loading" });
    try {
      if (prefetched?.error) throw new Error(prefetched.error);
      const response = prefetched?.data ? { data: prefetched.data } : await api.get(`/suppliers/consulta-ruc/${rucValue}/representatives`, {
        params: { legalName: name }, timeout: 35000
      });
      if (!stillActive() || digits(currentRuc.current) !== rucValue) return;
      if (response.data?.ruc !== rucValue) throw new Error("SUNAT returned an unexpected RUC.");
      setRepresentativeLookup({ status: "found", data: response.data });
      const people = response.data?.representatives || [];
      if (people.length === 1 && !typedRepresentative.current) {
        setRepresentative({ ...people[0], documentType: representativeDocumentType(people[0].documentType) });
      }
    } catch (err) {
      if (stillActive() && digits(currentRuc.current) === rucValue) {
        setRepresentativeLookup({ status: "unavailable", error: err.message || "SUNAT lookup unavailable" });
      }
    }
  }

  function editRepresentative(patch) {
    typedRepresentative.current = true;
    setRepresentative(current => ({ ...current, ...patch }));
  }

  function setAccount(index, patch) {
    setErrors((current) => {
      const next = { ...current };
      Object.keys(patch).forEach((key) => delete next[`accounts.${index}.${key}`]);
      return next;
    });
    setAccounts((current) => current.map((account, position) => position === index ? { ...account, ...patch } : account));
  }

  const accountErrors = (index) => Object.fromEntries(Object.entries(errors).filter(([key]) => key.startsWith(`accounts.${index}.`)).map(([key, value]) => [key.split(".")[2], value]));

  async function askAccess() {
    try {
      await api.post(`/suppliers/${check.data._id}/access-request`);
      setAccessAsked(true);
    } catch (err) {
      setError(err.message);
    }
  }

  async function register() {
    const problems = {};
    if (!/^(\d{8}|\d{11})$/.test(digits(ruc))) problems.ruc = "Enter a valid 11-digit RUC or supported 8-digit DNI.";
    if (!legalName.trim()) problems.legalName = "Legal name is required.";
    if (!justification.trim()) problems.justification = "Say why UMA needs this supplier.";
    const documentError = representative.documentType === "DNI" ? dniError(representative.documentNumber, { required: false }) : "";
    if (documentError) problems.representativeDocument = documentError;
    if (paymentTerms.option && (supplierCreditDays(paymentTerms) === null || (paymentTerms.option === "CUSTOM" && Number(paymentTerms.days) <= 0))) problems.creditDays = "Ingrese días de crédito enteros y válidos.";
    accounts.forEach((account, index) => {
      for (const [field, message] of Object.entries(bankAccountProblems(account))) problems[`accounts.${index}.${field}`] = message;
    });
    setErrors(problems);
    if (Object.keys(problems).length) {
      setError(t("Complete the highlighted fields."));
      return;
    }
    setSaving(true);
    setError("");
    const profile = sunat?.data || {};
    const data = new FormData();
    data.append("rucDni", digits(ruc));
    data.append("legalName", legalName.trim());
    data.append("name", legalName.trim());
    data.append("legalRepresentative", representative.fullName.trim());
    if (representative.documentNumber) data.append("legalRepresentativeDocument", JSON.stringify({ type: representative.documentType, number: representative.documentNumber.trim() }));
    data.append("proposalJustification", justification.trim());
    data.append("currency", accounts[0].accountCurrency || currency);
    if (paymentTerms.option) data.append("paymentTerms", JSON.stringify(paymentTerms));
    if (profile.personType) data.append("personType", profile.personType);
    if (profile.fiscalAddress) data.append("fiscalAddress", profile.fiscalAddress);
    if (profile.commercialName) data.append("commercialName", profile.commercialName);
    if (profile.location) data.append("location", JSON.stringify(profile.location));
    data.append("bankAccounts", JSON.stringify(accounts.map(bankAccountPayload)));
    if (certificate) data.append("bankCertificate", certificate);
    try {
      const response = await api.post("/suppliers", data, { headers: { "Content-Type": "multipart/form-data" } });
      onRegistered(response.data.data, response.data.warnings || []);
    } catch (err) {
      // Registered meanwhile by someone else: offer it like the lookup does.
      if (err.code === "DUPLICATE_SUPPLIER" && err.details?.supplier) {
        setCheck({ status: err.details.otherDepartment ? "restricted" : "found", data: { _id: err.details.supplier, supplierCode: err.details.supplierCode, legalName: legalName.trim(), homologationStatus: err.details.homologationStatus } });
      }
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const status = check.status;
  return (
    <section className="supplier-quick-register" aria-labelledby="supplier-quick-register-title">
      <header>
        <UserPlus size={18} aria-hidden="true" />
        <div><h4 id="supplier-quick-register-title">{t("Register a new supplier")}</h4><small>{t("Accounting reviews suppliers")}</small></div>
        <button type="button" className="icon-button quiet" onClick={onCancel} aria-label={t("Close")} title={t("Close")}><X size={16} aria-hidden="true" /></button>
      </header>

      <label className={`field${errors.ruc ? " field-error" : ""}`}>
        <span>{t("Supplier RUC")} *</span>
        <input inputMode="numeric" maxLength="11" value={ruc} onChange={(event) => setRuc(digits(event.target.value))} aria-invalid={Boolean(errors.ruc)} placeholder="20XXXXXXXXX" />
        {errors.ruc ? <small className="field-error-text">{t(errors.ruc)}</small> : <small className="field-hint">{t(status === "checking" ? "Checking the registry..." : "We check whether it is already registered and fill its name from SUNAT.")}</small>}
      </label>

      {status === "found" && <div className="inline-alert alert-info"><CheckCircle2 size={18} aria-hidden="true" /><div><strong>{t("Already registered")}: {check.data.supplierCode ? `${check.data.supplierCode} · ` : ""}{check.data.legalName}</strong><span><StatusBadge status={check.data.homologationStatus} /></span></div><button type="button" className="primary-button" onClick={() => onUseExisting(check.data)}>{t("Use this supplier")}</button></div>}
      {status === "restricted" && <div className="inline-alert alert-warning"><div><strong>{t("Registered for another area")}: {check.data.supplierCode ? `${check.data.supplierCode} · ` : ""}{check.data.legalName}</strong><span>{t(accessAsked ? "An Admin was asked to share it with your area. You will see it in your list once they do." : "Ask an Admin to share it with your area instead of registering it again.")}</span></div>{!accessAsked && <button type="button" className="secondary-button" onClick={askAccess}>{t("Ask to share it with my area")}</button>}</div>}
      {status === "error" && <Message type="error">{check.error}</Message>}

      {status === "new" && <>
        {sunat?.status === "loading" && <p className="muted-text"><Loader2 size={14} className="spin" aria-hidden="true" /> {t("Looking up the RUC in SUNAT...")}</p>}
        {sunat?.status === "found" && <SupplierSunatEvidence lookup={sunat.lookup} />}
        {sunat?.lookup?.fallback && <p className="field-hint">{t("Taxpayer details come from the official Padrón. Legal representatives are checked separately in Consulta RUC.")}</p>}
        {sunat?.status === "missing" && <p className="muted-text">{t("SUNAT Consulta RUC does not recognize this RUC.")}</p>}
        {sunat?.status === "unavailable" && <div role="status"><p className="muted-text">{t(sunat.error || "Consulta RUC could not return a usable supplier profile.")}</p><ConsultaRucLink pending ruc={digits(ruc)} assistedAvailable={sunat.assistedAvailable} onVerified={applyAssistedProfile} /></div>}
        {representativeLookup.status === "unavailable" && sunat?.status !== "unavailable" && <ConsultaRucLink />}
        <div className="form-grid two-column-form">
          <label className={`field form-span-two${errors.legalName ? " field-error" : ""}`}><span>{t("Legal name")} *</span><input value={legalName} onChange={(event) => { typedName.current = true; setLegalName(event.target.value); }} aria-invalid={Boolean(errors.legalName)} />{errors.legalName && <small className="field-error-text">{t(errors.legalName)}</small>}</label>
          {representativeLookup.status === "loading" && <p className="field-hint form-span-two" role="status">{t("Checking SUNAT legal representatives...")}</p>}
          {representativeLookup.status === "unavailable" && <div className="field-hint form-span-two" role="status"><p>{t("SUNAT representative lookup temporarily unavailable")}</p>{representativeLookup.error && <p>{t(representativeLookup.error)}</p>}<button type="button" className="text-button" onClick={() => void retryRepresentatives()}>{t("Retry representative lookup")}</button><p>{t("Representative lookup is separate from RUC validation; manual details still require review.")}</p></div>}
          {representativeLookup.status === "found" && !(representativeLookup.data?.representatives?.length) && <p className="field-hint form-span-two">{t("SUNAT Consulta RUC did not return legal representatives for this RUC.")}</p>}
          {(representativeLookup.data?.representatives?.length || 0) > 1 && <label className="field form-span-two"><span>{t("Select a SUNAT representative")}</span><select value={representativeLookup.data.representatives.findIndex(person => person.fullName === representative.fullName && person.documentNumber === representative.documentNumber)} onChange={event => {
            const person = representativeLookup.data.representatives[Number(event.target.value)];
            if (person) editRepresentative({ ...person, documentType: representativeDocumentType(person.documentType) });
          }}><option value="-1">{t("Select")}</option>{representativeLookup.data.representatives.map((person, index) => <option key={`${person.documentType}-${person.documentNumber}-${index}`} value={index}>{person.fullName} · {person.position} · {person.documentNumber}</option>)}</select></label>}
          <label className="field form-span-two"><span>{t("Legal Representative")}</span><input value={representative.fullName} onChange={event => editRepresentative({ fullName: event.target.value })} /></label>
          <label className="field"><span>{t("Representative document type")}</span><select value={representative.documentType} onChange={event => editRepresentative({ documentType: event.target.value })}><option value="">{t("Select")}</option><option value="DNI">DNI</option><option value="CE">CE</option><option value="PASAPORTE">{t("Passport")}</option><option value="RUC">RUC</option></select></label>
          <label className={`field${errors.representativeDocument ? " field-error" : ""}`}><span>{t("Representative document number")}</span><input value={representative.documentNumber} onChange={event => editRepresentative({ documentNumber: event.target.value })} inputMode={representative.documentType === "DNI" ? "numeric" : undefined} aria-invalid={Boolean(errors.representativeDocument)} />{errors.representativeDocument && <small className="field-error-text">{t(errors.representativeDocument)}</small>}</label>
          <div className="form-span-two"><SunatRepresentativeNote representative={representativeLookup.data?.representatives?.find(person => person.fullName === representative.fullName && person.documentNumber === representative.documentNumber)} queriedAt={representativeLookup.data?.queriedAt} /></div>
          <label className={`field form-span-two${errors.justification ? " field-error" : ""}`}><span>{t("Reason for registering the supplier")} *</span><textarea rows="2" value={justification} onChange={(event) => setJustification(event.target.value)} aria-invalid={Boolean(errors.justification)} />{errors.justification && <small className="field-error-text">{t(errors.justification)}</small>}</label>
        </div>

        <CreditDaysField value={paymentTerms} onChange={setPaymentTerms} />
        {errors.creditDays && <small className="field-error-text">{errors.creditDays}</small>}
        <div className="bank-account-list">
          {accounts.map((account, index) => <div className="bank-account-card" key={account.clientId}>
            <div className="bank-account-card-head"><strong>{t("Bank account {number}").replace("{number}", index + 1)}</strong>{accounts.length > 1 && <button type="button" className="icon-button quiet danger" onClick={() => setAccounts((current) => current.filter((_, position) => position !== index))} aria-label={`${t("Remove account")} ${index + 1}`} title={t("Remove account")}><Trash2 size={15} aria-hidden="true" /></button>}</div>
            <BankAccountFields value={account} onChange={(patch) => setAccount(index, patch)} errors={accountErrors(index)} />
          </div>)}
        </div>
        {accounts.length < 4 && <button type="button" className="text-button" onClick={() => setAccounts((current) => [...current, emptyBankAccount(current[0]?.accountHolderName || legalName, current.some((account) => account.accountCurrency === "USD") ? "PEN" : "USD")])}><Plus size={15} aria-hidden="true" />{t("Add another account (e.g. in dollars)")}</button>}

        <label className={`quick-file${certificate ? " is-attached" : ""}`}>
          <Paperclip size={18} aria-hidden="true" />
          <span><strong>{certificate?.name || t("Bank account certificate (optional)")}</strong><small>{t(certificate ? "Attached" : "Helps Accounting verify the account faster. PDF or photo.")}</small></span>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" aria-label={t("Bank account certificate (optional)")} onChange={(event) => { setCertificate(event.target.files?.[0] || null); event.target.value = ""; }} />
        </label>

        <div className="wizard-error"><Message type="error">{error}</Message></div>
        <div className="inline-form-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>{t("Cancel")}</button>
          <button type="button" className="primary-button" onClick={register} disabled={saving} aria-busy={saving}><Send size={16} aria-hidden="true" /><span>{t(saving ? "Registering..." : "Register and use this supplier")}</span></button>
        </div>
      </>}
      {status !== "new" && error && <Message type="error">{error}</Message>}
    </section>
  );
}
