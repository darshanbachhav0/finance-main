// Real request registration UI, isolated HTTP fixtures; no external calls or database writes.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";
import { mockWorkDrafts } from "./mockWorkDrafts.mjs";
import { limaToday } from "../../shared/businessCalendar.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../../.tmp/supplier-sunat-ui/", import.meta.url));
const server = await createServer({ root, configFile: `${root}/vite.config.js`, server: { host: "127.0.0.1", port: 5198, strictPort: true }, logLevel: "error" });
await mkdir(output, { recursive: true });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined });
const user = { _id: "sunat-requester", name: "Solicitante UMA", role: "Solicitor", area: "Laboratorios", costCenter: "center" };
const person = { documentType: "DOC. NACIONAL DE IDENTIDAD", documentNumber: "01234567", fullName: "ANA REPRESENTANTE", position: "GERENTE GENERAL", dateFrom: "15/01/2024" };
const second = { documentType: "CARNET DE EXTRANJERIA", documentNumber: "001234567", fullName: "SEGUNDO REPRESENTANTE", position: "APODERADO", dateFrom: "01/03/2025" };
const errors = [], pending = new Map();
const queriedAt = "2026-10-21T02:30:00Z"; // Still 20 October in Lima.
let page, submitted;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(account => {
    localStorage.setItem("erp_token", "isolated-sunat-test"); localStorage.setItem("erp_user", JSON.stringify(account));
    localStorage.setItem("erp_language", "es"); localStorage.setItem(`uma_tour_done_${account._id}`, "true");
  }, user);
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.slice(4);
    let body = { data: [], pagination: { total: 0, page: 1, totalPages: 1, pageSize: 20 } }, status = 200;
    if (path === "/auth/me") body = { user };
    else if (path === "/notifications") body = { data: [], unreadCount: 0 };
    else if (path === "/dashboard/tasks") body = { items: [], total: 0, counters: {} };
    else if (["/requests/authorized-cost-centers", "/cost-centers"].includes(path)) body = { data: [{ _id: "center", code: "LAB", name: "Laboratorios", active: true, area: user.area }] };
    else if (path === "/accounting-periods") body = { data: [{ _id: "period", period: limaToday().slice(0, 7), status: "OPEN" }] };
    else if (path === "/requests/form-policy") body = { data: { documentRequirements: [], quotationPolicy: { enabled: false } } };
    else if (path === "/requests/budget-preview") body = { data: { status: "AVAILABLE", lines: [] } };
    else if (path === "/suppliers/507f1f77bcf86cd799439011") body = { data: {
      _id: "507f1f77bcf86cd799439011", rucDni: "20600000011", legalName: "PROVEEDOR 20600000011", supplierCode: "PRV-0011", homologationStatus: "PENDING_VALIDATION", departments: [user.area],
      legalRepresentative: person.fullName, legalRepresentativeDocument: { type: "DNI", number: person.documentNumber },
      sunatRepresentatives: { ruc: "20600000011", queriedAt, entries: [{ ...person, dateFrom: "2024-01-15" }] },
      taxpayerValidation: { returnedIdentifier: "20600000011", status: "VALID", source: "SUNAT_CONSULTA_RUC", sunat: { taxpayerStatus: "ACTIVO", domicileCondition: "HABIDO", registrationDate: "2020-02-01", activityStartDate: "2020-02-15", queriedAt } },
      sunatProvider: { state: "PRODUCTION", configured: true, variant: "PADRON" }, permissions: {}, documents: [], bankAccounts: []
    } };
    else if (path === "/suppliers/507f1f77bcf86cd799439011/homologation-readiness") body = { data: { ready: false, issues: [] } };
    else if (path.startsWith("/suppliers/lookup/")) body = { found: false };
    else if (path.startsWith("/suppliers/padron/")) {
      const ruc = path.split("/").at(-1), inactive = ruc.endsWith("13");
      body = { found: true, ruc, source: "SUNAT_CONSULTA_RUC", officialSource: true, queriedAt,
        data: { rucDni: ruc, legalName: `PROVEEDOR ${ruc}`, personType: "LEGAL_ENTITY", fiscalAddress: "AV. UNIVERSIDAD 100",
          taxpayerStatus: inactive ? "BAJA DE OFICIO" : "ACTIVO", domicileCondition: inactive ? "NO HABIDO" : "HABIDO",
          active: !inactive, habido: !inactive, registrationDate: "2020-02-01", activityStartDate: "2020-02-15", deregistrationDate: inactive ? "2026-10-01" : "" } };
    } else if (path.includes("/representatives")) {
      const ruc = path.split("/")[3];
      if (ruc.endsWith("14") || ruc.endsWith("15")) await new Promise(resolve => pending.set(ruc, resolve));
      if (ruc.endsWith("16")) { status = 503; body = { message: "SUNAT unavailable" }; }
      else body = { found: true, ruc, legalName: `PROVEEDOR ${ruc}`, source: "SUNAT_CONSULTA_RUC_BROWSER", officialSource: true, queriedAt, representatives: ruc.endsWith("12") ? [person, second] : [person] };
    } else if (path === "/suppliers" && req.method() === "POST") {
      submitted = req.postData();
      body = { data: { _id: "507f1f77bcf86cd799439011", rucDni: "20600000011", legalName: "PROVEEDOR 20600000011", supplierCode: "PRV-0011", homologationStatus: "PENDING_VALIDATION", bankAccounts: [{ _id: "bank", bank: "BCP", currency: "PEN", accountType: "SAVINGS", active: true }] } };
    }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  await mockWorkDrafts(page);
  await page.goto("http://127.0.0.1:5198/requests/new");
  await page.getByRole("button", { name: /¿No está en la lista/ }).click();
  const form = page.locator(".supplier-quick-register");
  const ruc = form.getByLabel("RUC proveedor", { exact: false });
  const name = form.getByLabel("Representante Legal", { exact: true });
  const document = form.getByLabel("Número de documento del representante", { exact: true });
  await ruc.fill("20600000011");
  await page.waitForFunction(() => document.querySelector('.supplier-quick-register input[value="ANA REPRESENTANTE"]'));
  assert.equal(await name.inputValue(), person.fullName);
  assert.equal(await document.inputValue(), person.documentNumber);
  await form.getByText("Estado SUNAT: ACTIVO", { exact: true }).waitFor();
  await form.getByText("Condición de domicilio: HABIDO", { exact: true }).waitFor();
  assert.match(await form.locator(".field-hint").allTextContents().then(values => values.join(" ")), /Representante desde: 15\/01\/2024/);
  const evidence = form.locator(".supplier-sunat-evidence");
  assert.equal(await evidence.locator("details").getAttribute("open"), null);
  await evidence.locator("summary").click();
  await evidence.getByText("01/02/2020", { exact: true }).waitFor();
  await evidence.getByText("15/02/2020", { exact: true }).waitFor();
  assert.match(await evidence.innerText(), /20\/10\/2026.*21:30/);
  assert.equal(await evidence.getByText("Fecha de baja", { exact: true }).count(), 0);
  await page.screenshot({ path: `${output}/registration-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${output}/registration-mobile.png`, fullPage: true });

  await ruc.fill("20600000012");
  await form.getByLabel("Selecciona un representante SUNAT").waitFor();
  assert.equal(await name.inputValue(), "");
  await form.getByLabel("Selecciona un representante SUNAT").selectOption("1");
  assert.equal(await name.inputValue(), second.fullName);
  assert.equal(await form.getByLabel("Tipo de documento del representante").inputValue(), "CE");
  assert.equal(await document.inputValue(), second.documentNumber);

  await ruc.fill("20600000013");
  await form.getByText("Estado SUNAT: BAJA DE OFICIO", { exact: true }).waitFor();
  await form.getByText("Condición de domicilio: NO HABIDO", { exact: true }).waitFor();
  await form.locator(".supplier-sunat-evidence summary").click();
  await form.getByText("01/10/2026", { exact: true }).waitFor();

  await ruc.fill("20600000014");
  await form.getByText("Consultando representantes legales en SUNAT...", { exact: true }).waitFor();
  await name.fill("REPRESENTANTE CORREGIDO");
  await document.fill("87654321");
  pending.get("20600000014")();
  await form.getByText("Consultando representantes legales en SUNAT...", { exact: true }).waitFor({ state: "hidden" });
  assert.equal(await name.inputValue(), "REPRESENTANTE CORREGIDO");
  assert.equal(await document.inputValue(), "87654321");

  await ruc.fill("20600000015");
  await form.getByText("Consultando representantes legales en SUNAT...", { exact: true }).waitFor();
  await ruc.fill("20600000016");
  await form.getByText("Consulta de representantes SUNAT no disponible por ahora", { exact: true }).waitFor();
  pending.get("20600000015")();
  assert.equal(await name.inputValue(), "");
  await form.getByLabel("Razón social", { exact: false }).waitFor();
  assert.equal(await form.getByLabel("Razón social", { exact: false }).inputValue(), "PROVEEDOR 20600000016");

  // Actual form submission contains the extracted representative and document, not client evidence.
  await ruc.fill("20600000011");
  await page.waitForFunction(() => document.querySelector('.supplier-quick-register input[value="ANA REPRESENTANTE"]'));
  await form.getByLabel("Sustento del registro del proveedor").fill("Servicio de mantenimiento");
  await form.getByRole("button", { name: /^Banco/ }).click();
  await page.getByRole("option", { name: /BCP/ }).click();
  await form.getByLabel("Número de cuenta", { exact: false }).fill("19300000001");
  await form.getByLabel(/Código de Cuenta Interbancario/).fill("00219300000000000100");
  await form.getByRole("button", { name: "Registrar y usar este proveedor", exact: true }).click();
  await form.waitFor({ state: "detached" });
  assert.match(submitted, /name="legalRepresentative"\r\n\r\nANA REPRESENTANTE/);
  assert.match(submitted, /"type":"DNI","number":"01234567"/);
  assert.doesNotMatch(submitted, /name="(?:taxpayerValidation|sunatRepresentatives)"/);
  await page.goto("http://127.0.0.1:5198/suppliers/507f1f77bcf86cd799439011");
  await page.getByText("Estado SUNAT: ACTIVO", { exact: true }).waitFor();
  await page.getByText("Condición de domicilio: HABIDO", { exact: true }).waitFor();
  await page.locator(".supplier-sunat-evidence summary").click();
  await page.getByText("01/02/2020", { exact: true }).waitFor();
  assert.match(await page.locator("body").innerText(), /Representante desde: 15\/01\/2024/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  console.log("PASS supplier SUNAT: desktop/mobile, status/condition, dates in Lima, single/multiple representatives, manual corrections, stale-RUC guard and submitted identity.");
} catch (error) {
  if (page) { console.error(await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll("body *")].map(el => ({ tag: el.tagName, cls: el.className, right: el.getBoundingClientRect().right })).filter(el => el.right > innerWidth + 1).slice(0, 25) }))); console.error(await page.locator("body").innerText()); await page.screenshot({ path: `${output}/failure.png`, fullPage: true }); }
  throw error;
} finally {
  for (const resolve of pending.values()) resolve();
  await browser.close(); await server.close();
}
