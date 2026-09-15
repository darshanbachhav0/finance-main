import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { createServer } from "vite";
import { chromium } from "playwright";
import app from "../../backend/src/app.js";
import User from "../../backend/src/models/User.js";
import WorkDraft from "../../backend/src/models/WorkDraft.js";

const db = `erp_drafts_browser_test_${process.pid}_${Date.now()}`;
await mongoose.connect(`mongodb://127.0.0.1:27017/${db}`);
const backend = app.listen(0, "127.0.0.1");
await new Promise(resolve => backend.on("listening", resolve));
const backendUrl = `http://127.0.0.1:${backend.address().port}`;
const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../../.tmp/work-drafts/", import.meta.url));
await mkdir(output, { recursive: true });
const vite = await createServer({ root, configFile: `${root}/vite.config.js`, server: { host: "127.0.0.1", port: 5196, strictPort: true }, logLevel: "error" });
await vite.listen();
let browser;
let failSaves = false;
const errors = [];
const mutations = [];
try {
  const userDoc = await User.create({ name: "Draft Tester", email: "draft-browser@test.local", passwordHash: "unused", role: "Admin" });
  const user = { _id: String(userDoc._id), name: userDoc.name, role: "Admin", area: "Finance" };
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || "dev_secret_change_me");
  browser = await chromium.launch({ headless: true });
  async function newPage(context) {
    const page = await context.newPage();
    page.on("pageerror", err => errors.push(err.message));
    page.on("dialog", dialog => dialog.accept());
    await page.route(url => url.pathname.startsWith("/api/"), async route => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace("/api", "");
      if (path.startsWith("/work-drafts")) {
        if (failSaves && request.method() !== "GET") return route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Connection interrupted"}' });
        const response = await fetch(`${backendUrl}${url.pathname}${url.search}`, { method: request.method(), headers: { Authorization: `Bearer ${token}`, "Content-Type": request.headers()["content-type"] || "application/json" }, body: request.method() === "GET" ? undefined : request.postDataBuffer() });
        return route.fulfill({ status: response.status, contentType: response.headers.get("content-type"), body: Buffer.from(await response.arrayBuffer()) });
      }
      let body = { data: [], pagination: { total: 0, page: 1, totalPages: 1, pageSize: 20 } };
      if (path === "/auth/me") body = { user };
      else if (path === "/notifications") body = { data: [], unreadCount: 0 };
      else if (path === "/dashboard/tasks") body = { items: [], total: 0, counters: {} };
      else if (path === "/dashboard/summary") body = { role: "Admin", metrics: [], recentRequests: [], byStatus: [], byType: [] };
      else if (path.startsWith("/suppliers/lookup/")) body = { found: false, normalizedIdentifier: path.split("/").at(-1) };
      else if (path.startsWith("/suppliers/padron/")) body = { found: true, data: { legalName: "Draft Supplier SAC", fiscalAddress: "Av. Lima 100", personType: "LEGAL_ENTITY", taxpayerStatus: "ACTIVO", domicileCondition: "HABIDO" } };
      else if (path.includes("/representatives")) body = { representatives: [] };
      else if (path === "/requests/authorized-cost-centers") body = { data: [{ _id: "center", code: "CC1", name: "Finance", active: true }] };
      else if (path === "/accounting-periods") body = { data: [{ _id: "period", period: new Date().toISOString().slice(0, 7), status: "OPEN" }] };
      else if (path === "/requests/form-policy") body = { data: { documentRequirements: [], quotationPolicy: { enabled: false } } };
      else if (path === "/requests/budget-preview") body = { data: { status: "PENDING_VALIDATION", lines: [] } };
      else if (request.method() !== "GET") { mutations.push(path); body = { data: { _id: "saved-bank" } }; }
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.addInitScript(({ user, token }) => { localStorage.setItem("erp_token", token); localStorage.setItem("erp_user", JSON.stringify(user)); localStorage.setItem("erp_language", "en"); }, { user, token });
    return page;
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await newPage(context);
  const origin = "http://127.0.0.1:5196";
  const saved = async p => { try { await p.getByText("Draft saved to your account", { exact: true }).waitFor({ timeout: 10000 }); } catch (err) { console.log("SESSION", await p.evaluate(async () => { const { draftSession } = await import("/src/utils/workDrafts.js"); const params = new URLSearchParams(location.search); const s = draftSession(`${JSON.parse(localStorage.erp_user)._id}:supplier:new:${params.get("workDraft") || "latest"}:0`, {}); return { loaded:s.loaded, closed:s.closed, status:s.status, inflight: !!s.inflight, dirty:s.signature !== s.savedSignature, timer:s.timer, visible:document.visibilityState }; })); console.log("DRAFT DEBUG", await p.locator(".work-draft-status").allTextContents(), await p.locator("textarea").evaluateAll(nodes => nodes.map(n => n.value)), errors); throw err; } };
  await page.goto(`${origin}/suppliers`);
  await page.getByRole("button", { name: "New supplier", exact: true }).click();
  await page.getByLabel("RUC / identifier", { exact: true }).fill("20600000001");
  await page.getByLabel("Legal Name", { exact: false }).waitFor();
  await page.getByLabel("Registration justification", { exact: false }).fill("Needed for the teaching programme");
  await page.getByLabel("Fiscal Address", { exact: true }).fill("Contact address entered by the requester");
  await page.getByRole("group", { name: "Commercial Contact", exact: true }).getByLabel("Contact name", { exact: true }).fill("Maria Contact");
  await page.locator('.supplier-official-form input[type="file"]').first().setInputFiles({ name: "supplier.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nSupplier document") });
  await saved(page);
  assert.equal(mutations.length, 0, "Autosave does not submit a supplier");
  // Last keystroke is flushed when closing, before the debounce expires.
  await page.getByLabel("Registration justification", { exact: false }).fill("Changed immediately before closing");
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.getByRole("button", { name: "New supplier", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('textarea')?.value === "Changed immediately before closing" || [...document.querySelectorAll('textarea')].some(input => input.value === "Changed immediately before closing"));
  assert.equal(await page.getByLabel("Fiscal Address", { exact: true }).inputValue(), "Contact address entered by the requester");
  await page.goto(origin);
  await page.getByRole("heading", { name: "Continue your work" }).waitFor();
  const supplierDraft = await WorkDraft.findOne({ owner: user._id, scope: "supplier", closed: false });
  assert.ok(supplierDraft);
  const otherContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const other = await newPage(otherContext);
  await other.goto(`${origin}/suppliers?workDraft=${supplierDraft._id}&workScope=supplier&workRecord=new`);
  await other.getByLabel("Registration justification", { exact: false }).waitFor();
  assert.equal(await other.getByLabel("Registration justification", { exact: false }).inputValue(), "Changed immediately before closing");
  assert.equal(await other.getByLabel("Fiscal Address", { exact: true }).inputValue(), "Contact address entered by the requester");
  assert.match(await other.locator(".draft-file-list").innerText(), /supplier.pdf/);
  assert.equal(await other.getByRole("group", { name: "Commercial Contact", exact: true }).getByLabel("Contact name", { exact: true }).inputValue(), "Maria Contact");
  await other.screenshot({ path: `${output}/supplier-mobile.png`, fullPage: false, animations: "disabled" });
  assert.ok(await other.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  // Two independent browser sessions edit the same server revision.
  await page.goto(`${origin}/suppliers?workDraft=${supplierDraft._id}&workScope=supplier&workRecord=new`);
  await page.getByLabel("Registration justification", { exact: false }).waitFor();
  await other.bringToFront();
  await other.getByLabel("Registration justification", { exact: false }).fill("Newer edit from another device");
  await saved(other);
  await page.bringToFront();
  await page.getByLabel("Registration justification", { exact: false }).fill("Keep this conflicting edit");
  await page.getByText("This draft changed in another session", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Keep as separate draft" }).click();
  await saved(page);
  assert.equal(await WorkDraft.countDocuments({ scope: "supplier", closed: false }), 2);
  // Offline changes survive a refresh in encrypted browser storage.
  await page.goto(`${origin}/reimbursement-bank`);
  await page.getByRole("button", { name: "Add bank profile", exact: true }).click();
  await page.getByLabel("Account Number", { exact: false }).fill("1234567890123");
  await saved(page);
  failSaves = true;
  await page.getByLabel("Account Number", { exact: false }).fill("9876543210123");
  await page.getByText("Not saved — check your connection", { exact: true }).waitFor();
  const cachedText = await page.evaluate(async () => { const db = await new Promise(resolve => { const req = indexedDB.open("uma-private-draft-outbox"); req.onsuccess = () => resolve(req.result); }); return new Promise(resolve => { const req = db.transaction("drafts").objectStore("drafts").getAll(); req.onsuccess = () => resolve(JSON.stringify(req.result)); }); });
  assert.ok(!cachedText.includes("9876543210123"), "Browser storage contains no plaintext bank number");
  await page.reload();
  await page.getByRole("button", { name: "Add bank profile", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('input')].some(input => input.value === "9876543210123"));
  failSaves = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await saved(page);
  await page.getByRole("button", { name: "Discard draft", exact: true }).click();
  await page.locator('.work-draft-confirm').getByRole("button", { name: "Discard draft", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(await WorkDraft.countDocuments({ scope: "employee-bank", closed: false }), 0);
  // The real request wizard restores its current step and values.
  await page.goto(`${origin}/requests/new`);
  await page.getByLabel("Requirement title", { exact: false }).fill("Saved financial request");
  await page.getByLabel("Detailed description", { exact: false }).fill("A retained description");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator(".request-item-card").waitFor();
  await saved(page);
  await page.reload();
  await page.locator(".request-item-card").waitFor();
  await page.locator(".workflow-stepper button").first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('input')].some(input => input.value === "Saved financial request"));
  assert.equal(await page.getByLabel("Detailed description", { exact: false }).inputValue(), "A retained description");
  assert.equal(mutations.length, 0);
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await page.waitForURL("**/login");
  await page.goto(`${origin}/requests/new`);
  await page.getByLabel("Requirement title", { exact: false }).waitFor();
  assert.equal(await page.getByLabel("Requirement title", { exact: false }).inputValue(), "Saved financial request");
  assert.deepEqual(errors, []);
  console.log("PASS: supplier close/reopen, cross-device files, conflict copy, encrypted offline recovery, discard, request recovery and mobile layout.");
} finally {
  await browser?.close(); await vite.close(); await new Promise(resolve => backend.close(resolve));
  if (mongoose.connection.name === db) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}


