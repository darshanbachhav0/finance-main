// Isolated component checks; no backend or financial mutations.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../../.tmp/select-ui/", import.meta.url));
await mkdir(output, { recursive: true });
const server = await createServer({ root, configFile: `${root}/vite.config.js`, define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") }, server: { host: "127.0.0.1", port: 5192, strictPort: true }, logLevel: "error" });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined });
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  await page.route("**/__select-fixture", route => route.fulfill({ contentType: "text/html", body: `
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
    <script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { default: SearchSelect } = await import('/src/components/SearchSelect.jsx');
      const { default: Drawer } = await import('/src/components/Drawer.jsx');
      const { LanguageProvider } = await import('/src/context/LanguageContext.jsx');
      await import('/src/styles/global.css'); await import('/src/styles/workspace.css');
      localStorage.setItem('erp_language', 'en');
      const h = React.createElement;
      function Fixture() {
        const [value, setValue] = React.useState('');
        const [open, setOpen] = React.useState(true);
        return h(LanguageProvider, null, h(Drawer, { open, title: 'Selector fixture', onClose: () => setOpen(false),
          footer: h('button', { type: 'button' }, 'Save fixture') },
          h('div', { style: { height: '65vh' } }, 'Scrollable content'),
          h(SearchSelect, { label: 'Cost Center', value, onChange: setValue, options: Array.from({ length: 40 }, (_, i) => ({ value: String(i), label: 'Center ' + i + ' — Long department and laboratory description' })) }),
          h('button', { type: 'button', id: 'next-field' }, 'Next field'),
          h('output', { id: 'selection' }, value)));
      }
      ReactDOM.createRoot(document.getElementById('root')).render(h(Fixture));
    </script></body></html>` }));
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 740 });
    await page.goto("http://127.0.0.1:5192/__select-fixture");
    const trigger = page.locator(".search-select-trigger");
    await trigger.click();
    const input = page.getByRole("combobox");
    await input.waitFor();
    assert.equal(await input.evaluate(node => document.activeElement === node), true, "Opening focuses search");
    const box = await page.locator(".search-select-popover").boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= 741, `Popup stays inside ${width}px viewport`);
    assert.equal(await page.locator('[role="dialog"] .search-select-popover').count(), 1, "Popup remains in the dialog focus boundary");
    await input.fill("Center 39");
    await input.press("Enter");
    assert.equal(await page.locator("#selection").textContent(), "39");
    assert.equal(await trigger.evaluate(node => document.activeElement === node), true);
    await trigger.press("ArrowDown");
    await input.waitFor();
    await input.press("ArrowDown");
    assert.match(await input.getAttribute("aria-activedescendant"), /option-1$/);
    await input.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 1, "Escape closes only the selector");
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
    await trigger.click();
    await input.press("Tab");
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('[role="dialog"]'))), true);
    await trigger.click();
    await page.screenshot({ path: `${output}/select-${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  // Exercise the same shell in Spanish/dark mode with a long account name.
  const user = { _id: "layout-test", name: "María Rodríguez - Administración Financiera", role: "Admin", email: "layout@example.invalid" };
  await page.route(url => url.pathname.startsWith("/api/"), route => {
    const path = new URL(route.request().url()).pathname;
    const body = path === "/api/auth/me" ? { user }
      : path === "/api/dashboard/tasks" ? { items: [], total: 0, counters: {} }
      : path === "/api/notifications" ? { data: [], unreadCount: 0 }
      : { data: [], pagination: { total: 0, page: 1, pageSize: 10, totalPages: 1 } };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.evaluate(user => {
    localStorage.setItem("erp_token", "fixture-only");
    localStorage.setItem("erp_user", JSON.stringify(user));
    localStorage.setItem("erp_language", "es");
    localStorage.setItem("uma_theme", "dark");
    localStorage.setItem("uma_tour_done_layout-test", "true");
  }, user);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 740 });
    await page.goto("http://127.0.0.1:5192/requests");
    for (const selector of [".notification-button", ".user-menu-button"]) {
      const button = page.locator(selector);
      await button.click();
      const popup = page.locator(".topbar-popover");
      const box = await popup.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= 741, "Shell panel stays in the viewport");
      await page.keyboard.press("Escape");
      assert.equal(await popup.count(), 0);
      assert.equal(await button.evaluate(node => node === document.activeElement), true);
    }
    await page.screenshot({ path: `${output}/shell-dark-es-${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  assert.deepEqual(errors, []);
  console.log("PASS searchable selector: three viewports, drawer boundaries, filtering, selection, keyboard focus and Escape");
  console.log("PASS shell panels: three viewports, Spanish, dark mode, long account name and Escape focus return");
} finally {
  await browser?.close();
  await server.close();
}
