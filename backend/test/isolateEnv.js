import { fileURLToPath } from "node:url";

// Imported first by run.js. Some scripts under test load "dotenv/config", which would
// pull a developer's backend/.env (e.g. SUNAT_PROVIDER_MODE=PADRON with no local
// Padrón dataset) into every test. Point dotenv at a file that does not exist so the
// suite runs on its own defaults; tests that need a setting assign it explicitly.
process.env.DOTENV_CONFIG_PATH = fileURLToPath(new URL("./.env.none", import.meta.url));
process.env.DOTENV_CONFIG_QUIET = "true";
