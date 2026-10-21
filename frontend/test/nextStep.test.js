import assert from "node:assert/strict";
import fs from "node:fs";
import { nextStepFor } from "../src/utils/nextStep.js";
import { reviewSummary } from "../src/utils/simpleRendition.js";
import { TASK_SENTENCES } from "../src/utils/myTasks.js";

const source = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const camila = { _id: "u-camila", name: "Ruth Camila", role: "Solicitor" };
const accounting = { _id: "u-acc", name: "Contabilidad UMA", role: "Accounting" };
const treasury = { _id: "u-tre", name: "Tesorería UMA", role: "Treasury" };
const advance = (patch = {}) => ({ _id: "r1", requestNumber: "SOL-2026-00132", flowType: "C", requestType: "ENTREGA_RENDIR", status: "PAGADO", currency: "PEN", requester: { _id: camila._id, name: camila.name }, ...patch });
const submitted = advance({ rendition: { status: "SUBMITTED", financeReview: { result: "PENDING" }, amountAdvanced: 56, amountRendered: 50, amountReturned: 6 } });

// 1. Accounting opening a submitted rendition is told it is their turn, and reviews it right there.
const review = nextStepFor({ request: submitted, user: accounting });
assert.equal(review.key, "reviewRendition");
assert.equal(review.mine, true);
assert.equal(review.review, true, "the receipts and the decision are on the card");
assert.equal(review.title, "Review the receipts from {name}");
assert.equal(review.params.name, "Ruth Camila");
assert.deepEqual(review.more.open, { tab: "Documents", target: "official-rendition" });
// The employee's own advance has its own card; someone else only waits (the journey says who has it).
assert.equal(nextStepFor({ request: submitted, user: camila, ownAdvance: true }), null);
assert.equal(nextStepFor({ request: submitted, user: { _id: "u-x", role: "Solicitor" } }), null);
assert.equal(nextStepFor({ request: advance({ rendition: { status: "SUBMITTED", financeReview: { result: "PENDING" } } }), user: treasury }), null, "Treasury does not review renditions");

// 2. After the review: a non-deductible balance, or an advance to recover.
const balance = nextStepFor({ request: advance({ rendition: { status: "VALIDATED", nonDeductibleOutstanding: 5 } }), user: accounting });
assert.equal(balance.key, "settleBalance");
assert.equal(balance.params.amount, 5);
assert.deepEqual(balance.action.open, { tab: "Documents", target: "rendition-account-14" });
const recovery = nextStepFor({ request: advance({ rendition: { status: "REJECTED", recovery: { status: "PENDING", outstandingAmount: 40 } } }), user: treasury });
assert.equal(recovery.key, "recoverAdvance");
assert.equal(recovery.params.amount, 40);

// 3. Payment: prepare, Accounting verifies the bank file, Treasury confirms, then reconciles.
const payable = (patch) => ({ _id: "ap1", status: "OPEN", ...patch });
assert.equal(nextStepFor({ request: advance({ status: "CONTABILIZADO" }), user: treasury, related: { accountsPayable: [payable()] } }).title, "Pay the advance today");
const inFile = { accountsPayable: [payable({ status: "PAYMENT_FILE_CREATED", paymentBatch: "b1" })], paymentBatches: [{ _id: "b1", verification: { status: "PENDING" } }] };
const verify = nextStepFor({ request: advance({ status: "TXT_GENERADO" }), user: accounting, related: inFile });
assert.equal(verify.key, "verifyBankFile");
assert.equal(verify.action.href, "/accounting/bank-files?record=b1");
assert.equal(nextStepFor({ request: advance({ status: "TXT_GENERADO" }), user: treasury, related: inFile }).mine, false, "Treasury waits for Accounting's check");
const verified = { ...inFile, paymentBatches: [{ _id: "b1", verification: { status: "VERIFIED" } }] };
assert.equal(nextStepFor({ request: advance({ status: "TXT_GENERADO" }), user: treasury, related: verified }).action.href, "/treasury?tab=confirm&request=r1");
const paid = { accountsPayable: [payable({ status: "PAID" })] };
const reconcile = nextStepFor({ request: advance({ rendition: { status: "VALIDATED" } }), user: treasury, related: paid });
assert.equal(reconcile.key, "reconcile");
assert.equal(reconcile.action.href, "/treasury?tab=reconcile&request=r1");
assert.equal(nextStepFor({ request: advance({ rendition: { status: "VALIDATED" } }), user: treasury, related: { ...paid, reconciliations: [{ accountsPayables: ["ap1"] }] } }), null, "a payment already reconciled at request level");
assert.equal(nextStepFor({ request: advance({ status: "CONCILIADO" }), user: accounting, permissions: { canClose: true } }).action.run, "close");

// 4. The rest of the route: submit, correct, approve, commit, order, invoice.
const draft = { _id: "r2", status: "BORRADOR", flowType: "A1", requester: { _id: camila._id } };
assert.equal(nextStepFor({ request: draft, user: camila, permissions: { modifiable: true } }).action.run, "submit");
assert.equal(nextStepFor({ request: draft, user: camila, permissions: { modifiable: true }, missingDocuments: 2 }).key, "addDocuments");
assert.equal(nextStepFor({ request: { ...draft, status: "OBSERVADO" }, user: camila, permissions: { modifiable: true } }).action.href, "/requests/r2/edit");
assert.equal(nextStepFor({ request: { ...draft, status: "PENDIENTE_APROBACION" }, user: { _id: "jefe", role: "AreaDirector" }, permissions: { canApprove: true } }).action.run, "approve");
// A new supplier waiting for this jefe: approved with the request, or the request goes back.
const waitingSupplier = (extra) => ({ supplier: { _id: "s1", name: "Proveedor Nuevo", rucDni: "20600000005" }, yours: true, ready: true, issues: [], ...extra });
const jefeTurn = (supplierApproval) => nextStepFor({ request: { ...draft, status: "PENDIENTE_APROBACION" }, user: { _id: "jefe", role: "Solicitor" }, permissions: { canApprove: true }, supplierApproval });
assert.deepEqual([jefeTurn(waitingSupplier()).action.label, jefeTurn(waitingSupplier()).action.run], ["Approve", "approve"]);
assert.equal(jefeTurn(waitingSupplier({ ready: false })).action.run, "approve");
assert.equal(jefeTurn(waitingSupplier({ yours: false })).action.label, "Approve", "someone else's supplier: the plain decision");
assert.equal(nextStepFor({ request: { ...draft, status: "APROBADO" }, user: treasury, permissions: { canCommitBudget: true } }).action.run, "budget");
assert.equal(nextStepFor({ request: { ...draft, status: "COMPROMISO_PRESUPUESTAL" }, user: { _id: "p", role: "Procurement" }, permissions: { canIssueOrder: true } }).action.run, "order");
assert.equal(nextStepFor({ request: { ...draft, flowType: "B", status: "COMPROMISO_PRESUPUESTAL" }, user: camila, permissions: { canRegisterInvoice: true } }).action.open.target, "request-section-register-the-invoice");
// A1: the invoice is the requester's turn once the order is issued, and only until one is booked.
// The permission stays after booking (one order may receive several invoices); the card does not.
const ordered = { ...draft, status: "COMPROMISO_PRESUPUESTAL", purchaseOrder: { _id: "po1", poNumber: "OC-2026-00041" } };
const firstInvoice = nextStepFor({ request: ordered, user: camila, permissions: { canRegisterInvoice: true } });
assert.equal(firstInvoice.key, "registerInvoice");
assert.equal(firstInvoice.action.open.target, "request-section-register-a1-invoice-and-conformity");
assert.notEqual(nextStepFor({ request: { ...ordered, purchaseOrder: undefined }, user: camila, permissions: { canRegisterInvoice: true } })?.key, "registerInvoice", "no order yet");
const withTreasury = { text: "Booked by Accounting. Treasury pays it on the next payment day.", holder: { name: "Treasury", team: true } };
for (const status of ["CONTABILIZADO", "PROGRAMADO", "TXT_GENERADO", "PROVISIONADO_CXP", "PAGADO"]) {
  assert.equal(nextStepFor({ request: { ...ordered, status }, user: camila, permissions: { canRegisterInvoice: true }, journey: withTreasury }), null, `${status}: the booked invoice is not asked for again`);
  assert.notEqual(nextStepFor({ request: { ...ordered, status }, user: accounting, permissions: { canRegisterInvoice: true }, journey: withTreasury })?.key, "registerInvoice", `${status}: nor from Accounting`);
}
// Track B: its invoice is asked for until it is validated, as before.
assert.equal(nextStepFor({ request: { ...draft, flowType: "B", status: "COMPROMISO_PRESUPUESTAL", xmlValidation: { validated: false } }, user: camila, permissions: { canRegisterInvoice: true } }).key, "registerInvoice");
assert.equal(nextStepFor({ request: { ...draft, flowType: "B", status: "COMPROMISO_PRESUPUESTAL", xmlValidation: { validated: true } }, user: camila, permissions: { canRegisterInvoice: true } }), null);
// With the viewer's team and nothing more specific: the team's own screen.
const team = nextStepFor({ request: { ...draft, flowType: "B", status: "COMPROMISO_PRESUPUESTAL" }, user: accounting, journey: { text: "Approved and budgeted. Accounting books the invoice next.", holder: { name: "Accounting", team: true } } });
assert.equal(team.key, "teamTurn");
assert.equal(team.action.href, "/accounting");

// 5. What Accounting reviews: the money, each receipt with its file, the deposit slip, the checks.
const files = [{ _id: "f1", kind: "RENDITION", originalName: "boleta.jpg", url: "/a/f1" }, { _id: "f2", kind: "RETURN_RECEIPT", originalName: "voucher.jpg", url: "/a/f2" }, { _id: "f3", kind: "RENDITION", originalName: "planilla.pdf", url: "/a/f3" }];
const summary = reviewSummary(advance({ attachments: files, rendition: { status: "SUBMITTED", amountAdvanced: 56, amountRendered: 50, amountReturned: 6, returnDepositSlip: "f2", comments: "Taxi sin boleta", receiptLines: [{ date: "2026-10-18", documentType: "BOLETA", description: "Almuerzo", amount: 40, attachment: "f1" }], mobilityLines: [{ date: "2026-10-18", origin: "UMA", destination: "Colegio", amount: 8 }], unsupportedExpenseLines: [{ description: "Propina", grossAmount: 2 }] } }));
assert.equal(summary.balance, 0);
assert.equal(summary.ready, true);
assert.deepEqual(summary.items.map((item) => [item.kind, item.amount, item.file?.originalName || null]), [["RECEIPT", 40, "boleta.jpg"], ["TRANSPORT", 8, null], ["NO_RECEIPT", 2, null]]);
assert.equal(summary.depositSlip.originalName, "voucher.jpg");
assert.deepEqual(summary.otherFiles.map((file) => file.originalName), ["planilla.pdf"], "files not tied to a receipt are still listed");
assert.deepEqual(summary.checks.map((check) => [check.key, check.ok]), [["balance", true], ["files", true], ["slip", true], ["noReceipt", null]]);
assert.equal(summary.note, "Taxi sin boleta");
const open = reviewSummary(advance({ attachments: [], rendition: { amountAdvanced: 56, amountRendered: 40, amountReturned: 6, receiptLines: [{ description: "x", amount: 40 }], detailReconciliation: { status: "MISMATCH" } } }));
assert.equal(open.ready, false);
assert.deepEqual(open.checks.filter((check) => check.ok === false).map((check) => check.key), ["balance", "files", "slip", "detail"]);
assert.equal(open.checks[0].amount, 10);

// 6. Page wiring: the card is the first thing on the page; the journey says "With you".
const detail = source("../src/pages/RequestDetail.jsx");
assert.match(detail, /<Message type="error">\{error\}<\/Message>\s*\{step\?\.mine && <NextStepCard step=\{step\} request=\{request\} processing=\{processing\} onRun=\{runStep\} onOpen=\{openStep\} onReload=\{load\} \/>\}/);
assert.match(detail, /const step = nextStepFor\(\{ request, user, permissions, related, missingDocuments: missingDocuments\.length, invoiceCorrection, ownAdvance: simpleAdvance, journey \}\)/);
assert.match(detail, /viewerRole=\{user\.role\} viewerName=\{user\.name\}/);
assert.doesNotMatch(detail, /nextAction/, "one source for the next step");
assert.match(source("../src/components/NextStepCard.jsx"), /<RenditionReviewPanel request=\{request\} onReload=\{onReload\} \/>/);
const panel = source("../src/components/rendition/RenditionReviewPanel.jsx");
assert.match(panel, /api\.post\(`\/requests\/\$\{request\._id\}\/rendition\/\$\{action\}`, \{ comments \}\)/, "the same endpoints as the detailed workspace");
const workspace = source("../src/components/rendition/OfficialRenditionWorkspace.jsx");
for (const id of ["rendition-account-14", "rendition-recovery", "rendition-finance-review"]) assert.match(workspace, new RegExp(`<Section id="${id}"`));
assert.match(source("../src/components/RequestJourney.jsx"), /t\("With you \(\{name\}\)"\)/);
for (const key of ["reconciliation", "closeReady", "renditionBalance", "advanceRecovery"]) assert.ok(TASK_SENTENCES[key], `${key} has a sentence`);

console.log("PASS next step: each role's turn, the rendition review on the card, payment steps, page wiring");

// 7. An invoice from another supplier than the order: one clear card, the journey and the list
//    agree that the requester uploads the right invoice; no duplicate status blocks on the page.
{
  const { journeySummary } = await import("../src/utils/requestJourney.js");
  const { plainNextStep } = await import("../src/utils/plainStatus.js");
  const owner = { _id: "camila", role: "Solicitor" };
  const observed = { _id: "r9", flowType: "A1", status: "OBSERVADO_SUNAT", requester: { _id: "camila", name: "Camila" }, supplier: { legalName: "Comercial Andina S.A.C.", rucDni: "20123456789" }, observation: { code: "RUC_MISMATCH", detail: "The XML issuer RUC does not match the approved supplier." } };
  const related = { sunatVouchers: [{ seriesNumber: "E001-273", rucIssuer: "20610378669", validationStatus: "OBSERVED" }] };
  const card = nextStepFor({ request: observed, user: owner, permissions: { canRegisterInvoice: true }, related, invoiceCorrection: true });
  assert.equal(card.title, "The invoice is from another supplier");
  assert.deepEqual(card.params, { invoice: "E001-273", found: "20610378669", supplier: "Comercial Andina S.A.C.", expected: "20123456789" });
  assert.equal(card.action.open.target, "request-section-register-a1-invoice-and-conformity", "the button opens the invoice upload itself");
  assert.equal(card.tone, "warning");
  assert.equal(nextStepFor({ request: observed, user: { _id: "jefe", role: "Solicitor" }, related, invoiceCorrection: true }).mine, false);
  assert.equal(nextStepFor({ request: { ...observed, observation: { code: "DUPLICATE_VOUCHER" } }, user: owner, permissions: { canRegisterInvoice: true }, related, invoiceCorrection: true }).title, "This invoice is already registered");
  assert.equal(nextStepFor({ request: { ...observed, observation: { code: "OBSERVADO_SUNAT" } }, user: owner, permissions: { canRegisterInvoice: true }, related, invoiceCorrection: true }).title, "Correct the invoice documents", "a SUNAT check keeps the generic card");
  const journey = journeySummary(observed, { viewerId: "camila" });
  assert.equal(journey.holder.name, "Camila", "with the requester, not Accounting");
  assert.match(journey.text, /another supplier/);
  assert.equal(journeySummary({ ...observed, observation: { code: "OBSERVADO_SUNAT" } }, { viewerId: "camila" }).holder.team, true, "SUNAT checks stay with Accounting");
  assert.deepEqual(plainNextStep(observed), { text: "Upload the right invoice: the one uploaded is from another supplier.", yours: true });
  assert.match(detail, /!REQUESTER_INVOICE_PROBLEMS\.includes\(request\.observation\.code\)\) && <Message/, "the card replaces the red message");
  assert.doesNotMatch(detail, /<PlainStatus/, "the journey is the requester's only status block");
  assert.match(detail, /!simpleAdvance && !usesPlainStatuses\(user\) && <ReadinessPanel/, "the readiness checklist is Finance's");
}
