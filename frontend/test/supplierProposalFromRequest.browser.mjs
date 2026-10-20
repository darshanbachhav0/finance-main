import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";
import { mockWorkDrafts } from "./mockWorkDrafts.mjs";

// "Supplier not found? Propose it" on a request opens the supplier page with ?mode=new (and the
// invoice's RUC as ?ruc= when the request has one). It must show a new proposal: never the
// unfinished proposal of another supplier, which stays saved in Continue your work.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../../.tmp/supplier-proposal-from-request/", import.meta.url));
const origin = "http://127.0.0.1:5191";
const server = await createServer({ root, configFile: `${root}/vite.config.js`, server: { host: "127.0.0.1", port: 5191, strictPort: true }, logLevel: "error" });
const user = { _id: "proposal-test", name: "Proposal Tester", role: "Admin", area: "Administration" };
const company = (ruc) => `Proveedor ${ruc} S.A.C.`;
let browser;
const errors = [];
const lookups = [];

try {
  await mkdir(output, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api", "");
    let body = { data: [], pagination: { total: 0, page: 1, totalPages: 1, pageSize: 20 } };
    if (path === "/requests/invoice-preview") body = { data: { source: "XML", invoice: { ruc: "20600000005", invoiceNumber: "F001-00000123", currency: "PEN", totalAmount: 118, lines: [] }, supplier: null } };
    else assert.equal(route.request().method(), "GET", "nothing is submitted");
    if (path === "/auth/me") body = { user };
    else if (path === "/requests/authorized-cost-centers") body = { data: [{ _id: "center", code: "CC1", name: "Finance", active: true }] };
    else if (path === "/accounting-periods") body = { data: [{ _id: "period", period: new Date().toISOString().slice(0, 7), status: "OPEN" }] };
    else if (path === "/requests/form-policy") body = { data: { documentRequirements: [], quotationPolicy: { enabled: false } } };
    else if (path === "/requests/budget-preview") body = { data: { status: "PENDING_VALIDATION", lines: [] } };
    else if (path === "/notifications") body = { data: [], unreadCount: 0 };
    else if (path === "/dashboard/tasks") body = { items: [], total: 0, counters: {} };
    else if (path.startsWith("/suppliers/lookup/")) { lookups.push(path.split("/").at(-1)); body = { found: false, normalizedIdentifier: path.split("/").at(-1) }; }
    else if (path.startsWith("/suppliers/padron/")) {
      const ruc = path.split("/").at(-1);
      body = { found: true, ruc, data: { rucDni: ruc, legalName: company(ruc), personType: "LEGAL_ENTITY", fiscalAddress: `AV. ${ruc}`, taxpayerStatus: "ACTIVO", domicileCondition: "HABIDO", eligibleForHomologation: true } };
    } else if (path.includes("/representatives")) body = { representatives: [] };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  // Drafts behave as on the server, including reopening the latest one.
  const drafts = await mockWorkDrafts(page, { resume: true });
  await page.addInitScript((account) => {
    localStorage.setItem("erp_token", "isolated-proposal-test");
    localStorage.setItem("erp_user", JSON.stringify(account));
    localStorage.setItem("erp_language", "en");
  }, user);

  const legalName = () => page.getByLabel("Legal Name", { exact: false });
  const proposalRuc = () => page.locator(".supplier-official-form").getByLabel("RUC / identifier", { exact: false });
  const lookupRuc = () => page.getByLabel("RUC / identifier", { exact: true });
  const filledFromSunat = (ruc) => page.waitForFunction((name) => [...document.querySelectorAll("input")].some((input) => input.value === name), company(ruc));
  // Autosave waits 700 ms after an edit, so "Unsaved changes" is always seen before "Saved".
  const editedAndSaved = async () => {
    await page.getByText("Unsaved changes", { exact: true }).waitFor();
    await page.getByText("Saved", { exact: true }).waitFor();
  };
  const blankProposal = async () => {
    await lookupRuc().waitFor();
    await page.waitForFunction(() => !document.querySelector(".work-draft-fields")?.disabled);
    assert.equal(await lookupRuc().inputValue(), "");
    assert.equal(await page.locator(".supplier-official-form").count(), 0, "no earlier proposal is shown");
  };
  // Client-side navigation, as the app's own links do (the page and its draft sessions stay).
  const navigate = (path) => page.evaluate((target) => { history.pushState(null, "", target); dispatchEvent(new PopStateEvent("popstate")); }, path);

  // An unfinished proposal for another supplier, saved as a draft.
  await page.goto(`${origin}/suppliers`);
  await page.getByRole("button", { name: "New supplier", exact: true }).first().click();
  await lookupRuc().fill("20600000001");
  await filledFromSunat("20600000001");
  await legalName().fill("Previous supplier S.A.C.");
  await editedAndSaved();

  // From a request with an invoice: the invoice's RUC is checked and SUNAT fills the form.
  await page.goto(`${origin}/suppliers?mode=new&ruc=20600000002&returnTo=%2Frequests%2Fnew`);
  await filledFromSunat("20600000002");
  assert.equal(await proposalRuc().inputValue(), "20600000002");
  assert.equal(await legalName().inputValue(), company("20600000002"));
  assert.equal(await page.getByLabel("Fiscal Address", { exact: true }).inputValue(), "AV. 20600000002");
  assert.ok(lookups.includes("20600000002"), "the Supplier Master is checked for a duplicate");
  await page.screenshot({ path: `${output}/proposal-with-invoice-ruc.png`, animations: "disabled" });

  // Everything stays editable, the RUC included.
  await page.getByRole("button", { name: "Use another RUC", exact: true }).click();
  await lookupRuc().fill("20600000003");
  await filledFromSunat("20600000003");
  assert.equal(await proposalRuc().inputValue(), "20600000003");
  await legalName().fill("Corrected name S.A.C.");
  await editedAndSaved();

  // The address now names this proposal's draft, so a reload reopens it.
  const address = new URL(page.url());
  assert.equal(address.searchParams.get("workScope"), "supplier");
  assert.equal(address.searchParams.get("mode"), null);
  assert.equal(address.searchParams.get("ruc"), null);
  assert.equal(address.searchParams.get("returnTo"), "/requests/new");
  await page.reload();
  await page.waitForFunction(() => [...document.querySelectorAll("input")].some((input) => input.value === "Corrected name S.A.C."));
  assert.equal(await proposalRuc().inputValue(), "20600000003");

  // From a request without an invoice, opened again within the app: a blank proposal each time.
  await navigate("/requests");
  await page.locator(".supplier-official-form").waitFor({ state: "detached" });
  await navigate("/suppliers?mode=new&returnTo=%2Frequests%2Fnew");
  await blankProposal();
  await lookupRuc().fill("20600000004");
  await filledFromSunat("20600000004");
  await legalName().fill("Fourth supplier S.A.C.");
  await editedAndSaved();
  await navigate("/requests");
  await page.locator(".supplier-official-form").waitFor({ state: "detached" });
  await navigate("/suppliers?mode=new&returnTo=%2Frequests%2Fnew");
  await blankProposal();

  // Earlier proposals are kept as drafts.
  const saved = [...drafts.values()].filter((row) => row.scope === "supplier" && row.value);
  assert.deepEqual(saved.map((row) => row.value.entry.form.legalName).sort(), ["Corrected name S.A.C.", "Fourth supplier S.A.C.", "Previous supplier S.A.C."]);

  // The whole path: an invoice from an unregistered supplier dropped on a new request.
  await page.goto(`${origin}/requests/new`);
  await page.waitForFunction(() => document.querySelector("fieldset.work-draft-fields")?.disabled === false);
  await page.getByLabel("Supplier invoice XML or PDF", { exact: true }).setInputFiles({ name: "factura.xml", mimeType: "application/xml", buffer: Buffer.from("<Invoice/>") });
  await page.getByText("This supplier is not registered yet.", { exact: false }).waitFor();
  assert.match(await page.getByRole("link", { name: "Supplier not found? Propose it", exact: true }).getAttribute("href"), /[?&]ruc=20600000005(&|$)/);
  await page.getByRole("link", { name: "Propose the supplier", exact: true }).click();
  await filledFromSunat("20600000005");
  assert.equal(await proposalRuc().inputValue(), "20600000005");
  assert.match(new URL(page.url()).searchParams.get("returnTo"), /^\/requests\/new/);
  assert.deepEqual(errors, []);
  console.log("PASS: supplier proposal from a request opens new, with the invoice RUC looked up, editable, reload-safe and keeping earlier drafts.");
} finally {
  await browser?.close();
  await server.close();
}
