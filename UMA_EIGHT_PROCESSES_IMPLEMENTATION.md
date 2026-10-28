# UMA Finance — 8-process first step (A1, A2, B, C, D, M, H, E)

## Scope

This update is based on the supplied UMA payment-flow HTML and the eight-process comparison. It **replaces the first page of Nueva solicitud** with an eight-process picker while reusing and preserving the project's financial workflows and validations.

| Process | What the chooser opens | Backend behavior |
| --- | --- | --- |
| A1 | `/requests/new/form?process=A1` | Existing purchase/PO request workflow |
| A2 | `/batch-invoices` | Existing invoice ZIP upload against a purchase order |
| B | `/requests/new/form?process=B` | Existing direct-invoice request workflow |
| C | `/requests/new/form?process=C` | Existing advance/reimbursement workflow |
| D | `/treasury/transfers` | Existing Treasury bank-account transfer workflow |
| M | `/special-expenses?type=M` | Existing mobility document and review workflow |
| H | `/special-expenses?type=H` | Existing teaching-fee document and review workflow |
| E | `/special-expenses?type=E` | Existing student-refund document and review workflow |

All eight are visible, with a restricted status where the signed-in role cannot initiate the process. A Solicitor can initiate A1/A2/B/C/M/E; D requires Treasury and H requires Gestión de Personas. These restrictions are consistent with the existing route-level permissions.

The A1/B/C wizard continues to use the existing supplier, receipt automation, SUNAT verification, budget, quotation, payment priority, and readiness components. Its chosen process is locked when creating a new request (but editing legacy records remains compatible). Saved work-drafts and supplier-registration return links are preserved. The existing M/E/H routes are preselected from the chooser, and authorized cost-center options are requested for ordinary employees.

**Preserved:** all SUNAT-related backend files and existing SUNAT API routes, existing financial records, supplier verification, invoice duplicate checks, and bank-file approval rules.

**Not newly implemented:** end-to-end payment/ledger posting for M/H/E; they remain documentary review processes. The A2 screen remains the existing **batch ZIP upload** and has not been converted into a single-invoice form. No MongoDB migration is needed for the selector.

## Files changed/added

- `frontend/src/App.jsx` — routes the chooser before the wizard.
- `frontend/src/pages/RequestProcessSelection.jsx` — **new** eight-process page.
- `frontend/src/utils/umaProcessSelection.js` — **new** catalog, role checks and destinations.
- `frontend/src/styles/umaProcessSelection.css` — **new** styles (responsive).
- `frontend/src/pages/RequestCreate.jsx` — initial process, lock on create, legacy draft compatibility.
- `frontend/src/pages/UmaSpecialExpenses.jsx` — selected type + cost center scope.
- `frontend/src/pages/BulkInvoiceUpload.jsx` — return to selector.
- `frontend/test/umaProcessSelection.test.js` — **new** focused tests.

## Apply updated files on Windows

1. Stop `npm run dev` with `Ctrl+C`.
2. Back up the entire `finance-main` folder (and database before any separate migrations).
3. Download `UMA_Eight_Process_Changed_Code.zip` to Downloads.
4. In PowerShell:

```powershell
cd "C:\Users\TI-SJL-0010\Downloads\finance-main-triple-track-updated\finance-main"
Expand-Archive -Path "$env:USERPROFILE\Downloads\UMA_Eight_Process_Changed_Code.zip" -DestinationPath "." -Force
node --test .\frontend\test\umaProcessSelection.test.js
npm run dev
```

Visit **http://localhost:5174/requests/new** after signing in as a Solicitor.

## Tests and limitations

- **5/5** targeted selector tests passed (roles, routes, workflow mapping, saved draft flow).
- Modified JSX files parsed with the installed TypeScript JavaScript/JSX parser without syntax errors.
- Existing `requestWizard.test.js`, `trackDRoles.test.js`, and `documentApprovalContracts.test.js` passed.
- `navigationSections.test.js` failed because it expects an older menu layout already present in the base project. No navigation-section definitions were modified in this update.
- A complete Vite build and authenticated browser/MongoDB integration tests **were not run** in this environment. Validate in staging before using the update with real financial records.
