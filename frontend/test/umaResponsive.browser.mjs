// Isolated presentation fixtures: never connects to a real finance API or submits a financial action.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../../.tmp/uma-ui/", import.meta.url));
await mkdir(output, { recursive: true });
const server = await createServer({ root, configFile: `${root}/vite.config.js`, define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") }, server: { host: "127.0.0.1", port: 5190, strictPort: true }, logLevel: "error" });
await server.listen();
let browser, page;
const failures = [], runtimeErrors = [], results = [];
const user = { _id: "uma-test", name: "María Rodríguez", email: "ui-test@example.invalid", role: "Admin", area: "Administración" };
const center = { _id: "center", code: "CC-001", name: "Laboratorios de Ciencias de la Salud", area: "Ciencias de la Salud", active: true, annualBudget: 240000, budgetMode: "ACTIVE" };
const expense = { _id: "expense", code: "603201", accountNumber: "603201", name: "Materiales de enseñanza y laboratorio", category: "OPEX", active: true };
const supplier = { _id: "supplier", legalName: "Suministros Académicos del Perú S.A.C.", name: "Suministros Académicos del Perú S.A.C.", rucDni: "20600000001", supplierCode: "PRV-001", active: true, homologationStatus: "HOMOLOGATED" };
const requests = ["Materiales de laboratorio para el semestre", "Mantenimiento de equipos de investigación", "Insumos para prácticas académicas"].map((title, index) => ({
  _id: `request-${index}`, requestNumber: `SOL-2026-0010${index}`, title, description: title, detailedDescription: title,
  flowType: "A1", requestType: "OPEX", expenseNature: "GOODS", priority: "MEDIA", status: index === 0 ? "PENDIENTE_APROBACION" : "BORRADOR",
  currency: "PEN", totalAmount: 11800 + index * 200, totalPENEquivalent: 11800 + index * 200, totalNet: 10000, totalIGV: 1800,
  supplier, solicitor: user, requester: user, requesterArea: "Ciencias de la Salud", requestingArea: "Ciencias de la Salud", requesterCostCenter: center,
  issueDate: "2026-09-07", accountingPeriod: "2026-09", createdAt: "2026-09-07T12:00:00Z", updatedAt: "2026-09-07T12:00:00Z",
  approvalDueAt: "2026-09-09T12:00:00Z", approvalStage: "AREA_DIRECTOR", businessJustification: "Materiales necesarios para las prácticas del semestre académico.",
  lines: [{ _id: "line", itemDescription: "Equipo para prácticas de laboratorio", quantity: 10, unitPrice: 1000, unitOfMeasure: "UNIT", costCenter: center, expenseType: expense, totalAmount: 11800, netAmount: 10000, igvAmount: 1800 }],
  quotations: [], attachments: [], approvalHistory: [], allowedActions: index === 0 ? ["APPROVE", "OBSERVE", "RETURN", "REJECT"] : ["EDIT", "SUBMIT", "DELETE"], budgetPreview: { status: "AVAILABLE", lines: [] },
  budgetStatus: "AVAILABLE", approvalRoute: [], payments: [], audit: []
}));
const plan = { _id: "plan", period: "2026", planningMode: "ANNUAL_MONTHLY", assignedAmount: 240000, committedAmount: 28000, executedAmount: 76000, paidAmount: 56000, availableAmount: 136000, distributedAmount: 216000, unallocatedAmount: 24000, __v: 0, costCenter: center, expenseType: expense, project: "", active: true,
  months: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, assignedAmount: 18000, committedAmount: index === 8 ? 8000 : 0, executedAmount: index < 4 ? 18000 : index === 4 ? 4000 : 0, paidAmount: index < 3 ? 18000 : index === 3 ? 2000 : 0, availableAmount: index < 4 ? 0 : index === 4 ? 14000 : index === 8 ? 10000 : 18000 })),
  adjustments: [{ operationId: "created-plan", action: "CREATED", amount: 240000, reason: "Presupuesto institucional aprobado para el ejercicio 2026", actorName: "Equipo de Presupuesto", at: "2026-01-05T15:00:00Z" }]
};
const paginate = (data) => ({ data, pagination: { total: data.length, page: 1, pageSize: 10, totalPages: 1 } });

try {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => runtimeErrors.push({ url: page.url(), error: error.message }));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const url = new URL(route.request().url()), path = url.pathname.slice(4);
    let body = paginate([]);
    if (path === "/auth/me") body = { user };
    else if (path === "/notifications") body = { data: [], unreadCount: 0 };
    else if (path === "/dashboard/tasks") body = { items: [{ key: "approval", path: "/approvals", label: "Pending approval", count: 3, tone: "amber" }], total: 3, counters: { approval: 3 } };
    else if (path === "/dashboard/summary") body = { role: "Admin", lastUpdated: "2026-09-07T15:00:00Z", metrics: [{ key: "requests", label: "Requests", value: 24, tone: "navy" }, { key: "pending", label: "Pending approval", value: 3, tone: "amber" }, { key: "budget", label: "Available budget", value: 136000, format: "currency", tone: "green" }], warnings: [{ key: "approval", label: "Pending approval", count: 3, path: "/approvals" }], byStatus: [{ _id: "BORRADOR", count: 8 }, { _id: "PENDIENTE_APROBACION", count: 3 }, { _id: "PAGADO", count: 13 }], recentRequests: requests, byType: [], budget: { totals: {}, allocations: [] } };
    else if (["/cost-centers", "/requests/authorized-cost-centers"].includes(path)) body = paginate([center]);
    else if (path === "/expense-types") body = paginate([expense]);
    else if (path === "/suppliers") body = paginate([supplier]);
    else if (path === "/projects") body = paginate([{ _id: "project", code: "LAB-2026", name: "Renovación de laboratorios", active: true }]);
    else if (path === "/accounting-periods") body = paginate([{ _id: "period", period: "2026-09", status: "OPEN" }]);
    else if (path === "/requests/form-policy") body = { data: { documentRequirements: [], quotationPolicy: { enabled: false, minimumCount: 0 } } };
    else if (path === "/requests/budget-preview") body = { data: { status: "AVAILABLE", lines: [] } };
    else if (path === "/requests/document-requirements") body = { data: [] };
    else if (path === "/requests" || path === "/approvals/inbox") body = { ...paginate(url.searchParams.get("search") ? [] : requests), summary: { total: 3, amount: 35400, oldestCreatedAt: "2026-09-07T12:00:00Z" } };
    else if (/^\/requests\/request-\d$/.test(path)) body = { data: requests.find((request) => path.endsWith(request._id)) };
    else if (path === "/budget/plans/plan") body = { data: plan };
    else if (path === "/budget/allocations") body = paginate([{ ...plan, source: "LINKED_ANNUAL_PLAN" }]);
    else if (path === "/budget/overview") body = { data: { totals: { assigned: 240000, committed: 28000, executed: 76000, paid: 56000, available: 136000 }, warnings: [] } };
    else if (path === "/reports/management") body = { data: { budget: { assigned: 240000, committed: 28000, executed: 76000, paid: 56000, available: 136000 }, byType: [{ _id: "CAPEX", total: 30000 }, { _id: "OPEX", total: 46000 }], byMonth: [{ _id: "2026-07", total: 22000 }, { _id: "2026-08", total: 30000 }, { _id: "2026-09", total: 24000 }], comparison: { currentPeriod: "2026-09", currentTotal: 24000, previousTotal: 30000, changePercent: -20 }, filterOptions: { areas: [center.area], projects: ["LAB-2026"], costCenters: [{ value: center._id, code: center.code, name: center.name }] } } };
    else if (path === "/treasury/queue") body = { ...paginate([{ ...requests[0], status: "PROGRAMADO", accountsPayable: { _id: "payable", status: "SCHEDULED", currency: "PEN", outstandingAmount: 11800, dueDate: "2026-09-15", paymentPriority: "NORMAL", flowType: "A1" }, eligibleBankAccounts: [{ _id: "account", bank: "BCP", currency: "PEN", cci: "00212300000012345678", preferred: true }] }]), summary: { PEN: 11800, USD: 0 } };
    else if (path === "/users") body = paginate([user]);
    else if (path === "/exchange-rates/current") body = { data: { rate: 3.75, sellingRate: 3.75, currency: "USD", date: "2026-09-07", providerMode: "MANUAL" } };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("http://127.0.0.1:5190/login");
  await page.getByRole("heading", { name: "Welcome to UMA" }).waitFor();
  await page.screenshot({ path: `${output}/login-desktop.png` });
  await page.getByRole("button", { name: "Show password" }).click();
  assert.equal(await page.getByLabel("Password", { exact: true }).getAttribute("type"), "text");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/login-mobile.png` });
  await page.evaluate((user) => { localStorage.setItem("erp_user", JSON.stringify(user)); localStorage.setItem("erp_token", "ui-test-only"); localStorage.setItem("erp_language", "en"); }, user);
  await page.goto("http://127.0.0.1:5190/");
  await page.locator(".stat-card-link").first().waitFor();
  assert.equal(await page.locator(".stat-card-link").first().getAttribute("href"), "/requests");
  await page.locator(".stat-card-link").first().click();
  await page.waitForURL("**/requests");
  await page.goto("http://127.0.0.1:5190/");
  await page.locator(".stat-card-link").first().waitFor();
  let releaseRefresh, signalRefresh;
  const refreshStarted = new Promise((resolve) => { signalRefresh = resolve; });
  const refreshRoute = (route) => new Promise((resolve) => { releaseRefresh = async () => { await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Refresh unavailable. Please retry." }) }); resolve(); }; signalRefresh(); });
  await page.route("**/api/dashboard/summary", refreshRoute);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await refreshStarted;
  assert.equal(await page.locator(".stat-card-link").count(), 3, "Refresh keeps the current cards visible");
  assert.equal(await page.locator(".dashboard-loading").count(), 0);
  await releaseRefresh();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.locator(".stat-card-link").count(), 3, "Failed refresh preserves last successful data");
  await page.unroute("**/api/dashboard/summary", refreshRoute);
  const paths = ["/", "/requests", "/requests/new", "/requests/request-0", "/approvals", "/budget", "/treasury", "/reports", "/suppliers", "/accounting", "/accounting/payables", "/accounting/periods", "/accounting/invoice-observations", "/accounting/sire", "/batch-invoices", "/reimbursement-bank", "/cost-centers", "/expense-types", "/exchange-rates", "/users", "/audit", "/configuration/projects", "/configuration/budget-allocations"];
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    for (const path of paths) {
      await page.goto(`http://127.0.0.1:5190${path}`);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll(".content *")].filter((node) => { const r = node.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 && !node.closest(".table-scroll, .quotation-comparison, .budget-month-table, .chart-table-scroll, .section-tabs, .accounting-line, .rendition-line"); }).slice(0, 8).map((node) => ({ tag: node.tagName, class: node.className, right: Math.round(node.getBoundingClientRect().right) })) }));
      const okay = overflow.document <= width + 1 && await page.locator(".content").isVisible();
      results.push({ path, width, okay });
      if (!okay) failures.push({ path, width, ...overflow });
      if ((width === 1440 && ["/", "/requests", "/budget", "/reports", "/requests/request-0"].includes(path)) || (width === 390 && ["/requests", "/budget", "/treasury", "/requests/new"].includes(path))) await page.screenshot({ path: `${output}/${width}-${path.replaceAll("/", "-") || "dashboard"}.png` });
    }
    console.log(`Checked ${paths.length} pages at ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:5190/requests");
  await page.getByRole("button", { name: "Open navigation" }).click();
  assert.equal(await page.locator(".sidebar").getAttribute("inert"), null);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".sidebar").getAttribute("inert"), "");
  assert.equal(await page.locator(".data-table").first().evaluate((node) => node.classList.contains("mobile-cards")), true, "Small screens use cards without horizontal table navigation");
  await page.locator(".table-search input").first().fill("no-such-record");
  await page.getByText("No matching results", { exact: true }).waitFor();
  await page.locator(".empty-state").getByRole("button", { name: "Clear filters" }).click();
  await page.getByText("SOL-2026-00100", { exact: true }).waitFor();
  await page.getByText("Table options", { exact: true }).first().click();
  await page.getByRole("button", { name: "Save current view" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("View name").fill("UMA saved view");
  await dialog.getByRole("button", { name: "Save view", exact: true }).click();
  assert.equal(await page.getByLabel("Saved views").inputValue(), "UMA saved view");
  await page.goto("http://127.0.0.1:5190/approvals");
  await page.locator(".row-details > summary").first().click();
  await page.locator(".decision-button:visible").first().click();
  await page.getByRole("dialog").getByText("Approve this request?", { exact: true }).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto("http://127.0.0.1:5190/budget");
  await page.getByRole("button", { name: "Create annual budget", exact: true }).click();
  await dialog.getByLabel("Budget year", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Close panel" }).focus();
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => document.activeElement.closest('[role="dialog"]') !== null), true);
  await page.keyboard.press("Escape");
  await page.evaluate(() => localStorage.setItem("erp_language", "es"));
  await page.reload();
  await page.getByRole("button", { name: "Crear presupuesto anual" }).click();
  await dialog.getByLabel("Presupuesto anual", { exact: true }).fill("120000");
  await dialog.getByLabel("Modalidad presupuestal", { exact: true }).selectOption("ANNUAL_MONTHLY");
  await page.screenshot({ path: `${output}/budget-drawer-spanish.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.keyboard.press("Escape");
  await page.evaluate(() => localStorage.setItem("erp_language", "en"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://127.0.0.1:5190/requests/request-0");
  await page.locator(".request-section-toggle").first().click();
  await page.locator(".request-section-content").first().waitFor({ state: "hidden" });
  assert.equal(await page.locator(".request-section-content").first().isVisible(), false);
  await page.emulateMedia({ media: "print" });
  assert.equal(await page.locator(".request-section-content").first().isVisible(), true);
  assert.equal(await page.locator(".uma-print-header").isVisible(), true);
  await page.screenshot({ path: `${output}/request-print.png` });
  await page.emulateMedia({ media: "screen" });
  await writeFile(`${output}/results.json`, JSON.stringify({ results, failures, runtimeErrors }, null, 2));
  assert.deepEqual(runtimeErrors, []);
  assert.deepEqual(failures, []);
  console.log(`PASS: ${results.length} responsive page checks, navigation, cards, search, saved views, approval dialog, budget dialog, focus, Spanish and printing`);
} catch (error) {
  await writeFile(`${output}/results.json`, JSON.stringify({ results, failures, runtimeErrors }, null, 2));
  if (page) await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
