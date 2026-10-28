// Exercise the real browser automation with intercepted SUNAT pages; no external traffic.
import assert from "node:assert/strict";
import { getSunatConsultaBrowser, closeSunatRepresentativesBrowser, lookupSunatTaxpayerProfile, lookupSunatLegalRepresentatives } from "../src/services/sunatConsultaRucRepresentativesService.js";
const browser = await getSunatConsultaBrowser();
const newContext = browser.newContext.bind(browser);
let contexts = 0, fixture;
browser.newContext = async (...args) => {
  contexts++;
  const context = await newContext(...args);
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    let body;
    if (url.pathname.endsWith("/result")) {
      assert.equal(url.searchParams.get("search1"), fixture.ruc, "automation types the requested RUC");
      body = [["Número de RUC:", `${fixture.ruc} - TEST COMPANY`], ["Estado del Contribuyente:", "ACTIVO"], ["Condición del Contribuyente:", "HABIDO"], ["Domicilio Fiscal:", "TEST ADDRESS"]]
        .map(([key,value]) => `<div class="list-group-item"><div><h4>${key}</h4></div><div>${value}</div></div>`).join("");
      if (!fixture.missingRepresentatives) body += '<a href="/representatives">Representantes Legales</a>';
    } else if (url.pathname === "/representatives") {
      body = `<h1>REPRESENTANTES LEGALES DE ${fixture.ruc} - TEST COMPANY</h1><table><tr><th>Documento</th><th>Número</th><th>Nombre</th><th>Cargo</th><th>Fecha</th></tr><tr><td>DNI</td><td>01234567</td><td>TEST REPRESENTATIVE</td><td>GERENTE</td><td>01/01/2024</td></tr></table>`;
    } else body = '<form action="/result"><input name="search1" placeholder="Ingrese RUC"><button>Buscar</button></form>';
    await route.fulfill({ contentType: "text/html; charset=utf-8", body });
  });
  return context;
};
try {
  fixture = { ruc: "20519147247" };
  const profile = await lookupSunatTaxpayerProfile(fixture.ruc);
  assert.equal(profile.data.legalName, "TEST COMPANY");
  assert.equal(profile.data.taxpayerStatus, "ACTIVO");
  assert.equal(profile.data.domicileCondition, "HABIDO");
  assert.equal(profile.representativesLookup.data.representatives[0].fullName, "TEST REPRESENTATIVE");
  assert.equal(contexts, 1, "profile and representatives are read in the same browser session");
  const representatives = await lookupSunatLegalRepresentatives(fixture.ruc, "TEST COMPANY");
  assert.equal(representatives.representatives[0].documentNumber, "01234567");
  assert.equal(contexts, 1, "subsequent representative request reuses server-read evidence");
  fixture = { ruc: "20100053455", missingRepresentatives: true };
  const partial = await lookupSunatTaxpayerProfile(fixture.ruc);
  assert.equal(partial.data.fiscalAddress, "TEST ADDRESS");
  assert.ok(partial.representativesLookup.error);
  assert.equal(partial.representativesLookup.data, undefined, "failure must not become an empty successful representative result");
  console.log("PASS automatic Consulta RUC: type RUC, search, extract profile, open representatives, same-session extraction/cache, partial failure.");
} finally {
  browser.newContext = newContext;
  await closeSunatRepresentativesBrowser();
}
