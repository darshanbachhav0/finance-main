// Exercises the real request wizard with an isolated browser and mocked API.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../../.tmp/payment-terms-ui/", import.meta.url));
await mkdir(output, { recursive: true });
const server = await createServer({ root, configFile: `${root}/vite.config.js`, server: { host: "127.0.0.1", port: 5186, strictPort: true }, logLevel: "error" });
await server.listen();
let browser;
let page;
try {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const runtimeErrors = [];
  page.on("pageerror", (error) => { runtimeErrors.push(error.message); console.error("Browser error:", error.message); });
  page.on("console", (message) => { if (message.type() === "error") console.error("Console:", message.text()); });
  page.on("requestfailed", (request) => console.error("Request failed:", request.url(), request.failure()?.errorText));
  const user = { _id: "test-user", name: "Quotation Tester", role: "Solicitor", area: "Purchasing", costCenter: "center" };
  const centers = [{ _id: "center", code: "CC-100", name: "Purchasing", active: true }];
  const expenses = [{ _id: "expense", code: "EXP-100", name: "Supplies", accountNumber: "603201", category: "OPEX", active: true }];
  const suppliers = ["Supplier A", "Supplier B", "Supplier C"].map((name, index) => ({ _id: `supplier-${index}`, name, legalName: name, rucDni: `2060000000${index}`, supplierCode: `PRV-00${index}`, active: true, homologationStatus: "HOMOLOGATED" }));
  const form = { flowType: "A1", requestType: "OPEX", expenseNature: "GOODS", priority: "MEDIA", requesterCostCenter: "center", schoolOrDepartment: "Purchasing", areaCorrelative: "", issueDate: "2026-09-04", accountingPeriod: "2026-09", currency: "PEN", supplier: "supplier-0", title: "Laboratory supplies", detailedDescription: "Supplies for laboratory teaching", businessJustification: "Continue teaching", nonApprovalRisk: "Class delays", description: "Laboratory supplies", supplierSelectionReason: "Price and payment terms" };
  const lines = [{ clientId: "line", itemDescription: "Supplies", quantity: "1", unitOfMeasure: "UNIT", unitPrice: "11800", costCenter: "center", expenseType: "expense", netAmount: 10000, igvAmount: 1800, totalAmount: 11800 }];
  const quotations = suppliers.map((supplier, index) => ({ clientId: `quote-${index}`, supplier: supplier._id, amount: [11800, 12200, 11500][index], currency: "PEN", deliveryPeriod: `${3 + index * 2} days`, paymentConditions: index === 0 ? "Original supplier agreement" : "", paymentCondition: index === 1 ? "100%_ON_DELIVERY" : index === 2 ? "100%_ADVANCE" : null, commercialConditions: "", attachment: `attachment-${index}`, recommended: index === 0 }));
  let savedRequest;
  let savedQuotations;
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api", "");
    let body = { data: [] };
    if (path === "/auth/me") body = { user };
    else if (path === "/suppliers") body = { data: suppliers };
    else if (["/cost-centers", "/requests/authorized-cost-centers"].includes(path)) body = { data: centers };
    else if (path === "/expense-types") body = { data: expenses };
    else if (path === "/accounting-periods") body = { data: [{ _id: "period", period: "2026-09", status: "OPEN" }] };
    else if (path === "/notifications") body = { data: [], unreadCount: 0 };
    else if (path === "/dashboard/tasks") body = {};
    else if (path === "/requests/form-policy") body = { data: { documentRequirements: [], quotationPolicy: { enabled: true, minimumCount: 3 } } };
    else if (path === "/requests/budget-preview") body = { data: { status: "AVAILABLE", lines: [] } };
    else if (path === "/requests" && route.request().method() === "POST") {
      const payload = route.request().postData();
      const quotationJson = payload.match(/name="quotations"\r\n\r\n([^\r]+)/)?.[1];
      assert.ok(quotationJson, "Quotation fields are included in multipart save");
      savedQuotations = JSON.parse(quotationJson);
      savedRequest = { ...form, _id: "saved", requestNumber: "SOL-TEST", status: "BORRADOR", requester: user, solicitor: user, supplier: suppliers[0], totalAmount: 11800, totalNet: 10000, totalIGV: 1800, updatedAt: new Date().toISOString(), lines: lines.map((line) => ({ ...line, _id: line.clientId })), quotations: savedQuotations.map((quote, index) => ({ ...quote, _id: `quote-${index}`, supplier: suppliers[index] })), attachments: [], approvalHistory: [] };
      body = { data: savedRequest };
    } else if (path === "/requests/saved") body = { data: savedRequest };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.addInitScript(({ user, form, lines, quotations }) => {
    if (localStorage.getItem("payment-test-initialized")) return;
    localStorage.setItem("payment-test-initialized", "true");
    localStorage.setItem("erp_user", JSON.stringify(user));
    localStorage.setItem("erp_token", "isolated-test-token");
    localStorage.setItem("erp_language", "en");
    localStorage.setItem(`erp_request_autosave_${user._id}_new`, JSON.stringify({ form, lines, quotations, savedAt: new Date().toISOString() }));
  }, { user, form, lines, quotations });
  await page.goto("http://127.0.0.1:5186/requests/new");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const card = page.locator(".quotation-card").first();
  const condition = card.getByLabel("Payment condition", { exact: true });
  assert.equal(await condition.inputValue(), "");
  assert.equal(await card.getByLabel("Existing payment terms").inputValue(), "Original supplier agreement");
  assert.equal(await condition.locator("option").count(), 7);

  await condition.selectOption("ADVANCE_AND_BALANCE");
  await card.getByLabel("Advance percentage").fill("30");
  assert.match(await card.locator(".payment-preview").innerText(), /3,540\.00/);
  assert.match(await card.locator(".payment-preview").innerText(), /8,260\.00/);
  await card.getByLabel("Amount", { exact: false }).first().fill("10000");
  assert.match(await card.locator(".payment-preview").innerText(), /3,000\.00/);
  await card.getByLabel("Amount", { exact: false }).first().fill("11800");
  await card.getByLabel("Advance percentage").fill("100");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  assert.match(await card.innerText(), /greater than 0 and less than 100/);
  await card.getByLabel("Advance percentage").fill("30");
  await card.getByLabel("Balance payable").selectOption("OTHER");
  await card.getByLabel("Describe when the balance is payable").fill("After inspection");
  assert.match(await page.locator(".quotation-comparison").innerText(), /After inspection/);

  await condition.selectOption("CREDIT");
  assert.equal(await card.getByLabel("Advance percentage").count(), 0);
  await card.getByLabel("Credit period", { exact: true }).selectOption("OTHER");
  await card.getByLabel("Credit days").fill("75");
  await card.getByLabel("Credit period starts after").selectOption("CONFORMITY");
  assert.match(await card.locator(".payment-preview").innerText(), /75 days after Conformity/);
  await condition.selectOption("PARTIAL_PAYMENTS");
  await card.getByLabel("Number of payments").fill("3");
  await card.getByLabel("Payment details").fill("30% start, 40% progress, 30% delivery");
  assert.match(await card.locator(".payment-preview").innerText(), /3 payments/);
  await condition.selectOption("OTHER");
  await card.getByLabel("Describe the payment condition").fill("After acceptance");
  assert.match(await card.locator(".payment-preview").innerText(), /After acceptance/);
  await condition.selectOption("100%_ADVANCE");
  assert.match(await card.locator(".payment-preview").innerText(), /100% before starting/);
  await condition.selectOption("100%_ON_DELIVERY");
  assert.match(await card.locator(".payment-preview").innerText(), /100% after delivery/);

  await condition.selectOption("ADVANCE_AND_BALANCE");
  await card.getByLabel("Advance percentage").fill("30");
  await card.getByLabel("Payment notes").fill("Agreed with supplier");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.waitForURL("**/requests/saved");
  assert.equal(savedQuotations[0].paymentCondition, "ADVANCE_AND_BALANCE");
  assert.equal(Number(savedQuotations[0].advancePercentage), 30);
  assert.equal(savedQuotations[0].creditDays, null);
  assert.equal(savedQuotations[0].partialPaymentCount, null);
  await page.goto("http://127.0.0.1:5186/requests/saved/edit");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  assert.equal(await card.getByLabel("Advance percentage").inputValue(), "30");
  assert.equal(await card.getByLabel("Payment notes").inputValue(), "Agreed with supplier");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  assert.match(await page.locator(".quotation-comparison").innerText(), /30% advance \+ 70% balance/);

  await page.evaluate(() => localStorage.setItem("erp_language", "es"));
  await page.reload();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  assert.equal(await card.getByLabel("Condición de pago", { exact: true }).inputValue(), "ADVANCE_AND_BALANCE");
  assert.match(await card.locator(".payment-preview").innerText(), /30% adelanto \+ 70% saldo/);
  await page.locator(".quotation-section").screenshot({ path: `${output}/desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))));
  await card.locator(".quotation-payment-terms").evaluate((element) => window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - 100, behavior: "instant" }));
  await page.screenshot({ path: `${output}/mobile.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "No page overflow at 390px");
  assert.deepEqual(runtimeErrors, []);
  console.log("PASS: six options, calculations, validation, comparison, draft save/reopen, review, Spanish and mobile layout");
  console.log(`Screenshots: ${output}`);
} catch (error) {
  if (page) {
    console.error("Page:", page.url(), (await page.locator("body").innerText()).slice(-5000));
    await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  }
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
