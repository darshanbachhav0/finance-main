import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import ApprovalRule from "../src/models/ApprovalRule.js";
import BudgetCommitment from "../src/models/BudgetCommitment.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import InvoiceObservation from "../src/models/InvoiceObservation.js";
import JournalEntry from "../src/models/JournalEntry.js";
import MassUploadBatch from "../src/models/MassUploadBatch.js";
import PaymentBatch from "../src/models/PaymentBatch.js";
import PurchaseOrder from "../src/models/PurchaseOrder.js";
import Reconciliation from "../src/models/Reconciliation.js";
import SunatVoucher from "../src/models/SunatVoucher.js";
import { AP_STATUS, APPROVAL_STAGES, BUDGET_STATUS, FLOW_TYPE, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";

const apply = process.argv.includes("--apply");
const MIGRATION_KEY = "2026-08-uma-triple-track-v3";

function keyEquals(key, expected) {
  const entries = Object.entries(key || {});
  const wanted = Object.entries(expected);
  return entries.length === wanted.length && wanted.every(([name, value]) => key?.[name] === value);
}

async function dropConflictingUniqueIndexes(db, collectionName, predicates, summary) {
  const collection = db.collection(collectionName);
  let indexes = [];
  try { indexes = await collection.indexes(); } catch { return; }
  for (const index of indexes) {
    if (!index.unique || index.name === "_id_") continue;
    if (!predicates.some((predicate) => predicate(index.key))) continue;
    summary.indexesToDrop.push(`${collectionName}.${index.name}`);
    if (apply) await collection.dropIndex(index.name);
  }
}

function inferFlow(request) {
  if (request.flowType) return request.flowType;
  return request.requestType === REQUEST_TYPE.ENTREGA_RENDIR ? FLOW_TYPE.C : FLOW_TYPE.A1;
}

async function updateRequests(db, summary) {
  const requests = await db.collection("financialrequests").find({}).toArray();
  summary.requestsScanned = requests.length;
  for (const request of requests) {
    const apIds = await db.collection("accountspayables").find({ request: request._id }, { projection: { _id: 1 } }).toArray();
    const inferredFlow = inferFlow(request);
    const set = {};
    if (!request.flowType) set.flowType = inferredFlow;
    const currentIds = (request.accountsPayables || []).map(String).sort();
    const desiredIds = apIds.map((item) => String(item._id)).sort();
    if (JSON.stringify(currentIds) !== JSON.stringify(desiredIds)) {
      set.accountsPayables = apIds.map((item) => item._id);
      if (!request.accountsPayable && apIds[0]) set.accountsPayable = apIds[0]._id;
      summary.accountsPayableLinksUpdated += 1;
    }
    if (Object.keys(set).length) {
      summary.requestsUpdated += 1;
      if (apply) await db.collection("financialrequests").updateOne({ _id: request._id }, { $set: set });
    }
  }
}

async function updateAccountsPayable(db, summary) {
  const cursor = db.collection("accountspayables").find({});
  while (await cursor.hasNext()) {
    const payable = await cursor.next();
    const request = await db.collection("financialrequests").findOne({ _id: payable.request }, { projection: { flowType: 1, requestType: 1 } });
    const flowType = payable.sourceBatch ? FLOW_TYPE.A2 : inferFlow(request || {});
    const set = {};
    if (!payable.flowType) set.flowType = flowType;
    if (flowType !== FLOW_TYPE.C && payable.provisionJournal && !payable.budgetExecutedAt) {
      set.budgetExecutedAt = payable.createdAt || new Date();
    }
    if (flowType !== FLOW_TYPE.C && payable.status === AP_STATUS.PAID && !payable.budgetPaidAt) {
      set.budgetPaidAt = payable.paidDate || payable.updatedAt || new Date();
    }
    if (!Object.keys(set).length) continue;
    summary.accountsPayablesUpdated += 1;
    if (!payable.flowType) summary.accountsPayableFlowUpdated += 1;
    if (set.budgetExecutedAt) summary.accountsPayableBudgetExecutedBackfilled += 1;
    if (set.budgetPaidAt) summary.accountsPayableBudgetPaidBackfilled += 1;
    if (apply) await db.collection("accountspayables").updateOne({ _id: payable._id }, { $set: set });
  }
}

function proportionalLineAmounts(lines, targetAmount, field) {
  const total = Number(lines.reduce((sum, line) => sum + Number(line.amount || 0), 0).toFixed(2));
  const bounded = Math.max(0, Math.min(Number(targetAmount || 0), total));
  let allocated = 0;
  return lines.map((line, index) => {
    const lineAmount = Number(line.amount || 0);
    const value = index === lines.length - 1
      ? Number(Math.max(0, bounded - allocated).toFixed(2))
      : Number(Math.min(lineAmount, bounded * (lineAmount / Math.max(total, 1))).toFixed(2));
    allocated = Number((allocated + value).toFixed(2));
    return { ...line, [field]: value };
  });
}

async function updateBudgetCommitments(db, summary) {
  const commitments = await db.collection("budgetcommitments").find({}).toArray();
  summary.budgetCommitmentsScanned = commitments.length;
  for (const commitment of commitments) {
    const totalAmount = Number(commitment.totalAmount || 0);
    const request = await db.collection("financialrequests").findOne(
      { _id: commitment.request },
      { projection: { flowType: 1, requestType: 1 } }
    );
    const flowType = inferFlow(request || {});
    const payableMatch = {
      request: commitment.request,
      status: { $ne: AP_STATUS.CANCELLED },
      ...(flowType === FLOW_TYPE.C ? { _id: null } : {})
    };
    const payables = flowType === FLOW_TYPE.C
      ? []
      : await db.collection("accountspayables").find(payableMatch, {
          projection: { penEquivalent: 1, provisionJournal: 1, status: 1, budgetExecutedAt: 1, budgetPaidAt: 1 }
        }).toArray();

    let executedAmount = Number(commitment.executedAmount || 0);
    let paidAmount = Number(commitment.paidAmount || 0);
    if ([BUDGET_STATUS.EXECUTED, BUDGET_STATUS.CLOSED].includes(commitment.status)) executedAmount = totalAmount;
    else if (!executedAmount && flowType !== FLOW_TYPE.C) {
      executedAmount = Math.min(totalAmount, Number(payables
        .filter((item) => item.provisionJournal || item.budgetExecutedAt)
        .reduce((sum, item) => sum + Number(item.penEquivalent || 0), 0)
        .toFixed(2)));
    }
    if (commitment.status === BUDGET_STATUS.CLOSED) paidAmount = totalAmount;
    else if (!paidAmount && flowType !== FLOW_TYPE.C) {
      paidAmount = Math.min(totalAmount, Number(payables
        .filter((item) => item.status === AP_STATUS.PAID || item.budgetPaidAt)
        .reduce((sum, item) => sum + Number(item.penEquivalent || 0), 0)
        .toFixed(2)));
    }
    paidAmount = Math.min(paidAmount, totalAmount);
    if (paidAmount > executedAmount) executedAmount = paidAmount;

    let status = commitment.status;
    if (![BUDGET_STATUS.DEFERRED, BUDGET_STATUS.RELEASED].includes(status)) {
      if (paidAmount >= totalAmount && totalAmount > 0) status = BUDGET_STATUS.CLOSED;
      else if (paidAmount > 0) status = BUDGET_STATUS.PARTIALLY_PAID;
      else if (executedAmount >= totalAmount && totalAmount > 0) status = BUDGET_STATUS.EXECUTED;
      else if (executedAmount > 0) status = BUDGET_STATUS.PARTIALLY_EXECUTED;
    }

    let lines = (commitment.lines || []).map((line) => ({
      ...line,
      executedAmount: Number(line.executedAmount || 0),
      paidAmount: Number(line.paidAmount || 0)
    }));
    if (executedAmount > 0 && !lines.some((line) => Number(line.executedAmount || 0) > 0)) {
      lines = proportionalLineAmounts(lines, executedAmount, "executedAmount");
    }
    if (paidAmount > 0 && !lines.some((line) => Number(line.paidAmount || 0) > 0)) {
      lines = proportionalLineAmounts(lines, paidAmount, "paidAmount");
    }

    const changed = commitment.executedAmount === undefined
      || commitment.paidAmount === undefined
      || status !== commitment.status
      || JSON.stringify(lines) !== JSON.stringify(commitment.lines || []);
    if (!changed) continue;
    summary.budgetCommitmentsUpdated += 1;
    if (apply) {
      await db.collection("budgetcommitments").updateOne({ _id: commitment._id }, { $set: {
        executedAmount,
        paidAmount,
        status,
        lines
      } });
    }
  }
}

async function updateReconciliations(db, summary) {
  const rows = await db.collection("reconciliations").find({}).toArray();
  summary.reconciliationsScanned = rows.length;
  for (const reconciliation of rows) {
    const payableIds = await db.collection("accountspayables").find(
      { request: reconciliation.request, status: AP_STATUS.PAID },
      { projection: { _id: 1 } }
    ).toArray();
    const desired = payableIds.map((item) => item._id);
    const current = (reconciliation.accountsPayables || []).map(String).sort();
    const desiredStrings = desired.map(String).sort();
    if (JSON.stringify(current) === JSON.stringify(desiredStrings) && reconciliation.accountsPayable) continue;
    const set = { accountsPayables: desired };
    if (!reconciliation.accountsPayable && desired[0]) set.accountsPayable = desired[0];
    summary.reconciliationsUpdated += 1;
    if (apply) await db.collection("reconciliations").updateOne({ _id: reconciliation._id }, { $set: set });
  }
}

async function updatePurchaseOrders(db, summary) {
  const orders = await db.collection("purchaseorders").find({}).toArray();
  for (const order of orders) {
    const aps = await db.collection("accountspayables").find(
      { purchaseOrder: order._id, status: { $ne: "CANCELLED" } },
      { projection: { originalAmount: 1 } }
    ).toArray();
    const originalAmount = Number(order.originalAmount ?? order.amount ?? 0);
    const consumedAmount = Number(aps.reduce((sum, item) => sum + Number(item.originalAmount || 0), 0).toFixed(2));
    const remainingAmount = Math.max(0, Number((originalAmount - consumedAmount).toFixed(2)));
    const status = remainingAmount <= 0 && originalAmount > 0
      ? "LIQUIDATED"
      : consumedAmount > 0
        ? "PARTIALLY_LIQUIDATED"
        : (order.status || "ISSUED");
    summary.purchaseOrdersUpdated += 1;
    if (apply) {
      await db.collection("purchaseorders").updateOne({ _id: order._id }, { $set: {
        originalAmount,
        consumedAmount,
        remainingAmount,
        liquidatedInvoiceCount: aps.length,
        status
      } });
    }
  }
}

async function updateApprovalRules(db, summary) {
  const missingFlow = await db.collection("approvalrules").countDocuments({ $or: [{ flowType: { $exists: false } }, { flowType: null }] });
  summary.approvalRulesBackfilled = missingFlow;
  if (apply && missingFlow) {
    await db.collection("approvalrules").updateMany(
      { $or: [{ flowType: { $exists: false } }, { flowType: null }] },
      { $set: { flowType: "*" } }
    );
  }

  summary.expressRuleRequired = !(await db.collection("approvalrules").findOne({ active: true, flowType: FLOW_TYPE.B }));
  if (apply) {
    await ApprovalRule.updateOne(
      { name: "Pago directo express - Vía B" },
      { $set: {
        approvalLevel: APPROVAL_STAGES.AREA_DIRECTOR,
        role: ROLES.APPROVER,
        area: "*",
        amountFrom: 0,
        amountTo: null,
        requestType: "*",
        flowType: FLOW_TYPE.B,
        required: true,
        sequence: 1,
        slaHours: 4,
        active: true
      } },
      { upsert: true }
    );
  }
}

async function main() {
  await connectDB();
  const db = mongoose.connection.db;
  const existing = await db.collection("migrationruns").findOne({ key: MIGRATION_KEY });
  if (existing && apply) {
    console.log(`Migration ${MIGRATION_KEY} was already applied at ${existing.appliedAt.toISOString()}.`);
    return;
  }

  const summary = {
    migration: MIGRATION_KEY,
    mode: apply ? "APPLY" : "DRY_RUN",
    requestsScanned: 0,
    requestsUpdated: 0,
    purchaseOrdersUpdated: 0,
    accountsPayableLinksUpdated: 0,
    accountsPayablesUpdated: 0,
    accountsPayableFlowUpdated: 0,
    accountsPayableBudgetExecutedBackfilled: 0,
    accountsPayableBudgetPaidBackfilled: 0,
    budgetCommitmentsScanned: 0,
    budgetCommitmentsUpdated: 0,
    reconciliationsScanned: 0,
    reconciliationsUpdated: 0,
    approvalRulesBackfilled: 0,
    expressRuleRequired: false,
    indexesToDrop: []
  };

  await updateRequests(db, summary);
  await updateAccountsPayable(db, summary);
  await updateBudgetCommitments(db, summary);
  await updatePurchaseOrders(db, summary);
  await updateReconciliations(db, summary);
  await updateApprovalRules(db, summary);

  // Older releases enforced one CXP per request. A2 requires one CXP for every
  // valid invoice while all records still reference the original A1 request/PO.
  await dropConflictingUniqueIndexes(db, "accountspayables", [
    (key) => keyEquals(key, { request: 1 })
  ], summary);
  await dropConflictingUniqueIndexes(db, "journalentries", [
    (key) => keyEquals(key, { request: 1, entryType: 1 }),
    (key) => keyEquals(key, { accountsPayable: 1, entryType: 1 })
  ], summary);
  await dropConflictingUniqueIndexes(db, "reconciliations", [
    (key) => keyEquals(key, { accountsPayable: 1 })
  ], summary);

  if (apply) {
    await Promise.all([
      AccountsPayable.createIndexes(),
      ApprovalRule.createIndexes(),
      BudgetCommitment.createIndexes(),
      FinancialRequest.createIndexes(),
      InvoiceObservation.createIndexes(),
      JournalEntry.createIndexes(),
      MassUploadBatch.createIndexes(),
      PaymentBatch.createIndexes(),
      PurchaseOrder.createIndexes(),
      Reconciliation.createIndexes(),
      SunatVoucher.createIndexes()
    ]);
    await db.collection("migrationruns").insertOne({ key: MIGRATION_KEY, appliedAt: new Date(), summary });
  }

  console.log(JSON.stringify(summary, null, 2));
  if (!apply) console.log("Dry run only. Back up MongoDB, review this output, then re-run with --apply.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
