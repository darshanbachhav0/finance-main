import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => readFileSync(path.join(project, file), "utf8");

test("Contracts endpoints are not mounted", () => {
  const router = read("backend/src/routes/index.js");
  assert.doesNotMatch(router, /umaContractRoutes|router\.use\(["']\/contracts/);
});

test("Contracts page is not reachable in the frontend and does not appear in menus", () => {
  assert.doesNotMatch(read("frontend/src/App.jsx"), /UmaContracts|path=["']contracts["']/);
  assert.doesNotMatch(read("frontend/src/utils/navigationAccess.js"), /["']\/contracts["']/);
  assert.doesNotMatch(read("frontend/src/utils/navigationIcons.js"), /["']\/contracts["']/);
});

test("Contracts metrics and consultation topic are removed", () => {
  assert.doesNotMatch(read("backend/src/routes/umaInsightsRoutes.js"), /UmaContract|["']contracts["']/);
  assert.doesNotMatch(read("frontend/src/pages/UmaInsights.jsx"), /value=["']contracts["']|data\?\.contracts|name:["']Contratos["']/);
});

test("Dedicated Contracts modules removed; HR emails import remains", () => {
  for (const file of ["backend/src/routes/umaContractRoutes.js", "backend/src/services/umaContractService.js", "backend/src/models/UmaContract.js", "backend/src/models/UmaContractInvoice.js", "shared/umaContractRules.mjs", "frontend/src/pages/UmaContracts.jsx", "backend/test/umaContractRules.test.js"]) {
    assert.equal(existsSync(path.join(project, file)), false, file);
  }
  assert.equal(existsSync(path.join(project, "backend/src/services/contractEmailImportService.js")), true);
});
