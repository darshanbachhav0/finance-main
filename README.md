# UMA Integrated CAPEX / OPEX / Accounts Payable Management System

Production-oriented, modular ERP for controlling the institutional expenditure lifecycle from request intake through approval, budget commitment, Accounts Payable, Treasury, payment confirmation, reconciliation, close, and audit.

The application upgrades the existing React/Vite + Express/MongoDB project in place. Uploaded evidence and generated files remain on the local host.

## Architecture

- Frontend: React 18, Vite, React Router, Axios, Lucide icons, Floating UI.
- Backend: Node.js, Express, Mongoose, JWT, bcrypt, Helmet, CORS, rate limiting.
- Database: MongoDB.
- Storage: `backend/uploads` and `backend/generated`, with metadata stored in MongoDB.
- Languages: English and Spanish.

## Functional Areas

1. CAPEX/OPEX and special-flow requests.
2. Supplier master, homologation, and bank-account history.
3. Document rules and XML fiscal consistency validation.
4. Configurable hierarchical approvals, authenticated sign-off, and SLA.
5. Dimensional budget allocation, commitment, exception, release, execution, and payment control.
6. Fiscal processing, balanced journals, and explicit Accounts Payable records.
7. Treasury scheduling, bank-file batches, actual payment confirmation, and reconciliation.
8. SIRE/RCE preparation, month-end consolidation, reports, dashboards, and immutable audit history.

## Canonical Workflow

```text
BORRADOR -> EN_VALIDACION -> ENVIADO -> PENDIENTE_APROBACION
-> APROBADO_DIRECTOR -> APROBADO_VICERRECTOR
-> COMPROMISO_PRESUPUESTAL -> CONTABILIZADO -> PROGRAMADO
-> TXT_GENERADO -> PAGADO -> CONCILIADO -> CERRADO
```

`OBSERVADO`, `DEVUELTO`, `RECHAZADO`, and `ANULADO` are controlled exception states. `ENTREGA_RENDIR` moves from confirmed payment to `RENDICION_PENDIENTE`; it cannot close until the rendition is validated.

Important: generating a bank TXT creates a payment instruction and changes the request to `TXT_GENERADO`. It does **not** settle Accounts Payable. Treasury must record the real bank operation, date, and confirmed amount before the request becomes `PAGADO`.

## Roles

- `Admin`: technical administration, users, master data, and audited override capability.
- `Solicitor`: own requests, drafts/corrections, supplier proposals, and renditions.
- `Approver`: assigned Director or Vice Rector approvals, SLA, budget visibility, and reports.
- `Accounting`: supplier homologation, fiscal processing, CXP, journals, periods, SIRE, FX, and audit.
- `Treasury`: payable scheduling, bank batches, payment confirmation, reconciliation, and bank-detail viewing.
- `Budget`: allocations, commitments, exceptions, and budget reporting.
- `Management`: executive reporting and configured extraordinary approvals.

These seven stored roles represent eight operating profiles: Director and Vice Rector both use `Approver` with different approval levels. Backend role, permission, ownership, and workflow checks are authoritative; frontend navigation is a separate role-based layer. See the detailed role guide below for scope and limitations.

## Requirements and Installation

- Node.js 18 or newer.
- MongoDB available locally or through the configured connection string.

```powershell
npm install
Copy-Item backend\.env.example backend\.env
npm run seed
npm run dev
```

- Frontend: `http://localhost:5174`
- Backend health: `http://localhost:5000/health`

Set a strong `JWT_SECRET` before any shared or production-style use. Update `CLIENT_URLS` with every allowed frontend origin.

## Development Demo Users

These credentials are created only by the development seed and must not be used in production.

| Profile | Email | Password |
|---|---|---|
| Administrador | `demo.admin@uma.edu.pe` | `UMA-Demo-2026!` |
| Solicitante | `demo.solicitante.salud@uma.edu.pe` | `UMA-Demo-2026!` |
| Director de Área | `demo.director.salud@uma.edu.pe` | `UMA-Demo-2026!` |
| Vicerrector | `demo.vicerrector@uma.edu.pe` | `UMA-Demo-2026!` |
| Presupuesto | `demo.presupuesto@uma.edu.pe` | `UMA-Demo-2026!` |
| Contabilidad | `demo.contabilidad@uma.edu.pe` | `UMA-Demo-2026!` |
| Tesorería | `demo.tesoreria@uma.edu.pe` | `UMA-Demo-2026!` |
| Gerencia / Rectorado | `demo.gerencia@uma.edu.pe` | `UMA-Demo-2026!` |

The seed is idempotent and contains a cohesive, fictional UMA demonstration dataset. It covers the eight operating profiles, UMA faculties and Cost Centers, homologated suppliers, approvals, budgets, XML validation, Accounting/CXP, four-bank demo TXT batches, payment confirmation, rendition, reconciliation, and closure. See `docs/UMA_DEMO_DATA.md`.

To purge and recreate only a database whose name clearly identifies it as development:

```powershell
npm run seed:reset
npm run seed
```

The reset command is disabled when `NODE_ENV=production`, requires its built-in confirmation flag, and removes active development uploads/generated files after a backup is taken separately.

## Tests and Build

```powershell
npm test
npm run build
npm run verify
```

The backend suite covers the 33 critical financial controls, plus security and contract tests. The frontend suite covers canonical contracts, role navigation, remote table queries, and accessible row-menu keyboard behavior. There is no separate lint script in the current repository.

## Existing-Data Migration

Back up first, inspect the dry-run report, then apply once approved:

```powershell
npm run backup
npm run migrate:workflow
npm run migrate:workflow:apply
npm run verify:data
```

Migration reports are written under `backend/migration-reports`. Ambiguous historical accounting/payment records are reported for manual review instead of being silently reinterpreted. No collection is dropped and historical request numbers are retained.

## Local Storage and Backup

- Request evidence: `backend/uploads/requests/{requestId}`
- Supplier evidence: `backend/uploads/suppliers/{supplierId}`
- Bank files: `backend/generated/bank-files`
- Reports: `backend/generated/reports`
- Accounting exports: `backend/generated/accounting`

`npm run backup` exports MongoDB collections as Extended JSON and copies both upload and generated-file directories into a timestamped `backend/backups` folder. A usable recovery point requires all three parts.

## External Integration Limits

- SUNAT: provider abstraction with `MOCK`, authorized `MANUAL`, and unconfigured production placeholder modes. No production endpoint or credentials are fabricated.
- Exchange rates: PEN is 1. USD requires an exact dated record. Optional BCRP online retrieval is editable reference data and is not labelled as the authoritative SUNAT selling rate.
- SIRE/RCE: validated preparation and CSV export only; there is no direct SUNAT submission.
- Banks: BCP, BBVA, Interbank, and Scotiabank adapters are `DEMO / NOT CERTIFIED` until UMA supplies approved field specifications.
- Sign-off: authenticated electronic approval with user, role, IP, timestamp, reference, and request hash; it is not described as a certified legal digital signature.

See `docs/EXTERNAL_INTEGRATIONS.md` for configuration and certification requirements.

## Temporary Cloudflare Sharing

With MongoDB and this PC running:

```powershell
npm run share
npm run share:status
npm run share:stop
```

The generated `trycloudflare.com` URL is temporary. `npm run share:publish` also publishes the current tunnel URL to the stable Render access page. The local PC, ERP server, MongoDB, and tunnel must remain running.

## Documentation

- [Role permissions guide](docs/ROLE_PERMISSIONS_GUIDE.md): all eight operating profiles, capability matrices, permitted actions, restrictions, approval scope, banking visibility, and implementation limitations.
- [Printable role permissions guide](output/pdf/UMA_Role_Permissions_Guide.pdf): the 20-page UMA-formatted PDF, generated from the Markdown guide by `scripts/build-role-permissions-guide.py` (Python, ReportLab, pypdf, and Windows Arial fonts).
- `docs/GAP_ANALYSIS.md`: baseline comparison made before implementation.
- `docs/IMPLEMENTATION_PLAN.md`: phased implementation record.
- `docs/REQUIREMENTS_TRACEABILITY.md`: requirement-to-code/test mapping.
- `docs/EXTERNAL_INTEGRATIONS.md`: honest integration capabilities and limits.
- `docs/ARCHITECTURE.md`: system and domain architecture.
- `docs/QUOTATION_PAYMENT_TERMS.md`: quotation payment choices, comparison, order snapshots, and compatibility.
- `docs/SIMPLIFIED_REQUEST_ITEMS.md`: minimal item entry, automatic IGV totals, budget defaults, and draft compatibility.
- `docs/ANNUAL_MONTHLY_BUDGETS.md`: annual plans, monthly limits, reserve allocation, audited adjustments, and legacy compatibility.
- `docs/UMA_UI_UX.md`: UMA branding, the 19 interface improvements, responsive behavior, and browser verification.
- `docs/SUNAT_BACKGROUND_LOOKUP.md`: invisible RUC lookup, automatic supplier fields, and regression verification.
- `docs/MIGRATION_AND_OPERATIONS.md`: migration, backup, seed, run, and recovery procedures.
- `docs/USER_MANUAL.md`: English/Spanish operator manual source.
- `documentation/UMA_Integrated_ERP_User_and_Operations_Manual_EN_ES.docx`: polished bilingual Word manual.

## UMA Triple-Track Workflow (A1 / A2 / B / C)

The project now implements the consolidated UMA operating specification:

- **A1:** formal purchase, budget reservation, Purchase Order, conformity, XML/PDF, SUNAT validation, PO ceiling, and invoice-level CXP.
- **A2:** asynchronous ZIP/XLSX invoice batches against an active OC; valid invoices continue automatically while inconsistent invoices are isolated in Accounting observations.
- **B:** direct invoice / advance payment with mandatory XML/PDF, express approval, automatic provisioning, and priority Treasury treatment.
- **C:** advances and petty cash through Account 14, a ten-day rendition deadline, overdue blocking, and non-deductible regularization.

New operational commands:

```powershell
npm run worker:batch
npm run migrate:triple-track
npm run migrate:triple-track:apply
```

See `docs/TRIPLE_TRACK_IMPLEMENTATION.md` for routes, data model, worker operation, migration, SUNAT boundary, and verification coverage.
