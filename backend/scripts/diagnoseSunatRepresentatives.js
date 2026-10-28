/**
 * Safe local health check for the browser-based SUNAT representatives lookup.
 * Does not query any particular supplier or bypass human verification.
 * Usage: node backend/scripts/diagnoseSunatRepresentatives.js (from repo root)
 */
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { classifyRepresentativeLookupFailure, getSunatConsultaBrowser, closeSunatRepresentativesBrowser } from "../src/services/sunatConsultaRucRepresentativesService.js";
import { CONSULTA_RUC_URL, consultaRucPageState } from "../../shared/consultaRuc.mjs";
dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });
let browser;
try {
  console.log("[1/2] Checking the configured SUNAT browser...");
  browser = await getSunatConsultaBrowser();
  console.log("Chromium launched successfully.");
  console.log("[2/2] Checking SUNAT Consulta RUC access (no RUC sent)...");
  const page = await browser.newPage({ locale: "es-PE" });
  const response = await page.goto(CONSULTA_RUC_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  const status = response?.status() ?? 0;
  const body = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  console.log(`SUNAT HTTP status: ${status}`);
  if (consultaRucPageState({ bodyText: body }) === "CHALLENGE") {
    console.log("SUNAT is requesting human verification. Automatic representative lookup must remain pending.");
    process.exitCode = 2;
  } else if (status >= 200 && status < 400) {
    console.log("SUNAT page is reachable. Try a representative lookup in the app; this does not guarantee the representatives page is accessible.");
  } else {
    console.log("SUNAT page returned an unsuccessful status. Try later or consult SUNAT manually.");
    process.exitCode = 2;
  }
} catch (error) {
  const info = classifyRepresentativeLookupFailure(error);
  console.error(`${info.code}: ${info.message}`);
  process.exitCode = 1;
} finally {
  await closeSunatRepresentativesBrowser();
}
