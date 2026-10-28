import test from 'node:test';import assert from 'node:assert/strict';
import {validateInvestment,concentrationAfter} from '../../shared/umaInvestmentRules.mjs';
test('UMA investment honors 360 day maximum and calculates expected yield',()=>{
 const x=validateInvestment({institution:'Banco Uno',currency:'PEN',principal:10000,annualRate:7.2,startDate:'2026-01-01',maturityDate:'2026-06-30'});
 assert.equal(x.days,180);assert.equal(x.estimatedInterest,360);
 assert.throws(()=>validateInvestment({...x,startDate:'2026-01-01',maturityDate:'2027-01-15'}),/360/);
});
test('UMA investment concentrates institutions by currency',()=>{
 const c=concentrationAfter([{institution:'Banco Uno',currency:'PEN',principal:10000,status:'ACTIVE'}],{institution:'Banco Dos',currency:'PEN',principal:10000,status:'ACTIVE'});
 assert.equal(c.share,.5);
});
