import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chargedCostCenterAmounts } from "../../shared/antiFragmentation.mjs";
import { processBAdvanceEvidence } from "../../shared/processBAdvanceEvidence.mjs";
import { buildDigitalActaPdf } from "../src/services/digitalActaPdfRenderer.js";
const read = (path) => fs.readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("Por encargo shares exactly the beneficiary's charged amount, not requesting CeCo", () => {
  assert.deepEqual(chargedCostCenterAmounts({ costCenterType: "POR_ENCARGO",totalPENEquivalent:8000,requesterCostCenter:"REQUESTER",costAllocations:[{costCenter:"OBU",percentage:60},{costCenter:"TI",percentage:40}]}), [
    {id:"OBU",amount:4800},{id:"TI",amount:3200}
  ]);
  assert.deepEqual(chargedCostCenterAmounts({costCenterType:"PROPIO",totalPENEquivalent:8000,requesterCostCenter:"OBU"}), [{id:"OBU",amount:8000}]);
  assert.deepEqual(chargedCostCenterAmounts({costCenterType:"POR_ENCARGO",totalPENEquivalent:1180,costAllocations:[{costCenter:"TI"}]}), [{id:"TI",amount:1180}]);
});
test("Process B advance deadlines count from paid date and stay independent of request month", () => {
  const req={flowType:"B",supplierPaymentTerms:{paymentCondition:"100%_ADVANCE"},payment:{paidAt:"2026-09-01T13:00:00Z"},xmlValidation:{validated:false},digitalActa:{status:"PENDING"}};
  const result=processBAdvanceEvidence(req, "2026-10-05T14:00:00Z");
  assert.equal(result.invoiceDue,"2026-09-16");
  assert.equal(result.actaDue,"2026-10-01");
  assert.equal(result.invoiceOverdue,true);
  assert.equal(result.actaOverdue,true);
  assert.equal(processBAdvanceEvidence({...req,flowType:"C"}),null);
  assert.equal(processBAdvanceEvidence({...req,payment:{}}),null);
});
test("Completed digital acta renders a readable PDF with signed evidence and blocks unsigned exports", () => {
  const request={requestNumber:"SOL-2026-00007",flowType:"B",currency:"PEN",totalAmount:8000,totalPENEquivalent:8000};
  const acta={status:"COMPLETE",conformity:"TOTAL",description:"Servicios recibidos sin observaciones",documentHash:"a".repeat(64),issuedAt:"2026-10-22",completedAt:"2026-10-23",signatures:[{as:"RECEIVER",signer:"r",signedAt:"2026-10-22",signature:"SIG",documentHash:"a".repeat(64)}]};
  const pdf=buildDigitalActaPdf({request,acta,names:{r:"Camila"}});
  assert.ok(Buffer.isBuffer(pdf));assert.equal(pdf.subarray(0,8).toString(),"%PDF-1.4");
  assert.match(pdf.toString("latin1"),/SOL-2026-00007/);
  assert.match(pdf.toString("latin1"),/Camila/);
  assert.throws(()=>buildDigitalActaPdf({request,acta:{...acta,status:"PENDING"}}),/completed acta/);
});
test("Accounting-only posting gates B and uses invoice's own period + 4-level priority", () => {
  const accounting=read("../src/services/accountingService.js");
  const acta=read("../src/services/digitalActaService.js");
  const treasury=read("../src/services/treasuryService.js");
  assert.match(accounting,/Track B must be provisioned by Accounting/);
  assert.match(accounting,/if \(request.flowType === FLOW_TYPE.B\).*?\{/);
  assert.match(accounting,/if \(!treatment\?\.spotConfirmed\)/);
  assert.match(accounting,/assertDigitalActaForAccounting\(request\)/);
  assert.match(accounting,/normalizeRequestPriority\(request.priority\)/);
  assert.match(acta,/request.flowType !== FLOW_TYPE.B && !digitalActaPostingEnabled\(\)/);
  assert.match(treasury,/period: periodFromDate\(paymentDate\), action: "SCHEDULE"/);
  assert.doesNotMatch(treasury,/period: request.accountingPeriod, action: "CONFIRM_PAYMENT"/);
  const workflow=read("../src/services/workflowService.js");
  assert.match(workflow,/FINANCIAL_EVIDENCE_MILESTONES = new Set\(\[.*?"CERRADO".*?\]\)/);
});
