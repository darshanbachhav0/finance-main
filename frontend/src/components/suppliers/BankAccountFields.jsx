import { useLanguage } from "../../context/LanguageContext.jsx";
import SearchSelect from "../SearchSelect.jsx";
import { SELECTABLE_PERU_BANKS, peruBank } from "../../../../shared/peruBanks.mjs";
import { ACCOUNT_CURRENCY_OPTIONS, ACCOUNT_TYPE_OPTIONS, bankOptionLabel } from "../../utils/bankAccounts.js";
import "../../styles/bankAccounts.css";

// One supplier (or employee) bank account: the bank from the SBS list (searchable, "Otro / No
// disponible" with its name), savings or current account, soles or dollars, number, CCI and
// holder. The same fields everywhere an account is registered.

export default function BankAccountFields({ value, onChange, errors = {}, banks = SELECTABLE_PERU_BANKS, disabled = false, legend }) {
  const { t } = useLanguage();
  const set = (field) => (event) => onChange({ [field]: event.target.value });
  const fieldClass = (field, base = "field") => `${base}${errors[field] ? " field-error" : ""}`;
  const message = (field) => errors[field] && <small className="field-error-text">{t(errors[field])}</small>;
  const bank = peruBank(value.bank);
  const cciHint = bank?.cci ? t("A {bank} CCI starts with {code}.").replace("{bank}", bank.shortName || bank.name).replace("{code}", bank.cci) : t("20 digits, as the bank shows it.");

  return (
    <fieldset className="bank-account-fields" disabled={disabled}>
      {legend && <legend>{t(legend)}</legend>}
      <div className="form-grid two-column-form">
        <SearchSelect
          label="Bank"
          required
          value={value.bank}
          options={banks}
          getOptionValue={(item) => item.code}
          getOptionLabel={bankOptionLabel}
          onChange={(code) => onChange({ bank: code || "", ...(code !== "OTHER" ? { bankOtherName: "" } : {}) })}
          error={errors.bank}
          searchPlaceholder="Search bank..."
          placeholder="Select the bank"
        />
        {value.bank === "OTHER" && <label className={fieldClass("bankOtherName")}><span>{t("Name of the bank")} *</span><input value={value.bankOtherName} onChange={set("bankOtherName")} aria-invalid={Boolean(errors.bankOtherName)} />{message("bankOtherName") || <small className="field-hint">{t("Accounting checks this account before it is paid.")}</small>}</label>}
        <label className={fieldClass("accountType")}><span>{t("Account type")} *</span><select value={value.accountType} onChange={set("accountType")} aria-invalid={Boolean(errors.accountType)}>{ACCOUNT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}</select>{message("accountType")}</label>
        <label className={fieldClass("accountCurrency")}><span>{t("Account currency")} *</span><select value={value.accountCurrency} onChange={set("accountCurrency")} aria-invalid={Boolean(errors.accountCurrency)}>{ACCOUNT_CURRENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}</select>{message("accountCurrency")}</label>
        <label className={fieldClass("accountNumber")}><span>{t("Account number")} *</span><input inputMode="numeric" autoComplete="off" value={value.accountNumber} onChange={set("accountNumber")} aria-invalid={Boolean(errors.accountNumber)} />{message("accountNumber")}</label>
        <label className={fieldClass("cci")}><span>{t("Interbank account code (CCI)")} *</span><input inputMode="numeric" autoComplete="off" maxLength="24" value={value.cci} onChange={set("cci")} aria-invalid={Boolean(errors.cci)} />{message("cci") || <small className="field-hint">{cciHint}</small>}</label>
        <label className={fieldClass("accountHolderName", "field form-span-two")}><span>{t("Account holder")} *</span><input value={value.accountHolderName} onChange={set("accountHolderName")} aria-invalid={Boolean(errors.accountHolderName)} />{message("accountHolderName")}</label>
      </div>
    </fieldset>
  );
}
