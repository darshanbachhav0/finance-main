import "dotenv/config";
import fs from "fs/promises";
import mongoose from "mongoose";
import AccountsPayable from "../src/models/AccountsPayable.js";
import AuditLog from "../src/models/AuditLog.js";
import BudgetCommitment from "../src/models/BudgetCommitment.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import JournalEntry from "../src/models/JournalEntry.js";
import PaymentBatch from "../src/models/PaymentBatch.js";
import Reconciliation from "../src/models/Reconciliation.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";
import User from "../src/models/User.js";
import XmlValidationAttempt from "../src/models/XmlValidationAttempt.js";
import { connectDB } from "../src/config/db.js";

const expectedAccounts = [
  ["demo.admin@uma.edu.pe", "Admin", null],
  ["demo.solicitante.salud@uma.edu.pe", "Solicitor", null],
  ["demo.director.salud@uma.edu.pe", "Approver", "AREA_DIRECTOR"],
  ["demo.vicerrector@uma.edu.pe", "Approver", "VICE_RECTOR"],
  ["demo.presupuesto@uma.edu.pe", "Budget", null],
  ["demo.contabilidad@uma.edu.pe", "Accounting", null],
  ["demo.tesoreria@uma.edu.pe", "Treasury", null],
  ["demo.gerencia@uma.edu.pe", "Management", "RECTORATE"]
];

const expectedStatuses = {
  "UMA_01_BORRADOR_SALUD": "BORRADOR",
  "UMA_02_PENDIENTE_DIRECTOR": "PENDIENTE_APROBACION",
  "UMA_03_PENDIENTE_VICERRECTOR": "APROBADO_DIRECTOR",
  "UMA_04_PENDIENTE_RECTORADO": "APROBADO_VICERRECTOR",
  "UMA_05_COMPROMISO_PRESUPUESTAL": "COMPROMISO_PRESUPUESTAL",
  "UMA_06_CONTABILIZADO": "CONTABILIZADO",
  "UMA_07_PROGRAMADO": "PROGRAMADO",
  "UMA_08_TXT_SCOTIABANK": "TXT_GENERADO",
  "UMA_09_TXT_INTERBANK_USD": "TXT_GENERADO",
  "UMA_10_PAGADO_BBVA": "PAGADO",
  "UMA_11_CERRADO_BCP": "CERRADO",
  "UMA_12_RENDICION_PENDIENTE": "RENDICION_PENDIENTE",
  "UMA_13_RENDICION_CERRADA": "CERRADO",
  "UMA_14_REEMBOLSO_NO_DEDUCIBLE": "CONTABILIZADO",
  "UMA_15_OBSERVADO": "OBSERVADO",
  "UMA_16_RECHAZADO": "RECHAZADO",
  "UMA_17_EXCEPCION_PRESUPUESTAL": "APROBADO_VICERRECTOR",
  "UMA_18_PERIODO_CERRADO": "BORRADOR"
};

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function verifyUsers() {
  check(await User.countDocuments({ email: /@erp\.local$/i }) === 0, "Legacy @erp.local demo accounts remain.");
  for (const [email, role, approvalLevel] of expectedAccounts) {
    const user = await User.findOne({ email });
    check(user?.active, `Missing active demo account ${email}.`);
    check(user.role === role, `${email} has role ${user?.role}; expected ${role}.`);
    if (approvalLevel) check(user.approvalLevel === approvalLevel, `${email} has the wrong approval level.`);
  }
}

async function verifyScenarios() {
  for (const [key, status] of Object.entries(expectedStatuses)) {
    const request = await FinancialRequest.findOne({ developmentScenarioKey: key });
    check(request, `Missing UMA scenario ${key}.`);
    check(request.status === status, `${request.requestNumber} is ${request.status}; expected ${status}.`);
    check(request.requester && request.supplier && request.lines.length, `${request.requestNumber} has broken master-data links.`);
  }
}

async function verifyLifecycleLinks() {
  const closed = await FinancialRequest.findOne({ developmentScenarioKey: "UMA_11_CERRADO_BCP" });
  const [ap, commitment, journals, reconciliation, audits] = await Promise.all([
    AccountsPayable.findOne({ request: closed._id }),
    BudgetCommitment.findOne({ request: closed._id }),
    JournalEntry.find({ request: closed._id }),
    Reconciliation.findOne({ request: closed._id }),
    AuditLog.countDocuments({ requestId: closed._id })
  ]);
  check(ap?.status === "PAID" && ap.outstandingAmount === 0, "Closed scenario CXP is not settled.");
  check(commitment?.status === "CLOSED", "Closed scenario budget is not marked paid/closed.");
  check(journals.some((entry) => entry.entryType === "PROVISION"), "Closed scenario provision journal is missing.");
  check(journals.some((entry) => entry.entryType === "PAYMENT"), "Closed scenario payment journal is missing.");
  check(reconciliation?.difference === 0, "Closed scenario reconciliation is missing or unbalanced.");
  check(audits >= 8, "Closed scenario audit trail is incomplete.");

  const txtOnly = await FinancialRequest.findOne({ developmentScenarioKey: "UMA_08_TXT_SCOTIABANK" });
  const txtAp = await AccountsPayable.findOne({ request: txtOnly._id });
  check(txtAp?.status === "PAYMENT_FILE_CREATED" && txtAp.outstandingAmount > 0, "TXT-only scenario was incorrectly settled.");

  const rendition = await FinancialRequest.findOne({ developmentScenarioKey: "UMA_13_RENDICION_CERRADA" });
  check(rendition.rendition?.status === "VALIDATED", "Completed rendition is not validated.");
  check(await JournalEntry.exists({ request: rendition._id, entryType: "RENDITION" }), "Rendition journal is missing.");

  const [capex, management, budget] = await Promise.all([
    FinancialRequest.findOne({ developmentScenarioKey: "UMA_09_TXT_INTERBANK_USD" }),
    User.findOne({ email: "demo.gerencia@uma.edu.pe" }),
    User.findOne({ email: "demo.presupuesto@uma.edu.pe" })
  ]);
  const rectorateStep = capex.approvalRouteSnapshot.find((step) => step.approvalLevel === "RECTORATE");
  const capexCommitment = await BudgetCommitment.findOne({ request: capex._id });
  check(String(rectorateStep?.completedBy) === String(management._id), "Management/Rectorate approval is not linked to the USD CAPEX scenario.");
  check(String(capexCommitment?.createdBy) === String(budget._id), "Budget commitment is not linked to the Budget role.");
}

async function verifyIntegrationsAndFiles() {
  const batches = await PaymentBatch.find().select("+filePath");
  const banks = new Set(batches.map((batch) => batch.bank));
  for (const bank of ["BCP", "BBVA", "INTERBANK", "SCOTIABANK"]) {
    check(banks.has(bank), `No demo bank batch exists for ${bank}.`);
  }
  for (const batch of batches) await fs.access(batch.filePath);
  check(await XmlValidationAttempt.countDocuments({ status: "VALID" }) >= 4, "Validated XML attempts are missing.");
  check(await Supplier.countDocuments({ homologationStatus: "PENDING_VALIDATION", active: false }) >= 1, "Pending supplier warning scenario is missing.");
  check(await SupplierBankAccount.countDocuments({ active: false }) >= 1, "Supplier bank-account history is missing.");
}

async function main() {
  await connectDB();
  await verifyUsers();
  await verifyScenarios();
  await verifyLifecycleLinks();
  await verifyIntegrationsAndFiles();
  console.log(JSON.stringify({
    success: true,
    dataset: "UMA cohesive development demo",
    primaryRoleAccounts: expectedAccounts.length,
    scenarios: Object.keys(expectedStatuses).length,
    bankAdaptersRepresented: 4,
    message: "All UMA demo-data integrity checks passed."
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
