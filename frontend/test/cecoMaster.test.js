import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const costCenters = fs.readFileSync(new URL("../src/pages/CostCenters.jsx", import.meta.url), "utf8");
const users = fs.readFileSync(new URL("../src/pages/AdminUsers.jsx", import.meta.url), "utf8");
const requestDetail = fs.readFileSync(new URL("../src/pages/RequestDetail.jsx", import.meta.url), "utf8");

test("CeCo administration exposes UMA hierarchy and provenance", () => {
  assert.match(costCenters, /organizationalUnit/);
  assert.match(costCenters, /organizationalUnitCode/);
  assert.match(costCenters, /importProvenance/);
  assert.match(costCenters, /sourceRows/);
});

test("user administration displays DNI, default CeCo hierarchy and keeps authorized CeCos", () => {
  assert.match(users, /Employee DNI/);
  assert.match(users, /authorizedCostCenters/);
  assert.match(users, /organizationalUnitCode/);
  assert.match(users, /Manual review/);
});

test("request details prefer immutable historical CeCo snapshots", () => {
  assert.ok(requestDetail.indexOf("row.costCenterSnapshot?.name") < requestDetail.indexOf("row.costCenter?.name"));
});
