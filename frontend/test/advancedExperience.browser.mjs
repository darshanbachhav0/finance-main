import assert from "node:assert/strict";

// Invoked by the existing isolated fixture harness. No live API or financial writes.
export async function checkAdvancedExperience(page, user, output) {
  const base = "http://127.0.0.1:5190";
  await page.setViewportSize({ width: 1600, height: 1000 });
  user.role = "Admin";
  await page.goto(base);
  await page.getByRole("button", { name: "Customize dashboard", exact: true }).click();
  await page.locator(".widget-tools").first().getByRole("button", { name: "Hide", exact: true }).click();
  await page.locator(".toast-action").getByText("Undo", { exact: true }).click();
  assert.equal(await page.locator(".dashboard-primary").count(), 1);
  await page.getByRole("button", { name: "Move down: Recent work", exact: true }).click();
  await page.reload();
  assert.equal(await page.locator(".dashboard-widget").first().locator(".dashboard-primary").count(), 0);
  await page.getByRole("button", { name: "Customize dashboard", exact: true }).click();
  await page.getByRole("button", { name: "Restore default layout", exact: true }).click();
  await page.getByRole("button", { name: "Customize dashboard", exact: true }).click();

  await page.getByRole("button", { name: "Workspace help", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Start workspace tour", exact: true }).click();
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await dialog.getByRole("heading", { name: "Administration", exact: true }).waitFor();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Accessibility settings", exact: true }).click();
  await dialog.getByLabel("Reduce motion", { exact: true }).check();
  await dialog.getByLabel("High contrast", { exact: true }).check();
  await dialog.getByLabel("Larger text", { exact: true }).check();
  await page.keyboard.press("Escape");
  await page.reload();
  assert.equal(await page.locator("html").getAttribute("data-reduce-motion"), "true");
  assert.equal(await page.locator("html").getAttribute("data-high-contrast"), "true");
  await page.locator(".dashboard-primary").waitFor();
  await page.screenshot({ path: `${output}/accessible-dashboard.png` });
  await page.getByRole("button", { name: "Accessibility settings", exact: true }).click();
  await dialog.getByLabel("High contrast", { exact: true }).uncheck();
  await dialog.getByLabel("Larger text", { exact: true }).uncheck();
  await dialog.getByLabel("Reduce motion", { exact: true }).uncheck();
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Search requests, suppliers, RUC, invoices...").fill("20600000001");
  await page.locator('[role="option"]').filter({ hasText: "Supplier · 20600000001" }).waitFor();
  await page.keyboard.press("Escape");

  await page.route("**/api/notifications?**", route => route.fulfill({ json: { unreadCount: 2, data: [
    { _id: "sla-alert", type: "SLA_OVERDUE", title: "Approval overdue", message: "Review the pending request", path: "/approvals", createdAt: new Date().toISOString() },
    { _id: "payment-alert", type: "PAYMENT_CONFIRMED", title: "Bank confirmation received", message: "Payment evidence recorded", path: "/treasury/history", createdAt: new Date().toISOString() }
  ] } }));
  await page.getByRole("button", { name: "Open task notifications", exact: true }).click();
  await page.locator(".notification-filters").getByRole("button", { name: "SLA", exact: true }).click();
  await page.getByText("Approval overdue", { exact: true }).waitFor();
  assert.equal(await page.locator(".notification-item").count(), 1);
  await page.getByRole("button", { name: "Open task notifications", exact: true }).click();

  let secondPage = false;
  await page.route("**/api/treasury/queue?**", route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("pageSize") !== "100") return route.fallback();
    const second = params.get("page") === "2"; if (second) secondPage = true;
    return route.fulfill({ json: { data: [{ _id: second ? "ap-2" : "ap-1", requestId: "request-0", requestNumber: "SOL-2026-00100", accountsPayable: { _id: second ? "ap-2" : "ap-1", outstandingAmount: second ? 20 : 100, currency: second ? "USD" : "PEN", scheduledFor: "2026-09-05" } }], pagination: { totalPages: 2, page: second ? 2 : 1 } } });
  });
  await page.route("**/api/treasury/payment-confirmations?**", route => {
    if (new URL(route.request().url()).searchParams.get("pageSize") !== "100") return route.fallback();
    return route.fulfill({ json: { data: [{ _id: "ap-1", requestId: "request-0", requestNumber: "SOL-2026-00100", accountsPayable: { _id: "ap-1", outstandingAmount: 100, currency: "PEN", scheduledFor: "2026-09-05" } }], pagination: { totalPages: 1 } } });
  });
  await page.goto(`${base}/treasury`);
  await page.getByRole("button", { name: "Payment calendar", exact: true }).click();
  await dialog.getByLabel("Date", { exact: true }).fill("2026-09-01");
  await page.locator(".calendar-records article").first().waitFor();
  assert.equal(await page.locator(".calendar-records article").count(), 2);
  assert.equal(secondPage, true);
  await page.locator('.payment-calendar button:has(time[datetime="2026-09-05"])').click();
  assert.equal(await page.locator(".calendar-records article").count(), 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/payment-calendar-mobile.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${base}/treasury`);
  await page.locator(".link-button").filter({ hasText: "SOL-2026-00100" }).first().click();
  await page.locator(".resizable-preview").waitFor();
  await page.getByLabel("Panel width", { exact: true }).fill("440");
  assert.equal(Math.round((await page.locator(".resizable-preview").boundingBox()).width), 440);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator(".resizable-preview").getByRole("button", { name: "Close", exact: true }).click();

  await page.goto(`${base}/batch-invoices`);
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles({ name: "invalid.exe", mimeType: "application/octet-stream", buffer: Buffer.from("not permitted") });
  await page.getByText("This file type is not accepted. Check the allowed formats.", { exact: true }).waitFor();
  await input.setInputFiles({ name: "invoices.zip", mimeType: "application/zip", buffer: Buffer.from("local selection only") });
  await page.getByText("Selected locally. Upload completes when you save.", { exact: true }).waitFor();

  user.role = "Management";
  await page.goto(`${base}/reports`);
  await page.getByRole("button", { name: "Presentation mode", exact: true }).click();
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await page.locator(".presentation-slide").getByText("Monthly spending trend", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Auto-play", exact: true }).click();
  await dialog.getByRole("button", { name: "Pause", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".presentation-slide .recharts-area-curve").waitFor();
  await page.screenshot({ path: `${output}/management-presentation.png` });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.keyboard.press("Escape");

  user.role = "Admin";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/requests/request-0`);
  await page.locator(".mobile-action-panel > summary").click();
  await page.locator(".mobile-action-panel").getByRole("button", { name: "Approve", exact: true }).click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.evaluate(() => localStorage.setItem("erp_language", "es"));
  await page.goto(base);
  await page.getByRole("button", { name: "Opciones de accesibilidad", exact: true }).click();
  await dialog.getByLabel("Reducir animaciones", { exact: true }).check();
  await page.screenshot({ path: `${output}/accessibility-spanish-mobile.png` });
  await page.keyboard.press("Escape");
  await page.evaluate(() => localStorage.setItem("erp_language", "en"));
  console.log("PASS advanced UX: widgets/undo/persistence, role tour, accessibility, search, bell categories, complete paginated calendar, resizable preview, upload validation, presentation, mobile actions and Spanish");
}
