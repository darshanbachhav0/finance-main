# UMA Integrated CAPEX / OPEX / Accounts Payable Management System

## Implementation Plan

Date: 2026-08-10

This plan upgrades the existing modular Express/React application in place. Each phase preserves existing data and includes a test/build gate. The canonical request lifecycle is the only runtime state machine; budget, AP, payment-batch, rendition and reconciliation entities keep their own domain states without competing with request status.

## Completion Record

| Phase | Result |
|---|---|
| 1. Audit and baseline | Complete |
| 2. Canonical domain foundation | Complete |
| 3. Period, audit, permissions, validation | Complete |
| 4. Requests, documents, XML, suppliers | Complete |
| 5. Approval engine and SLA | Complete |
| 6. Budget ledger and commitments | Complete |
| 7. Accounting and Accounts Payable | Complete |
| 8. Treasury, payment, reconciliation | Complete |
| 9. Special financial flows | Complete |
| 10. SIRE and month-end reporting | Complete |
| 11. Frontend alignment | Complete |
| 12. Migration, seed, documentation, verification | Complete after the verification results recorded in `docs/VERIFICATION_REPORT.md` |

## Engineering Principles

1. Financial state changes go through domain services, never ad hoc controller assignments.
2. All money calculations use centralized two-decimal minor-unit helpers.
3. Multi-record financial operations use a transaction helper when MongoDB transactions are available and an idempotent ordered fallback for standalone development.
4. Existing records are migrated conservatively with dry-run reporting and manual-review flags.
5. External adapters disclose development/manual/not-configured modes and never claim certification.
6. Backend rules are authoritative; frontend controls explain and reflect them.
7. New list APIs support pagination/filtering without breaking current pages during migration.

## Phase 1: Audit and Baseline

Deliverables:

- Repository and live-schema audit.
- `docs/GAP_ANALYSIS.md`.
- This implementation plan.
- Recorded baseline test and build results.

Gate: existing backend tests, frontend tests and frontend build pass before application edits.

## Phase 2: Canonical Domain Foundation

Deliverables:

- Canonical statuses, request types, expense natures, error codes and permission constants.
- Atomic counter/sequence service for `SOL-YYYY-XXXXX`, `OC-YYYY-XXXXX`, journal and batch references.
- Central money helpers.
- Canonical workflow transition graph/service.
- New core models and indexes: migration record, accounting mapping, approval/document/budget rules, budget allocation, AP, journal, payment batch, purchase order, notification and reconciliation data.
- Dry-run/apply migration with manual-review report.

Gate: constants, money, sequence, transition and migration unit/integration tests; backend suite; frontend tests; build.

## Phase 3: Period, Audit, Permissions and Validation

Deliverables:

- Structured `AppError` codes and consistent API error payload.
- Action-aware accounting-period guard with blocked-attempt audit.
- Expanded immutable audit schema/service and read-only viewer endpoint.
- Permission catalog layered over existing roles; Budget and Management roles.
- Segregation-of-duties checks and audited Admin overrides.
- Shared pagination/filter/sort helpers and input normalization.

Gate: closed-period mutation/approval/audit tests, permission tests, API error tests, build.

## Phase 4: Requests, Documents, XML and Suppliers

Deliverables:

- Request service for draft/save/submit/update/void and canonical transitions.
- Profile Cost Center enforcement and authorized Cost Center list.
- Configurable accounting mappings and document requirement rules.
- Structured document validation errors.
- Expanded XML validation result and persisted failed validations.
- SUNAT provider abstraction with MOCK, MANUAL and explicit NOT_CONFIGURED production placeholder.
- Configurable exchange-rate provider and request FX snapshot.
- Supplier service with normalized identifier, homologation decision and durable bank-account history.
- Organized local file storage for new uploads.

Gate: draft, submission, attachment, XML mismatch, duplicate supplier, bank history and accounting-mapping tests; build.

## Phase 5: Approval Engine and SLA

Deliverables:

- Configurable approval rules and route snapshots.
- APPROVE, OBSERVE, RETURN and REJECT actions.
- Authenticated electronic sign-off with request snapshot hash.
- Configurable SLA start/due/complete/result/severity.
- Self-approval prevention and audited Admin override.

Gate: Director/Vice Rector routing, action, SLA and segregation tests; build.

## Phase 6: Budget Ledger and Commitments

Deliverables:

- Dimensional budget allocations by period/year, Cost Center, account/budget item and project.
- Configurable TRANSITIONAL/ACTIVE mode and exception strategy.
- Idempotent reserve/release/execute/pay lifecycle with history.
- Budget source-of-truth API for dashboard and detail screens.

Gate: sufficient/insufficient/exception/rollback/idempotency tests; build.

## Phase 7: Accounting and Accounts Payable

Deliverables:

- Normalized fiscal voucher control and composite uniqueness.
- Balanced journal model and posting validation.
- Configurable provision mappings for OPEX, CAPEX, non-deductible reimbursement and Account 14 advances.
- Explicit idempotent Accounts Payable record.
- Accounting/detail APIs using related entities.

Gate: missing dimensions, duplicate voucher, AP, balanced journals and mapping tests; build.

## Phase 8: Treasury, Bank Batches, Payment and Reconciliation

Deliverables:

- AP-based payable queue, scheduling and filters.
- DEMO bank adapter architecture for BCP, BBVA, Interbank and Scotiabank.
- Persisted batch, items, bank-account snapshots, checksum and generated-file history.
- TXT generation transitions to `TXT_GENERADO` only and does not settle AP.
- Idempotent payment confirmation posts payment journal, settles AP and updates budget.
- Manual reconciliation and canonical `PAGADO -> CONCILIADO -> CERRADO` flow.

Gate: four-bank batch, no-premature-payment, payment journal, AP settlement and reconciliation tests; build.

## Phase 9: Special Financial Flows

Deliverables:

- Entrega a Rendir advance, confirmed disbursement, pending rendition, evidence validation, Account 14 clearing, returned amount and final expense recognition.
- Reembolso sin Sustento configured non-deductible accounting.
- Purchase order entity and generation for quotation-originated purchases.

Gate: Account 14, rendition conversion/balance, unsupported reimbursement and PO sequence tests; build.

## Phase 10: SIRE and Month-End Reporting

Deliverables:

- SIRE preparation service/adapter and explicit no-direct-submission disclosure.
- Journal-based consolidation by Cost Center/account with debit/credit and zero-difference check.
- CSV/export history and final-export safeguards.
- Broader role-oriented transactional reports with period/date filters.

Gate: consolidation, SIRE eligibility and report-history tests; build.

## Phase 11: Frontend Alignment

Deliverables:

- Navigation/screens for Accounts Payable, bank history, reconciliation, audit, approval rules and configuration where authorized.
- Canonical workflow stepper and status labels.
- Expanded request wizard/detail, approval, budget, accounting, Treasury, rendition and closed-period feedback.
- Budget and Management dashboards.
- Persistent actionable notifications.
- English/Spanish coverage for all new text.
- Server-driven table pagination/filtering for financial collections.

Gate: frontend tests, production build, keyboard/mobile/live-role browser verification.

## Phase 12: Migration, Seed, Documentation and Final Verification

Deliverables:

- Development-only idempotent seed users for Admin, Solicitor, Director, Vice Rector, Accounting, Treasury, Budget and Management.
- Reference rules/master data and opt-in end-to-end scenario seed.
- `docs/EXTERNAL_INTEGRATIONS.md`.
- `docs/REQUIREMENTS_TRACEABILITY.md`.
- Updated README and actual-system user/operations manual.
- Backup/restore guidance for MongoDB plus file storage.
- Complete automated and live verification report.

Gate:

- All backend and frontend tests pass.
- Frontend production build passes.
- Backend starts and health endpoint responds.
- Migration dry-run completes and reports ambiguous records without changing them.
- Five existing roles plus Budget and Management are verified.
- Critical lifecycle scenarios are exercised against isolated test data.
- Browser console/network checks and desktop/mobile workflows are clean.

## Migration Safety Strategy

1. Migration defaults to `--dry-run`.
2. A migration-run record prevents accidental duplicate application.
3. Exact mappings are automatic only when historical meaning is unambiguous.
4. `APROBADO_POR_PAGAR` becomes `CONTABILIZADO` only when accounting evidence exists; otherwise it is reported for review.
5. `PROCESADO_BANCO` and legacy rendition/closed records are reported for manual review when actual payment confirmation cannot be proven.
6. Existing request numbers remain immutable; only missing/new numbers use the atomic sequence.
7. Existing physical file URLs remain readable; new uploads use organized paths.
8. No collection is dropped and no financial record is deleted.
