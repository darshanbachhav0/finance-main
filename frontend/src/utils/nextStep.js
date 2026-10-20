import { canonicalRequestStatus } from "../../../shared/workflowStatus.mjs";
import { REQUESTER_INVOICE_PROBLEMS, waitsForBankAccount } from "./plainStatus.js";

// "Your turn" at the top of a request: the one thing the person looking at it has to do now, in
// plain words, with the button that does it (run), opens the exact place on the page (open) or
// goes to the screen where it is done (href). `mine: false` is a short note for someone who only
// waits; null means the journey banner already says everything. English strings are the t()
// keys; Spanish lives in context/i18n/simple.js.

const DOCUMENTS = "request-section-documents-and-fiscal-validation";
const REGISTER_INVOICE = { A1: "request-section-register-a1-invoice-and-conformity", B: "request-section-register-the-invoice" };
const FINANCE = ["Admin", "Accounting"];
const PAYERS = ["Admin", "Treasury"];
const SETTLERS = ["Admin", "Accounting", "Treasury"];
const IN_BANK_FILE = ["PAYMENT_FILE_CREATED", "PARTIALLY_PAID"];
const TO_PAY = ["OPEN", "SCHEDULED"];

const turn = (key, title, text, extra = {}) => ({ key, mine: true, title, text, ...extra });
const note = (key, text, extra = {}) => ({ key, mine: false, text, ...extra });
const idOf = (value) => String(value?._id || value || "");

// An invoice the requester has to replace, said in full: which invoice, whose RUC and whose order.
// Other invoice observations keep the generic wording and show their detail on the page.
function invoiceProblem(request, related) {
  const code = request.observation?.code;
  if (!REQUESTER_INVOICE_PROBLEMS.includes(code)) return null;
  const voucher = [...(related.sunatVouchers || [])].reverse().find((item) => item.validationStatus !== "VALID") || {};
  const supplier = request.supplier || {};
  return {
    code,
    params: {
      invoice: voucher.seriesNumber || "",
      found: voucher.rucIssuer || "",
      supplier: supplier.legalName || supplier.name || request.supplierSnapshot?.legalName || "",
      expected: supplier.rucDni || supplier.normalizedIdentifier || request.supplierSnapshot?.identifier || ""
    }
  };
}

// Where a team's work on a request is done, when nothing more specific applies.
const TEAM_WORKSPACE = {
  Accounting: () => ({ label: "Open Accounting", href: "/accounting" }),
  Treasury: (request) => ({ label: "Open Payments", href: `/treasury?request=${request._id}` })
};

// supplierApproval: the request's supplier still waiting for its proposer's jefe (approval options).
export function nextStepFor({ request, user, permissions = {}, related = {}, missingDocuments = 0, invoiceCorrection = false, ownAdvance = false, journey = null, supplierApproval = null } = {}) {
  if (!request || !user) return null;
  const role = user.role;
  const status = canonicalRequestStatus(request.status);
  const rendition = request.rendition || {};
  const isAdvance = request.flowType === "C" && request.requestType === "ENTREGA_RENDIR";
  const owner = idOf(request.requester || request.solicitor) === idOf(user._id);
  const name = request.requester?.name || request.solicitor?.name || "";

  if (invoiceCorrection) {
    const fixes = permissions.canRegisterInvoice || owner || role === "Admin";
    const upload = { label: "Upload the correct invoice", open: { tab: "Documents", target: REGISTER_INVOICE[request.flowType] || DOCUMENTS } };
    const problem = invoiceProblem(request, related);
    if (problem?.code === "RUC_MISMATCH") {
      const known = problem.params.invoice && problem.params.found;
      return fixes
        ? turn("correctInvoice", "The invoice is from another supplier", known
          ? "Invoice {invoice} was issued by RUC {found}, but this purchase order is for {supplier} (RUC {expected}). Upload {supplier}'s invoice. If you really bought from RUC {found}, the request has the wrong supplier: ask Accounting to annul it, then repeat it with that supplier."
          : "The invoice was issued by another RUC, but this purchase order is for {supplier} (RUC {expected}). Upload {supplier}'s invoice, or ask Accounting to annul the request if the supplier is wrong.", { params: problem.params, tone: "warning", action: upload })
        : note("correctInvoice", "The invoice is from another supplier than the purchase order. The requester uploads the right one.");
    }
    if (problem?.code === "DUPLICATE_VOUCHER") {
      return fixes
        ? turn("correctInvoice", "This invoice is already registered", problem.params.invoice ? "Invoice {invoice} is already in the system. Upload the invoice for this purchase." : "This invoice is already in the system. Upload the invoice for this purchase.", { params: problem.params, tone: "warning", action: upload })
        : note("correctInvoice", "The invoice uploaded is already registered. The requester uploads the one for this purchase.");
    }
    return fixes
      ? turn("correctInvoice", "Correct the invoice documents", "Correct the invoice documents. Existing approvals and the issued order remain valid; do not submit the request for approval again.", { action: { label: "Open documents", open: { tab: "Documents", target: DOCUMENTS } } })
      : note("correctInvoice", "The requester is correcting the invoice documents. Existing approvals and the issued order remain valid.");
  }
  if (request.observationOwner === "BUDGET" && !permissions.canCommitBudget) {
    return note("budgetException", "Budget is reviewing an exception for this request's budget. You do not need to submit it again; you will be notified of the decision.");
  }
  if (request.observationOwner === "ACCOUNTING") {
    return FINANCE.includes(role)
      ? turn("sunatException", "Review the SUNAT exception", "SUNAT could not verify this invoice. Review it in Accounting > SUNAT exceptions; once the exception is approved the payment continues without new approvals.", { action: { label: "Open SUNAT exceptions", href: "/accounting?view=sunat-exceptions" } })
      : note("sunatException", "SUNAT could not verify this invoice. Accounting will review it; once it approves a manual SUNAT exception the payment continues on its own. You do not need to submit the request again.");
  }
  if (waitsForBankAccount(request)) {
    if (request.observation?.resolver === "ACCOUNTING" && FINANCE.includes(role)) return turn("verifyBank", "Verify the bank account of {name}", "The advance is paid out automatically as soon as you verify the account.", { params: { name }, action: { label: "Open bank accounts", href: "/reimbursement-bank" } });
    if (request.observation?.resolver !== "ACCOUNTING" && owner) return turn("registerBank", "Register your bank account", "Accounting verifies it, and then your advance is paid.", { action: { label: "Add bank account", href: "/reimbursement-bank" } });
    if (permissions.canCommitBudget) return note("waitsForBank", "This advance waits for the employee's verified bank account. It is paid out automatically once Accounting verifies it; Commit budget is not needed.");
  }
  // The employee's own paid advance has its own card (AdvanceRenditionCard).
  if (ownAdvance) return null;

  const budgetShort = rendition.status === "SUBMITTED" && request.observation?.code === "INSUFFICIENT_BUDGET";
  if (budgetShort && role === "Treasury") {
    return turn("renditionBudget", "Review the budget exception", "The CECO budget is short for this rendition. Review the exception so Management can approve it; then Accounting approves the rendition.", { tone: "warning", action: { label: "Open budget exceptions", href: "/budget?tab=exceptions&exceptionStatus=PENDING" } });
  }
  if (FINANCE.includes(role) && rendition.status === "SUBMITTED" && rendition.financeReview?.result === "PENDING") {
    if (budgetShort) return turn("reviewRendition", "Review the receipts from {name}", "The CECO budget was short when the rendition was approved. Once Management approves the budget exception, approve it again.", { params: { name }, tone: "warning", review: true, more: { label: "Open budget exceptions", href: "/budget?tab=exceptions&exceptionStatus=PENDING" } });
    return isAdvance
      ? turn("reviewRendition", "Review the receipts from {name}", "Check that the receipts and the money returned add up to the advance. Then approve the rendition, or send it back with a comment.", { params: { name }, review: true, more: { label: "See every detail", open: { tab: "Documents", target: "official-rendition" } } })
      : turn("reviewRendition", "Review the declaration from {name}", "Check the expenses declared without receipts. Then approve them so the reimbursement is paid, or send them back with a comment.", { params: { name }, review: true, more: { label: "See every detail", open: { tab: "Documents", target: "official-rendition" } } });
  }
  if (SETTLERS.includes(role) && isAdvance && rendition.status === "VALIDATED" && Number(rendition.nonDeductibleOutstanding || 0) > 0) {
    return turn("settleBalance", "Settle the non-deductible {amount}", "Part of the expenses is not deductible and stays charged to {name}. Record whether it is paid back or deducted from payroll.", { params: { name, amount: Number(rendition.nonDeductibleOutstanding) }, tone: "warning", action: { label: "Record the settlement", open: { tab: "Documents", target: "rendition-account-14" } } });
  }
  if (SETTLERS.includes(role) && isAdvance && rendition.status === "REJECTED" && rendition.recovery?.status === "PENDING") {
    return turn("recoverAdvance", "Recover {amount} from {name}", "The rendition was rejected. Record how the money that was not returned comes back: a deposit or a payroll deduction.", { params: { name, amount: Number(rendition.recovery.outstandingAmount || 0) }, tone: "warning", action: { label: "Record the recovery", open: { tab: "Documents", target: "rendition-recovery" } } });
  }
  if (owner && request.requestType === "REEMBOLSO_SIN_SUSTENTO" && status === "COMPROMISO_PRESUPUESTAL" && ["PENDING", "OBSERVED", "NOT_REQUIRED", undefined].includes(rendition.status)) {
    return turn("declaration", "Send your signed declaration", "List what you paid and sign the declaration. Accounting reviews it and then you are paid.", { action: { label: "Open the declaration", open: { tab: "Documents", target: "official-rendition" } } });
  }
  if (permissions.canCommitBudget) return turn("commitBudget", "Commit the budget", "Review budget availability and commit the approved request.", { action: { label: "Commit budget", run: "budget" } });
  if (permissions.modifiable) {
    const edit = { label: "Edit request", href: `/requests/${request._id}/edit` };
    if (["OBSERVADO", "DEVUELTO"].includes(status)) return turn("correctRequest", "Correct your request and send it again", "Read the comment in History, fix what was asked, then submit it again.", { tone: "warning", action: edit, more: { label: "Read the comments", open: { tab: "Approvals" } } });
    if (missingDocuments) return turn("addDocuments", "Add the required documents", "Complete the required documents before submitting.", { action: { label: "Open documents", open: { tab: "Documents", target: DOCUMENTS } }, more: edit });
    return turn("submit", "Submit for approval", "Your request is ready for your submission review.", { action: { label: "Submit", run: "submit" }, more: edit });
  }
  // The jefe verifies a new supplier with the request: both are approved together, or the request
  // goes back while the supplier is missing something.
  if (permissions.canApprove && supplierApproval?.yours) {
    const params = { supplier: supplierApproval.supplier?.name || "" };
    return supplierApproval.ready
      ? turn("approve", "Approve the new supplier and this request", "{supplier} is a new supplier. Check its details and documents, then approve both, or send the request back.", { params, action: { label: "Approve supplier and request", run: "approve" }, more: { label: "Other options", open: { target: "request-actions" } } })
      : turn("approve", "Send this request back", "{supplier} is a new supplier and cannot be approved yet. Send the request back so the requester completes it.", { params, tone: "warning", action: { label: "Send back", run: "observe" }, more: { label: "See what is missing", open: { target: "request-actions" } } });
  }
  if (permissions.canApprove) return turn("approve", "Approve or reject this request", "Review the supporting documents and record your decision.", { action: { label: "Approve", run: "approve" }, more: { label: "Other options", open: { target: "request-actions" } } });
  if (permissions.canIssueOrder) return turn("issueOrder", "Issue the purchase order", "Review the approved purchase and issue the order.", { action: { label: "Issue order", run: "order" } });
  // Only while the request waits for its first invoice. An A1 order may still receive more invoices
  // after one is booked (the Documents tab keeps the upload), but that is nobody's turn.
  const awaitsInvoice = status === "COMPROMISO_PRESUPUESTAL" && (request.flowType === "B" ? !request.xmlValidation?.validated : Boolean(request.purchaseOrder));
  if (permissions.canRegisterInvoice && awaitsInvoice) {
    return turn("registerInvoice", "Register the supplier's invoice", "Upload the invoice XML or its PDF. Accounting books it and Treasury pays it.", { action: { label: "Register the invoice", open: { tab: "Documents", target: request.flowType === "B" ? "request-section-register-the-invoice" : "request-section-register-a1-invoice-and-conformity" } } });
  }

  // Payment: Treasury prepares the bank file, Accounting verifies it, Treasury confirms and reconciles.
  const payables = (related.accountsPayable || []).filter((item) => item.status !== "CANCELLED");
  const batches = related.paymentBatches || [];
  const covered = new Set((related.reconciliations || []).flatMap((item) => [item.accountsPayable, ...(item.accountsPayables || [])]).filter(Boolean).map(idOf));
  const inFile = payables.filter((item) => IN_BANK_FILE.includes(item.status));
  const unverified = inFile.map((item) => batches.find((batch) => idOf(batch) === idOf(item.paymentBatch))).find((batch) => batch?.verification?.status === "PENDING");
  const query = `request=${request._id}`;
  if (FINANCE.includes(role) && unverified) return turn("verifyBankFile", "Verify the bank file", "Treasury put this payment in a bank file. Check it so Treasury can send it to the bank.", { action: { label: "Verify the bank file", href: `/accounting/bank-files?record=${unverified._id}` } });
  if (PAYERS.includes(role)) {
    if (payables.some((item) => item.status === "PAYMENT_BOUNCED")) return turn("reprogram", "Send the returned payment again", "The bank returned this payment. Check the bank account and put it in a new bank file.", { tone: "warning", action: { label: "Open returned payments", href: `/treasury?tab=returned&${query}` } });
    if (inFile.length && unverified) return note("bankFileCheck", "Accounting is verifying the bank file. Then you confirm the payment.");
    if (inFile.length) return turn("confirmPayment", "Confirm the payment", "Once the bank has paid it, record the operation number.", { action: { label: "Confirm the payment", href: `/treasury?tab=confirm&${query}` } });
    if (payables.some((item) => TO_PAY.includes(item.status))) {
      return isAdvance
        ? turn("preparePayment", "Pay the advance today", "Put it in today's BBVA bank file in Payments.", { action: { label: "Open payments", href: `/treasury?tab=prepare&${query}` } })
        : turn("preparePayment", "Prepare the payment", "Put it in the BBVA bank file in Payments when it is due.", { action: { label: "Open payments", href: `/treasury?tab=prepare&${query}` } });
    }
    if (payables.some((item) => item.status === "PAID" && !item.reconciliation && !covered.has(idOf(item)))) {
      return turn("reconcile", "Reconcile the payment", "Match it with the bank statement: enter the bank reference and the amount on the statement.", { action: { label: "Reconcile", href: `/treasury?tab=reconcile&${query}` } });
    }
  }
  if (permissions.canClose) return turn("close", "Close the request", "Everything is paid and reconciled. Close it to finish.", { tone: "success", action: { label: "Close request", run: "close" } });

  // The journey says the request is with the viewer's team, and nothing more specific applies.
  const holder = journey?.holder;
  if (holder?.team && holder.name === role && TEAM_WORKSPACE[role]) {
    return turn("teamTurn", "This request is with your team", journey.text, { params: journey.params, action: TEAM_WORKSPACE[role](request) });
  }
  return null;
}
