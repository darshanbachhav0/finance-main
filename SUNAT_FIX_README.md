# UMA Finance — SUNAT Legal Representative Lookup Fix

This package updates **only** the legal-representative lookup and its UI. It does not disable or change the separate taxpayer RUC validation, document verification, supplier approval, financial payments or database records.

## What changed
- Uses Chromium's actual user-agent instead of a custom non-browser identifier.
- Classifies missing Chromium, browser launch failures, SUNAT human verification, access restriction, timeouts, and generic failures; no internal file paths returned to the browser.
- Adds a retry button in both full Supplier registration and the quick registration form, preserving already entered information.
- Adds `backend/scripts/diagnoseSunatRepresentatives.js`, which checks Chromium and the SUNAT landing page without querying a supplier.
- Adds four focused error-classification tests.

## Apply updated-file ZIP (Windows PowerShell)
1. Stop the dev server (`Ctrl+C`). Back up your project.
2. From project root:

```powershell
cd "C:\Users\TI-SJL-0010\Downloads\finance-main-triple-track-updated\finance-main"
Expand-Archive -Path "$env:USERPROFILE\Downloads\UMA_SUNAT_Representative_Fix_Changed_Files.zip" -DestinationPath "." -Force
npx playwright install chromium
node .\backend\scripts\diagnoseSunatRepresentatives.js
node --test .\backend\test\sunatRepresentativesFailure.test.js
npm run dev
```

If diagnosis cannot launch Chromium, run `npm ci` to restore dependencies, then rerun `npx playwright install chromium`.

## Interpreting the diagnosis
- **Chromium launched + SUNAT HTTP 200**: opening the public page works. Try RUC lookup again; the legal-representatives subsection may still be unavailable.
- **Browser missing**: run `npx playwright install chromium` from project root.
- **Human verification/CAPTCHA**: automation stops. Consult SUNAT manually and enter representative evidence for later human approval; do not treat the manually entered identity as SUNAT-verified.
- **403/429/timeout**: SUNAT or network access may be restricted. Wait and retry; do not disable SUNAT controls.

## Validation
Four focused unit tests and backend syntax validation passed. Changed JSX files passed TypeScript parser syntax checks. Full React build, MongoDB integration and live SUNAT connectivity were not verified from this environment.
