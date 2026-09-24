// Rebuilds the local search indexes over an already-downloaded SUNAT Padron dataset only - it
// never downloads or syncs data itself and fails fast if no dataset exists yet. Reach for this
// after manually replacing/repairing chunk files, or if the index looks stale/corrupted but the
// dataset itself is fine. For downloading/refreshing the dataset, use syncSunatPadron.js or padronWorker.js.
import "dotenv/config";
import path from "node:path";
import { getSunatPadronStatus } from "../src/services/sunatPadronService.js";
import { preparePadronIndexes } from "../src/services/padronChunkIndex.js";

const status = await getSunatPadronStatus();
if (!status.ready) throw new Error("Download the SUNAT Padrón first using sunat:padron:sync.");
const start = performance.now();
const count = await preparePadronIndexes(path.join(status.dataDir, "current", "chunks"));
console.log(`Prepared ${count} local search indexes in ${((performance.now() - start) / 1000).toFixed(2)}s. No download or database import was needed.`);
