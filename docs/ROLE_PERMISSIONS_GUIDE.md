# UMA Finance — roles, permissions, menus and approval routes

Source of truth in code: `shared/accessControl.mjs` (roles, permissions with scope, segregation of
duties). The backend enforces it on every route (`authorizePermission`), list query
(`requestVisibilityFilter`) and record action; the frontend builds each menu from the same catalog
(`frontend/src/utils/navigationAccess.js`). A hidden button is never the control.

Sources: Manual de usuario (doc 1), Manual técnico (doc 2), pilot `Pagos UMA Piloto.html`.

## 1. Roles

Eleven canonical roles. The stored value is kept from earlier versions so approval history and audit
logs stay readable; the code is what people see.

| Code | Stored value | Name |
|---|---|---|
| SOL | `Solicitor` | Solicitante |
| JEF | `AreaDirector` | Responsable del Centro de Costo |
| VIC | `ViceRector` | Vicerrector / Gerente |
| GAF | `GAF` | Gerencia de Administración Financiera |
| GG | `Management` | Gerencia General |
| CON | `Accounting` | Contabilidad |
| TES | `Treasury` | Tesorería |
| LEG | `Legal` | Legal |
| GP | `HumanResources` | Gestión de Personas |
| AUD | `Auditor` | Auditoría |
| ADMIN | `Admin` | Administrador del sistema |

One employee = one account: `role` is the primary role (home workspace, single-answer data scope),
`roles` holds additional roles. Permissions add up; the broadest scope wins.

### Removed and merged roles

| Former role | Now | Why |
|---|---|---|
| `SuperAdmin` | ADMIN | Duplicate administration role. Its console (platform health, alerts, audit, settings, backups) is now Administración. Admin accounts are assigned from Empleados; `npm run admin:create` is the break-glass path. |
| `Procurement` | SOL + grantable `purchase_order.issue` | The standalone Contracts & Supplies module is out of scope; issuing the A1 order survives as an explicit permission. Flagged for review. |
| `ManagementViewer` | AUD | The management portal (`/api/management/v1`, `/management-view`) is not in any source and was removed. Flagged for review. |
| `Budget` | TES | Folded earlier; still moved at server start. |

## 2. Role–permission matrix

Scope: **Propio** (own), **CeCo** (own cost center), **Jerarquía** (their cascade), **UMA** (whole university).

| Permission | SOL | JEF | VIC | GAF | GG | CON | TES | LEG | GP | AUD | ADMIN |
|---|---|---|---|---|---|---|---|---|---|---|---|
| request.create | Propio | | | | | | | | | | |
| request.view | CeCo | Jerarquía | Jerarquía | UMA | UMA | UMA | UMA | Propio | Propio | UMA | |
| request.edit (own observed/draft) | Propio | | | | | | | | | | |
| request.approve / observe / reject | | Jerarquía | Jerarquía | UMA | UMA | | | | | | |
| request.void | | | | | | UMA | | | | | |
| acta.issue | Propio | | | | | | | | | | |
| acta.sign | | Jerarquía | Jerarquía | UMA | UMA | | | | | | |
| supplier.create | CeCo | CeCo | CeCo | | | UMA | UMA | | | | |
| supplier.validate (and bank accounts) | | | | | | | UMA | | | | |
| supplier.view | CeCo | CeCo | CeCo | UMA | | UMA | UMA | | | UMA | |
| supplier.bank_view | | | | UMA | | UMA | UMA | | | | |
| budget.view | | Jerarquía | Jerarquía | UMA | UMA | UMA | UMA | | | UMA | |
| budget.manage | | | | | | | UMA | | | | |
| accounting.provision | | | | | | UMA | | | | | |
| accounting.close_period | | | | | | UMA | | | | | |
| accounting.reopen_period | | | | UMA | | | | | | | |
| accounting.export (SIRE) | | | | | | UMA | | | | | |
| accounting.codes_manage | | | | | | UMA | | | | | |
| treasury.schedule / generate_batch / execute_payment | | | | | | | UMA | | | | |
| treasury.transfer (D) / treasury.investment | | | | | | | UMA | | | | |
| batch.approve (payments + detracciones) | | | | UMA | | | | | | | |
| investment.approve | | | | UMA | | | | | | | |
| reconciliation.prepare | | | | | | | UMA | | | | |
| reconciliation.sign | | | | | | UMA | | | | | |
| bank_format.certify | | | | | | | UMA | | | | |
| rendition.review | | | | | | UMA | | | | | |
| legal.review (E) | | | | | | | | Propio | | | |
| honorarios.manage (H) | | | | | | | | | Propio | | |
| batch_invoice.upload / review | Propio / – | | | | | UMA | | | | | |
| employee_bank.manage_own | Propio | | | | | | | | | | |
| employee_bank.review | | | | | | UMA | | | | | |
| report.view | | Jerarquía | Jerarquía | UMA | UMA | UMA | UMA | | | UMA | |
| insights.view (Consultas/Indicadores) | | | | UMA | UMA | UMA | UMA | | | UMA | |
| finance_parameters.manage (UIT, thresholds, approval rules) | | | | UMA | | | | | | | |
| employee.manage / role.manage / permission.manage | | | | | | | | | | | UMA |
| cost_center.manage | | | | | | | | | | | UMA |
| platform.manage | | | | | | | | | | | UMA |
| audit.read | | | | UMA | | | | | | UMA | Admin modules only |

Grantable to one person on top of their roles (Empleados > Permisos adicionales): request.create,
budget.view, report.view, supplier.bank_view, employee_bank.manage_own, employee_bank.review,
rendition.review, purchase_order.issue, batch_invoice.upload, batch_invoice.review,
bank_format.certify. Department duties are never grantable.

Approval authority is contextual: `request.approve` only lets a person decide the step assigned to
them (as the cost center's responsible, the superior in the cascade, a Por Encargo beneficiary, or
the GAF / Gerencia General amount tier). Nobody approves their own request; nobody approves two
steps of the same request; the administrator approves nothing for being administrator.

### Segregation of duties

| Rule | Severity |
|---|---|
| AUD with any other role | Blocked (cannot be saved) |
| TES + GAF (generates vs approves batches) | Blocked |
| CON + TES (provisions/signs vs pays/prepares) | Blocked |
| CON + GAF | Review (listed in Roles y permisos) |
| ADMIN + GAF / GG / CON / TES | Review |
| Batch generator ≠ batch approver; Treasury prepares, Accounting signs the reconciliation; requester ≠ approver; supplier proposer ≠ validator | Enforced per record |
| Admin changes their own roles or permissions | Refused |
| Removing the last active administrator | Refused |

## 3. Menu visibility

| Role | Menu |
|---|---|
| SOL | Inicio · Nuevo requerimiento · Mis requerimientos · Proveedores (+ Aprobaciones only if they have a team or an assigned step) |
| JEF / VIC | Inicio · Requerimientos · Aprobaciones · Presupuestos e indicadores · Consultas |
| GAF | Inicio · Aprobaciones · Lotes por aprobar · Consultas · Reglas y parámetros · Traspasos · Inversiones · Auditoría |
| GG | Inicio · Aprobaciones · Indicadores · Consultas |
| CON | Inicio · Por contabilizar · Conciliaciones · Periodos y cierre · Consultas · Configuración (cuentas, mapeos) |
| TES | Inicio · Programación, lotes y pagos · Proveedores · Historial de pagos · Conciliaciones · Traspasos · Presupuesto · Consultas · Configuración (formatos BBVA, reglas de presupuesto) |
| LEG | Inicio · Devoluciones por validar · Consultas |
| GP | Inicio · Honorarios (registro y seguimiento) |
| AUD | Inicio · Consultas · Auditoría · Historial financiero (read-only) |
| ADMIN | Inicio · Empleados · Roles y permisos · Costos y jerarquías · Auditoría administrativa · Plataforma |

Several roles → the menus merge in order. Detracciones SUNAT are a tab of Tesorería's payments page;
SIRE and accounting entries open from Contabilidad's pages; "Mi cuenta bancaria" is in the account menu.

## 4. Approval routes

UIT and thresholds are financial parameters the GAF maintains (defaults: GAF above 5 UIT, Gerencia
General above 20 UIT).

| Process | Registered by | Route | Then |
|---|---|---|---|
| A1 Compra con OC | SOL | Responsable CeCo → superior (VIC/Gerente) → GAF > 5 UIT → GG > 20 UIT; Por Encargo adds each beneficiary CeCo's visto | Purchase order (`purchase_order.issue`) → acta (SOL issues, JEF signs, VIC > 5 UIT) → CON provisions → TES schedules → GAF approves batch → TES pays → TES prepares / CON signs reconciliation |
| A2 Lote contra OC | SOL / CON (batch upload) | Approvals of the OC | Invoice validation per XML → CON provisions → payment as above |
| B Factura directa | SOL | Base route as A1 | Acta → CON provisions → payment |
| C Rendir / caja chica / reembolso | SOL | Base route; payments to Tesorería staff always add GAF | TES pays the advance → rendition reviewed by CON |
| M Movilidad | SOL | Responsable → superior → GAF > 5 UIT → GG > 20 UIT | Accounting |
| H Honorarios | GP | Responsable → GAF (any amount) | Accounting (4ta retention) |
| E Devolución | SOL | Legal → Responsable → GAF > 5 UIT (never GG) | Accounting / Treasury (gateway reversal) |
| D Traspaso | TES | Jefe de Tesorería → GAF | TES executes and reconciles |

Anti-fragmentation: A1, A2 and B requests to the same supplier and cost center within 30 days are
routed at the level of their sum. Observado returns the request to its requester for correction;
Rechazado is final and frees the budget. Every decision is recorded in the request's approval
history and the audit log.

## 5. Database migration

Versioned migration `2026-10-28-canonical-roles-v1`
(`backend/src/services/canonicalRoleMigrationService.js`, `backend/scripts/migrateCanonicalRoles.js`).
It changes access configuration only: requests, approval history, invoices, payments, actas and
audit logs are never modified (an old approval keeps the role name it was decided under).

| Step | What |
|---|---|
| Users | Retired role → canonical (SuperAdmin→Admin, Procurement→Solicitor + `purchase_order.issue`, ManagementViewer→Auditor, Budget→Treasury). Legal/Gestión de Personas keep registering requests through an added Solicitante role. Legacy permission values (`request:create`) → canonical (`request.create`); non-grantable values dropped and listed. |
| Review flags | `accessReview` set (not guessed) for retired roles, kept Solicitante access, blocked SoD combinations, people without supervisor or (requesters) cost center. |
| Approval rules | Rules on a retired role move to its replacement; rules routed to Admin/Auditor are deactivated, never deleted. |
| Audit | One `ROLES_MIGRATED` audit entry per changed person; a `migrationruns` record. |

Until the migration runs, the app reads retired values through the catalog (a SuperAdmin account
works as Admin), so deploying first is safe.

Run it:

```bash
npm run migrate:canonical-roles
```
Dry run: writes nothing, prints counts and writes `backend/data/reports/canonical-roles-dry_run-<time>.json` with each person's old and new access.

```bash
npm run migrate:canonical-roles:apply
```
Takes a full backup first (stops if it fails), applies, writes `canonical-roles-apply-<time>.json`.

Rollback (restores role, roles, permissions, previousRole, accessReview and approval rules from the apply report; records changed by an administrator since are skipped unless `--force`):

```bash
npm run migrate:canonical-roles -- --rollback=data/reports/canonical-roles-apply-<time>.json
```

A full restore is also possible from the backup folder written before the apply.

## 6. Known gaps and conflicts

- Contracts & Supplies module (excluded): the manuals' "Contrato vigente" shortcut (`CTR`, born
  APROBADO_COMPROMETIDO) and Treasury's contract validation are not available; B/A2 linked to a
  contract follow the normal route. The A1 order is issued by whoever holds `purchase_order.issue`.
- JEF scope: the technical manual says "own CeCo"; the pilot uses the cascade. The platform keeps
  the cascade (a responsible reads the cost centers under them).
- New supplier: the user manual lets approval continue while Tesorería validates; payment waits.
  The platform keeps that rule.
- Track D: Tesorería registers and holds the first route level (Jefe de Tesorería); the
  self-approval rule needs a different Tesorería user to approve.
- SOL "Consultas" (scope-filtered topics) is served by Mis requerimientos and the search; the
  institution-wide Consultas page stays with the finance roles and Auditoría.
- Administrator authenticator: mandatory only with `ADMIN_2FA_REQUIRED=true` (the former Super Admin
  rule forced it); accounts that enrolled keep using it.
