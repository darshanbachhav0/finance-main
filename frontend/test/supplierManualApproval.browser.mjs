import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";
import { mockWorkDrafts } from "./mockWorkDrafts.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../../.tmp/supplier-manual-approval/", import.meta.url));
const origin = "http://127.0.0.1:5199";
const server = await createServer({ root, configFile: `${root}/vite.config.js`, server: { host: "127.0.0.1", port: 5199, strictPort: true }, logLevel: "error" });
await mkdir(output, { recursive: true });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined });
  for (const [role, width] of [["Treasury", 1440], ["Solicitor", 390]]) {
    const user = { _id: "reviewer", name: "Supplier Reviewer", role, hasTeam: role === "Solicitor", area: "Operations" };
    const id = "507f1f77bcf86cd799439011";
    let approved = false, allowed = true, ready = true;
    const decisions = [], errors = [];
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    page.setDefaultTimeout(12000);
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(account => {
      localStorage.setItem("erp_token", "supplier-review-fixture");
      localStorage.setItem("erp_user", JSON.stringify(account));
      localStorage.setItem("erp_language", "es");
      localStorage.setItem(`uma_tour_done_${account._id}`, "true");
    }, user);
    const supplier = () => ({ _id: id, name: "Proveedor Manual SAC", legalName: "Proveedor Manual SAC", rucDni: "20600000017",
      supplierCode: "PRV-0017", departments: ["Operations"], proposedBy: { _id: "requester", name: "Requester" },
      personType: "LEGAL_ENTITY", fiscalAddress: "Av. Lima 100", homologationStatus: approved ? "HOMOLOGATED" : "PENDING_VALIDATION", active: approved,
      taxpayerStatus: "PENDING", taxpayerValidation: { status: "NOT_VERIFIED" },
      taxpayerLookup: { status: "UNAVAILABLE", identifier: "20600000017", legalName: "Proveedor Manual SAC", checkedAt: new Date().toISOString(), failureCode: "CONSULTA_ACCESS_RESTRICTED" },
      jefeApproval: approved ? { decision: "APPROVED", reviewMethod: "MANUAL_SUNAT_UNAVAILABLE", decidedBy: user, decidedAt: new Date().toISOString() } : { decision: "PENDING" },
      approval: approved ? null : { approver: user, financeReview: true },
      permissions: { canApprove: allowed && !approved }, documents: [], bankAccounts: [], auditHistory: [],
      sunatProvider: { state: "PRODUCTION", configured: true, variant: "CONSULTA_RUC" }
    });
    await page.route(url => url.pathname.startsWith("/api/"), async route => {
      const request = route.request(), path = new URL(request.url()).pathname.slice(4);
      let body = { data: [], pagination: { total: 0, page: 1, totalPages: 1, pageSize: 10 } };
      if (path === "/auth/me") body = { user };
      else if (path === "/notifications") body = { data: [], unreadCount: 0 };
      else if (path === "/dashboard/tasks") body = { items: [], total: 0, counters: {} };
      else if (path === `/suppliers/${id}/approval`) { decisions.push(request.postDataJSON()); approved = true; body = { data: supplier() }; }
      else if (path === `/suppliers/${id}`) body = { data: supplier() };
      else if (path === `/suppliers/${id}/homologation-readiness`) body = { data: { valid: ready, issues: ready ? [] : [{ code: "LEGAL_NAME_MISSING", message: "Legal name is required." }] } };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    await mockWorkDrafts(page);
    await page.goto(`${origin}/suppliers/${id}`);
    const button = page.getByRole("button", { name: "Aprobar proveedor manualmente", exact: true });
    await button.waitFor();
    await page.screenshot({ path: `${output}/${role}-before.png`, fullPage: true });
    await button.click();
    await page.getByText("Aprobado manualmente mientras SUNAT no estaba disponible. La verificación SUNAT sigue pendiente.", { exact: true }).waitFor();
    assert.deepEqual(decisions, [{ decision: "APPROVE" }], "one click sends exactly one approval without a confirmation dialog");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(await button.count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: `${output}/${role}-approved.png`, fullPage: true });
    approved = false; ready = false;
    await page.reload();
    await button.waitFor();
    assert.equal(await button.isDisabled(), true, "missing supplier requirements still block approval");
    allowed = false; ready = true;
    await page.reload();
    await page.getByRole("heading", { name: "Proveedor Manual SAC", exact: true }).first().waitFor();
    assert.equal(await button.count(), 0, "unrelated users have no approval action");
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("PASS: Treasury and jefe approve in one click during SUNAT outages; manual provenance, required fields, permissions and mobile layout verified.");
} finally { await browser?.close(); await server.close(); }
