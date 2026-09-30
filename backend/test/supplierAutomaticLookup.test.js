import test from "node:test";
import assert from "node:assert/strict";
import { consultaProfileFromFields } from "../src/services/sunatConsultaRucRepresentativesService.js";
import { getSupplierAutomaticPrefill, classifyConsultaFailure } from "../src/services/supplierPadronLookupService.js";
const ruc = "20550807123";
const fields = { "NUMERO DE RUC": `${ruc} - TEST UNIVERSITY`, "NOMBRE COMERCIAL": "-", "DOMICILIO FISCAL": "TEST ADDRESS", "ESTADO DEL CONTRIBUYENTE": "ACTIVO", "CONDICION DEL CONTRIBUYENTE": "HABIDO" };
test("Consulta RUC returns only evidenced supplier fields and rejects mismatched identities", () => {
 const profile = consultaProfileFromFields(ruc, fields);
 assert.equal(profile.data.legalName, "TEST UNIVERSITY");
 assert.equal(profile.data.fiscalAddress, "TEST ADDRESS");
 assert.equal(profile.data.commercialName, "");
 assert.equal(profile.data.eligibleForHomologation, true);
 assert.equal(profile.data.bankAccounts, undefined);
 assert.throws(() => consultaProfileFromFields("20111111111", fields), /mismatched/);
 assert.equal(consultaProfileFromFields(ruc, {...fields, "ESTADO DEL CONTRIBUYENTE": "BAJA DEFINITIVA"}).data.eligibleForHomologation, false);
});
test("Consulta RUC is primary; a negative taxpayer status is never replaced by a positive fallback", async () => {
 const profile=consultaProfileFromFields(ruc, {...fields, "CONDICION DEL CONTRIBUYENTE": "NO HABIDO"});
 const result=await getSupplierAutomaticPrefill(ruc,{consulta:async()=>profile,padron:async()=>assert.fail("Must not consult fallback")});
 assert.equal(result.data.habido,false);
});
test("Website outage falls back to Padron and preserves its evidence and missing results", async () => {
 for(const found of [true,false]) {
 const result=await getSupplierAutomaticPrefill(ruc,{consulta:async()=>{throw new Error("Timeout or challenge");},padron:async()=>({found,source:"SUNAT_PUBLIC_PADRON_RUC",datasetDate:"2026-09-30"})});
 assert.equal(result.found,found);assert.equal(result.fallback,true);assert.equal(result.datasetDate,"2026-09-30");
 }
 await assert.rejects(getSupplierAutomaticPrefill(ruc,{consulta:async()=>{throw new Error("Unavailable");},padron:async()=>{throw new Error("Dataset unavailable");}}),/Padrón fallback is also unavailable/);
});

test("Consulta RUC keeps inactive status separate from its closure date", () => {
 const result = consultaProfileFromFields(ruc, {...fields, "ESTADO DEL CONTRIBUYENTE": "BAJA DE OFICIO Fecha de Baja: 31/03/2014"});
 assert.equal(result.data.taxpayerStatus, "BAJA DE OFICIO");
 assert.equal(result.data.active, false);
 assert.equal(result.data.eligibleForHomologation, false);
});

test("Deployment failures stay actionable without leaking internal paths", async () => {
 const secret = "Executable doesn't exist at /private/server/browser";
 assert.equal(classifyConsultaFailure(new Error(secret)).code, "CONSULTA_BROWSER_MISSING");
 await assert.rejects(getSupplierAutomaticPrefill(ruc, {
  consulta: async () => { throw new Error(secret); },
  padron: async () => { throw new Error("private storage path"); }
 }), error => error.statusCode === 503 && error.details.requiresConfiguration && !error.message.includes("/private"));
 assert.equal(classifyConsultaFailure(new Error("HTTP 403")).code, "CONSULTA_ACCESS_RESTRICTED");
 assert.equal(classifyConsultaFailure(new Error("Target page has been closed")).code, "CONSULTA_TIMEOUT");
});
