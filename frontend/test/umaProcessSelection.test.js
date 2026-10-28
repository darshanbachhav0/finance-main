import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { UMA_PROCESSES, canStartUmaProcess, processDestination, requestFlowFromProcess } from '../src/utils/umaProcessSelection.js';

test('all eight distinct processes have an explicit destination', () => {
  assert.deepEqual(UMA_PROCESSES.map(({code}) => code), ['A1','A2','B','C','D','M','H','E']);
  for (const {code,title,description,requirements} of UMA_PROCESSES) {
    assert.ok(title && description && requirements && processDestination(code)?.startsWith('/'));
  }
});

test('Solicitor can initiate A1/A2/B/C/M/E but not D/H', () => {
  const requester={role:'Solicitor',permissions:[]};
  assert.deepEqual(UMA_PROCESSES.filter(item=>canStartUmaProcess(item,requester)).map(item=>item.code),['A1','A2','B','C','M','E']);
  assert.equal(canStartUmaProcess(UMA_PROCESSES[4], requester),false);
  assert.equal(canStartUmaProcess(UMA_PROCESSES[6], requester),false);
});

test('Treasury can initiate D, HR can initiate H, read-only users cannot initiate any', () => {
  const byCode=code=>UMA_PROCESSES.find(item=>item.code===code);
  assert.equal(canStartUmaProcess(byCode('D'),{role:'Treasury'}),true);
  assert.equal(canStartUmaProcess(byCode('H'),{role:'HumanResources'}),true);
  for(const process of UMA_PROCESSES) {
    assert.equal(canStartUmaProcess(process,{role:'Auditor',permissions:[]}),false);
    assert.equal(canStartUmaProcess(process,{role:'Solicitor'},true),false);
  }
});

test('legacy A1/B/C are preselected without changing SUNAT or submission APIs', () => {
  assert.deepEqual(requestFlowFromProcess('A1'),{flowType:'A1',requestType:'OPEX'});
  assert.deepEqual(requestFlowFromProcess('B'),{flowType:'B',requestType:'OPEX'});
  assert.deepEqual(requestFlowFromProcess('C'),{flowType:'C',requestType:'ENTREGA_RENDIR'});
  assert.equal(requestFlowFromProcess('E'),null);
  assert.equal(processDestination('A2'),'/batch-invoices');
  const src=fs.readFileSync(new URL('../src/pages/RequestCreate.jsx',import.meta.url),'utf8');
  assert.match(src, /<InvoiceDropZone/);
  assert.match(src, /<SupplierQuickRegister/);
  assert.match(src, /\/requests\/invoice-preview/);
});

test('entry uses the chooser while existing work drafts still open',()=>{
 const app=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
 const chooser=fs.readFileSync(new URL('../src/pages/RequestProcessSelection.jsx',import.meta.url),'utf8');
 assert.match(app,/path="requests\/new"/);
 assert.match(app,/path="form" element=\{<RequestCreate/);
 assert.match(chooser,/params\.has\('workDraft'\)/);
 assert.match(chooser,/canStartUmaProcess/);
});
