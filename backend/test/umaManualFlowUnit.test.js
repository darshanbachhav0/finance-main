import assert from 'node:assert/strict';
import test from 'node:test';
import { costAllocationProblems, splitByPercentages, percentageTotal } from '../../shared/costCenterAllocation.mjs';
import { journeySummary } from '../../frontend/src/utils/requestJourney.js';
import { plainNextStep, waitsForBankAccount } from '../../frontend/src/utils/plainStatus.js';

// Database-independent regressions for Doc 1 / Doc 2 / Pagos UMA Piloto.
test('Por encargo: distributions must total 100% and be unique', () => {
  assert.equal(costAllocationProblems([{costCenter:'TI',percentage:60},{costCenter:'OBU',percentage:40}]).length, 0);
  assert.ok(costAllocationProblems([{costCenter:'TI',percentage:60},{costCenter:'TI',percentage:40}]).some(x => /once/.test(x.message)));
  assert.ok(costAllocationProblems([{costCenter:'TI',percentage:60},{costCenter:'OBU',percentage:30}]).some(x => /100%/.test(x.message)));
  assert.equal(percentageTotal([60,40]),100);
  assert.equal(splitByPercentages(5000.01,[60,40]).reduce((a,b)=>a+b,0),5000.01);
});

test('Approved alone is not Treasury payable', () => {
  const item=journeySummary({flowType:'B',status:'APROBADO',approvalHistory:[]});
  assert.equal(item.holder.name,'Financial Control');
});

test('Budget-committed employee advance belongs to Accounting', () => {
  const item=journeySummary({flowType:'C',requestType:'ENTREGA_RENDIR',status:'COMPROMISO_PRESUPUESTAL',approvalHistory:[]});
  assert.equal(item.holder.name,'Accounting');
  assert.match(item.text,/provision/i);
  assert.equal(plainNextStep({flowType:'C',requestType:'ENTREGA_RENDIR',status:'COMPROMISO_PRESUPUESTAL',rendition:{status:'PENDING'}}).yours,false);
});

test('Unverified employee account remains visible after budget commitment',()=>{
 const req={flowType:'C',requestType:'ENTREGA_RENDIR',status:'COMPROMISO_PRESUPUESTAL',currency:'PEN',observation:{code:'REIMBURSEMENT_BANK_REQUIRED'}};
 assert.equal(waitsForBankAccount(req),true);
 assert.match(plainNextStep(req).text,/bank account/i);
});

test('Provisioned employee advance, not just approval, passes to Treasury',()=>{
 const item=journeySummary({flowType:'C',requestType:'ENTREGA_RENDIR',status:'CONTABILIZADO',approvalHistory:[]});
 assert.equal(item.holder.name,'Treasury');
});
