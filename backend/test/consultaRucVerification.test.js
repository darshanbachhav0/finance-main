import assert from "node:assert/strict";
import test from "node:test";
import Supplier from "../src/models/Supplier.js";
import { sunatProviderMode, usesConsultaRucOnly, usesPublicPadron } from "../src/config/sunatMode.js";
import { ConsultaRucSunatProvider } from "../src/integrations/sunat/ConsultaRucSunatProvider.js";
import { consultaNotFoundProfile, consultaProfileFromFields, consultaRucNotRegistered } from "../src/services/sunatConsultaRucRepresentativesService.js";
import { getSunatProvider, usesAutomaticTaxpayerLookup } from "../src/services/sunatService.js";
import { automaticTaxpayerResult } from "../src/services/supplierService.js";
import { getSupplierAutomaticPrefill } from "../src/services/supplierPadronLookupService.js";
import { cachedTaxpayerProfile } from "../src/services/taxpayerProfileCache.js";
import { ERROR_CODES } from "../src/utils/constants.js";

const ruc = "20550807123";
// UMA's own SUNAT Consulta RUC result, as extractConsultaFields reads the page (tables are lists).
const umaFields = {
  "NUMERO DE RUC": `${ruc} - UNIVERSIDAD MARIA AUXILIADORA S.A.C.`,
  "TIPO CONTRIBUYENTE": "SOCIEDAD ANONIMA CERRADA",
  "NOMBRE COMERCIAL": "-",
  "FECHA DE INSCRIPCION": "13/12/2012",
  "FECHA DE INICIO DE ACTIVIDADES": "02/01/2013",
  "ESTADO DEL CONTRIBUYENTE": "ACTIVO",
  "CONDICION DEL CONTRIBUYENTE": "HABIDO",
  "DOMICILIO FISCAL": "AV. CANTO BELLO NRO. 431 URB. CANTO BELLO LIMA - LIMA - SAN JUAN DE LURIGANCHO",
  "SISTEMA EMISION DE COMPROBANTE": "MANUAL",
  "ACTIVIDAD COMERCIO EXTERIOR": "SIN ACTIVIDAD",
  "SISTEMA CONTABILIDAD": "MANUAL/COMPUTARIZADO",
  "ACTIVIDAD(ES) ECONOMICA(S)": ["Principal - 8530 - ENSEÑANZA SUPERIOR"],
  "COMPROBANTES DE PAGO C/AUT. DE IMPRESION (F. 806 U 816)": ["FACTURA", "BOLETA DE VENTA"],
  "SISTEMA DE EMISION ELECTRONICA": ["FACTURA PORTAL DESDE 06/07/2024", "BOLETA PORTAL DESDE 31/03/2019", "DESDE LOS SISTEMAS DEL CONTRIBUYENTE. AUTORIZ DESDE 28/02/2019"],
  "EMISOR ELECTRONICO DESDE": "28/02/2019",
  "COMPROBANTES ELECTRONICOS": "FACTURA (desde 28/02/2019),BOLETA (desde 28/02/2019)",
  "AFILIADO AL PLE DESDE": "01/01/2015",
  "PADRONES": ["NINGUNO"]
};
const unavailable = () => Object.assign(new Error("Unavailable"), { statusCode: 503 });

test("PADRON is the default source; website and MOCK require explicit selection", () => {
  assert.equal(sunatProviderMode({}), "PADRON");
  assert.equal(sunatProviderMode({ SUNAT_PROVIDER_MODE: " consulta-ruc " }), "CONSULTA_RUC");
  for (const alias of ["PADRON", "public_padron", "PUBLIC-PADRON"]) assert.equal(sunatProviderMode({ SUNAT_PROVIDER_MODE: alias }), "PADRON");
  assert.equal(sunatProviderMode({ SUNAT_PROVIDER_MODE: "MOCK" }), "MOCK");
  assert.equal(usesConsultaRucOnly({}), false);
  assert.equal(usesPublicPadron({}), true);
  assert.equal(usesPublicPadron({ SUNAT_PROVIDER_MODE: "PADRON" }), true);

  const provider = getSunatProvider("");
  assert.deepEqual([provider.mode, provider.variant, provider.source, provider.configured], ["PRODUCTION", "PADRON", "SUNAT_PUBLIC_PADRON_RUC", true]);
  assert.equal(provider.capabilities.voucherExistence, false);
  assert.equal(getSunatProvider("MOCK").mode, "MOCK");
  assert.equal(getSunatProvider("PADRON").variant, "PADRON");
  assert.equal(usesAutomaticTaxpayerLookup({ variant: "CONSULTA_RUC" }), true);
  assert.equal(usesAutomaticTaxpayerLookup({ variant: "PADRON" }), true);
  assert.equal(usesAutomaticTaxpayerLookup({ mode: "MOCK" }), false);
});

test("the whole Consulta RUC result page is read: every field SUNAT shows", () => {
  const { data } = consultaProfileFromFields(ruc, umaFields);
  assert.equal(data.legalName, "UNIVERSIDAD MARIA AUXILIADORA S.A.C.");
  assert.equal(data.commercialName, "", "a dash means none");
  assert.deepEqual([data.taxpayerStatus, data.domicileCondition, data.active, data.habido, data.eligibleForHomologation], ["ACTIVO", "HABIDO", true, true, true]);
  assert.deepEqual([data.registrationDate, data.activityStartDate, data.deregistrationDate], ["2012-12-13", "2013-01-02", ""]);
  assert.equal(data.taxpayerType, "SOCIEDAD ANONIMA CERRADA");
  assert.equal(data.voucherIssuanceSystem, "MANUAL");
  assert.equal(data.foreignTradeActivity, "SIN ACTIVIDAD");
  assert.equal(data.accountingSystem, "MANUAL/COMPUTARIZADO");
  assert.deepEqual(data.economicActivities, [{ kind: "Principal", code: "8530", description: "ENSEÑANZA SUPERIOR" }]);
  assert.deepEqual(data.printedVoucherTypes, ["FACTURA", "BOLETA DE VENTA"]);
  assert.equal(data.electronicIssuanceSystems.length, 3);
  assert.equal(data.electronicIssuerSince, "2019-02-28");
  assert.deepEqual(data.electronicVouchers, ["FACTURA (desde 28/02/2019)", "BOLETA (desde 28/02/2019)"]);
  assert.equal(data.pleAffiliationDate, "2015-01-01");
  assert.deepEqual(data.registries, [], "Padrones: NINGUNO");
  // A field the page leaves out stays out; nothing is invented.
  const minimal = consultaProfileFromFields(ruc, { "NUMERO DE RUC": umaFields["NUMERO DE RUC"], "ESTADO DEL CONTRIBUYENTE": "ACTIVO", "CONDICION DEL CONTRIBUYENTE": "NO HABIDO" }).data;
  assert.deepEqual([minimal.taxpayerType, minimal.economicActivities, minimal.electronicIssuerSince, minimal.registries, minimal.eligibleForHomologation], ["", [], "", [], false]);
});

test("a RUC SUNAT does not have is an official 'not found', not an outage", () => {
  const page = "Consulta RUC Resultado de la Búsqueda El número de RUC 20999999990 consultado no es válido. Debe verificar el número y volver a ingresar.";
  assert.equal(consultaRucNotRegistered(page, "20999999990"), true);
  assert.equal(consultaRucNotRegistered(page, ruc), false, "only for the RUC asked");
  assert.equal(consultaRucNotRegistered("Número de RUC: 20550807123 - UNIVERSIDAD", ruc), false);
  assert.deepEqual(Object.keys(consultaNotFoundProfile("20999999990")).sort(), ["found", "message", "officialSource", "queriedAt", "ruc", "source"]);
  assert.equal(consultaNotFoundProfile("20999999990").found, false);
});

test("Consulta RUC verification: valid only for ACTIVO/HABIDO; never a voucher", async () => {
  const profile = (overrides = {}) => async () => ({ ...consultaProfileFromFields(ruc, { ...umaFields, ...overrides }), cacheExpiresAt: undefined });
  const valid = await new ConsultaRucSunatProvider({ lookupProfile: profile() }).validateTaxpayer(ruc);
  assert.deepEqual([valid.valid, valid.official, valid.source, valid.returnedLegalName], [true, true, "SUNAT_CONSULTA_RUC", "UNIVERSIDAD MARIA AUXILIADORA S.A.C."]);
  const notHabido = await new ConsultaRucSunatProvider({ lookupProfile: profile({ "CONDICION DEL CONTRIBUYENTE": "NO HABIDO" }) }).validateTaxpayer(ruc);
  assert.deepEqual([notHabido.valid, notHabido.condition], [false, "NO HABIDO"]);
  const missing = await new ConsultaRucSunatProvider({ lookupProfile: async () => consultaNotFoundProfile(ruc) }).validateTaxpayer(ruc);
  assert.deepEqual([missing.valid, missing.status], [false, "NO_ENCONTRADO"]);
  const dni = await new ConsultaRucSunatProvider({ lookupProfile: () => assert.fail("a DNI is not looked up") }).validateTaxpayer("44556677");
  assert.deepEqual([dni.valid, dni.status], [false, "RUC_INVALIDO"]);
  await assert.rejects(new ConsultaRucSunatProvider({ lookupProfile: async () => { throw unavailable(); } }).validateTaxpayer(ruc), (error) => error.statusCode === 503, "SUNAT unreachable is never 'valid'");

  const voucher = await new ConsultaRucSunatProvider({ lookupProfile: profile() }).validateVoucher({ ruc, series: "F001", number: "123" });
  assert.deepEqual([voucher.valid, voucher.voucherVerified, voucher.status, voucher.taxpayer.valid], [false, false, "COMPROBANTE_NO_VERIFICADO", true]);
  const inactive = await new ConsultaRucSunatProvider({ lookupProfile: profile({ "ESTADO DEL CONTRIBUYENTE": "BAJA DEFINITIVA" }) }).validateVoucher({ ruc, series: "F001", number: "1" });
  assert.equal(inactive.status, "RUC_BAJA DEFINITIVA");
  await assert.rejects(new ConsultaRucSunatProvider().getSellingExchangeRate({ date: "2026-10-26" }), (error) => error.code === ERROR_CODES.EXCHANGE_RATE_MISSING);
});

test("Consulta RUC only: no Padrón fallback when SUNAT is unreachable", async () => {
  const padron = () => assert.fail("Consulta RUC mode never reads the Padrón");
  await assert.rejects(getSupplierAutomaticPrefill(ruc, { consultaOnly: true, consulta: async () => { throw new Error("Timeout waiting for result"); }, padron }),
    (error) => error.statusCode === 503 && error.details.consultaFailure === "CONSULTA_TIMEOUT" && error.message === "Consulta RUC did not respond within the lookup time limit.");
  await assert.rejects(getSupplierAutomaticPrefill(ruc, { consultaOnly: true, consulta: async () => { throw new Error("SUNAT is requesting interactive human verification on Consulta RUC."); }, padron }),
    (error) => error.details.consultaFailure === "CONSULTA_ACCESS_RESTRICTED", "human verification is reported, never bypassed");
  const missing = await getSupplierAutomaticPrefill(ruc, { consultaOnly: true, consulta: async () => consultaNotFoundProfile(ruc), padron });
  assert.equal(missing.found, false);
  assert.equal(missing.fallback, undefined);
});

test("SUNAT's 'not found' is returned but never cached as evidence", async () => {
  const model = { findById: () => ({ lean: async () => null }), updateOne: () => assert.fail("not cached") };
  const result = await cachedTaxpayerProfile(ruc, async () => consultaNotFoundProfile(ruc), { model });
  assert.deepEqual([result.found, result.cached], [false, false]);
  await assert.rejects(cachedTaxpayerProfile(ruc, async () => ({ found: false, ruc, source: "MOCK" }), { model }), (error) => error.statusCode === 503, "only SUNAT's own answer");
});

test("the supplier keeps the Consulta RUC profile it was verified on", async () => {
  const result = automaticTaxpayerResult(consultaProfileFromFields(ruc, umaFields));
  assert.equal(result.valid, true);
  assert.equal(result.sunat.taxpayerType, "SOCIEDAD ANONIMA CERRADA");
  assert.deepEqual(result.sunat.economicActivities, [{ kind: "Principal", code: "8530", description: "ENSEÑANZA SUPERIOR" }]);
  assert.deepEqual(result.sunat.registries, [], "'NINGUNO' is kept as an answer");
  assert.equal(result.sunat.electronicIssuerSince, "2019-02-28");
  assert.equal(result.sunat.commercialName, undefined, "supplier fields are not duplicated here");
  // Padrón evidence has none of these fields, so none are stored.
  const padron = automaticTaxpayerResult({ found: true, officialSource: true, source: "SUNAT_PUBLIC_PADRON_RUC", datasetDate: "2026-10-20", data: { rucDni: ruc, legalName: "UMA", taxpayerStatus: "ACTIVO", domicileCondition: "HABIDO", active: true, habido: true } });
  assert.deepEqual(["taxpayerType", "economicActivities", "registries"].filter((key) => key in padron.sunat), []);

  const supplier = new Supplier({ rucDni: ruc, legalName: "UNIVERSIDAD MARIA AUXILIADORA S.A.C.", name: "UNIVERSIDAD MARIA AUXILIADORA S.A.C.", taxpayerValidation: { status: "VALID", sunat: result.sunat } });
  await supplier.validate();
  const stored = supplier.toObject().taxpayerValidation.sunat;
  assert.deepEqual(stored.economicActivities, [{ kind: "Principal", code: "8530", description: "ENSEÑANZA SUPERIOR" }]);
  assert.deepEqual([stored.accountingSystem, stored.pleAffiliationDate, stored.printedVoucherTypes.length], ["MANUAL/COMPUTARIZADO", "2015-01-01", 2]);
});
