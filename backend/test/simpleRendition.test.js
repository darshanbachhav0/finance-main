import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import mongoose from "mongoose";
import AccountingMapping from "../src/models/AccountingMapping.js";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import ApprovalRule from "../src/models/ApprovalRule.js";
import CostCenter from "../src/models/CostCenter.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import JournalEntry from "../src/models/JournalEntry.js";
import Notification from "../src/models/Notification.js";
import User from "../src/models/User.js";
import { decideApproval } from "../src/services/approvalService.js";
import { verifyBankFile } from "../src/services/bankFileVerificationService.js";
import { createEmployeeReimbursementBankAccount, reviewEmployeeReimbursementBankAccount } from "../src/services/employeeReimbursementBankService.js";
import { repairStoredFileNames } from "../src/services/fileNameRepairService.js";
import { reviewRendition, submitRendition } from "../src/services/renditionService.js";
import { createFinancialRequest } from "../src/services/requestService.js";
import { generatedRoot, tempUploadDir } from "../src/services/storageService.js";
import { confirmTreasuryPayable, generatePaymentBatch } from "../src/services/treasuryService.js";
import { ERROR_CODES, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";
import { looksMisdecoded, utf8FileName } from "../src/utils/fileName.js";
import { installBbvaTestConfiguration, upcomingPaymentDate } from "./bbvaFixtures.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };
const period = "2026-09";
// The upload check reads the content: a real JPEG start.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

test("uploaded file names keep their accents", () => {
  assert.equal(utf8FileName("UMA 15 AÃ±os Corporate Email Signature.png"), "UMA 15 Años Corporate Email Signature.png");
  assert.equal(utf8FileName("Años.png"), "Años.png", "already right");
  assert.equal(utf8FileName("boleta.jpg"), "boleta.jpg");
  assert.equal(utf8FileName("Ã"), "Ã", "not valid UTF-8: kept");
  assert.equal(looksMisdecoded("AÃ±os"), true);
  assert.equal(looksMisdecoded("Años"), false);
});

test("an advance is rendered with receipts, transport and the money returned", { timeout: 180000 }, async (t) => {
  const databaseName = `erp_simple_rendition_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:${Number(process.env.TEST_MONGODB_PORT || 27017)}/${databaseName}`);
  const files = [];
  try {
    await Promise.all([FinancialRequest.init(), AccountsPayable.init(), JournalEntry.init(), Notification.init()]);
    await installBbvaTestConfiguration();
    const center = await CostCenter.create({ code: "SR-CC", name: "Simple rendition", area: "Operations", budgetMode: "ACTIVE", annualBudget: 1000000, active: true });
    const opex = await ExpenseType.create({ code: "SR-OPEX", name: "Travel expense", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", deductible: true, active: true });
    const director = await User.create({ name: "SR Director", email: "sr.director@test.local", passwordHash: "unused", role: ROLES.AREA_DIRECTOR, approvalLevel: "AREA_DIRECTOR", approvalAreas: ["*"], area: "Operations" });
    const owner = await User.create({ name: "SR Employee", dni: "44556611", employeeCode: "UMA-SR-1", email: "sr.owner@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", costCenter: center._id, authorizedCostCenters: [center._id], jefe: director._id });
    const accounting = await User.create({ name: "SR Accounting", email: "sr.accounting@test.local", passwordHash: "unused", role: ROLES.ACCOUNTING, area: "Finance" });
    const treasury = await User.create({ name: "SR Treasury", email: "sr.treasury@test.local", passwordHash: "unused", role: ROLES.TREASURY, area: "Finance" });
    const gaf = await User.create({ name: "SR GAF", email: "sr.gaf@test.local", passwordHash: "unused", role: ROLES.GAF, area: "Finance" });
    await AccountingPeriod.create({ period, status: "OPEN" });
    for (const [purpose, accountNumber, bank] of [["ACCOUNTS_PAYABLE", "421201"], ["IGV", "401111"], ["BANK", "104101", "BCP"], ["BANK", "104102", "BBVA"], ["ADVANCE_TRANSIT", "141301"], ["RETURN_RECEIVABLE", "101199"]]) {
      await AccountingMapping.create({ code: `SR-${purpose}-${bank || "ALL"}`, name: purpose, purpose, requestType: "*", expenseNature: "*", bank: bank || "*", currency: "*", accountNumber, active: true });
    }
    await ApprovalRule.create({ name: "SR director", approvalLevel: "AREA_DIRECTOR", role: ROLES.AREA_DIRECTOR, area: "*", amountFrom: 0, requestType: "*", flowType: "*", required: true, sequence: 1, slaHours: 24, active: true });
    const bank = await createEmployeeReimbursementBankAccount({ payload: { bank: "BCP", currency: "PEN", accountHolderName: owner.name, accountNumber: "1941000000011", cci: "00219410000000000011", preferred: true }, user: owner, req });
    await reviewEmployeeReimbursementBankAccount({ accountId: bank._id, payload: { result: "VERIFIED" }, user: accounting, req });
    const writeTemp = async (name, content) => {
      await fs.mkdir(tempUploadDir, { recursive: true });
      const filePath = path.join(tempUploadDir, `${Date.now()}-${Math.random().toString(16).slice(2)}-${name}`);
      await fs.writeFile(filePath, content);
      files.push(filePath);
      return { path: filePath, filename: path.basename(filePath), originalname: name, mimetype: name.endsWith(".pdf") ? "application/pdf" : "image/jpeg", size: Buffer.byteLength(content) };
    };

    // A paid advance of S/ 100.
    const created = await createFinancialRequest({
      payload: { flowType: "C", requestType: REQUEST_TYPE.ENTREGA_RENDIR, expenseNature: "TRAVEL", priority: "MEDIA", issueDate: "2026-09-10", accountingPeriod: period, currency: "PEN", requesterCostCenter: String(center._id), title: "Trip to the school", description: "Trip to the school", businessJustification: "School visit",
        lines: JSON.stringify([{ costCenter: String(center._id), expenseType: String(opex._id), itemDescription: "Trip", quantity: "1", unitOfMeasure: "UNIT", unitPrice: "100", priceIncludesIGV: true }]), submit: "true" },
      files: {}, user: owner, req
    });
    await decideApproval({ id: created._id, action: "APPROVE", comments: "Approved", forward: false, user: director, req });
    const payable = await AccountsPayable.findOne({ request: created._id });
    const batch = await generatePaymentBatch({ payableIds: [String(payable._id)], bank: "BBVA", currency: "PEN", paymentDate: upcomingPaymentDate(), user: treasury, req });
    files.push(path.join(generatedRoot, "bank-files", batch.batch.fileName));
    await verifyBankFile({ batchId: batch.batch._id, user: gaf, req });
    await confirmTreasuryPayable({ accountsPayableId: payable._id, payload: { operationNumber: "SR-OP-1", paidAt: "2026-09-18", confirmedAmount: 100 }, user: treasury, req });

    const lines = (total, igv = 0) => JSON.stringify([{ costCenter: String(center._id), netAmount: Math.round((total - igv) * 100) / 100, igvAmount: igv, totalAmount: total }]);
    const base = {
      receiptLines: JSON.stringify([
        { date: "2026-09-19", documentType: "BOLETA", description: "Lunch", amount: 30, fileIndex: 0 },
        { date: "2026-09-19", documentType: "FACTURA", documentNumber: "F001-77", issuerRuc: "20555555551", description: "Bus tickets", amount: 11.8, fileIndex: 1 }
      ]),
      mobilityLines: JSON.stringify([{ date: "2026-09-19", origin: "UMA", destination: "Colegio", servicePurpose: "Trip to the school", amount: 10 }]),
      unsupportedExpenseLines: JSON.stringify([{ date: "2026-09-19", description: "Parking", goodsServiceType: "SERVICES", grossAmount: 2 }]),
      lines: lines(53.8, 1.8),
      amountReturned: "46.20",
      confirmedExceptionalUse: "true",
      beneficiaryAcknowledged: "true"
    };

    await t.test("every receipt needs its photo or PDF, and the details must add up", async () => {
      const lunch = await writeTemp("boleta.jpg", JPEG);
      await assert.rejects(() => submitRendition({ requestId: created._id, user: owner, req, files: { rendition: [lunch] }, payload: base }), (error) => error.details?.field === "receiptLines.1.file");
      const lunch2 = await writeTemp("boleta.jpg", JPEG), bus = await writeTemp("factura.pdf", "%PDF-1.4");
      // The accounting amount (50) and the details (53.80) differ.
      await assert.rejects(() => submitRendition({ requestId: created._id, user: owner, req, files: { rendition: [lunch2, bus] }, payload: { ...base, lines: lines(50) } }), (error) => error.code === ERROR_CODES.RENDITION_TOTAL_MISMATCH);
    });

    await t.test("receipts point at their files, the deposit slip is kept, and the totals include the receipts", async () => {
      const lunch = await writeTemp("boleta almuerzo.jpg", JPEG), bus = await writeTemp("factura.pdf", "%PDF-1.4"), slip = await writeTemp("voucher depósito.pdf", "%PDF-1.4");
      const submitted = await submitRendition({ requestId: created._id, user: owner, req, files: { rendition: [lunch, bus], returnReceipt: [slip] }, payload: base });
      const rendition = submitted.rendition;
      assert.equal(rendition.status, "SUBMITTED");
      assert.deepEqual(rendition.receiptLines.map((line) => [line.documentType, line.amount]), [["BOLETA", 30], ["FACTURA", 11.8]]);
      const byId = new Map(submitted.attachments.map((item) => [String(item._id), item]));
      assert.deepEqual(rendition.receiptLines.map((line) => byId.get(String(line.attachment))?.originalName), ["boleta almuerzo.jpg", "factura.pdf"]);
      assert.equal(byId.get(String(rendition.returnDepositSlip))?.kind, "RETURN_RECEIPT");
      assert.deepEqual([rendition.receiptSubtotal, rendition.mobilitySubtotal, rendition.unsupportedExpenseSubtotal, rendition.reimbursementTotal], [41.8, 10, 2, 53.8]);
      assert.deepEqual([rendition.amountRendered, rendition.amountReturned, rendition.balanceOutstanding, rendition.detailReconciliation.status], [53.8, 46.2, 0, "MATCH"]);
      assert.equal(rendition.lines[0].igvAmount, 1.8, "the factura's IGV is separated");
    });

    await t.test("Accounting validates it as before", async () => {
      const approved = await reviewRendition({ requestId: created._id, action: "APPROVE", comments: "OK", user: accounting, req });
      assert.equal(approved.request.rendition.status, "VALIDATED");
    });

    await t.test("names stored with the wrong encoding are repaired once", async () => {
      const db = mongoose.connection.db;
      const { insertedId } = await db.collection("financialrequests").insertOne({ requestNumber: "SR-NAMES", attachments: [{ kind: "SUPPORTING", originalName: "UMA 15 AÃ±os.png" }, { kind: "SUPPORTING", originalName: "plain.pdf" }, { kind: "SUPPORTING", originalName: "Ã" }] });
      assert.deepEqual(await repairStoredFileNames({ db }), { applied: true, repaired: 1 });
      const names = (await db.collection("financialrequests").findOne({ _id: insertedId })).attachments.map((item) => item.originalName);
      assert.deepEqual(names, ["UMA 15 Años.png", "plain.pdf", "Ã"]);
      assert.deepEqual(await repairStoredFileNames({ db }), { applied: false, repaired: 0 });
    });
  } finally {
    for (const file of files) await fs.rm(file, { force: true });
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
