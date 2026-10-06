import { dniError, requiredError } from "./fieldValidation.js";

// Supplier proposal form (components/suppliers/SupplierForm.jsx): steps, what each step needs
// before Continue / Submit, and what Finance still needs before homologation.

export const SUPPLIER_DOCUMENTS = Object.freeze([
  ["rucFile", "RUC_FILE", "Updated RUC document"],
  ["legalRepId", "LEGAL_REP_ID", "Legal representative identification"],
  ["bankCertificate", "BANK_CERTIFICATE", "Official bank certificate"]
]);

// The bank step only exists when the form may register the first account (a new proposal).
export function supplierStepsFor({ includeInitialBank = false } = {}) {
  return ["identity", "conditions", ...(includeInitialBank ? ["bank"] : []), "compliance", "review"];
}

const digits = (value) => String(value || "").replace(/[\s-]/g, "");

// Problems that block Continue (and Submit) on a step, as { field: message }. Declarations and
// documents never block: they are needed for homologation, not to submit the proposal.
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
    const account = digits(form.accountNumber);
    const cci = digits(form.cci);
    if (!form.bank && (account || cci)) add("bank", "Select the bank for the account you entered, or clear the account number and CCI to add the account after saving.");
    if (account && !/^\d+$/.test(account)) add("accountNumber", "Account number must contain digits only.");
    if (cci && !/^\d{20}$/.test(cci)) add("cci", "CCI must contain exactly 20 digits.");
  }
  return problems;
}

// What Finance needs before it can homologate the supplier, as a checklist for the review step.
export function homologationChecklist(form, { documentKinds = new Set(), files = {} } = {}) {
  const declared = (answer) => ["YES", "NO"].includes(answer);
  return [
    { key: "stateSanctions", label: "State sanctions declaration answered", done: declared(form.stateSanctionsAnswer), step: "compliance" },
    { key: "complianceModel", label: "Compliance model declaration answered", done: declared(form.complianceModelAnswer), step: "compliance" },
    ...SUPPLIER_DOCUMENTS.map(([field, kind, label]) => ({ key: field, label, done: Boolean(files[field]) || documentKinds.has(kind), step: "compliance" }))
  ];
}
