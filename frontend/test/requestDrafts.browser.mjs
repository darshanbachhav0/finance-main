import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { createServer } from "vite";
import { chromium } from "playwright";
import app from "../../backend/src/app.js";
import User from "../../backend/src/models/User.js";
import WorkDraft from "../../backend/src/models/WorkDraft.js";

// New request drafts: New request opens a blank request, unfinished ones are listed and reopen by
// address, and Start another / Discard / Save draft behave without leaving empty drafts behind.
const db = `erp_request_drafts_browser_test_${process.pid}_${Date.now()}`;
await mongoose.connect(`mongodb://127.0.0.1:27017/${db}`);
const backend = app.listen(0, "127.0.0.1");
await new Promise(resolve => backend.on("listening", resolve));
const backendUrl = `http://127.0.0.1:${backend.address().port}`;
const root = fileURLToPath(new URL("../", import.meta.url));
const vite = await createServer({ root, configFile: `${root}/vite.config.js`, server: { host: "127.0.0.1", port: 5197, strictPort: true }, logLevel: "error" });
await vite.listen();
let browser;
const errors = [];
try {
  const userDoc = await User.create({ name: "Request Draft Tester", email: "request-drafts@test.local", passwordHash: "unused", role: "Admin" });
  const user = { _id: String(userDoc._id), name: userDoc.name, role: "Admin", area: "Finance" };
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || "dev_secret_change_me");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", err => errors.push(err.message));
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api", "");
    if (path.startsWith("/work-drafts")) {
      const response = await fetch(`${backendUrl}${url.pathname}${url.search}`, { method: request.method(), headers: { Authorization: `Bearer ${token}`, "Content-Type": request.headers()["content-type"] || "application/json" }, body: request.method() === "GET" ? undefined : request.postDataBuffer() });
      return route.fulfill({ status: response.status, contentType: response.headers.get("content-type"), body: Buffer.from(await response.arrayBuffer()) });
    }
    let body = { data: [], pagination: { total: 0, page: 1, totalPages: 1, pageSize: 20 } };
    if (path === "/auth/me") body = { user };
    else if (path === "/notifications") body = { data: [], unreadCount: 0 };
    else if (path === "/dashboard/tasks") body = { items: [], total: 0, counters: {} };
    else if (path === "/requests/authorized-cost-centers") body = { data: [{ _id: "center", code: "CC1", name: "Finance", active: true }] };
    else if (path === "/accounting-periods") body = { data: [{ _id: "period", period: new Date().toISOString().slice(0, 7), status: "OPEN" }] };
    else if (path === "/requests/form-policy") body = { data: { documentRequirements: [], quotationPolicy: { enabled: false } } };
    else if (path === "/requests/budget-preview") body = { data: { status: "PENDING_VALIDATION", lines: [] } };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.addInitScript(({ user, token }) => { localStorage.setItem("erp_token", token); localStorage.setItem("erp_user", JSON.stringify(user)); localStorage.setItem("erp_language", "en"); }, { user, token });
  const origin = "http://127.0.0.1:5197";
  const openDrafts = () => WorkDraft.countDocuments({ owner: user._id, scope: "request", closed: false });
  const settle = () => page.waitForTimeout(1500); // longer than the autosave debounce
  const saved = () => page.getByText("Saved", { exact: true }).waitFor({ timeout: 10000 });
  const draftOptions = async () => { if (!await page.locator(".work-draft-status > details").evaluate(node => node.open)) await page.locator(".work-draft-status > details > summary").click(); };
  const title = () => page.getByLabel("Requirement title", { exact: false });

  const hasValue = value => page.waitForFunction(text => [...document.querySelectorAll("input, textarea")].some(input => input.value === text), value);
  const lacksValue = value => page.waitForFunction(text => ![...document.querySelectorAll("input, textarea")].some(input => input.value === text), value);
  const draftInUrl = () => page.waitForFunction(() => new URLSearchParams(location.search).get("workDraft"));
  const panelTitles = () => page.locator(".continue-work-row strong").allInnerTexts();
  const ownPanel = () => page.locator(".work-draft-status");

  // Opening New request without typing saves nothing.
  await page.goto(`${origin}/requests/new`);
  await page.waitForFunction(() => document.querySelector("fieldset.work-draft-fields")?.disabled === false);
  await settle();
  assert.equal(await openDrafts(), 0, "Opening New request without typing saves no draft");

  // Once saved, the address names the draft, so a reload reopens it.
  await title().fill("Saved financial request");
  await saved();
  await draftInUrl();
  assert.equal(await openDrafts(), 1);
  await page.reload();
  await hasValue("Saved financial request");
  await settle();
  assert.equal(await openDrafts(), 1, "Restoring a draft does not create another one");

  // "New request" from the menu opens a blank request and lists the unfinished one by its title.
  await page.getByRole("link", { name: "New request", exact: true }).first().click();
  await lacksValue("Saved financial request");
  await page.locator(".continue-work").waitFor();
  assert.deepEqual(await panelTitles(), ["Saved financial request"]);
  await title().fill("Second request");
  await saved();
  await draftInUrl();
  assert.equal(await openDrafts(), 2);
  assert.deepEqual(await panelTitles(), ["Saved financial request"], "The open draft is not listed");

  // Start another draft keeps both and saves no empty one.
  await draftOptions();
  await ownPanel().getByRole("button", { name: "Start another draft", exact: true }).click();
  await lacksValue("Second request");
  await settle();
  assert.equal(await openDrafts(), 2, "Start another draft saves no empty draft");

  // Continue reopens a listed draft, even after starting another one.
  await page.locator(".continue-work-row", { hasText: "Saved financial request" }).getByRole("link", { name: "Continue", exact: true }).click();
  await hasValue("Saved financial request");

  // Save draft names the missing supplier instead of failing on the server.
  await page.getByLabel("Detailed description", { exact: false }).fill("A retained description");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.locator(".request-item-card").waitFor();
  await page.locator(".request-item-card").getByLabel("Item / service description", { exact: false }).fill("Projector");
  await page.locator(".request-item-card").getByLabel("Unit price", { exact: false }).first().fill("1500");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByText("Select a supplier.", { exact: true }).first().waitFor();
  assert.equal(new URL(page.url()).pathname, "/requests/new");

  // Discard removes only this draft and starts no replacement.
  await draftOptions();
  await ownPanel().getByRole("button", { name: "Discard draft", exact: true }).click();
  await ownPanel().locator(".work-draft-confirm").getByRole("button", { name: "Discard draft", exact: true }).click();
  await page.waitForURL(`${origin}/requests`);
  await settle();
  assert.equal(await openDrafts(), 1, "Discard leaves only the other draft");
  assert.deepEqual(errors, []);
  console.log("PASS: blank New request, draft address and reload, menu New request, start another, continue, supplier check on Save draft and discard.");
} finally {
  await browser?.close(); await vite.close(); await new Promise(resolve => backend.close(resolve));
  if (mongoose.connection.name === db) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
