import { useLanguage } from "../../context/LanguageContext.jsx";
import { isUnitedStates } from "../../../../shared/supplierRegistration.mjs";
import "../../styles/bankAccounts.css";

// An account abroad (pilot "Cuenta en el exterior (SWIFT)"): the bank and its country, SWIFT/BIC,
// IBAN or account number, ABA for banks in the United States and an optional intermediary bank.
// Always in dollars; Treasury pays it by international transfer.

export default function ForeignBankAccountFields({ value, onChange, errors = {}, disabled = false }) {
  const { t } = useLanguage();
  const set = (field) => (event) => onChange({ [field]: event.target.value });
  const fieldClass = (field, base = "field") => `${base}${errors[field] ? " field-error" : ""}`;
  const message = (field) => errors[field] && <small className="field-error-text">{t(errors[field])}</small>;
  const usBank = isUnitedStates(value.bankCountry);
  const input = (field, label, { required = false, hint = "", span = false, ...props } = {}) => (
    <label className={fieldClass(field, span ? "field form-span-two" : "field")}>
      <span>{t(label)}{required ? " *" : ""}</span>
      <input value={value[field] || ""} onChange={set(field)} aria-invalid={Boolean(errors[field])} autoComplete="off" {...props} />
      {message(field) || (hint && <small className="field-hint">{t(hint)}</small>)}
    </label>
  );

  return (
    <fieldset className="bank-account-fields" disabled={disabled}>
      <div className="form-grid two-column-form">
        {input("bankOtherName", "Name of the bank", { required: true })}
        {input("bankCountry", "Bank country", { required: true })}
        {input("bankCity", "Bank city")}
        {input("bankAddress", "Bank address")}
        {input("swift", "SWIFT / BIC code", { required: true, maxLength: 11, hint: "8 or 11 letters and digits." })}
        {input("iban", "IBAN", { maxLength: 42, hint: "Required in Europe and other IBAN countries." })}
        {input("accountNumber", "Account number", { hint: "When the bank has no IBAN." })}
        {input("aba", "ABA routing number", { required: usBank, inputMode: "numeric", maxLength: 9, hint: usBank ? "9 digits." : "Only for banks in the United States." })}
        {input("intermediaryBank", "Intermediary bank")}
        {input("intermediarySwift", "Intermediary bank SWIFT", { maxLength: 11 })}
        <label className="field"><span>{t("Account currency")}</span><input value={t("Dollars (USD)")} readOnly /></label>
        {input("accountHolderName", "Account holder", { required: true })}
      </div>
    </fieldset>
  );
}
