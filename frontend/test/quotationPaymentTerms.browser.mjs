// Exercises the real request wizard with an isolated browser and mocked API.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";
import { parseQuotations } from "../../backend/src/services/requestService.js";

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
  Object.assign(quotations[1], { paymentCondition: "CREDIT", creditDays: 75, creditStart: "CONFORMITY" });
  Object.assign(quotations[2], { paymentCondition: "PARTIAL_PAYMENTS", partialPaymentCount: 3, paymentNotes: "30% start, 40% progress, 30% delivery" });
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
    else if (["/requests", "/requests/saved"].includes(path) && ["POST", "PUT"].includes(route.request().method())) {
      const payload = route.request().postData();
      const quotationJson = payload.match(/name="quotations"\r\n\r\n([^\r]+)/)?.[1];
      assert.ok(quotationJson, "Quotation fields are included in multipart save");
      savedQuotations = parseQuotations(quotationJson);
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
  const terms = card.locator(".quotation-payment-terms");
  const choose = label => terms.getByRole("radio", { name: label, exact: true }).check();
  const percentage = terms.getByRole("spinbutton", { name: "Advance percentage", exact: true });
  const slider = terms.getByRole("slider", { name: "Advance percentage slider" });
  const preview = terms.locator(".payment-preview");
  const amount = card.getByLabel("Amount", { exact: false }).first();
  const assertSplit = async (advance, balance) => {
    assert.equal(await terms.getByRole("img", { name: "Advance " + advance + "% | Balance " + balance + "%", exact: true }).count(), 1);
    const widths = await terms.locator(".quotation-split-bar").evaluate(element => [element.children[0].getBoundingClientRect().width, element.getBoundingClientRect().width]);
    assert.ok(Math.abs(widths[0] / widths[1] * 100 - advance) < 0.1);
  };
  assert.equal(await terms.getByRole("radio").count(), 3);
  assert.equal(await terms.locator('input[type="radio"]:checked').count(), 0, "An existing agreement is not overwritten");
  assert.match(await terms.locator(".payment-saved-terms").innerText(), /Original supplier agreement/);
  assert.equal(await page.getByLabel(/Number of payments|Payment details/).count(), 0);
  assert.equal(await terms.getByRole("combobox", { name: "Payment condition", exact: true }).count(), 0);
  await amount.fill("3540");
  await choose("Advance + Balance");
  assert.equal(await percentage.inputValue(), "30");
  assert.equal(await slider.inputValue(), "30");
  assert.equal(await terms.getByLabel("Balance payable").inputValue(), "ON_DELIVERY", "Required internal timing is automatic");
  assert.equal(await terms.getByLabel("Balance payable").isVisible(), false);
  assert.match(await preview.innerText(), /1,062\.00/);
  assert.match(await preview.innerText(), /2,478\.00/);
  await assertSplit(30, 70);
  await amount.fill("10000");
  assert.match(await preview.innerText(), /3,000\.00/);
  assert.match(await preview.innerText(), /7,000\.00/);
  await amount.fill("3540");

  for (const preset of [20, 30, 50]) {
    await terms.getByRole("button", { name: preset + "%", exact: true }).click();
    assert.equal(await percentage.inputValue(), String(preset));
    assert.equal(await slider.inputValue(), String(preset));
    assert.equal(await terms.getByRole("button", { name: preset + "%", exact: true }).getAttribute("aria-pressed"), "true");
    await assertSplit(preset, 100 - preset);
  }
  await terms.getByRole("button", { name: "Custom", exact: true }).click();
  assert.equal(await percentage.evaluate(element => element === document.activeElement), true);
  await percentage.fill("33.33");
  assert.equal(await slider.inputValue(), "33.33");
  assert.match(await preview.innerText(), /1,179\.88/);
  assert.match(await preview.innerText(), /2,360\.12/);
  await assertSplit(33.33, 66.67);
  await slider.focus();
  await slider.press("Home");
  assert.equal(await percentage.inputValue(), "0.01");
  await slider.press("ArrowRight");
  assert.equal(await percentage.inputValue(), "0.02");
  await slider.press("End");
  assert.equal(await percentage.inputValue(), "99.99");
  await slider.press("ArrowLeft");
  assert.equal(await percentage.inputValue(), "99.98");
  const box = await slider.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  assert.equal(await percentage.inputValue(), await slider.inputValue(), "Pointer interaction updates the number input");
  assert.ok(Math.abs(Number(await percentage.inputValue()) - 50) < 1);
  await percentage.fill("100");
  assert.equal(await terms.locator(".payment-amounts").count(), 0, "Invalid percentages never display stale amounts");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  assert.match(await terms.innerText(), /greater than 0 and less than 100/);
  await percentage.fill("");
  assert.equal(await terms.locator(".payment-amounts").count(), 0);
  await percentage.fill("30");
  assert.equal(await percentage.getAttribute("aria-invalid"), "false");
  await terms.getByText("Additional terms (optional)", { exact: true }).click();
  await terms.getByLabel("Balance payable").selectOption("OTHER");
  await terms.getByLabel("Describe when the balance is payable").fill("After inspection");
  assert.match(await page.locator(".quotation-comparison").innerText(), /After inspection/);
  await terms.getByLabel("Payment notes").fill("Agreed with supplier");

  // Both fixed cards save the derived percentages through the real API parser.
  for (const [label, condition, advance, balance] of [["100% Advance", "100%_ADVANCE", 100, 0], ["100% On Delivery", "100%_ON_DELIVERY", 0, 100]]) {
    await choose(label);
    assert.equal(await terms.getByRole("slider").count(), 0);
    assert.equal(await percentage.count(), 0);
    await assertSplit(advance, balance);
    const amounts = await terms.locator(".payment-amounts strong").allTextContents();
    assert.match(amounts[advance ? 0 : 1], /3,540\.00/);
    assert.match(amounts[advance ? 1 : 0], /0\.00/);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.waitForURL("**/requests/saved");
    assert.equal(savedQuotations[0].paymentCondition, condition);
    assert.equal(savedQuotations[0].advancePercentage, advance);
    assert.equal(savedQuotations[0].balancePercentage, balance);
    assert.equal(savedQuotations[0].partialPaymentCount, null);
    assert.equal(savedQuotations[0].balanceTiming, null);
    assert.equal(savedQuotations[1].paymentCondition, "CREDIT", "Existing credit agreements are retained");
    assert.equal(savedQuotations[1].creditDays, 75);
    assert.equal(savedQuotations[2].paymentCondition, "PARTIAL_PAYMENTS", "Existing partial agreements are retained");
    assert.equal(savedQuotations[2].partialPaymentCount, 3);
    await page.goto("http://127.0.0.1:5186/requests/saved/edit");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    assert.equal(await terms.getByRole("radio", { name: label, exact: true }).isChecked(), true);
    await assertSplit(advance, balance);
  }
  await choose("Advance + Balance");
  await percentage.fill("33.33");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("erp_request_autosave_test-user_saved"))?.quotations[0].advancePercentage === "33.33");
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  assert.equal(await percentage.inputValue(), "33.33");
  assert.equal(await slider.inputValue(), "33.33");
  await terms.getByRole("button", { name: "30%", exact: true }).click();
  await amount.fill("");
  assert.equal(await terms.locator(".payment-amounts").count(), 0);
  await amount.fill("3540");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.waitForURL("**/requests/saved");
  assert.equal(savedQuotations[0].paymentCondition, "ADVANCE_AND_BALANCE");
  assert.equal(savedQuotations[0].advancePercentage, 30);
  assert.equal(savedQuotations[0].balancePercentage, 70);
  assert.equal(savedQuotations[0].balanceTiming, "ON_DELIVERY");
  assert.equal(savedQuotations[0].creditDays, null);
  assert.equal(savedQuotations[0].partialPaymentCount, null);
  await page.goto("http://127.0.0.1:5186/requests/saved/edit");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  assert.equal(await percentage.inputValue(), "30");
  assert.equal(await slider.inputValue(), "30");
  assert.equal(await terms.getByLabel("Payment notes").inputValue(), "Agreed with supplier");
  await terms.screenshot({ path: output + "/desktop.png" });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  assert.match(await page.locator(".quotation-comparison").innerText(), /30% advance \+ 70% balance/);

  await page.evaluate(() => localStorage.setItem("erp_language", "es"));
  await page.reload();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  assert.equal(await terms.getByRole("radio", { name: "Adelanto + Saldo", exact: true }).isChecked(), true);
  assert.match(await preview.innerText(), /30% adelanto \+ 70% saldo/);
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "No page overflow at " + width + "px");
    await terms.screenshot({ path: output + "/" + width + ".png" });
  }
  assert.deepEqual(runtimeErrors, []);
  console.log("PASS: three payment cards, synchronized slider/input, presets, live amounts, fixed splits, validation, legacy terms, save/reopen, autosave, review, Spanish and responsive layouts");

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
