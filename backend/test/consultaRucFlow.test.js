import test from "node:test";
import assert from "node:assert/strict";
import { consultaRucPageState, CONSULTA_RUC_URL } from "../../shared/consultaRuc.mjs";
import { getSupplierAutomaticPrefill } from "../src/services/supplierPadronLookupService.js";
import { assistedConsultaAvailable, lookupAssistedConsultaRuc } from "../src/services/sunatAssistedLookupService.js";
import { usesPadronFallback, usesConsultaRucOnly, usesPublicPadronData } from "../src/config/sunatMode.js";
import { inProcessWorkerFlags } from "../src/workers/inProcessWorkers.js";

const ruc = "20550807123";
test("official Padrón fallback is an explicit opt-in and enables its refresh worker", () => {
  const env = { SUNAT_PROVIDER_MODE: "CONSULTA_RUC", SUNAT_CONSULTA_RUC_PADRON_FALLBACK: "true", SUNAT_PADRON_WORKER_ENABLED: "true" };
  assert.equal(usesPadronFallback(env), true);
  assert.equal(usesConsultaRucOnly(env), false);
  assert.equal(usesPublicPadronData(env), true);
  assert.equal(inProcessWorkerFlags(env).padron, true);
  assert.equal(usesPadronFallback({}), false);
  assert.equal(usesConsultaRucOnly({}), false);
  assert.equal(usesPublicPadronData({}), true);
  assert.equal(usesPadronFallback({ ...env, SUNAT_PROVIDER_MODE: "MOCK" }), false);
});

test("blocked Consulta RUC uses only the official fallback result and retains its dataset date", async () => {
  const result = await getSupplierAutomaticPrefill(ruc, {
    consultaOnly: false,
    consulta: async () => { throw new Error("HTTP 403"); },
    padron: async () => ({ found: true, ruc, source: "SUNAT_PUBLIC_PADRON_RUC", officialSource: true, datasetDate: "2026-10-27", data: { rucDni: ruc, legalName: "UNIVERSITY", active: false, habido: true } })
  });
  assert.equal(result.source, "SUNAT_PUBLIC_PADRON_RUC");
  assert.equal(result.fallback, true);
  assert.equal(result.datasetDate, "2026-10-27");
  assert.equal(result.data.active, false, "an inactive taxpayer is never upgraded by the fallback");
});
test("assisted SUNAT opens only for a local Windows development connection", () => {
  const req = { socket: { remoteAddress: "::ffff:127.0.0.1" } };
  assert.equal(assistedConsultaAvailable(req, { platform: "win32", env: {} }), true);
  assert.equal(assistedConsultaAvailable(req, { platform: "win32", env: { NODE_ENV: "production" } }), false);
  assert.equal(assistedConsultaAvailable(req, { platform: "win32", env: { RENDER: "true" } }), false);
  assert.equal(assistedConsultaAvailable(req, { platform: "linux", env: {} }), false);
  assert.equal(assistedConsultaAvailable({ socket: { remoteAddress: "192.168.5.20" }, headers: { "x-forwarded-for": "127.0.0.1" } }, { platform: "win32", env: {} }), false);
});

test("a cancelled assisted verification never launches a browser or invents evidence", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(lookupAssistedConsultaRuc(ruc, { signal: controller.signal, launchBrowser: () => assert.fail("cancelled") }), error => error.statusCode === 409);
  await assert.rejects(lookupAssistedConsultaRuc("123", { launchBrowser: () => assert.fail("invalid RUC") }), error => error.statusCode === 422);
});

test("an assisted browser failure closes its resources and exposes only a sanitized error", async () => {
  let browserClosed = false, contextClosed = false;
  const browser = {
    close: async () => { browserClosed = true; },
    newContext: async () => ({
      close: async () => { contextClosed = true; },
      newPage: async () => ({ goto: async () => { throw new Error("Private browser path C:/secret/internal"); } })
    })
  };
  await assert.rejects(lookupAssistedConsultaRuc(ruc, { launchBrowser: async () => browser }), error => error.statusCode === 503 && !error.message.includes("secret"));
  assert.equal(browserClosed, true);
  assert.equal(contextClosed, true);
});
test("Consulta RUC waits for a result, not an echoed search value or verification label", () => {
  assert.equal(consultaRucPageState({ bodyText: `Consulta RUC Buscar ${ruc}`, ruc }), "");
  assert.equal(consultaRucPageState({ bodyText: `Número de RUC: ${ruc} - UNIVERSIDAD\nEstado del Contribuyente: ACTIVO`, ruc }), "PROFILE");
  assert.equal(consultaRucPageState({ bodyText: `El número de RUC ${ruc} consultado no es válido.`, ruc }), "NOT_FOUND");
  assert.equal(consultaRucPageState({ bodyText: "Verificación de datos", ruc }), "");
  for (const bodyText of ["Just a moment...", "Verify you are human", "Verificación humana", "No soy un robot"]) {
    assert.equal(consultaRucPageState({ bodyText, ruc }), "CHALLENGE");
  }
  assert.equal(consultaRucPageState({ bodyText: "Servicio no disponible", ruc }), "UNAVAILABLE");
});

test("restricted Consulta RUC remains unverified and returns the official website without endless retries", async () => {
  await assert.rejects(getSupplierAutomaticPrefill(ruc, {
    consultaOnly: true,
    consulta: async () => { throw new Error("SUNAT requested interactive human verification on Consulta RUC."); },
    padron: () => assert.fail("Consulta RUC must be the only source")
  }), error => error.code === "CONSULTA_ACCESS_RESTRICTED" && error.statusCode === 503
    && error.details.retryable === false && error.details.consultaUrl === CONSULTA_RUC_URL);
});
