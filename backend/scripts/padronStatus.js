import "dotenv/config";
import { getSunatPadronStatus } from "../src/services/sunatPadronService.js";
const status = await getSunatPadronStatus();
console.log(JSON.stringify(status,null,2));
if(process.argv.includes("--require-ready") && !status.ready)process.exitCode=1;
