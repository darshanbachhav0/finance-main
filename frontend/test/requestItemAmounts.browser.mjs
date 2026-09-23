import { mockWorkDrafts } from "./mockWorkDrafts.mjs";
// Real request wizard; isolated API fixtures. Database persistence is covered by requestPhase3.test.js.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";
import { parseRequestLines } from "../../backend/src/services/requestService.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../../.tmp/request-item-ui/", import.meta.url));
const user = { _id: "item-user", name: "Item Tester", role: "Solicitor", area: "Purchasing", costCenter: "center" };
const center = { _id: "center", code: "CC-100", name: "Purchasing", active: true };
const expense = { _id: "expense", code: "EXP-100", name: "Supplies", category: "OPEX", accountNumber: "603201", active: true };
const expenses = [expense, { ...expense, _id: "expense2", name: "Services", accountNumber: "631100" }];
const supplier = { _id: "supplier", rucDni: "20600000001", name: "Test supplier", legalName: "Test supplier", active: true, homologationStatus: "HOMOLOGATED" };
const form = { flowType: "A1", requestType: "OPEX", expenseNature: "GOODS", priority: "MEDIA", requesterCostCenter: "center", schoolOrDepartment: "Purchasing", issueDate: "2026-09-09", accountingPeriod: "2026-09", currency: "PEN", supplier: "supplier", title: "Supplies", detailedDescription: "Teaching supplies", businessJustification: "Classes", nonApprovalRisk: "Class delays", description: "Teaching supplies", supplierSelectionReason: "" };
const initialLine = { clientId: "first", itemDescription: "", quantity: "1", unitOfMeasure: "UNIT", unitPrice: "", priceIncludesIGV: true, costCenter: "center", expenseType: "", netAmount: 0, igvAmount: 0, totalAmount: 0 };
const server = await createServer({ root, configFile: `${root}/vite.config.js`, server: { host: "127.0.0.1", port: 5192, strictPort: true }, logLevel: "error" });
let browser, page, saved;
let previews = [], submittedLines = [], errors = [];
try {
  await mkdir(output, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname.replace("/api", "");
    let body = { data: [] };
    if (path === "/auth/me") body = { user };
    else if (path === "/suppliers") body = { data: [supplier] };
    else if (path === "/requests/authorized-cost-centers") body = { data: [center] };
    else if (path === "/expense-types") body = { data: expenses };
    else if (path === "/accounting-periods") body = { data: [{ _id: "period", period: "2026-09", status: "OPEN" }] };
    else if (path === "/notifications") body = { data: [], unreadCount: 0 };
    else if (path === "/dashboard/tasks") body = {};
    else if (path === "/requests/form-policy") body = { data: { documentRequirements: [], quotationPolicy: { enabled: false, minimumCount: 3 } } };
    else if (path === "/requests/budget-preview") {
      const payload = route.request().postDataJSON();
      const lines = parseRequestLines(payload.lines);
      previews.push(lines.reduce((sum, line) => sum + line.totalAmount, 0));
      body = { data: { status: "AVAILABLE", lines: [] } };
    } else if (["POST", "PUT"].includes(route.request().method()) && ["/requests", "/requests/saved"].includes(path)) {
      const raw = route.request().postData();
      const extract = key => raw.match(new RegExp('name="' + key + '"\\r\\n\\r\\n([^\\r]*)'))?.[1];
      submittedLines = JSON.parse(extract("lines"));
      const lines = parseRequestLines(submittedLines);
      saved = { ...form, _id: "saved", requestNumber: "SOL-2026-90001", status: "BORRADOR", updatedAt: new Date().toISOString(), requester: user, solicitor: user, supplier, requesterCostCenter: center, lines: lines.map((line, index) => ({ ...line, _id: "line-" + index, costCenter: center, expenseType: expense })), quotations: [], attachments: [], approvalHistory: [], totalNet: lines.reduce((sum, line) => sum + line.netAmount, 0), totalIGV: lines.reduce((sum, line) => sum + line.igvAmount, 0), totalAmount: lines.reduce((sum, line) => sum + line.totalAmount, 0) };
      body = { data: saved };
    } else if (path === "/requests/saved") body = { data: saved };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await mockWorkDrafts(page, { resume: true });
  await page.addInitScript(({ user, form, initialLine }) => {
    localStorage.setItem("erp_user", JSON.stringify(user));
    localStorage.setItem("erp_token", "isolated-test");
    if (!localStorage.getItem("item-test-init")) {
      localStorage.setItem("item-test-init", "true");
      localStorage.setItem("erp_language", "en");
      localStorage.setItem(`erp_request_autosave_${user._id}_new`, JSON.stringify({ form, lines: [initialLine], quotations: [], savedAt: new Date().toISOString() }));
    }
  }, { user, form, initialLine });
  await page.goto("http://127.0.0.1:5192/requests/new");
  const account = page.getByRole("button", { name: "Expense category for these items", exact: false });
  assert.match(await account.innerText(), /Select/, "Ambiguous accounts are not silently guessed");
  await account.click();
  await page.getByRole("option", { name: "Supplies", exact: true }).click();
  const card = page.locator(".request-item-card").first();
  const total = card.getByLabel("Final total", { exact: true });
  const includes = card.getByRole("checkbox");
  assert.equal(await includes.isChecked(), true);
  assert.equal(await card.locator("input").count(), 4);
  assert.equal(await card.locator("select").count(), 1);
  assert.equal(await total.evaluate(element => element.tagName), "OUTPUT", "Total is display-only");
  assert.equal(await card.getByLabel(/Net|Accounting total|Budget item/).count(), 0);
  await card.getByLabel("Item / service description", { exact: false }).fill("Laboratory supplies");
  await card.getByLabel("Quantity", { exact: false }).fill("3");
  await card.getByLabel("Unit price (PEN)", { exact: false }).fill("1000");
  assert.equal(await total.innerText(), "PEN 3,000.00");
  await includes.uncheck();
  assert.equal(await total.innerText(), "PEN 3,540.00");
  assert.match(await card.locator(".request-item-calculation").innerText(), /540\.00/);
  await page.waitForResponse(response => response.url().includes("budget-preview") && response.request().postData()?.includes('"totalAmount":3540'));
  assert.ok(previews.includes(3540));
  await card.getByLabel("Quantity", { exact: false }).fill("2.5");
  await card.getByLabel("Unit price (PEN)", { exact: false }).fill("19.99");
  assert.equal(await total.innerText(), "PEN 58.98");
  await card.getByLabel("Quantity", { exact: false }).fill("");
  assert.equal(await total.innerText(), "PEN 0.00");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  assert.match(await card.innerText(), /valid quantity/);
  await card.getByLabel("Quantity", { exact: false }).fill("3");
  await card.getByLabel("Unit price (PEN)", { exact: false }).fill("1000");
  await page.getByRole("button", { name: "Add line", exact: true }).click();
  const second = page.locator(".request-item-card").nth(1);
  await second.getByLabel("Item / service description", { exact: false }).fill("Additional supply");
  await second.getByLabel("Unit price (PEN)", { exact: false }).fill("10");
  assert.equal(await second.getByRole("checkbox").isChecked(), true);
  assert.match(await page.locator(".request-items-total").innerText(), /3,550\.00/);
  await second.getByRole("button", { name: "Remove line 2" }).click();
  await page.waitForFunction(async () => { const response = await fetch("http://127.0.0.1:5000/api/work-drafts"); return (await response.json()).data.some(draft => draft.value.lines[0].priceIncludesIGV === false); });
  await page.reload();
  // The request-information step is restored automatically.
  assert.equal(await includes.isChecked(), false);
  assert.equal(await total.innerText(), "PEN 3,540.00");
  await page.locator(".official-line-list").screenshot({ path: `${output}/desktop.png` });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.waitForURL("**/requests/saved");
  assert.equal(submittedLines[0].priceIncludesIGV, false);
  assert.equal(submittedLines[0].expenseType, "expense");
  assert.equal(submittedLines[0].costCenter, "center");
  assert.equal(saved.totalAmount, 3540);
  await page.goto("http://127.0.0.1:5192/requests/saved/edit");
  assert.equal(await total.innerText(), "PEN 3,540.00");
  assert.equal(await includes.isChecked(), false);
  await includes.check();
  assert.equal(await total.innerText(), "PEN 3,000.00");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.waitForURL("**/requests/saved");
  assert.equal(submittedLines[0].priceIncludesIGV, true);
  assert.equal(saved.totalAmount, 3000);
  await page.evaluate(() => localStorage.setItem("erp_language", "es"));
  await page.goto("http://127.0.0.1:5192/requests/saved/edit");
  assert.equal(await card.getByRole("checkbox", { name: "El precio unitario ya incluye IGV (18%)" }).isChecked(), true);
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No page overflow at ${width}px`);
    await card.screenshot({ path: `${output}/${width}.png` });
  }
  assert.deepEqual(errors, []);
  console.log("PASS: six-field items, both IGV modes, live changes, rounding, validation, multiple lines, budget preview, autosave, save/reopen, Spanish and responsive layouts");
} catch (error) {
  if (page) console.error("Overflow diagnostics:", await page.evaluate(() => [...document.querySelectorAll("body *")].filter((node) => { const rect = node.getBoundingClientRect(); return rect.width && rect.right > innerWidth + 1 && rect.left >= 0 && !node.closest(".table-scroll, .quotation-comparison"); }).map((node) => ({ tag: node.tagName, class: node.className, right: node.getBoundingClientRect().right, text: node.textContent.slice(0, 60) })).slice(0, 20)));
  await page?.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
