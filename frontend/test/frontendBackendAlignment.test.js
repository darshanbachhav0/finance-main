import assert from "node:assert/strict";
import fs from "node:fs";
import { displayedRequestStatus, renditionRequirements } from "../src/utils/requestPresentation.js";
import { requestStatuses } from "../src/utils/options.js";

const read = file => fs.readFileSync(new URL(file, import.meta.url), "utf8");

assert.equal(displayedRequestStatus({ status: "PAGADO", financialProgress: { status: "TXT_GENERADO", counts: { total: 3, paid: 1 } } }), "TXT_GENERADO");
assert.equal(displayedRequestStatus({ status: "PAGADO_CERRADO", financialProgress: { status: "CONCILIADO", counts: { total: 1 } } }), "CERRADO");
assert.equal(displayedRequestStatus({ status: "PAGADO", financialProgress: { status: "PAGADO", counts: { total: 3, paid: 3 } } }), "PAGADO");
assert.equal(renditionRequirements({ phases: { RENDITION: { valid: false, requirements: [{ kind: "SUPPORTING" }], missing: [{ kind: "SUPPORTING" }] } } }).missing.length, 1);

for (const obsolete of ["PAGADO_CERRADO", "PROVISIONADO_CXP", "PROCESADO_BANCO", "EN_VALIDACION", "ENVIADO", "RENDICION_PENDIENTE"]) {
  assert.equal(requestStatuses.includes(obsolete), false, `${obsolete} must not be an active workflow filter`);
}

const quickView = read("../src/components/RequestQuickView.jsx");
assert.ok(!quickView.match(/editable[^;]+RECHAZADO/), "Rejected requests must not be editable from quick view");

const treasury = read("../src/pages/TreasuryQueue.jsx");
assert.ok(treasury.includes('value={bank} readOnly'));
assert.ok(treasury.includes('const historicalSourceBanks = ["BBVA", "BCP", "INTERBANK", "SCOTIABANK"]'));
assert.ok(treasury.includes("Beneficiary accounts may use another bank through CCI"));

const approvals = read("../src/pages/ApprovalInbox.jsx");
assert.ok(approvals.includes("row.allowedActions") && approvals.includes('hasAction(row, "APPROVE")'));
assert.ok(!approvals.includes("requesterId") && !approvals.includes("user.approvalLevel"));

const requestDetail = read("../src/pages/RequestDetail.jsx");
assert.ok(requestDetail.includes("request.allowedActions"));
assert.ok(!requestDetail.includes('editableStatuses.includes(request.status)'));

const requestList = read("../src/pages/RequestsList.jsx");
assert.ok(requestList.includes('renditionStatus: searchParams.get("renditionStatus")'));
assert.ok(read("../src/utils/dashboardLinks.js").includes("renditionStatus=PENDING%2CSUBMITTED%2COBSERVED"));

const costCenters = read("../src/pages/CostCenters.jsx");
const users = read("../src/pages/AdminUsers.jsx");
assert.ok(costCenters.includes('key: "area"') && costCenters.includes("organizationalUnitCode") && costCenters.includes("importProvenance"));
assert.ok(users.includes("authorizedCostCenters") && users.includes("Default Cost Center"));

const exchangeRates = read("../src/pages/ExchangeRates.jsx");
assert.ok(exchangeRates.includes("currentEvidence.fallback?.used") && exchangeRates.includes("Official / authoritative"));

const documents = read("../src/pages/RequestDetail.jsx");
assert.ok(documents.includes("Current document phase") && documents.includes("phaseStatus.requirements") && documents.includes("phaseStatus.missing"));

console.log("PASS frontend/backend alignment: derived parent progress, terminal safety, Track C separation, BBVA source, role actions, CeCo, SUNAT evidence and documents");
