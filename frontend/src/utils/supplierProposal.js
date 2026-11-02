import { dniError, identifierError, requiredError } from "./fieldValidation.js";
import { bankAccountProblems, foreignBankAccountProblems } from "./bankAccounts.js";
import { detractionAccountError, emailError } from "../../../shared/supplierRegistration.mjs";

// Supplier proposal form (components/suppliers/SupplierForm.jsx): steps, what each step needs
// before Continue / Submit, and what the proposer's jefe still needs before approving it.
// A supplier is national (RUC or DNI, SUNAT data, may be subject to detraccion) or abroad (country
// and tax identification, an account abroad in dollars) - pilot "Alta de proveedor".
// The compliance declarations and the "mandatory" documents (RUC file, representative ID, bank
// certificate) were taken out of the form; documents already on file still show on the record.

// The bank step only exists when the form may register the first accounts (a new proposal).
export function supplierStepsFor({ includeInitialBank = false } = {}) {
  return ["identity", "conditions", ...(includeInitialBank ? ["bank"] : []), "review"];
}

// Problems that block Continue (and Submit) on a step, as { field: message }. Bank accounts are
// keyed "bankAccounts.<index>.<field>".
// newProposal: the contact email and goods/services are asked of every new registration; a
// correction of an older proposal that lacks them is not blocked.
export function supplierStepProblems(step, form, { includeInitialBank = false, newProposal = includeInitialBank } = {}) {
  const problems = {};
  const add = (field, message) => { if (message) problems[field] = message; };
  const foreign = form.origin === "FOREIGN";
  if (step === "identity") {
    if (foreign) {
      add("country", requiredError(form.country, "Enter the supplier's country."));
      add("foreignTaxId", requiredError(form.foreignTaxId, "Enter the supplier's tax identification in its country."));
    } else {
      // The server refuses a RUC whose check digit is wrong, so the form does too.
      add("rucDni", identifierError(form.rucDni));
      if (form.detractionSubject) add("detractionAccountNumber", detractionAccountError(form.detractionAccountNumber, { required: true }));
    }
    add("legalName", requiredError(form.legalName, "Legal name is required."));
    add("email", emailError(form.email, { required: newProposal }));
    if (newProposal && !form.supplyType) add("supplyType", "Choose goods or services.");
    if (form.representativeDocumentType === "DNI") add("representativeDocumentNumber", dniError(form.representativeDocumentNumber, { required: false }));
  }
  if (step === "conditions") {
    add("proposalJustification", requiredError(form.proposalJustification, "Registration justification is required."));
    if (form.deliveryMethod === "OTHER") add("deliveryOther", requiredError(form.deliveryOther, "Explain the other delivery method."));
  }
  if (step === "bank" && includeInitialBank) {
    // Every account started is checked in full; an untouched one is left out.
    (form.bankAccounts || []).forEach((account, index) => {
      const accountProblems = foreign ? foreignBankAccountProblems(account, { required: false }) : bankAccountProblems(account, { required: false });
      for (const [field, message] of Object.entries(accountProblems)) add(`bankAccounts.${index}.${field}`, message);
    });
  }
  return problems;
}

// What the proposer's jefe needs before approving the supplier, as a checklist for the review step.
export function homologationChecklist(form) {
  const foreign = form.origin === "FOREIGN";
  const accounts = (form.bankAccounts || []).filter((account) => foreign ? account.bankOtherName || account.swift : account.bank);
  return [
    { key: "personType", label: "Person type recorded", done: Boolean(form.personType), step: "identity" },
    { key: "fiscalAddress", label: "Fiscal address recorded", done: Boolean(String(form.fiscalAddress || "").trim()), step: "identity" },
    ...(foreign ? [] : [{ key: "legalRepresentative", label: "Legal representative and document recorded", done: Boolean(String(form.legalRepresentative || "").trim() && String(form.representativeDocumentNumber || "").trim()), step: "identity" }]),
    { key: "bankAccount", label: "At least one bank account", done: accounts.length > 0, step: "bank" }
  ];
}
