import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";
import { mockWorkDrafts } from "./mockWorkDrafts.mjs";
import { limaToday } from "../../shared/businessCalendar.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../../.tmp/minimal-finance-ui/", import.meta.url));
await mkdir(output, { recursive: true });
const server = await createServer({ root, configFile: `${root}/vite.config.js`, server: { host: "127.0.0.1", port: 5196, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined });
const errors = [];
const today = limaToday();
const user = { _id: "jefe", name: "María UMA", role: "Solicitor", area: "Laboratorios", costCenter: "center", teamAccess: true };
const account = { _id: "account", bank: "BCP", currency: "PEN", accountType: "SAVINGS", active: true, accountNumber: "19300000001", cci: "00219300000000000100", verificationStatus: "VERIFIED" };
const supplier = { _id: "supplier", name: "Proveedor UMA", legalName: "Proveedor UMA", rucDni: "20777999123", supplierCode: "PRV-0001", active: true, homologationStatus: "HOMOLOGATED", paymentTerms: { option: "CREDIT_30", days: 30 }, bankAccounts: [account], documents: [{ _id: "supplier-doc", originalName: "Certificado bancario.pdf", url: "/uploads/suppliers/supplier/bank.pdf" }] };
const center = { _id: "center", name: "Laboratorios", code: "LAB", active: true, area: user.area };
const request = {
  _id: "request", requestNumber: "SOL-2026-00001", flowType: "A1", requestType: "OPEX", expenseNature: "SERVICES", priority: "MEDIA", frequency: "ONE_OFF",
  requester: user, solicitor: user, requesterArea: user.area, requesterCostCenter: center, issueDate: today, accountingPeriod: today.slice(0, 7), currency: "PEN", status: "BORRADOR",
  supplier, paymentAccount: { account: "account", bank: "BCP", currency: "PEN", accountType: "SAVINGS", accountLast4: "0001" },
  description: "Mantenimiento de laboratorios", detailedDescription: "Mantenimiento de laboratorios", businessJustification: "Continuidad de clases", totalAmount: 10000, totalNet: 8474.58, totalIGV: 1525.42,
  supplierPaymentTerms: { paymentCondition: "CREDIT", creditDays: 30, creditStart: "INVOICE" }, supplierCreditDaysSnapshot: 30,
  invoiceDetails: { status: "ATTACHED", source: "MANUAL", number: "F001-123", issueDate: `${today.slice(0, 7)}-01`, currency: "PEN", totalAmount: 10000, igvAmount: 1525.42 },
  lines: [{ _id: "line", itemDescription: "Mantenimiento", quantity: 1, unitPrice: 10000, priceIncludesIGV: true, unitOfMeasure: "UNIT", costCenter: center, totalAmount: 10000, netAmount: 8474.58, igvAmount: 1525.42 }],
  allowedActions: ["EDIT", "SUBMIT"], quotations: [], approvalHistory: [], approvalRouteSnapshot: [], attachments: [{ _id: "invoice", kind: "PDF", originalName: "Factura.pdf", url: "/uploads/requests/request/invoice.pdf" }], updatedAt: new Date().toISOString()
};
const jefe = { year: today.slice(0, 4), configured: true, totals: { assigned: 100000, committed: 20000, executed: 30000, available: 50000 }, progress: 30,
  approvals: [{ ...request, status: "PENDIENTE_APROBACION", scheduledPaymentDate: `${today.slice(0, 7)}-30` }], approvalCount: 1, invoiceAlerts: { overdue: 1, dueSoon: 2 } };
let submitted;
let page;

try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(12000);
  await page.addInitScript(account => {
    localStorage.setItem("erp_token", "isolated-finance-ui"); localStorage.setItem("erp_user", JSON.stringify(account));
    localStorage.setItem("erp_language", "es"); localStorage.setItem(`uma_tour_done_${account._id}`, "true");
  }, user);
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.slice(4);
    let body = { data: [], pagination: { total: 0, page: 1, totalPages: 1, pageSize: 20 } };
    if (path === "/auth/me") body = { user };
    else if (path === "/dashboard/summary") body = { role: user.role, jefe, lastUpdated: new Date().toISOString() };
    else if (path === "/notifications") body = { data: [], unreadCount: 0 };
    else if (path === "/dashboard/tasks") body = { items: [], total: 0, counters: {} };
    else if (path === "/suppliers") body = { data: [supplier] };
    else if (path === "/suppliers/supplier") body = { data: supplier };
    else if (["/requests/authorized-cost-centers", "/cost-centers"].includes(path)) body = { data: [center] };
    else if (path === "/accounting-periods") body = { data: [{ _id: "period", period: today.slice(0, 7), status: "OPEN" }] };
    else if (path === "/requests/form-policy") body = { data: { documentRequirements: [], quotationPolicy: { enabled: false, minimumCount: 0 } } };
    else if (path === "/requests/budget-preview") body = { data: { status: "AVAILABLE", lines: [] } };
    else if (path === "/requests/request" && req.method() === "GET") body = { data: request, related: {} };
    else if (path === "/requests/request" && req.method() === "PUT") { submitted = req.postData(); body = { data: request }; }
    else if (path === "/dashboard/invoices") body = { data: [{ _id: "invoice", request: { _id: "request", requestNumber: request.requestNumber }, supplier, originalAmount: 1000, outstandingAmount: 700, currency: "PEN", dueDate: today, invoiceState: "Vencida", voucher: { series: "F001", number: "123", documentDate: today }, paymentTermsSnapshot: { creditDays: 30 } }], pagination: { total: 1, page: 1, totalPages: 1 } };
    else if (path === "/files/download") return route.fulfill({ contentType: "application/pdf", headers: { "Content-Disposition": 'attachment; filename="Factura.pdf"' }, body: "%PDF-1.4 test" });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await mockWorkDrafts(page);
  const origin = "http://127.0.0.1:5196";
  await page.goto(origin);
  await page.locator(".jefe-kpis").waitFor();
  assert.equal(await page.locator(".jefe-kpis .stat-card").count(), 4);
  assert.equal(await page.locator(".jefe-dashboard progress").getAttribute("value"), "30");
  assert.equal(await page.locator(".personal-stats, .recharts-wrapper").count(), 0);
  await page.locator(".jefe-dashboard").getByText("Fecha de pago programada", { exact: true }).first().waitFor();
  const scrollBeforeDocuments = await page.evaluate(() => scrollY);
  await page.getByRole("button", { name: "Ver documentos", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByText("Factura.pdf", { exact: true }).waitFor();
  await drawer.getByText("Certificado bancario.pdf", { exact: true }).waitFor();
  const downloadPromise = page.waitForEvent("download");
  await drawer.getByRole("button", { name: "Descargar", exact: true }).first().click();
  assert.equal((await downloadPromise).suggestedFilename(), "Factura.pdf");
  await drawer.getByRole("button", { name: /Cerrar/ }).click();
  await drawer.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => scrollY), scrollBeforeDocuments);
  await page.screenshot({ path: `${output}/jefe-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator(".jefe-kpis .stat-card").count(), 4);
  await page.locator(".jefe-dashboard").getByText("Fecha de pago programada", { exact: true }).first().waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${output}/jefe-mobile.png`, fullPage: true });
  await page.locator(".jefe-invoice-alert").click();
  await page.getByRole("button", { name: "F001-123" }).click();
  await page.getByRole("dialog").getByText("Monto pendiente", { exact: true }).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: /Cerrar/ }).click();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/requests/request/edit`);
  await page.locator(".workflow-stepper").waitFor();
  assert.equal(await page.locator(".workflow-stepper li").count(), 4);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByLabel("Condición de pago", { exact: true }).waitFor();
  assert.equal(await page.locator(".supplier-advance-calculator").count(), 0);
  await page.getByLabel("Condición de pago", { exact: true }).selectOption("ADVANCE_AND_BALANCE");
  await page.getByLabel("Porcentaje de adelanto", { exact: true }).fill("30");
  assert.equal(Number(await page.getByLabel("Monto del adelanto", { exact: true }).inputValue()), 3000);
  await page.getByLabel("Monto del adelanto", { exact: true }).fill("5000");
  assert.equal(Number(await page.getByLabel("Porcentaje de adelanto", { exact: true }).inputValue()), 50);
  await page.getByLabel("Monto del adelanto", { exact: true }).fill("3333.33");
  assert.equal(Number(await page.getByLabel("Porcentaje de adelanto", { exact: true }).inputValue()), 33.3333);
  assert.equal(Number(await page.getByLabel("Monto del adelanto", { exact: true }).inputValue()), 3333.33);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${output}/advance-mobile.png`, fullPage: true });
  await page.getByLabel("Condición de pago", { exact: true }).selectOption("CREDIT");
  await page.getByLabel("Días de crédito acordados").fill("30");
  assert.equal(await page.locator(".supplier-advance-calculator").count(), 0);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: "Enviar solicitud", exact: true }).waitFor();
  await page.screenshot({ path: `${output}/summary-mobile.png`, fullPage: true });
  await page.getByRole("button", { name: "Enviar solicitud", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".wizard-actions"));
  const submittedTerms = JSON.parse(submitted.match(/name="supplierPaymentTerms"\r\n\r\n([^\r]+)/)[1]);
  assert.equal(submittedTerms.paymentCondition, "CREDIT");
  assert.equal(Number(submittedTerms.creditDays), 30);
  assert.deepEqual(errors, []);
  console.log("PASS desktop/mobile: four KPIs, budget progress, document download, invoice detail, four steps, conditional advance calculator and submission payload.");
} catch (error) {
  if (page) console.error(await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll("body *")].map(el => ({ tag: el.tagName, cls: el.className, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width })).filter(el => el.right > innerWidth + 1).slice(0, 25) })));
  if (page) { console.error(await page.locator("body").innerText()); await page.screenshot({ path: `${output}/failure.png`, fullPage: true }); }
  console.error(errors);
  throw error;
} finally { await browser.close(); await server.close(); }
