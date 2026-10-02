// Render services configured manually also run this through npm run build.
const { spawnSync } = require("node:child_process");
const path = require("node:path");
if (process.env.RENDER === "true") {
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve(__dirname, "../node_modules/.cache/uma-chromium");
  const cli = path.join(path.dirname(require.resolve("playwright/package.json")), "cli.js");
  const result = spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit", env: process.env });
  if (result.error || result.status !== 0) {
    console.error("SUNAT browser installation failed; deployment cannot enable automatic lookup.");
    process.exit(1);
  }
  // Fail during build rather than exposing a broken lookup to users.
  const { chromium } = require("playwright");
  chromium.launch({ channel: "chromium", headless: true, timeout: 10000 })
    .then(browser => browser.close())
    .then(() => console.log("SUNAT Chromium launch check passed."))
    .catch(error => { console.error("SUNAT Chromium launch check failed:", error.message); process.exitCode = 1; });
}
