import test from 'node:test';
import assert from 'node:assert/strict';
import {computeMobility,computeHonoraria,validateStudentRefund,validateSpecialExpense} from '../../shared/umaSpecialRules.mjs';
test('UMA movilidad aggregates the cap by day, not by trip',()=>{
 const result=computeMobility([{date:'2026-10-20',reason:'Visita',amount:30},{date:'2026-10-20',reason:'Retorno',amount:30}]);
 assert.equal(result.gross,60);assert.equal(result.nondeductible,10.8);assert.equal(result.deductible,49.2);
});
test('UMA honorarios withholds above 1500 and protects duplicates',()=>{
 const r=computeHonoraria([{teacher:'Ana',receipt:'E001-15',amount:2000}]);
 assert.equal(r.withholding,160);assert.equal(r.net,1840);
 assert.throws(()=>computeHonoraria([{teacher:'Ana',receipt:'E001-15',amount:2000},{teacher:'Ana',receipt:'E001-15',amount:2000}]),/duplicado/);
});
test('UMA student refund paid by card requires gateway reversal',()=>{
 const r=validateStudentRefund({studentCode:'AL-23',reason:'Pago en exceso',evidenceNumber:'LIB-7',concept:'704101',paymentMethod:'CARD',amount:120,incomeChecked:true});
 assert.equal(r.paymentRoute,'GATEWAY_REVERSAL');
 assert.throws(()=>validateSpecialExpense('E',{...r,incomeChecked:false}),/obligatorios/);
});
test('Invalid mobility dates and money rejected',()=>{
 assert.throws(()=>computeMobility([{date:'2026-02-30',reason:'test',amount:5}]),/Trayecto/);
 assert.throws(()=>computeHonoraria([{teacher:'B',receipt:'E001-5',amount:-5}]),/Recibo/);
});
