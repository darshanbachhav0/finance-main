import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

// Drives the real Consulta RUC scraper (headless Chromium) against simulated SUNAT pages: the
// result page as SUNAT serves it since Oct 2026 ("Representante(s) Legal(es)" in form formRepLeg),
// and the security check SUNAT may put in front of the representatives page.
// Run: npm run test:sunat-representatives --workspace backend (needs Playwright's Chromium).

const page = (body) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Consulta RUC</title></head><body>${body}</body></html>`;

const home = page(`<form name="selecXNroRuc" method="post" action="/cl-ti-itmrconsruc/jcrS00Alias">
  <input type="hidden" name="accion" value="consPorRuc"><input type="text" name="search1" id="txtRuc">
  <input type="hidden" name="nroRuc" id="nroRuc"><button type="button" id="btnAceptar">Buscar</button></form>
  <script>document.getElementById("btnAceptar").addEventListener("click", function () { document.getElementById("nroRuc").value = document.getElementById("txtRuc").value; document.forms.selecXNroRuc.submit(); });</script>`);

const result = (ruc, name) => page(`<h4>Resultado de la Búsqueda</h4>
  <div class="list-group"><h4>Número de RUC:</h4><h4>${ruc} - ${name}</h4><h4>Estado del Contribuyente:</h4><p>ACTIVO</p><h4>Condición del Contribuyente:</h4><p>HABIDO</p></div>
  <form name="formRepLeg" method="post" action="/cl-ti-itmrconsruc/jcrS00Alias">
    <button type="button" class="btn btn-primary btn-sm btnInfRepLeg">Representante(s) Legal(es)</button>
    <input type="hidden" name="accion" value="getRepLeg"><input type="hidden" name="contexto" value="ti-it"><input type="hidden" name="modo" value="1">
    <input type="hidden" name="desRuc" value="${name}"><input type="hidden" name="nroRuc" value="${ruc}">
  </form>
  <script>document.querySelector(".btnInfRepLeg").addEventListener("click", function () { document.forms.formRepLeg.submit(); });</script>`);

const representatives = (ruc, name) => page(`<h4>Representantes Legales de ${ruc} - ${name}</h4>
  <table><thead><tr><th>Documento</th><th>Nro. Documento</th><th>Nombre</th><th>Cargo</th><th>Fecha Desde</th></tr></thead>
  <tbody><tr><td>DNI</td><td>08123456</td><td>QUISPE ROJAS ANA MARIA</td><td>GERENTE GENERAL</td><td>01/03/2019</td></tr></tbody></table>`);

const securityCheck = page(`<h1>e-consultaruc.sunat.gob.pe</h1><h2>Verificación de seguridad en curso</h2>
  <p>Este sitio web utiliza un servicio de seguridad para protegerse contra bots maliciosos.</p><p>Rendimiento y seguridad de Cloudflare</p>`);

const NAME = "COMERCIAL ANDINA SAC";
const CHECKED_RUC = "20111111111";

function readBody(req) {
  return new Promise((resolve) => { let data = ""; req.on("data", (chunk) => { data += chunk; }); req.on("end", () => resolve(new URLSearchParams(data))); });
}

test("SUNAT legal representatives: the current Consulta RUC page is read, and a security check stops at once", { timeout: 120000 }, async (t) => {
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (req.method === "GET") return res.end(home);
    const form = await readBody(req);
    const ruc = form.get("nroRuc");
    if (form.get("accion") === "getRepLeg") return res.end(ruc === CHECKED_RUC ? securityCheck : representatives(ruc, form.get("desRuc")));
    return res.end(result(ruc, NAME));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.SUNAT_CONSULTA_RUC_URL = `http://127.0.0.1:${server.address().port}/cl-ti-itmrconsruc/FrameCriterioBusquedaWeb.jsp`;
  const { closeSunatRepresentativesBrowser, lookupSunatLegalRepresentatives } = await import("../src/services/sunatConsultaRucRepresentativesService.js");
  try {
    await t.test("the 'Representante(s) Legal(es)' button opens the representatives and they are returned", async () => {
      const found = await lookupSunatLegalRepresentatives("20100000001", NAME);
      assert.equal(found.found, true);
      assert.equal(found.ruc, "20100000001");
      assert.deepEqual(found.representatives.map((person) => [person.documentType, person.documentNumber, person.fullName, person.position]),
        [["DNI", "08123456", "QUISPE ROJAS ANA MARIA", "GERENTE GENERAL"]]);
    });

    await t.test("SUNAT's security check is reported right away, never waited out or bypassed", async () => {
      const started = Date.now();
      await assert.rejects(() => lookupSunatLegalRepresentatives(CHECKED_RUC, NAME), (error) => error.statusCode === 503 && error.details?.category === "SUNAT_REP_MANUAL_VERIFICATION");
      assert.ok(Date.now() - started < 18000, "it stops after a short grace, before the lookup's deadline");
    });
  } finally {
    await closeSunatRepresentativesBrowser();
    server.close();
    delete process.env.SUNAT_CONSULTA_RUC_URL;
  }
});
