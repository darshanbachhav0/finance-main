import "dotenv/config";

import mongoose from "mongoose";

import { connectDB } from "./src/config/db.js";

import { getSunatPadronStatus } from "./src/services/sunatPadronService.js";
import { getSunatProvider } from "./src/services/sunatService.js";

import app from "./src/app.js";
import { startInProcessWorkers, usesPublicPadron as usesPublicPadronMode } from "./src/workers/inProcessWorkers.js";

const PORT =
  process.env.PORT ||
  5000;

const usesPublicPadron = usesPublicPadronMode();

if (
  process.env.NODE_ENV ===
    "production" &&
  (
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET ===
      "dev_secret_change_me"
  )
) {
  throw new Error(
    "A strong JWT_SECRET is required in production."
  );
}

function warnIfSunatProviderMisconfigured() {
  const provider = getSunatProvider();
  // ProductionSunatProvider degrades to NotConfiguredSunatProvider (mode "PRODUCTION",
  // configured: false) when its required env vars are missing. Surface that gap loudly at
  // boot instead of letting an operator discover it via a 503 on the first real SUNAT call.
  if (provider.mode !== "PRODUCTION" || provider.configured) return;
  const missing = [];
  if (!process.env.SUNAT_API_BASE_URL) missing.push("SUNAT_API_BASE_URL");
  if (!process.env.SUNAT_API_TOKEN) missing.push("SUNAT_API_TOKEN");
  if (!process.env.SUNAT_TAXPAYER_ENDPOINT && !process.env.SUNAT_VOUCHER_ENDPOINT && !process.env.SUNAT_EXCHANGE_RATE_ENDPOINT) {
    missing.push("SUNAT_TAXPAYER_ENDPOINT or SUNAT_VOUCHER_ENDPOINT or SUNAT_EXCHANGE_RATE_ENDPOINT");
  }
  console.warn(
    `[SUNAT PROVIDER] SUNAT_PROVIDER_MODE resolves to PRODUCTION but the integration is not configured (missing: ${missing.join(", ") || "unknown"}). ` +
    "Every SUNAT taxpayer/voucher/exchange-rate call will fail with HTTP 503 until this is fixed. The server will still start."
  );
}

connectDB()
  .then(async () => {
    if (
      usesPublicPadron
    ) {
      const status = await getSunatPadronStatus();
      console.log(status.ready ? `[SUNAT PADRON] Local dataset ready (${status.manifest.datasetDate || "date unavailable"}). Updates run in the background worker.` : "[SUNAT PADRON] No local dataset. Manual proposals remain available; taxpayer validation is pending.");
    }

    warnIfSunatProviderMisconfigured();

    const server = app.listen(
      PORT,
      () => {
        console.log(
          `ERP Financial backend running on port ${PORT}`
        );
      }
    );

    // Batch invoices, SLA escalation and the Padrón refresh run in this process (see
    // src/workers/inProcessWorkers.js for the env flags that turn each one off).
    const workers = await startInProcessWorkers();

    let shuttingDown = false;
    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`${signal} received: stopping background workers and HTTP server...`);
      // Render allows ~30s between SIGTERM and SIGKILL; never hang past that on a slow batch.
      const forceExit = setTimeout(() => process.exit(0), 25000);
      forceExit.unref();
      server.close();
      await workers.stop();
      await mongoose.disconnect().catch(() => {});
      process.exit(0);
    };
    process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
    process.on("SIGINT", () => { void shutdown("SIGINT"); });
  })
  .catch((error) => {
    console.error(
      "Unable to start backend",
      error
    );

    process.exit(1);
  });