import "dotenv/config";

import { connectDB } from "./src/config/db.js";

import { getSunatPadronStatus } from "./src/services/sunatPadronService.js";
import { getSunatProvider } from "./src/services/sunatService.js";

import app from "./src/app.js";

const PORT =
  process.env.PORT ||
  5000;

const sunatMode =
  String(
    process.env
      .SUNAT_PROVIDER_MODE ||
      ""
  )
    .trim()
    .toUpperCase();

const usesPublicPadron =
  [
    "PADRON",
    "PUBLIC_PADRON",
    "PUBLIC-PADRON"
  ].includes(
    sunatMode
  );

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
      console.log(status.ready ? `[SUNAT PADRON] Local dataset ready (${status.manifest.datasetDate || "date unavailable"}). Updates run separately.` : "[SUNAT PADRON] No local dataset. Manual proposals remain available; taxpayer validation is pending.");
    }

    warnIfSunatProviderMisconfigured();

    app.listen(
      PORT,
      () => {
        console.log(
          `ERP Financial backend running on port ${PORT}`
        );
      }
    );
  })
  .catch((error) => {
    console.error(
      "Unable to start backend",
      error
    );

    process.exit(1);
  });