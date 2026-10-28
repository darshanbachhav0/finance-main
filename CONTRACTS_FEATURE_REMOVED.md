# UMA Finance — Contracts feature removed temporarily

This version was updated from `UMA_Finance_Expanded_Source_2026-10-27.zip`.

**Contracts / Contratos as a separate platform feature is disabled and its source modules have been removed.** This covers:

- Sidebar / page navigation and `/contracts` frontend route.
- `/api/contracts` backend endpoints (registration, Treasury review, quota use, PDFs, alerts).
- Dedicated `UmaContract`, `UmaContractInvoice` data models, services, pages and contract-quota code.
- Contract report topic in Consultas and Contracts indicator.
- The now-obsolete contract-rules test and its test-suite import.

**Preserved intentionally:**

- Existing A1/A2/B/C/D and M/E/H processes, Treasury, Accounting, suppliers, user permissions, digital actas, and investments.
- The ability to attach a signed service agreement as supporting evidence for an ordinary expense request (`CONTRACT` document kind). This is part of existing finance document controls, **not** the dedicated Contracts module.
- `importContractEmails.js` and `contractEmailImportService.js`: these import *employee email addresses from an HR spreadsheet called MAESTRO_CONTRATOS*, not financial contracts.
- Legacy already-saved contract records and attached files in MongoDB/storage. **No database collections, payment records, or uploaded files are dropped.** The old Contracts API will no longer read or mutate these records.
- Old implementation documents are retained as historical artifacts; they may describe contracts from an earlier build.

## Install

Option A: extract the full source ZIP into a **new folder**, copy the appropriate staging `.env` values, run `npm ci`, and verify before deployment.

Option B: apply the changed-code ZIP at the project root (folder containing `backend`, `frontend`, and `shared`), then run the included `REMOVE_CONTRACTS.ps1` to delete the seven retired modules. The script stops if it cannot find your project layout. Take a copy or Git commit first.

Do not execute database deletion or collection-drop commands. If Contracts was already used, its old records should be archived/migrated separately **only with your explicit approval**.

### Smoke checks

```powershell
node --test backend/test/removedContractsFeature.test.js
npm run test:frontend
npm run build --workspace frontend
npm run dev
```

If `npm run test:backend` is available with a dedicated test database, run it too. Test backend scripts may write data in the database configured for testing.
