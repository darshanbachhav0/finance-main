// One-shot SUNAT public Padron sync: downloads/refreshes the local dataset once and exits.
// Reach for this for a manual/on-demand refresh or in a cron-style scheduler that itself
// handles recurrence. For a long-running process that keeps refreshing on its own, use
// padronWorker.js instead; for a status check only, use padronStatus.js.
import "dotenv/config";

import {
  ensureSunatPadron,
  forceSyncSunatPadron,
  getSunatPadronStatus
} from "../src/services/sunatPadronService.js";

const force =
  process.argv.includes(
    "--force"
  );

try {
  const result =
    force
      ? await forceSyncSunatPadron()
      : await ensureSunatPadron();

  const status =
    await getSunatPadronStatus();

  console.log("");
  console.log(
    "SUNAT public Padrón is ready."
  );

  console.log(
    `Dataset date : ${
      result.datasetDate ||
      "not reported"
    }`
  );

  console.log(
    `Rows         : ${Number(
      result.rows || 0
    ).toLocaleString(
      "en-US"
    )}`
  );

  console.log(
    `Generated at : ${
      result.generatedAt ||
      "-"
    }`
  );

  console.log(
    `Data folder  : ${status.dataDir}`
  );

  console.log(
    `Changed      : ${
      result.changed
        ? "yes"
        : "no"
    }`
  );

  console.log("");

  process.exit(0);
} catch (error) {
  console.error("");
  console.error(
    "SUNAT public Padrón synchronization failed."
  );

  console.error(
    error?.stack ||
      error?.message ||
      error
  );

  console.error("");

  process.exit(1);
}