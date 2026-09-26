// Long-running SUNAT public Padron daemon: takes a lock, refreshes on its own schedule with a
// heartbeat, and keeps running until SIGTERM/SIGINT (or once, with --once, for a bootstrap run
// from deploy tooling). Reach for this to run padron sync as a standing service/process manager
// entry outside the web server (production on Render runs the same loop in-process instead - see
// backend/src/workers/padronWorker.js and SUNAT_PADRON_WORKER_ENABLED). For a single manual
// refresh use syncSunatPadron.js instead; for status only, padronStatus.js.
import "dotenv/config";
import { runPadronWorker } from "../src/workers/padronWorker.js";

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

const result = await runPadronWorker({ once: process.argv.includes("--once"), shouldStop: () => stopping });
if (result.failed) process.exitCode = 1;
