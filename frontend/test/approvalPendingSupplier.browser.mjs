import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

// A request sent with a supplier that still waits for its proposer's jefe: the jefe sees the supplier
// on the approval page and on the request, approves both with one decision, or - when the supplier
// is not ready - sends the request back.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../../.tmp/approval-pending-supplier/", import.meta.url));
const origin = "http://127.0.0.1:5187";
const server = await createServer({ root, configFile: `${root}/vite.config.js`, server: { host: "127.0.0.1", port: 5187, strictPort: true }, logLevel: "error" });
const jefe = { _id: "jefe-user", name: "Requester Jefe", role: "Solicitor", area: "Operations", hasTeam: true };
const requestId = "64b000000000000000000001";
const supplier = { _id: "64b000000000000000000009", name: "Proveedor Nuevo S.A.C.", rucDni: "20600000005" };
const request = {
  _id: requestId, requestNumber: "REQ-2026-00042", title: "Laptop repair", description: "Laptop repair", status: "PENDIENTE_APROBACION",
  flowType: "A1", requestType: "OPEX", currency: "PEN", totalAmount: 118, accountingPeriod: "2026-10",
  requester: { _id: "requester", name: "Requester" }, supplier: { _id: supplier._id, legalName: supplier.name, rucDni: supplier.rucDni, homologationStatus: "PENDING_VALIDATION" },
  allowedActions: ["APPROVE", "OBSERVE", "REJECT"], lines: [], attachments: [], quotations: [], approvalHistory: [],
  approvalRouteSnapshot: [{ _id: "step-1", sequence: 1, status: "PENDING", source: "MANAGER_CHAIN", approvalLevel: "JEFE", approverUser: jefe._id, approverSnapshot: { name: jefe.name } }]
};
const readyApproval = { supplier, yours: true, ready: true, issues: [], approver: { _id: jefe._id, name: jefe.name }, adminFallback: false };
const incompleteApproval = { ...readyApproval, ready: false, issues: [{ code: "MISSING_RUC_FILE", field: "documents", message: "RUC_FILE is required for homologation." }] };
let browser;
const errors = [];
const decisions = [];
let supplierApproval = readyApproval;

try {
  await mkdir(output, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname.replace("/api", "");
    let body = { data: [], pagination: { total: 0, page: 1, totalPages: 1, pageSize: 20 } };
    if (path === "/auth/me") body = { user: jefe };
    else if (path === "/notifications") body = { data: [], unreadCount: 0 };
    else if (path === "/dashboard/tasks") body = { items: [], total: 0, counters: {} };
    else if (path === `/requests/${requestId}`) body = { data: request, related: {} };
    else if (path === `/requests/${requestId}/document-requirements`) body = { data: { currentPhase: "SUBMISSION", phases: { SUBMISSION: { requirements: [] } } } };
    else if (path === `/approvals/${requestId}/options`) body = { data: { chain: true, canForward: false, forwardTo: null, remainingPolicyStages: [], supplierApproval } };
    else if (method === "POST" && path.startsWith(`/approvals/${requestId}/`)) {
      decisions.push({ action: path.split("/").at(-1), body: route.request().postDataJSON() });
      body = { data: { ...request, status: "COMPROMISO_PRESUPUESTAL", allowedActions: [] } };
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.addInitScript((user) => {
    localStorage.setItem("erp_token", "isolated-approval-test");
    localStorage.setItem("erp_user", JSON.stringify(user));
    localStorage.setItem("erp_language", "en");
  }, jefe);

  // The approval page the email opens.
  await page.goto(`${origin}/approvals/${requestId}`);
  await page.getByText("New supplier: approving this request also approves it", { exact: true }).waitFor();
  assert.ok(await page.getByRole("link", { name: "Review the supplier", exact: true }).getAttribute("href").then((href) => href.endsWith(`/suppliers/${supplier._id}`)));
  await page.screenshot({ path: `${output}/approval-page.png`, animations: "disabled" });
  await page.getByRole("button", { name: "Approve supplier and request", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await page.getByText("Approved. Thank you.", { exact: true }).first().waitFor();
  assert.deepEqual(decisions.at(-1), { action: "approve", body: { comments: "", forward: false, approveSupplier: true } });

  // The request page: same panel, and the confirmation names the supplier.
  await page.goto(`${origin}/requests/${requestId}`);
  await page.getByText("New supplier: approving this request also approves it", { exact: true }).first().waitFor();
  assert.match(await page.locator("#next-step").innerText(), /Approve the new supplier and this request[\s\S]*Proveedor Nuevo S\.A\.C\. is a new supplier/);
  assert.ok(await page.locator("#next-step").getByRole("button", { name: "Approve supplier and request" }).isVisible());
  await page.locator("#request-actions").getByRole("button", { name: "Approve supplier and request", exact: true }).click();
  await page.getByRole("dialog").getByText("Approve the supplier and this request?", { exact: true }).waitFor();
  assert.match(await page.getByRole("dialog").innerText(), /Proveedor Nuevo S\.A\.C\. · RUC 20600000005/);
  await page.screenshot({ path: `${output}/request-confirm.png`, animations: "disabled" });
  await page.getByRole("dialog").getByRole("button", { name: "Approve and finalize", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.deepEqual(decisions.at(-1), { action: "approve", body: { comments: "", forward: false, approveSupplier: true } });

  // A supplier that cannot be approved yet: what is missing, no Approve, Send back still there.
  supplierApproval = incompleteApproval;
  await page.goto(`${origin}/approvals/${requestId}`);
  await page.getByText("The new supplier cannot be approved yet", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Approve/ }).count(), 0);
  assert.ok(await page.getByRole("button", { name: "Send back", exact: true }).isVisible());
  await page.goto(`${origin}/requests/${requestId}`);
  await page.getByText("The new supplier cannot be approved yet", { exact: true }).first().waitFor();
  assert.equal(await page.locator("#request-actions").getByRole("button", { name: "Approve supplier and request", exact: true }).isDisabled(), true);
  await page.screenshot({ path: `${output}/request-not-ready.png`, animations: "disabled" });
  assert.match(await page.locator("#next-step").innerText(), /Send this request back/);
  await page.locator("#next-step").getByRole("button", { name: "Send back" }).click();
  await page.getByRole("dialog").getByText("Send this request back?", { exact: true }).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();

  // Someone else's supplier: who approves it is named; the decision is the plain one.
  supplierApproval = { ...readyApproval, yours: false, approver: { _id: "other", name: "Other Jefe" } };
  await page.goto(`${origin}/approvals/${requestId}`);
  await page.getByText("Other Jefe approves it. The request can be finalized once the supplier is approved.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await page.getByText("Approved. Thank you.", { exact: true }).first().waitFor();
  assert.deepEqual(decisions.at(-1).body, { comments: "", forward: false });

  assert.deepEqual(errors, []);
  console.log("PASS: the jefe verifies a waiting supplier with the request: shown, approved together, or sent back when not ready.");
} finally {
  await browser?.close();
  await server.close();
}
