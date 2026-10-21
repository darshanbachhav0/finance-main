import { dniError, requiredError } from "./fieldValidation.js";
import { bankAccountProblems } from "./bankAccounts.js";

// Supplier proposal form (components/suppliers/SupplierForm.jsx): steps, what each step needs
// before Continue / Submit, and what the proposer's jefe still needs before approving it.
// The compliance declarations and the "mandatory" documents (RUC file, representative ID, bank
// certificate) were taken out of the form; documents already on file still show on the record.

// The bank step only exists when the form may register the first accounts (a new proposal).
export function supplierStepsFor({ includeInitialBank = false } = {}) {
  return ["identity", "conditions", ...(includeInitialBank ? ["bank"] : []), "review"];
}

// Problems that block Continue (and Submit) on a step, as { field: message }. Bank accounts are
// keyed "bankAccounts.<index>.<field>".
export function supplierStepProblems(step, form, { includeInitialBank = false } = {}) {
  const problems = {};
  const add = (field, message) => { if (message) problems[field] = message; };
  if (step === "identity") {
    // Blocking is by format, as the server checks it; the check-digit hint shows on blur.
    if (!/^\d{8}$|^\d{11}$/.test(String(form.rucDni || "").replace(/\D/g, ""))) add("rucDni", "Enter a valid 11-digit RUC or supported 8-digit DNI.");
    add("legalName", requiredError(form.legalName, "Legal name is required."));
    if (form.representativeDocumentType === "DNI") add("representativeDocumentNumber", dniError(form.representativeDocumentNumber, { required: false }));
  }
  if (step === "conditions") {
    add("proposalJustification", requiredError(form.proposalJustification, "Registration justification is required."));
    if (form.deliveryMethod === "OTHER") add("deliveryOther", requiredError(form.deliveryOther, "Explain the other delivery method."));
  }
  if (step === "bank" && includeInitialBank) {
    // Every account started is checked in full; an untouched one is left out.
    (form.bankAccounts || []).forEach((account, index) => {
      for (const [field, message] of Object.entries(bankAccountProblems(account, { required: false }))) add(`bankAccounts.${index}.${field}`, message);
    });
  }
  return problems;
}

// What the proposer's jefe needs before approving the supplier, as a checklist for the review step.
export function homologationChecklist(form) {
  const accounts = (form.bankAccounts || []).filter((account) => account.bank);
  return [
    { key: "personType", label: "Person type recorded", done: Boolean(form.personType), step: "identity" },
    { key: "fiscalAddress", label: "Fiscal address recorded", done: Boolean(String(form.fiscalAddress || "").trim()), step: "identity" },
    { key: "legalRepresentative", label: "Legal representative and document recorded", done: Boolean(String(form.legalRepresentative || "").trim() && String(form.representativeDocumentNumber || "").trim()), step: "identity" },
    { key: "bankAccount", label: "At least one bank account", done: accounts.length > 0, step: "bank" }
  ];
}
