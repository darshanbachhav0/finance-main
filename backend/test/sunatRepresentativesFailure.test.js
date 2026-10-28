import test from "node:test";
import assert from "node:assert/strict";
import { classifyRepresentativeLookupFailure } from "../src/services/sunatConsultaRucRepresentativesService.js";

test("missing Chromium explains the fix without disclosing a local path", () => {
  const info = classifyRepresentativeLookupFailure(new Error("Executable doesn't exist at C:/private/user/browser.exe"));
  assert.equal(info.code, "SUNAT_REP_BROWSER_MISSING");
  assert.equal(info.requiresConfiguration, true);
  assert.ok(!info.message.includes("private"));
});
test("SUNAT timeouts permit retry without asserting a valid representative", () => {
  const info = classifyRepresentativeLookupFailure(new Error("page.goto: Timeout 30000ms exceeded"));
  assert.equal(info.code, "SUNAT_REP_TIMEOUT");
  assert.equal(info.retryable, true);
});
test("a human challenge cannot be bypassed", () => {
  const info = classifyRepresentativeLookupFailure(new Error("SUNAT requested interactive human verification"));
  assert.equal(info.code, "SUNAT_REP_MANUAL_VERIFICATION");
  assert.equal(info.retryable, false);
});
test("unexpected errors do not disclose internal details", () => {
  const info = classifyRepresentativeLookupFailure(new Error("secret /private/internal/value"));
  assert.equal(info.code, "SUNAT_REP_UNAVAILABLE");
  assert.ok(!info.message.includes("secret"));
});
