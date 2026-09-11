import "dotenv/config";
import path from "node:path";
import { getSunatPadronStatus } from "../src/services/sunatPadronService.js";
import { preparePadronIndexes } from "../src/services/padronChunkIndex.js";

const status = await getSunatPadronStatus();
if (!status.ready) throw new Error("Download the SUNAT Padrón first using sunat:padron:sync.");
const start = performance.now();
const count = await preparePadronIndexes(path.join(status.dataDir, "current", "chunks"));
console.log(`Prepared ${count} local search indexes in ${((performance.now() - start) / 1000).toFixed(2)}s. No download or database import was needed.`);
