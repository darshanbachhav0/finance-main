# Background supplier RUC lookup

Entering an 11-digit RUC still checks the Supplier Master, fills company details from the local SUNAT Padrón, and retrieves legal representatives from Consulta RUC separately. A single representative fills automatically; when SUNAT returns several, the user selects the primary representative.

## Fast proposal entry (11 September 2026)

The automatic lookup starts after a 200 ms typing pause. Only the Supplier Master duplicate check gates the proposal form. The form then opens immediately while Padrón details load in the background, followed by legal representatives. Late autofill fills untouched, empty fields; it does not remount the form or replace manual edits and selected files. A duplicate or failed duplicate check never opens a new proposal, and failures do not trigger an endless automatic retry loop. Duplicate checks have a 10-second client timeout; background Padrón prefill has a 15-second client timeout and leaves manual entry available on failure.

Padrón searches use persistent, sorted binary indexes of RUC suffixes and UTF-8 byte offsets. Each indexed lookup locates the exact row without scanning the large text chunk. This also works with unsorted SUNAT records. Index files use eight bytes per record plus a small header; in-memory index caching is bounded at 64 MB. Concurrent index requests share preparation work. File size and modification time invalidate an outdated index, and dataset generations invalidate cached RUC results. Unsupported future chunk formats or files of 4 GB or more retain the correct streaming lookup.

Proposal prefill reads the existing local dataset without waiting for a full download, synchronization lock, or refresh. An out-of-date dataset starts a deduplicated background refresh, with a five-minute retry throttle. Prefill may use the existing configured acceptable-staleness window (seven days by default); missing or expired data returns an unavailable result promptly instead of supplying expired cached data. Supplier homologation and financial taxpayer validation retain their existing refresh and validation policy. Completing proposal fields is not homologation.

New Padrón datasets receive their indexes before activation. Existing installations can prepare the indexes once without downloading or importing the dataset again:

```powershell
npm run sunat:padron:index
```

Missing indexes are also built automatically on first use. On the development machine, preparing all 29 chunks for 18,394,155 records took 7.16 seconds. Three same-machine local service lookups improved from 325/973/2,851 ms to 5.8/5.9/18.8 ms in a fresh process after indexing. These measurements cover local Padrón lookup only; API/network latency, duplicate-check database latency, and SUNAT's external representative service are separate. The external service can still be slow, but it does not block the form.

Restart the backend after updating the source, and refresh the browser to load the new frontend build. The existing local dataset has already been indexed in this workspace. No database migration is needed.

Validation: `node backend/test/sunatPadronLookup.test.js` covers unsorted rows, byte boundaries, UTF-8/CRLF, missing RUCs, persistent index reuse, replaced datasets, concurrent index preparation, nonblocking refresh, and expired-cache rejection. The supplier browser suite also holds Padrón responses pending to verify immediate form entry, preservation of manual edits, duplicate blocking, and failed-check retry behavior.

Consulta RUC now runs in full Chromium's unified headless mode. The client identifies itself as `UMA-Finance/1.0 (SUNAT public RUC lookup)`. The service enforces headless mode even when an older launcher sets `SUNAT_REPRESENTATIVES_HEADLESS=false`. It never falls back to a visible browser. The updated BAT's browser installation check also runs invisibly.

The existing cache and concurrent-request deduplication remain active. A disconnected browser is recreated on the next lookup. SUNAT verification challenges and network failures are returned to the form; existing Padrón data stays available. Human verification is not automated or bypassed.

Restart the running backend to load the change, or use the updated `START_UMA_PUBLIC_FIXED.bat`. No Padrón rebuild or database migration is required for this change. Full Chromium must be installed: `npx playwright install chromium`.

Run `npm run test:supplier-ruc-ui --workspace frontend` from the repository root. This exercises the actual supplier form and backend representative service with isolated SUNAT/API fixtures, including no-window launch options, autofill, multiple representatives, cache reuse, concurrent lookups, browser recovery, human verification and network errors. It makes no external requests and does not create supplier records. Screenshots go to `.tmp/supplier-ruc-ui`.

Live verification on 7 September 2026 successfully retrieved the university's legal representative using the same headless mode and client identity. Future availability still depends on SUNAT's public service.

Reference: [Playwright unified Chromium headless mode](https://playwright.dev/docs/browsers#chromium-new-headless-mode).
