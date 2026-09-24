// Read-only status dump for the local SUNAT Padron dataset/worker (JSON to stdout); never syncs,
// indexes or starts anything. Reach for this to check readiness/freshness from an operator shell,
// a health check, or CI (--require-ready exits non-zero when not ready). Use syncSunatPadron.js,
// padronWorker.js or indexSunatPadron.js to actually change the dataset or its indexes.
import "dotenv/config";
import { getSunatPadronStatus } from "../src/services/sunatPadronService.js";
const status = await getSunatPadronStatus();
console.log(JSON.stringify(status,null,2));
if(process.argv.includes("--require-ready") && !status.ready)process.exitCode=1;
