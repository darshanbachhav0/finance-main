import { CheckCircle2, Loader2, Paperclip, Plus, Send, Trash2, UserPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import api from "../../api/client.js";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { bankAccountPayload, bankAccountProblems, emptyBankAccount } from "../../utils/bankAccounts.js";
import Message from "../Message.jsx";
import StatusBadge from "../StatusBadge.jsx";
import BankAccountFields from "./BankAccountFields.jsx";

// Registering a supplier without leaving the request (step 1, "Datos de proveedor"): the RUC is
// checked against the registry first (an existing supplier is used, another area's is asked for),
// SUNAT fills the legal name, and the requester adds the reason and the bank accounts. The supplier
// gets its PRV code now; the requester's jefe approves it together with the request. The full
// proposal (contacts, representative, delivery) stays on the Suppliers page.
const digits = (value) => String(value || "").replace(/\D/g, "");

export default function SupplierQuickRegister({ initialRuc = "", need = "", currency = "PEN", onRegistered, onUseExisting, onCancel }) {
  const { t } = useLanguage();
  const [ruc, setRuc] = useState(digits(initialRuc));
  const [check, setCheck] = useState({ status: "idle" });
  const [sunat, setSunat] = useState(null);
  const [legalName, setLegalName] = useState("");
  const [justification, setJustification] = useState(need ? t("Supplier for: {need}").replace("{need}", need.split(/\r?\n/)[0].slice(0, 160)) : "");
  const [accounts, setAccounts] = useState([emptyBankAccount("", currency)]);
  const [certificate, setCertificate] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [accessAsked, setAccessAsked] = useState(false);
  const typedName = useRef(false);

  // The RUC is looked up as soon as it is complete: registered (use it), another area's (ask for
  // it) or new (SUNAT fills the legal name while the rest is typed).
  useEffect(() => {
    const value = digits(ruc);
    setAccessAsked(false);
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
        setSunat({ status: lookup.data?.found ? "found" : "missing", data: lookup.data?.data });
        const name = lookup.data?.data?.legalName;
        if (name && !typedName.current) {
          setLegalName(name);
          setAccounts((current) => current.map((account) => account.accountHolderName ? account : { ...account, accountHolderName: name }));
        }
      }).catch(() => active && setSunat({ status: "unavailable" }));
    }).catch((err) => active && setCheck({ status: "error", error: err.message }));
    return () => { active = false; };
  }, [ruc]);

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
    data.append("proposalJustification", justification.trim());
    data.append("currency", accounts[0].accountCurrency || currency);
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
        <div><h4 id="supplier-quick-register-title">{t("Register a new supplier")}</h4><small>{t("It gets its PRV code now; your jefe approves it with this request.")}</small></div>
        <button type="button" className="icon-button quiet" onClick={onCancel} aria-label={t("Close")} title={t("Close")}><X size={16} aria-hidden="true" /></button>
      </header>

      <label className={`field${errors.ruc ? " field-error" : ""}`}>
        <span>{t("Supplier RUC")} *</span>
        <input inputMode="numeric" maxLength="11" value={ruc} onChange={(event) => setRuc(digits(event.target.value))} aria-invalid={Boolean(errors.ruc)} placeholder="20XXXXXXXXX" />
        {errors.ruc ? <small className="field-error-text">{t(errors.ruc)}</small> : <small className="field-hint">{t(status === "checking" ? "Checking the registry..." : "We check whether it is already registered and fill its name from SUNAT.")}</small>}
      </label>

      {status === "found" && <div className="inline-alert alert-info"><CheckCircle2 size={18} aria-hidden="true" /><div><strong>{t("Already registered")}: {check.data.supplierCode ? `${check.data.supplierCode} · ` : ""}{check.data.legalName}</strong><span><StatusBadge status={check.data.homologationStatus} /></span></div><button type="button" className="primary-button" onClick={() => onUseExisting(check.data)}>{t("Use this supplier")}</button></div>}
      {status === "restricted" && <div className="inline-alert alert-warning"><div><strong>{t("Registered for another area")}: {check.data.supplierCode ? `${check.data.supplierCode} · ` : ""}{check.data.legalName}</strong><span>{t(accessAsked ? "Accounting was asked to share it with your area. You will see it in your list once they do." : "Ask Accounting to share it with your area instead of registering it again.")}</span></div>{!accessAsked && <button type="button" className="secondary-button" onClick={askAccess}>{t("Ask to share it with my area")}</button>}</div>}
      {status === "error" && <Message type="error">{check.error}</Message>}

      {status === "new" && <>
        {sunat?.status === "loading" && <p className="muted-text"><Loader2 size={14} className="spin" aria-hidden="true" /> {t("Looking up the RUC in SUNAT...")}</p>}
        {sunat?.status === "found" && <p className="muted-text"><CheckCircle2 size={14} aria-hidden="true" /> {t("Name and address filled from SUNAT.")}</p>}
        {["missing", "unavailable"].includes(sunat?.status) && <p className="muted-text">{t("SUNAT did not answer: type the legal name as it appears on the RUC.")}</p>}
        <div className="form-grid two-column-form">
          <label className={`field form-span-two${errors.legalName ? " field-error" : ""}`}><span>{t("Legal name")} *</span><input value={legalName} onChange={(event) => { typedName.current = true; setLegalName(event.target.value); }} aria-invalid={Boolean(errors.legalName)} />{errors.legalName && <small className="field-error-text">{t(errors.legalName)}</small>}</label>
          <label className={`field form-span-two${errors.justification ? " field-error" : ""}`}><span>{t("Reason for registering the supplier")} *</span><textarea rows="2" value={justification} onChange={(event) => setJustification(event.target.value)} aria-invalid={Boolean(errors.justification)} />{errors.justification && <small className="field-error-text">{t(errors.justification)}</small>}</label>
        </div>

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
