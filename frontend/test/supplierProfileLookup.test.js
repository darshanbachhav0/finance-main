import assert from "node:assert/strict";
import test from "node:test";
import { lookupSupplierProfile } from "../src/utils/supplierProfileLookup.js";

const preparing = () => ({ status: 503, details: { retryable: true, retryAfterSeconds: 15 } });

test("supplier autofill waits for Padrón preparation and returns the recovered profile", async () => {
  let calls = 0;
  const waits = [];
  const notices = [];
  const profile = { found: true, data: { legalName: "SANITAS PERU S.A. - EPS", fiscalAddress: "CAL. AMADOR MERINO REYNA NRO. 492" } };
  const result = await lookupSupplierProfile(async () => {
    if (++calls < 3) throw preparing();
    return profile;
  }, { onRetry: (_error, seconds) => notices.push(seconds), wait: async milliseconds => waits.push(milliseconds) });
  assert.equal(result, profile);
  assert.deepEqual(waits, [15000, 15000]);
  assert.deepEqual(notices, [15, 15]);
});

test("supplier autofill stops on configuration, authorization and missing-RUC responses", async () => {
  for (const error of [{ status: 503, details: { retryable: false, retryAfterSeconds: 15 } }, { status: 403 }, { status: 503 }]) {
    await assert.rejects(lookupSupplierProfile(async () => { throw error; }, { wait: () => assert.fail("Must not poll an unrecoverable lookup") }), actual => actual === error);
  }
  const missing = { found: false };
  assert.equal(await lookupSupplierProfile(async () => missing), missing);
});

test("changing RUC or closing the form cancels polling and discards late responses", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(lookupSupplierProfile(async () => { calls++; throw preparing(); }, {
    signal: controller.signal, onRetry: () => controller.abort()
  }));
  assert.equal(calls, 1);
  const late = new AbortController();
  await assert.rejects(lookupSupplierProfile(async () => {
    late.abort();
    return { found: true, data: { legalName: "OLD RUC" } };
  }, { signal: late.signal }));
});
