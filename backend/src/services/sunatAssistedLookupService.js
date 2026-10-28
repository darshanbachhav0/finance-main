import { AppError } from "../utils/AppError.js";
import { CONSULTA_RUC_URL } from "../../../shared/consultaRuc.mjs";
import { extractConsultaFields, consultaNotFoundProfile, rememberConsultaRucProfile, clearConsultaRucProfile } from "./sunatConsultaRucRepresentativesService.js";
import { classifyConsultaFailure } from "./supplierPadronLookupService.js";

const TIMEOUT_MS = 180_000;

// A visible browser must open on the operator's own PC, never on a deployment
// server or in response to a remote client's request. Use the actual socket,
// rather than forwarded headers, to enforce this boundary.
export function assistedConsultaAvailable(req, { platform = process.platform, env = process.env } = {}) {
  const address = req.socket?.remoteAddress || "";
  return platform === "win32" && env.NODE_ENV !== "production" && env.RENDER !== "true"
    && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
}

// The human completes any challenge. Automation touches only the ordinary RUC
// search form and reads the result returned by SUNAT in that same browser.
export async function readAssistedConsultaPage(page, ruc, { timeout = TIMEOUT_MS } = {}) {
  const input = page.locator('input[name="search1"]:visible, input[name="nroRuc"]:visible, input[placeholder*="RUC" i]:visible').first();
  await input.waitFor({ state: "visible", timeout });
  await input.fill(ruc);
  await page.getByRole("button", { name: /^buscar$/i }).first().click({ noWaitAfter: true });
  const result = await page.waitForFunction(({ ruc }) => {
    const text = (document.body?.innerText || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toUpperCase();
    if (/NUMERO DE RUC\s*:\s*\d{11}\s*-/.test(text)) return "PROFILE";
    if (text.includes(ruc) && /CONSULTADO NO ES VALIDO/.test(text)) return "NOT_FOUND";
    return false;
  }, { ruc }, { timeout });
  const state = await result.jsonValue();
  await result.dispose();
  if (state === "NOT_FOUND") {
    clearConsultaRucProfile(ruc);
    return { ...consultaNotFoundProfile(ruc), assisted: true };
  }
  return { ...rememberConsultaRucProfile(ruc, await extractConsultaFields(page)), assisted: true };
}

export async function lookupAssistedConsultaRuc(rucValue, { signal, launchBrowser } = {}) {
  const ruc = String(rucValue || "").replace(/\D/g, "");
  if (!/^\d{11}$/.test(ruc)) throw new AppError(422, "SUNAT lookup requires an 11-digit RUC.");
  let browser;
  let context;
  let expired = false;
  let timer;
  const close = () => browser?.close().catch(() => {});
  try {
    if (signal?.aborted) throw new AppError(409, "SUNAT browser verification was cancelled. Retry when you are ready.");
    const launch = launchBrowser || (async () => {
      const { chromium } = await import("playwright");
      const executablePath = String(process.env.PLAYWRIGHT_EXECUTABLE_PATH || "").trim();
      return chromium.launch({ headless: false, timeout: 10000, ...(executablePath ? { executablePath } : { channel: "chromium" }) });
    });
    browser = await launch();
    signal?.addEventListener("abort", close, { once: true });
    if (signal?.aborted) throw new AppError(409, "SUNAT browser verification was cancelled. Retry when you are ready.");
    timer = setTimeout(() => { expired = true; void close(); }, TIMEOUT_MS);
    context = await browser.newContext({ locale: "es-PE" });
    const page = await context.newPage();
    await page.goto(CONSULTA_RUC_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.bringToFront();
    return await readAssistedConsultaPage(page, ruc);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (expired || error.name === "TimeoutError") throw new AppError(408, "SUNAT browser verification timed out. Retry and complete the verification in the SUNAT window.");
    if (signal?.aborted || /has been closed/i.test(error.message)) throw new AppError(409, "SUNAT browser verification was cancelled. Retry when you are ready.");
    const failure = classifyConsultaFailure(error);
    throw new AppError(503, failure.message, { requiresConfiguration: failure.requiresConfiguration }, failure.code);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", close);
    await context?.close().catch(() => {});
    await close();
  }
}
