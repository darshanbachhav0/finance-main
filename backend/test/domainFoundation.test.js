import assert from "node:assert/strict";
import test from "node:test";
import { allowedTransitions, canTransition } from "../src/services/workflowService.js";
import { assertStoredAssetAccess, resolveStoredAsset } from "../src/services/fileAccessService.js";
import { addMoney, assertLineTotal, moneyEquals, multiplyMoney, roundMoney } from "../src/utils/money.js";
import { REQUEST_STATUS, ROLES } from "../src/utils/constants.js";

test("money helpers calculate with exact two-decimal minor units", () => {
  assert.equal(addMoney(0.1, 0.2), 0.3);
  assert.equal(multiplyMoney(118.35, 3.406), 403.1);
  assert.equal(roundMoney("10.005"), 10.01);
  assert.equal(moneyEquals("1.10", 1.1), true);
  assert.doesNotThrow(() => assertLineTotal({ netAmount: 100, igvAmount: 18, totalAmount: 118 }));
  assert.throws(() => assertLineTotal({ netAmount: 100, igvAmount: 18, totalAmount: 117.99 }), /Net plus IGV/);
});

test("canonical workflow graph does not permit payment directly from Accounting", () => {
  assert.equal(canTransition(REQUEST_STATUS.ACCOUNTED, REQUEST_STATUS.SCHEDULED), true);
  assert.equal(canTransition(REQUEST_STATUS.ACCOUNTED, REQUEST_STATUS.PAID), false);
  assert.equal(canTransition(REQUEST_STATUS.BANK_FILE_GENERATED, REQUEST_STATUS.PAID), true);
  assert.deepEqual(allowedTransitions(REQUEST_STATUS.PAID), [REQUEST_STATUS.RENDITION_PENDING, REQUEST_STATUS.RECONCILED]);
  assert.deepEqual(allowedTransitions(REQUEST_STATUS.CLOSED), []);
});

test("stored financial files reject traversal and unsupported public paths", () => {
  const valid = resolveStoredAsset("/uploads/requests/507f1f77bcf86cd799439011/invoice.pdf");
  assert.equal(valid.kind, "uploads");
  assert.match(valid.absolutePath, /uploads[\\/]requests[\\/]507f1f77bcf86cd799439011[\\/]invoice\.pdf$/);
  assert.throws(() => resolveStoredAsset("/uploads/requests/507f/../../secrets.txt"), /Invalid stored-file path/);
  assert.throws(() => resolveStoredAsset("/uploads/C:/Windows/system.ini"), /Invalid stored-file path/);
  assert.throws(() => resolveStoredAsset("/public/report.csv"), /Unsupported stored-file path/);
});

test("generated financial files enforce the server-side role matrix", async () => {
  const bankFile = resolveStoredAsset("/generated/bank-files/BCP-DEMO.txt");
  await assert.doesNotReject(() => assertStoredAssetAccess(bankFile, { role: ROLES.TREASURY }));
  await assert.rejects(() => assertStoredAssetAccess(bankFile, { role: ROLES.SOLICITOR }), /permission/);

  const report = resolveStoredAsset("/generated/reports/month-end.csv");
  await assert.doesNotReject(() => assertStoredAssetAccess(report, { role: ROLES.MANAGEMENT }));
  await assert.rejects(() => assertStoredAssetAccess(report, { role: ROLES.SOLICITOR }), /permission/);
});
