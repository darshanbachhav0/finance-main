# Background supplier RUC lookup

Entering an 11-digit RUC still checks the Supplier Master, fills company details from the local SUNAT Padrón, and retrieves legal representatives from Consulta RUC separately. A single representative fills automatically; when SUNAT returns several, the user selects the primary representative.

Consulta RUC now runs in full Chromium's unified headless mode. The client identifies itself as `UMA-Finance/1.0 (SUNAT public RUC lookup)`. The service enforces headless mode even when an older launcher sets `SUNAT_REPRESENTATIVES_HEADLESS=false`. It never falls back to a visible browser. The updated BAT's browser installation check also runs invisibly.

The existing cache and concurrent-request deduplication remain active. A disconnected browser is recreated on the next lookup. SUNAT verification challenges and network failures are returned to the form; existing Padrón data stays available. Human verification is not automated or bypassed.

Restart the running backend to load the change, or use the updated `START_UMA_PUBLIC_FIXED.bat`. No Padrón rebuild or database migration is required for this change. Full Chromium must be installed: `npx playwright install chromium`.

Run `npm run test:supplier-ruc-ui --workspace frontend` from the repository root. This exercises the actual supplier form and backend representative service with isolated SUNAT/API fixtures, including no-window launch options, autofill, multiple representatives, cache reuse, concurrent lookups, browser recovery, human verification and network errors. It makes no external requests and does not create supplier records. Screenshots go to `.tmp/supplier-ruc-ui`.

Live verification on 7 September 2026 successfully retrieved the university's legal representative using the same headless mode and client identity. Future availability still depends on SUNAT's public service.

Reference: [Playwright unified Chromium headless mode](https://playwright.dev/docs/browsers#chromium-new-headless-mode).
