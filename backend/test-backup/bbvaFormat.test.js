import assert from "node:assert/strict";
import test from "node:test";
import { BbvaBankFileAdapter,inspectBbvaFile } from "../src/integrations/banks/BbvaBankFileAdapter.js";
import { getBankFileAdapter } from "../src/integrations/banks/index.js";
import { bbvaSample } from "./bbvaFixtures.js";

for(const currency of ["PEN","USD"]) test(`BBVA ${currency}: supplied sample reproduced byte for byte`,async()=>{
  const {buffer,configuration,items}=await bbvaSample(currency);
  const actual=new BbvaBankFileAdapter(configuration).generateFile({currency,items});
  assert.deepEqual(actual,buffer);
  const result=inspectBbvaFile(actual);
  assert.equal(result.paymentCount,items.length);
  assert.equal(result.totalCents,currency==="PEN"?"1771190":"369470");
  assert.equal(result.headerBytes,151);assert.equal(result.detailBytes,277);
});
test("BBVA rejects invalid beneficiaries, amounts, currencies and unconfirmed configuration",async()=>{
  const {configuration,items}=await bbvaSample("PEN");
  const adapter=new BbvaBankFileAdapter(configuration);
  const generate=item=>adapter.generateFile({currency:"PEN",items:[item]});
  for(const amount of [0,-1,NaN,Infinity,1.234]) assert.throws(()=>generate({...items[0],amount}));
  assert.throws(()=>generate({...items[0],supplierIdentifier:"EMP-123"}));
  assert.throws(()=>generate({...items[0],supplierName:""}));
  assert.throws(()=>generate({...items[0],bankAccount:{...items[0].bankAccount,accountNumber:"123"}}));
  assert.throws(()=>generate({...items[1],bankAccount:{...items[1].bankAccount,cci:"123"}}));
  assert.throws(()=>adapter.generateFile({currency:"PEN",items:[items[0],{...items[0],currency:"USD"}]}));
  assert.throws(()=>new BbvaBankFileAdapter({...configuration,bbva:{...configuration.bbva,confirmed:false}}));
  assert.throws(()=>new BbvaBankFileAdapter({...configuration,bbva:{...configuration.bbva,debitAccount:""}}));
  for(const bank of ["BCP","INTERBANK","SCOTIABANK"]) assert.throws(()=>getBankFileAdapter(bank,configuration));
  const valid=adapter.generateFile({currency:"PEN",items:[items[0]]});
  const changed=Buffer.from(valid);changed.write("000002",76,"ascii");assert.throws(()=>inspectBbvaFile(changed));
  const wrongAmount=Buffer.from(valid);wrongAmount.write("000000000000001",26,"ascii");assert.throws(()=>inspectBbvaFile(wrongAmount));
});
