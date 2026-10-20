import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

// An A1 invoice issued by another RUC than the order's supplier. The request page says so once,
// with both RUCs and the button that opens the invoice upload, and nothing contradicts it. The
// request form stops it earlier: an invoice from another RUC than the chosen supplier is not sent.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../../.tmp/request-invoice-attention/", import.meta.url));
const origin = "http://127.0.0.1:5185";
const server = await createServer({ root, configFile: `${root}/vite.config.js`, server: { host: "127.0.0.1", port: 5185, strictPort: true }, logLevel: "error" });
const user = { _id: "requester-1", name: "Diego Arteaga", role: "Solicitor", area: "TESORERIA" };
const requestId = "6ad78bae36c0a7e5db18f6ae";
const supplier = { _id: "64c000000000000000000001", legalName: "Comercial Andina S.A.C.", rucDni: "20123456789", normalizedIdentifier: "20123456789", homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true, supplierCode: "PRV-0042" };
const request = {
  _id: requestId, requestNumber: "SOL-2026-00118", title: "Invoice E001-273 from RUC 20610378669", description: "Invoice E001-273", status: "OBSERVADO_SUNAT",
  flowType: "A1", requestType: "OPEX", expenseNature: "GOODS", currency: "PEN", totalAmount: 6136, accountingPeriod: "2026-10", issueDate: "2026-10-20",
  requester: { _id: user._id, name: user.name }, supplier, purchaseOrder: { _id: "po-1", poNumber: "OC-2026-0031" },
  observation: { code: "RUC_MISMATCH", detail: "The XML issuer RUC does not match the approved supplier.", observedAt: new Date().toISOString() },
  allowedActions: ["REGISTER_INVOICE"], lines: [], attachments: [], quotations: [],
  approvalHistory: [{ action: "RUC_MISMATCH", createdAt: new Date(Date.now() - 32 * 60000).toISOString() }],
  approvalRouteSnapshot: [{ _id: "s1", sequence: 1, status: "APPROVED", source: "MANAGER_CHAIN", approverSnapshot: { name: "Jefe" } }]
};
const related = { sunatVouchers: [{ _id: "v1", seriesNumber: "E001-273", rucIssuer: "20610378669", validationStatus: "OBSERVED", totalAmount: 6136 }] };
let browser;
const errors = [];
const writes = [];

try {
  await mkdir(output, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname.replace("/api", "");
    let body = { data: [], pagination: { total: 0, page: 1, totalPages: 1, pageSize: 20 } };
    if (path === "/auth/me") body = { user };
    else if (path === "/notifications") body = { data: [], unreadCount: 0 };
    else if (path === "/dashboard/tasks") body = { items: [], total: 0, counters: {} };
    else if (path === `/requests/${requestId}`) body = { data: request, related };
    else if (path === `/requests/${requestId}/document-requirements`) body = { data: { currentPhase: "INVOICE_REGISTRATION", phases: { SUBMISSION: { requirements: [] }, INVOICE_REGISTRATION: { requirements: [{ kind: "XML", minCount: 1, labelKey: "invoice" }] } } } };
    else if (path === "/suppliers") body = { data: [supplier], pagination: { total: 1, page: 1, totalPages: 1, pageSize: 100 } };
    else if (path === "/requests/authorized-cost-centers") body = { data: [{ _id: "center", code: "CC1", name: "Finance", active: true }] };
    else if (path === "/accounting-periods") body = { data: [{ _id: "period", period: new Date().toISOString().slice(0, 7), status: "OPEN" }] };
    else if (path === "/requests/form-policy") body = { data: { documentRequirements: [], quotationPolicy: { enabled: false } } };
    else if (path === "/requests/budget-preview") body = { data: { status: "PENDING_VALIDATION", lines: [] } };
    else if (path === "/requests/invoice-preview") body = { data: { source: "XML", invoice: { ruc: "20610378669", invoiceNumber: "E001-273", currency: "PEN", totalAmount: 6136, netAmount: 5200, igvAmount: 936, lines: [] }, supplier: null } };
    else if (method !== "GET" && !path.startsWith("/work-drafts")) writes.push(`${method} ${path}`);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.addInitScript((account) => {
    localStorage.setItem("erp_token", "isolated-invoice-test");
    localStorage.setItem("erp_user", JSON.stringify(account));
    localStorage.setItem("erp_language", "en");
  }, user);

  // The request page: one explanation, the requester holds it, nothing says otherwise.
  await page.goto(`${origin}/requests/${requestId}`);
  const card = page.locator("#next-step");
  await card.getByText("The invoice is from another supplier", { exact: true }).waitFor();
  assert.match(await card.innerText(), /Invoice E001-273 was issued by RUC 20610378669, but this purchase order is for Comercial Andina S\.A\.C\. \(RUC 20123456789\)/);
  assert.match(await page.locator(".request-journey").innerText(), /Waiting for the right invoice: the one uploaded is from another supplier\.[\s\S]*With you/);
  for (const gone of ["SUNAT could not verify it yet", "Needed from you", "Readiness check", "The XML issuer RUC does not match the approved supplier."]) {
    assert.equal(await page.getByText(gone, { exact: false }).count(), 0, `no "${gone}"`);
  }
  await page.screenshot({ path: `${output}/request-page.png`, animations: "disabled" });
  await card.getByRole("button", { name: "Upload the correct invoice" }).click();
  await page.locator("#request-section-register-a1-invoice-and-conformity").waitFor();
  assert.equal(await page.getByRole("tab", { name: "Documents" }).getAttribute("aria-selected"), "true");

  // The request form: the invoice says RUC 20610378669, the chosen supplier is another one.
  await page.goto(`${origin}/requests/new`);
  await page.waitForFunction(() => document.querySelector("fieldset.work-draft-fields")?.disabled === false);
  await page.getByLabel("Supplier invoice XML or PDF", { exact: true }).setInputFiles({ name: "E001-273.xml", mimeType: "application/xml", buffer: Buffer.from("<Invoice/>") });
  await page.getByText("This supplier is not registered yet.", { exact: false }).waitFor();
  await page.locator(".quick-supplier").getByRole("button", { name: /Supplier/ }).first().click();
  await page.getByRole("option", { name: /Comercial Andina/ }).click();
  await page.getByText("This invoice was issued by RUC 20610378669, not by the selected supplier. Choose the supplier that issued it.", { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/request-form.png`, animations: "disabled" });
  await page.getByLabel("Why is it needed?", { exact: false }).fill("For the accounting team");
  await page.getByRole("button", { name: /Send for approval|Submit/ }).last().click();
  await page.getByText("The attached invoice was issued by another RUC. Select the supplier that issued it (propose it if it is not registered), or attach this supplier's invoice.", { exact: true }).first().waitFor();
  assert.deepEqual(writes.filter((write) => write.startsWith("POST /requests") && !write.endsWith("invoice-preview")), [], "nothing is sent");

  assert.deepEqual(errors, []);
  console.log("PASS: an invoice from another supplier is explained once on the request and stopped on the form.");
} finally {
  await browser?.close();
  await server.close();
}
