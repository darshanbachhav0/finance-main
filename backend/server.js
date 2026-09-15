import "dotenv/config";

import { connectDB } from "./src/config/db.js";

import { getSunatPadronStatus } from "./src/services/sunatPadronService.js";

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

connectDB()
  .then(async () => {
    if (
      usesPublicPadron
    ) {
      const status = await getSunatPadronStatus();
      console.log(status.ready ? `[SUNAT PADRON] Local dataset ready (${status.manifest.datasetDate || "date unavailable"}). Updates run separately.` : "[SUNAT PADRON] No local dataset. Manual proposals remain available; taxpayer validation is pending.");
    }

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