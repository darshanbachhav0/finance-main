import assert from "node:assert/strict";
import test from "node:test";
import { supplierVerificationCurrent } from "../../shared/supplierVerification.mjs";
import { treasuryDateFilter } from "../src/services/treasuryFilters.js";
import { paymentBatchSummary, paymentSummaryCsv } from "../src/services/paymentBatchSummary.js";

test("supplier evidence is reusable only for the same identity, within validity and without a risk flag", () => {
  const supplier = { rucDni: "20123456789", legalName: "Proveedor UMA S.A.C.", taxpayerStatus: "ACTIVE", homologationStatus: "HOMOLOGATED", homologationValidUntil: "2027-01-01T00:00:00-05:00",
    taxpayerValidation: { status: "VALID", returnedIdentifier: "20123456789", returnedLegalName: "Proveedor UMA SAC", identifierMatch: "MATCH", legalNameMatch: "MATCH", validatedAt: "2026-01-01" } };
  const now = new Date("2026-10-21T12:00:00Z");
  assert.equal(supplierVerificationCurrent(supplier,now),true);
  for (const patch of [{ legalName: "Otro SAC" }, { rucDni: "20123456780" }, { homologationValidUntil: "2026-10-20" }, { taxpayerStatus: "INACTIVE" }]) assert.equal(supplierVerificationCurrent({ ...supplier,...patch },now),false);
  assert.equal(supplierVerificationCurrent({ ...supplier, taxpayerValidation: { ...supplier.taxpayerValidation,revalidationRequired: true } },now),false);
});

test("Treasury calendar filters use Lima at midnight boundaries and reject invalid custom ranges", () => {
  const filter = treasuryDateFilter({ datePreset: "today", paymentStatus: "overdue" },new Date("2026-11-01T02:00:00Z"));
  assert.match(JSON.stringify(filter),/2026-10-31/);
  assert.match(JSON.stringify(filter[1]),/2026-10-31/);
  assert.match(JSON.stringify(filter[1]),/America\/Lima/);
  assert.throws(() => treasuryDateFilter({ datePreset: "custom", dateFrom: "2026-02-30",dateTo: "2026-03-05" }));
  assert.throws(() => treasuryDateFilter({ datePreset: "custom", dateFrom: "2026-03-10",dateTo: "2026-03-05" }));
  const month = JSON.stringify(treasuryDateFilter({ datePreset: "month" },new Date("2028-02-22T12:00:00Z")));
  assert.match(month,/2028-02-29/);
});

test("supplier summary keeps destinations and currencies separate and reconciles exact cents with invoice traces", () => {
  const base = { supplier: "s1",supplierIdentifier: "20123456789",supplierName: "Proveedor UMA",request: "r1",requestNumber: "SOL-2026-00001",currency: "PEN",priority: "NORMAL",bankAccount: { bank: "BCP",currency: "PEN",accountType: "CURRENT",accountNumber: "191000001",cci: "00200000000000000001" } };
  const items = [{ ...base, accountsPayable: "ap1",amount: 0.1 },{ ...base,accountsPayable: "ap2",amount: 0.2 },{ ...base,accountsPayable: "ap3",amount: 10,bankAccount: { ...base.bankAccount,accountNumber: "191000002" } },{ ...base,accountsPayable: "ap4",currency: "USD",amount: 1,bankAccount: { ...base.bankAccount,currency: "USD" } }];
  const summary = paymentBatchSummary(items);
  assert.equal(summary.supplierCount,1); assert.equal(summary.requestCount,1); assert.equal(summary.suppliers.length,3);
  assert.equal(summary.suppliers[0].total,0.3); assert.equal(summary.suppliers[0].items.length,2);
  assert.match(paymentSummaryCsv({ batchNumber: "BATCH-1",items }),/SOL-2026-00001/);
  assert.doesNotMatch(paymentSummaryCsv({ batchNumber: "BATCH-1",items }),/191000001/);
});
