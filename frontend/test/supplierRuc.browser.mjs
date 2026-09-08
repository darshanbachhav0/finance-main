// Real supplier form and representative service; isolated SUNAT/API fixtures.
// No external requests or supplier writes are made by this regression suite.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";
import { lookupSunatLegalRepresentatives, closeSunatRepresentativesBrowser } from "../../backend/src/services/sunatConsultaRucRepresentativesService.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../../.tmp/supplier-ruc-ui/", import.meta.url));
const launch = chromium.launch.bind(chromium);
const previousHeadless = process.env.SUNAT_REPRESENTATIVES_HEADLESS;
process.env.SUNAT_REPRESENTATIVES_HEADLESS = "false"; // Legacy launchers must stay invisible too.
process.env.SUNAT_CONSULTA_RUC_TIMEOUT_MS = "5000";
const server = await createServer({ root, configFile: `${root}/vite.config.js`, server: { host: "127.0.0.1", port: 5188, strictPort: true }, logLevel: "error" });
let browser, serviceBrowser, page;
let launches = 0, searches = 0, transportFailure = false;
const runtimeErrors = [];
const company = "Proveedor de prueba S.A.C.";
const first = { documentType: "DNI", documentNumber: "00000001", fullName: "Representante de prueba", position: "GERENTE", dateFrom: "01/01/2026" };
const second = { ...first, documentNumber: "00000002", fullName: "Segunda representante" };

try {
  await mkdir(output, { recursive: true });
  await server.listen();
  browser = await launch({ headless: true });
  // Instrument only the service browser, checking options before it can launch.
  chromium.launch = async (options) => {
    assert.equal(options.headless, true, "The service must never open a desktop window");
    assert.equal(options.channel, "chromium");
    launches++;
    serviceBrowser = await launch(options);
    const newContext = serviceBrowser.newContext.bind(serviceBrowser);
    serviceBrowser.newContext = async (options) => {
      assert.equal(options.userAgent, "UMA-Finance/1.0 (SUNAT public RUC lookup)");
      const context = await newContext(options);
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        assert.equal(url.origin, "https://e-consultaruc.sunat.gob.pe", "Fixtures must not contact external services");
        if (transportFailure) return route.abort("connectionreset");
        let body;
        if (url.pathname.endsWith("FrameCriterioBusquedaWeb.jsp")) {
          body = '<form action="lookup"><input name="search1"><button>Buscar</button></form>';
        } else if (url.pathname.endsWith("/lookup")) {
          searches++;
          const ruc = url.searchParams.get("search1");
          body = ruc.endsWith("03") ? `<p>${ruc} CAPTCHA: verificación requerida</p>`
            : `<p>${ruc}</p><a href="representatives?ruc=${ruc}">Representantes Legales</a>`;
        } else if (url.pathname.endsWith("/representatives")) {
          const ruc = url.searchParams.get("ruc");
          const people = ruc.endsWith("02") ? [first, second] : [first];
          body = `<h1>REPRESENTANTES LEGALES DE ${ruc} - ${company}</h1><p>RESULTADO DE LA BÚSQUEDA</p><table><tr><th>Documento</th><th>Número</th><th>Nombre</th><th>Cargo</th><th>Fecha</th></tr>${people.map(p => `<tr>${Object.values(p).map(value => `<td>${value}</td>`).join("")}</tr>`).join("")}</table>`;
        } else return route.abort();
        await route.fulfill({ contentType: "text/html; charset=utf-8", body });
      });
      return context;
    };
    return serviceBrowser;
  };

  await assert.rejects(lookupSunatLegalRepresentatives("123", company), error => error.statusCode === 422);
  assert.equal(launches, 0, "Invalid identifiers do not start a browser");

  const user = { _id: "ruc-test", name: "Supplier Tester", role: "Admin", area: "Administration" };
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", error => runtimeErrors.push(error.message));
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    assert.equal(route.request().method(), "GET", "The suite must not write supplier records");
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api", "");
    let body = { data: [] }, status = 200;
    if (path === "/auth/me") body = { user };
    else if (path === "/suppliers") body = { data: [], total: 0, page: 1, pageSize: 10 };
    else if (path.startsWith("/suppliers/lookup/")) body = { found: false, data: null };
    else if (path.startsWith("/suppliers/padron/")) {
      const ruc = path.split("/").at(-1);
      body = { found: true, ruc, datasetDate: "2026-09-07", officialSource: true, data: { rucDni: ruc, legalName: company, personType: "LEGAL_ENTITY", fiscalAddress: "AV. UNIVERSIDAD NRO. 100", taxpayerStatus: "ACTIVO", domicileCondition: "HABIDO", active: true, habido: true, accountHolderName: company, location: { ubigeo: "150101" } } };
    } else if (/\/consulta-ruc\/\d+\/representatives$/.test(path)) {
      try { body = await lookupSunatLegalRepresentatives(path.split("/")[3], url.searchParams.get("legalName")); }
      catch (error) { status = error.statusCode || 500; body = { message: error.message, code: error.code }; }
    } else if (path === "/notifications") body = { data: [], unreadCount: 0 };
    else if (path === "/dashboard/tasks") body = {};
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.addInitScript(user => {
    localStorage.setItem("erp_token", "isolated-ruc-test");
    localStorage.setItem("erp_user", JSON.stringify(user));
    localStorage.setItem("erp_language", "en");
  }, user);
  const openSupplier = async ruc => {
    await page.goto("http://127.0.0.1:5188/suppliers");
    await page.getByRole("button", { name: "New supplier", exact: true }).click();
    await page.getByLabel("RUC / identifier", { exact: true }).fill(ruc);
    await page.getByLabel("Legal Name", { exact: false }).waitFor();
    assert.equal(await page.getByLabel("Legal Name", { exact: false }).inputValue(), company);
    assert.equal(await page.getByLabel("Fiscal Address", { exact: true }).inputValue(), "AV. UNIVERSIDAD NRO. 100");
  };

  await openSupplier("20600000001");
  await page.getByText("The single SUNAT representative was automatically copied into the Legal Representative fields below.").waitFor();
  assert.equal(await page.getByLabel("Legal Representative", { exact: true }).inputValue(), first.fullName);
  assert.equal(await page.getByLabel("Representative document number", { exact: true }).inputValue(), first.documentNumber);
  assert.equal(page.context().pages().length, 1, "Supplier entry opens no tabs or popups");
  assert.equal(launches, 1);
  const cached = await lookupSunatLegalRepresentatives("20600000001", company);
  assert.equal(cached.cached, true);
  assert.equal(searches, 1, "Repeated RUC lookup reuses the cached result");
  await page.screenshot({ path: `${output}/autofill.png`, fullPage: true });

  await openSupplier("20600000002");
  await page.getByText("SUNAT reports multiple representatives. Select the person UMA wants to record as the primary representative; the system will not guess automatically.").waitFor();
  assert.equal(await page.getByLabel("Legal Representative", { exact: true }).inputValue(), "");
  await page.getByRole("button", { name: "Use as legal representative" }).nth(1).click();
  assert.equal(await page.getByLabel("Legal Representative", { exact: true }).inputValue(), second.fullName);

  await openSupplier("20600000003");
  await page.getByText("SUNAT representative lookup temporarily unavailable", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Legal Name", { exact: false }).inputValue(), company, "A SUNAT challenge preserves Padrón autofill");
  assert.equal(launches, 1, "A challenge does not trigger a visible-browser fallback");

  await serviceBrowser.close();
  const beforeSearches = searches;
  const [one, two] = await Promise.all([lookupSunatLegalRepresentatives("20600000005", company), lookupSunatLegalRepresentatives("20600000005", company)]);
  assert.deepEqual(one, two);
  assert.equal(searches, beforeSearches + 1, "Concurrent requests share one lookup");
  assert.equal(launches, 2, "A disconnected browser is replaced with another invisible browser");

  transportFailure = true;
  await openSupplier("20600000004");
  await page.getByText("SUNAT representative lookup temporarily unavailable", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Fiscal Address", { exact: true }).inputValue(), "AV. UNIVERSIDAD NRO. 100");
  assert.equal(await page.getByLabel("Legal Representative", { exact: true }).inputValue(), "");
  assert.equal(launches, 2, "A network failure does not trigger a visible-browser fallback");
  assert.deepEqual(runtimeErrors, []);
  console.log("PASS: invisible RUC lookup, supplier autofill, representative selection, cache, concurrent lookup, browser recovery, CAPTCHA and connection-failure handling");
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await closeSunatRepresentativesBrowser();
  chromium.launch = launch;
  if (previousHeadless === undefined) delete process.env.SUNAT_REPRESENTATIVES_HEADLESS;
  else process.env.SUNAT_REPRESENTATIVES_HEADLESS = previousHeadless;
  await browser?.close();
  await server.close();
}
