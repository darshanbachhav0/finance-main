// Deterministic browser regression: no requests are sent to SUNAT.
import assert from "node:assert/strict";
import { getSunatConsultaBrowser, closeSunatRepresentativesBrowser, waitForRucResult, extractConsultaFields, consultaProfileFromFields } from "../src/services/sunatConsultaRucRepresentativesService.js";
import { readAssistedConsultaPage } from "../src/services/sunatAssistedLookupService.js";
import { lookupSunatTaxpayerProfile } from "../src/services/sunatConsultaRucRepresentativesService.js";

const ruc = "20550807123";
try {
  const browser = await getSunatConsultaBrowser();
  const page = await browser.newPage();
  await page.setContent(`<body>Consulta RUC <span>${ruc}</span><button>Buscar</button></body>`);
  let resolved = false;
  const result = waitForRucResult(page, ruc).then(() => { resolved = true; });
  await page.evaluate(async () => {
    await new Promise(resolve => setTimeout(resolve, 150));
  });
  assert.equal(resolved, false, "an echoed RUC is not a taxpayer profile");
  await page.evaluate(ruc => {
    document.body.innerHTML = [
      ["Número de RUC:", `${ruc} - TEST UNIVERSITY`],
      ["Estado del Contribuyente:", "ACTIVO"],
      ["Condición del Contribuyente:", "HABIDO"]
    ].map(([label, value]) => `<div class="list-group-item"><div><h4>${label}</h4></div><div>${value}</div></div>`).join("");
  }, ruc);
  await result;
  const profile = consultaProfileFromFields(ruc, await extractConsultaFields(page));
  assert.equal(profile.data.legalName, "TEST UNIVERSITY");
  assert.equal(profile.data.eligibleForHomologation, true);
  await page.setContent(`<body>El número de RUC ${ruc} consultado no es válido.</body>`);
  await waitForRucResult(page, ruc);
  await page.setContent("<body>Verify you are human</body>");
  await assert.rejects(waitForRucResult(page, ruc), /human verification/);
  await page.setContent("<body>Servicio no disponible</body>");
  await assert.rejects(waitForRucResult(page, ruc), /unavailable/);
  // An interactive challenge fixture stays untouched until the test operator
  // supplies the ordinary form. The service does not solve or click challenges.
  await page.setContent("<body>Verify you are human</body>");
  let assistedDone = false;
  const assisted = readAssistedConsultaPage(page, ruc, { timeout: 5000 }).then(result => { assistedDone = true; return result; });
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
  assert.equal(assistedDone, false);
  await page.evaluate(ruc => {
    document.body.innerHTML = '<input name="search1" placeholder="Ingrese RUC"><button>Buscar</button>';
    document.querySelector("button").addEventListener("click", () => {
      document.body.innerHTML = [["Número de RUC:", `${ruc} - ASSISTED UNIVERSITY`], ["Estado del Contribuyente:", "ACTIVO"], ["Condición del Contribuyente:", "HABIDO"]]
        .map(([label, value]) => `<div class="list-group-item"><div><h4>${label}</h4></div><div>${value}</div></div>`).join("");
    });
  }, ruc);
  const verified = await assisted;
  assert.equal(verified.assisted, true);
  assert.equal(verified.data.legalName, "ASSISTED UNIVERSITY");
  assert.equal(verified.data.eligibleForHomologation, true);
  assert.equal((await lookupSunatTaxpayerProfile(ruc)).data.legalName, "ASSISTED UNIVERSITY", "subsequent supplier validation uses the server-read evidence");
  await page.evaluate(() => {
    document.body.innerHTML = '<input name="search1"><button>Buscar</button>';
    document.querySelector("button").addEventListener("click", () => {
      document.body.innerHTML = '<div class="list-group-item"><div><h4>Número de RUC:</h4></div><div>20111111111 - DIFFERENT COMPANY</div></div>';
    });
  });
  await assert.rejects(readAssistedConsultaPage(page, ruc, { timeout: 5000 }), /mismatched/, "a different RUC can never verify the requested supplier");
  await page.evaluate(ruc => {
    document.body.innerHTML = '<input name="search1"><button>Buscar</button>';
    document.querySelector("button").addEventListener("click", () => {
      document.body.innerText = `El número de RUC ${ruc} consultado no es válido.`;
    });
  }, ruc);
  assert.equal((await readAssistedConsultaPage(page, ruc, { timeout: 5000 })).found, false);
  console.log("PASS Consulta RUC browser: delayed result, real DOM extraction, not found, challenge and outage.");
} finally {
  await closeSunatRepresentativesBrowser();
}
