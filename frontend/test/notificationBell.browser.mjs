import { mockWorkDrafts } from "./mockWorkDrafts.mjs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({ root, configFile: `${root}/vite.config.js`, server: { host: "127.0.0.1", port: 5188, strictPort: true }, logLevel: "error" });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.clock.install();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const user = { _id: "accountant", name: "Accounting Tester", role: "Accounting", area: "Finance" };
  let notifications = [];
  let failTasks = false;
  let failRead = false;
  let fetches = 0;
  const profile = { _id: "profile-1", user: { name: "Employee One" }, bank: "BCP", currency: "PEN", active: true, verificationStatus: "PENDING", accountNumberMasked: "******1234" };
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname.replace("/api", "");
    let body = { data: [] };
    if (path === "/auth/me") body = { user };
    else if (path === "/employee-bank-accounts") body = { data: [profile, { ...profile, _id: "profile-2", user: { name: "Employee Two" } }] };
    else if (path === "/notifications") {
      fetches++;
      body = { data: notifications, unreadCount: notifications.filter(item => !item.readAt).length };
    } else if (path === "/dashboard/tasks") {
      if (failTasks) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Unavailable" }) });
      body = { items: [{ key: "employeeBankReviews", label: "Reimbursement bank profiles awaiting review", count: 2, path: "/reimbursement-bank?verificationStatus=PENDING", tone: "amber" }], total: 2, counters: {} };
    } else if (path.startsWith("/notifications/") && route.request().method() === "PATCH") {
      if (failRead) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Read failed" }) });
      notifications = notifications.map(item => path === "/notifications/read-all" || path === `/notifications/${item._id}/read` ? { ...item, readAt: new Date().toISOString() } : item);
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await mockWorkDrafts(page);
  await page.addInitScript(user => {
    localStorage.setItem("erp_user", JSON.stringify(user));
    localStorage.setItem("erp_token", "test-token");
    localStorage.setItem("erp_language", "en");
  }, user);
  await page.goto("http://127.0.0.1:5188/reimbursement-bank");
  const bell = page.getByRole("button", { name: "Open task notifications", exact: true });
  await bell.click();
  await page.getByText("Reimbursement bank profiles awaiting review", { exact: true }).waitFor();
  await page.getByText("No notifications yet.", { exact: true }).waitFor();
  await bell.click();
  const incoming = id => ({ _id: id, title: "Reimbursement bank profile awaiting review", message: "BCP / PEN: a reimbursement bank profile needs Accounting verification.", path: "/reimbursement-bank?record=profile-1" });
  notifications = [incoming("notification-1")];
  // Another user's action is picked up without navigating or opening the bell.
  await page.clock.fastForward(31000);
  await page.locator('.notification-dot[aria-label="1 unread notifications"]').waitFor();
  await bell.click();
  assert.equal(await page.locator(".notification-dot").innerText(), "1", "Task count is not added to unread count");
  await page.locator(".notification-item").click();
  await page.waitForURL("**/reimbursement-bank?record=profile-1");
  await page.getByText("Showing the bank profile linked from your notification.", { exact: true }).waitFor();
  await page.getByText("Employee One", { exact: true }).first().waitFor();
  assert.equal(await page.getByText("Employee Two", { exact: true }).count(), 0, "Link targets the specific bank profile");
  await page.locator('.notification-dot[aria-label="Pending tasks"]').waitFor();
  notifications.push(incoming("notification-2"));
  failTasks = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.locator('.notification-dot[aria-label="1 unread notifications"]').waitFor();
  await bell.click();
  await page.getByText("Some alerts could not be refreshed. Try again.", { exact: false }).waitFor();
  assert.equal(await page.locator(".notification-item").count(), 2, "Task-summary failure does not erase alerts");
  failRead = true;
  await page.getByRole("button", { name: "Mark all read", exact: true }).click();
  await page.getByText("Could not mark notifications as read. Try again.", { exact: false }).waitFor();
  assert.equal(await page.locator(".notification-dot").innerText(), "1");
  failRead = false;
  failTasks = false;
  await page.getByRole("button", { name: "Mark all read", exact: true }).click();
  await page.locator('.notification-dot[aria-label="Pending tasks"]').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await page.locator(".task-popover").boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 391, "Bell fits the mobile viewport");
  assert.ok(fetches >= 4);
  assert.deepEqual(errors, []);
  console.log("Notification bell: polling, unread count, deep links, read actions, independent errors and mobile layout passed.");
} finally {
  await browser?.close();
  await server.close();
}
