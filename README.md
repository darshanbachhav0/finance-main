# UMA Integrated CAPEX / OPEX / Accounts Payable Management System

Production-oriented, modular ERP for controlling the institutional expenditure lifecycle from
request intake through approval, budget commitment, procurement, Accounts Payable, Treasury,
payment confirmation, reconciliation, close, and audit — for Universidad María Auxiliadora (UMA).

## Architecture

- Frontend: React 18, Vite, React Router, Axios, Lucide icons, Floating UI.
- Backend: Node.js, Express, Mongoose, JWT, bcrypt, Helmet, CORS, rate limiting.
- Database: MongoDB.
- Storage: `backend/uploads` and `backend/generated`, with metadata stored in MongoDB.
- Languages: Spanish (default) and English, toggle-able per session.

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the full business-workflow and technical
description (roles, the A1/A2/B/C "triple-track" workflow, approval routing, budget, accounting,
treasury, suppliers, SUNAT/SIRE integration, and what's intentionally out of scope).

## Functional areas

1. CAPEX/OPEX and special-flow requests (advances, reimbursements, direct payment).
2. Supplier master, homologation (with a configurable renewal window), and bank-account history.
3. Document rules and XML fiscal consistency validation.
4. Configurable hierarchical approvals (organizational manager chain + policy rules), authenticated
   sign-off, and SLA escalation.
5. Dimensional budget allocation, commitment, exception routing, release, execution, and payment
   control.
6. Fiscal processing, balanced journals, explicit Accounts Payable records (including partial
   payments), and controlled cancellation of unpaid obligations.
7. Purchase/Service Order issuance (Procurement), Treasury scheduling, BBVA bank-file batches,
   actual payment confirmation, and reconciliation.
8. SUNAT taxpayer/voucher validation, SIRE/RCE preparation, month-end consolidation, reports,
   dashboards, and immutable audit history.

## Roles

Nine stored roles — see **[docs/ROLE_PERMISSIONS_GUIDE.md](docs/ROLE_PERMISSIONS_GUIDE.md)** for the
full capability matrix and per-role guide:

`Admin`, `Solicitor`, `Approver` (Area Director and Vice Rector share this role; `approvalLevel`
distinguishes them), `Accounting`, `Treasury`, `Budget`, `Procurement`, `Management`,
`ManagementViewer` (strictly read-only).

Backend role/permission/ownership/workflow checks are authoritative; frontend navigation is a
separate, narrower presentational layer on top of them.

## Requirements and installation

- Node.js 18 or newer.
- MongoDB available locally or through the configured connection string.

```powershell
npm install
Copy-Item backend\.env.example backend\.env
npm run seed
npm run dev
```

- Frontend: `http://localhost:5174`
- Backend: `http://localhost:5000`

Set a strong `JWT_SECRET` before any shared or production-style use, and update `CLIENT_URLS` with
every allowed frontend origin. See **[docs/OPERATIONS.md](docs/OPERATIONS.md)** for the full
environment-variable reference, background workers, migrations, and backup procedures.

## Development demo data

`npm run seed` creates a fictional, internally-consistent UMA demo dataset covering all nine role
profiles. The demo password is generated fresh per run (or read from `SEED_DEMO_PASSWORD` if set) —
it is **not** a fixed value anywhere in source. Capture it from the seed command's final JSON
summary output (`password` field). To wipe and recreate:

```powershell
npm run seed:reset
npm run seed
```

`seed:reset` refuses to run outside a database whose name identifies it as development, and refuses
to run at all when `NODE_ENV=production`.

## Tests and build

```powershell
npm test
npm run build
npm run verify
```

The backend suite is a full integration suite (310 tests) against a real local MongoDB instance —
it needs MongoDB reachable, not a mock. The frontend suite covers canonical UI contracts, role
navigation, and accessibility behavior.

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how the platform works: roles, workflow,
  budget, accounting, treasury, suppliers, SUNAT/SIRE, and explicit scope boundaries.
- **[docs/OPERATIONS.md](docs/OPERATIONS.md)** — environment variables, background workers,
  migrations, backups, and deployment.
- **[docs/ROLE_PERMISSIONS_GUIDE.md](docs/ROLE_PERMISSIONS_GUIDE.md)** — detailed per-role
  capability matrix and walkthrough, also rendered to a printable PDF by
  `scripts/build-role-permissions-guide.py`.

## Temporary Cloudflare sharing

With MongoDB and this PC running:

```powershell
npm run share
npm run share:status
npm run share:stop
```

The generated `trycloudflare.com` URL is temporary. `npm run share:publish` also publishes the
current tunnel URL to the stable Render access page (`link-site/`). The local PC, ERP server,
MongoDB, and tunnel must all remain running for the shared link to work.
