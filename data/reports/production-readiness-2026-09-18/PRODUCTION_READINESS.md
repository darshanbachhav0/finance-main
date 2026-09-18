# UMA Finance — final regression and deployment review

Review date: 18 September 2026. **Overall result: BLOCKER for production. Ready for restricted internal testing.**

Passing automated tests establishes a useful regression baseline. It does not establish bank acceptance, fiscal certification, safe historical migration, or operational readiness. This review found specific gaps below. No application feature or financial rule was changed, no operational database migration/import was applied, and no payment or SUNAT submission was made.

## Verification performed

| Check | Result and limits |
|---|---|
| Full backend suite | **236 passed, 0 failed, 0 skipped.** Includes database-backed workflows, fiscal/budget controls, BBVA, SIRE, CeCo and SLA tests. Some older tests check source contracts rather than executing a complete workflow. |
| Full frontend suite | **Passed.** Includes calculation, navigation, canonical workflow, document, fiscal, CeCo, permission, SIRE and SLA contracts. This suite is largely static/pure-function coverage. |
| Frontend production build | **Passed.** Initial sandbox invocation could not spawn esbuild; the approved retry succeeded. This was an execution restriction, not an application build defect. |
| Additional HTTP API tests | **Passed.** Eight roles, Director/Vice Rector stages, forbidden approval calls, unauthenticated access, terminal actions and direct `renditionStatus` filtering. Synthetic users/requests in a disposable database. |
| Responsive browser review | **Passed:** 23 routes at 1440, 1024, 768, 390 and 320 pixels; 115 checks with no overflow failures or JavaScript runtime errors. Navigation, cards, search, saved views, approval/budget dialogs, focus, Spanish and printing also pass. The test required maintenance for collapsed controls, transition timing and backend `allowedActions`. APIs are mocked, so this is not live financial UAT. |
| Migration dry runs | All six scripts completed twice without errors against a disposable copy of the local launcher database. No apply flags were used. Repeated dry runs alone do not prove apply idempotency. |
| BBVA verification | Both generated samples are byte-identical to the references. PEN: 8 payments, 17,711.90. USD: 1 payment, 3,694.70. Both have 151-byte headers and 277-byte detail records, excluding line separators. |
| SIRE test export | One synthetic, journal-linked voucher exported to `TEST-ONLY-SIRE.csv`; schema `SIRE_RCE_VOUCHER_V2`. No external submission. Additional negative checks reproduced four defects. |
| Database safety | Source was read using raw MongoDB operations. Before/after document digests matched. Disposable databases were dropped. No live financial data was modified. |

Evidence is retained beside this report: backend/frontend/build logs, API contract output, migration logs, CeCo validation JSON and `review-evidence.json`. BBVA files/comparison are in `../bbva-structure-tests`. Browser screenshots/results are in `../../../.tmp/uma-ui`.

Coverage limits: this was not a penetration test, dependency-vulnerability certification, load test or disaster-recovery exercise. The HTTP role matrix exercises request responses and approval rejection, not every endpoint/action combination. Goods/service document phases are covered, but real professional-fee samples are not. A production-like replica-set failure test, representative historical restore and real Finance user acceptance remain outstanding.

The inspected database is the one named in `START_UMA_PUBLIC_FIXED.bat`: `uma_finance_triple_track_fresh` on local port 27018. It has 12 users, six CeCos, eight bank configurations and **zero financial requests, CXPs, journals, vouchers, payment batches or reconciliations**. It is not a representative historical finance dataset. The migration copy included documents, not original indexes; original source indexes were inventoried separately in the evidence JSON. Index migration behavior is additionally covered by isolated regression fixtures.

## Readiness by module

Ratings describe the complete module's deployment readiness, including configuration dependencies. READY means no blocking defect found within the tested scope, not external certification.

| Module | Rating | Findings / remaining gate |
|---|---|---|
| A1 goods and ordinary services | NEEDS CONFIGURATION | First/additional invoice registration, XML validation, budget posting and child payment/reconciliation tests pass. Activate phase rules, accounting mappings, real CeCos and fiscal provider. Professional fees are separately blocked below. |
| A2 individual and batch | NEEDS CONFIGURATION | Actual ZIP processing, one failed invoice, failed correction and successful retry are exercised; no extra CXP is created by the failed correction. Partial settlement uses the tested child aggregation. Supervised worker and production fiscal provider required. |
| Track B | NEEDS CONFIGURATION | Director → Vice Rector defaults and historical route preservation pass. Actual XML posting tests pass. Existing configuration still needs the phase/approval migration. |
| Track C | NEEDS BUSINESS CONFIRMATION | Reserve-before-advance, payment separate from rendition, actual-expense execution and unused commitment release pass. Accounting must sign off its real rendition evidence, non-deductible/refund handling and closure scenario in UAT. |
| Workflow/status engine | READY | Rejected/cancelled/closed terminals, historical `PAGADO_CERRADO`, payment confirmation, partial payment/reconciliation and closure evidence checks pass. |
| Documents and professional services | BLOCKER | Phase matching and missing-document tests pass, but A1 registration hardcodes `FACTURA` despite fee-receipt document rules. Professional-fee end-to-end behavior is not safe to approve. |
| Budget | NEEDS CONFIGURATION | Availability, reservation, insufficient-budget exceptions, Management approval, self-approval prevention and cancellation-release history pass. Approve real allocations, authorized management accounts and mappings. |
| Accounting | NEEDS CONFIGURATION | Closed-period tests cover first/additional A1 and queued A2 posting. Journal/CXP regressions pass. Real dimensions, open periods and replica-set deployment remain required. |
| SUNAT supplier/voucher and exchange rates | NEEDS CONFIGURATION | Padrón is kept separate from invoice validity; XML fields, duplicate identity, PEN/USD evidence and previous-valid-day fallback pass. Gateway credentials, actual response contracts and outage behavior have not been certified externally. |
| BBVA Treasury | NEEDS BUSINESS CONFIRMATION | Sample lengths, padding, counts/totals, CCI structure, mixed-currency rejection, BBVA source-only and TXT≠payment tests pass. All eight inspected bank configurations remain DEMO/unconfirmed; both BBVA currency configurations require Treasury approval and bank acceptance. |
| CeCo / employee assignment | BLOCKER | Five conflicting CeCos, zero safe assignments, six active demo CeCos. Do not apply this import yet. |
| SIRE/RCE | BLOCKER | Voucher-level positive tests pass, but additional negative tests expose unsafe eligibility and missing legacy visibility. CSV is a preparation export, not a certified SUNAT RCE submission file. |
| SLA and notification bell | NEEDS CONFIGURATION | Due-soon, overdue, escalation, deduplication, resolution and immutable audit tests pass. Launch/supervise the separate SLA worker; the BAT does not start it. Approve thresholds and recipient assignments. |
| Audit | READY | Tested application-level save/update/replace/bulk/delete protection and transition/escalation records pass. Database administrator access can bypass application middleware; retain restricted DB privileges and backups. |
| Permissions | READY | All eight profiles exercised through HTTP; stage-specific actions and forbidden operations behaved correctly. Production account security is independently blocked below. |
| Frontend | READY | Suite/build and 115 responsive page checks pass. Browser fixtures do not replace a real role-based UAT session. |
| Historical migrations | BLOCKER | No representative financial history was available. Older migrations contain unsafe historical inference/overwrite paths; do not run the entire chain blindly. |
| Deployment/security | BLOCKER | Eight active accounts accept the published demo password; source MongoDB is standalone; launcher is not a complete production process supervisor. |

## Exact remaining blockers

1. **SIRE eligibility and linkage.** In `backend/src/services/sireService.js`, request-level accounting dates can admit a CXP without a journal. A `CANCELLED` CXP also exports. A CXP with amount 999/USD linked to a validated voucher for 118/PEN exports without a mismatch error. These were reproduced independently; each case returned one eligible row. Require appropriate accounting evidence and validate the CXP/voucher/request/supplier association before fiscal export.
2. **SIRE historical visibility.** A historical `PAGADO_CERRADO` request with a fiscal period but no CXP yielded zero review entries. Candidate discovery starts from CXPs, so these requests are invisible rather than flagged. Also review duplicate selection: the first candidate reserves the identity even when invalid, potentially suppressing a later valid candidate. The latter is a source-review finding, not an additional executed reproduction.
3. **Professional-fee identity.** `invoiceRegistrationService.js` sets both parsed voucher type and persisted fiscal type to `FACTURA` (around lines 193 and 325). The fee attachment option does not establish correct Recibo por Honorarios classification. Accounting must confirm the required evidence/format; the code path then needs an explicit regression fix and real sample testing before this flow is enabled.
4. **Unresolved CeCos and users.** The import report below is not clear for application. Six demo CeCos remain active and can remain available wherever active centers are offered. Their deactivation and replacement must precede new production transactions; historical snapshots must be retained.
5. **Credentials.** Eight active accounts in the inspected database match the demo password embedded in the login UI. Disable or secure demo accounts and provision named users before real-data access. No password or secret is reproduced in this report. The existing rotation script changes every user's password and writes a credential file; do not run it casually on an operating system.
6. **Transactional deployment.** `transactionService.js` runs without a session on standalone MongoDB. The inspected source has no replica set. Individual claim safeguards do not provide atomicity across every journal, CXP, budget and audit write. Deploy a replica set and run failure/restart testing before production.
7. **Historical migration safety.** `migrateCanonicalWorkflow.js` overwrites an existing supplier snapshot from today's master. `migrateTripleTrackWorkflow.js` assigns all currently PAID CXPs to a request-level reconciliation and can pick the first as the single link. Payment alone does not prove reconciliation. These scripts require per-record historical review or correction before use on real financial history.

Missing production BBVA configuration, fiscal gateway acceptance and operational worker supervision are additional release gates even after these defects are resolved. Application fixes were not bundled into this review; changing export eligibility or historical migration behavior needs focused regression work, not an unreviewed deployment workaround.

## CeCo dry-run result and confirmations

153 source rows; 39 distinct CeCos; 34 importable CeCos; five blocked CeCos; 27 repeated-code groups. Repeated rows often represent employees within one CeCo and are not automatically errors. Six demo centers would be deactivated. **Zero employee assignments are ready; 125 employee records are unmatched and 28 ambiguous.** No import was applied.

| CeCo | Source rows | Required decision |
|---|---|---|
| 30004 | 82–96 | Admisión maps to both Ventas y Admisión / 20012 and Marketing / 20011. Confirm hierarchy. |
| 40020 | 136–138, 150 | Conflicting IINN / 20009, CCSS / 20005 and area labels. Confirm the center and its organizational parent. |
| 50103 | 47, 58–60 | Same code assigned to Farmacia y Bioquímica and Psicología. Confirm whether one code is wrong. |
| 20007 | 66–69 | Same code represents Tesorería and Gerencia de Administración Financiera. Confirm whether this shared mapping is intentional. |
| 20002 | 135 | RECTORADO is mapped to VICERRECTORADO ACADÉMICO IINN / 20009. Confirm the authoritative mapping. |

HR/Admin must supply reliable DNI/employee identifiers for unmatched users and approve conflicts. Existing authorized CeCos are not automatically widened. `ceco-dry-run.json` contains exact source rows and affected identifiers and should be handled as restricted personnel data. Historical preservation passes synthetic tests; this source has no financial transactions against which to verify real snapshots.

## Migration order, dependencies and rollback

No production migration was applied. Each listed script was run twice in dry mode against the local copy. Fresh databases do not need historical backfills merely because scripts exist.

| Order | Script / operation | Required treatment |
|---|---|---|
| 0 | Verified backup and maintenance window | Stop writers/workers; capture database, indexes, uploads/generated files and encryption keys. Restore to a separate staging replica set and reconcile counts/balances before migration. |
| 1, legacy only | `migrateCanonicalWorkflow.js` | Foundation normalization and possible CXP creation. Marker-based repeat protection. Hold until snapshot overwrite and financial inference have been reviewed. Dry run proposed supplier, expense-type, user and period changes in the local copy. |
| 2, legacy only | `migrateOfficialUmaFormatsFoundation.js` | Additive format/supplier/rendition foundation. Marker and isolated repeated-apply tests exist. Local dry run proposed one bank-account normalization. |
| 3, legacy only | `migrateTripleTrackWorkflow.js` | Links and budget counters depend on existing requests/CXPs. Hold ambiguous reconciliation mappings. Marker-based replay guard is not crash recovery. Local financial scan was empty. |
| 4 | `migrateWorkflowStatusesV2.js` | Derives canonical statuses from evidence, preserves prior status in a manifest, and replaces obsolete request-level reconciliation uniqueness with payable-level uniqueness. Apply requires explicit `MONGODB_URI`, `--database=<exact-name>` and `--maintenance-confirmed`. Review every conflict/manual-review row first. Isolated apply/idempotency tests pass. |
| 5 | `migrateDocumentPhases.js` | Local dry run: deactivate eight legacy rules, upsert 12 canonical rules and Track B Vice Rector rule. Historical approval snapshots are preserved. Upserts prevent simple duplication but may overwrite customized default configuration; export and review current rules first. |
| 6, currently HOLD | `importUmaCostCenters.js` | Resolve all source mappings and employee matches first. Preserve original historical dimension snapshots before master replacement. Default is dry run. Importer can apply a safe subset even with conflicts, so the release procedure must enforce this hold. Repeated-import/snapshot preservation tests pass. |
| 7 | Index/configuration verification | Verify fiscal identity uniqueness, reconciliation payable uniqueness, notification `(user,eventKey)` uniqueness, `audit_event_unique`, and payment claim indexes on staging, then production during the approved maintenance window. Confirm actual indexes rather than assuming schema declarations have applied. |

No dedicated historical data rewrite is required for additive BBVA audit fields, SIRE export metadata or SLA monitoring. Do not regenerate old files or backfill invented voucher/rate evidence.

Apply idempotency is explicitly tested for official foundations, workflow status migration and CeCo import. Repeated dry runs of the other scripts establish stable planning only; interrupted-apply recovery on representative history remains untested. Older scripts may auto-create collections/indexes through Mongoose even in dry mode, which is why they were not pointed at the source database.

There is no verified universal rollback command. Do not reverse statuses manually or delete movements. Restore a coherent pre-migration database/files backup in a controlled environment, preserving any subsequent evidence separately if writes occurred. `backupLocalData.js` exports records and files but does not establish a consistent online snapshot or preserve a full index/restore procedure by itself. A restore rehearsal is required.

## Required environment and persisted configuration

No deployed service environment was certified. There is no backend `.env` in this checkout; the BAT injects local settings. Do not copy `.env.example` unchanged: it contains demo/legacy options and older SUNAT credential comments that do not configure the current gateway adapter.

| Area | Variables / values used by current code |
|---|---|
| API | `NODE_ENV=production`, explicit replica-set `MONGODB_URI`, strong `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT`, exact HTTPS `CLIENT_URLS` (or `CLIENT_URL`). Configure reverse-proxy trust to match the real deployment. |
| Drafts | Stable `DRAFT_ENCRYPTION_KEY`; if absent, JWT secret is the fallback. Back up the active key separately. Do not rotate it without a plan for existing encrypted drafts. |
| Frontend | Correct build-time `VITE_API_URL` where a separate API origin is used; validate same-origin `/api` deployment otherwise. |
| Fiscal gateway | `SUNAT_PROVIDER_MODE=PADRON`/`PUBLIC_PADRON` for local supplier data plus gateway voucher validation, or `PRODUCTION` for the configured provider. Set `SUNAT_API_BASE_URL`, `SUNAT_API_TOKEN`, `SUNAT_VOUCHER_ENDPOINT`, `SUNAT_EXCHANGE_RATE_ENDPOINT`; `SUNAT_TAXPAYER_ENDPOINT` for production taxpayer calls. Confirm `SUNAT_API_METHOD` and `SUNAT_API_TIMEOUT_MS`. Never use MOCK for production validation. |
| FX fallback | `EXCHANGE_RATE_ALLOW_REFERENCE_FALLBACK=false` unless Finance expressly authorizes non-authoritative reference fallback. Seven-day previous-publication search is implemented; dates/source/authority are retained. |
| Public Padrón | Persistent `SUNAT_PADRON_DATA_DIR`; approved `SUNAT_PADRON_INFO_URL`/`SUNAT_PADRON_DOWNLOAD_URL`; refresh 24 hours, stale limit seven days, timeout and size/row thresholds. `SUNAT_PADRON_MIN_ROWS`, `SUNAT_PADRON_MIN_ROW_RATIO`, `SUNAT_PADRON_MAX_UNCOMPRESSED_BYTES`. Review accepted freshness policy. |
| RUC representatives | Installed Playwright Chromium; `SUNAT_CONSULTA_RUC_TIMEOUT_MS`, `SUNAT_CONSULTA_RUC_CACHE_MINUTES`. Live site availability/behavior has not been certified by this regression. |
| Batch worker | `BATCH_INVOICE_POLL_MS=5000`, `BATCH_INVOICE_WORKER_CONCURRENCY=3`, `BATCH_INVOICE_STALE_MINUTES=15`, normally `BATCH_INVOICE_INLINE_PROCESSING=false`. Review existing ZIP/XLSX upload safety limits and persistent shared files. |
| SLA | `SLA_DUE_SOON_HOURS=4`, `SLA_ESCALATION_HOURS=24`, `SLA_POLL_MS=60000`, identical in API and worker. Existing saved approval deadlines remain authoritative. |

BBVA configuration is stored in `BankFormatConfiguration`, not enabled by `BANK_FILE_MODE=DEMO`. Configure separate BBVA PEN/USD records with `mode=FIXED_WIDTH`, version, reviewed field mappings and `bbva.confirmed=true`. Retain historical non-BBVA records. Persist `backend/uploads` and `backend/generated`; current storage service uses those paths directly, so the example `UPLOAD_DIR` alone does not relocate storage.

## Production processes and external sign-off

Run these under a supervisor with restart policies, logs, health monitoring and the same intended database/configuration:

1. API: `npm start --workspace backend`, after production frontend build. Serve through the approved HTTPS endpoint.
2. Batch invoices: `npm run worker:batch --workspace backend`.
3. Approval SLA: `npm run worker:sla --workspace backend`. `sla:check` is a one-shot scan that writes notifications/audits; run it only in the intended approved environment, not as a read-only check.
4. Padrón, when enabled: `npm run sunat:padron:worker --workspace backend`; bootstrap once before users depend on lookups. Share the persistent dataset with API and use a single updater.
5. MongoDB replica set and durable file storage, with monitored backups and a tested restore procedure.

The current BAT starts API/batch/Padrón-related processes but does not start SLA monitoring, uses standalone MongoDB and seeds demo data on a fresh database. It is not sufficient as the final production deployment procedure.

Treasury/BBVA must confirm debit accounts, header prefix/control/trailer, detail prefix, RUC/DNI and internal/interbank codes, internal account length/prefix, document-type mappings, payment reference handling, description/contact controls, ordering contact, trailing controls, encoding/newlines and execution-date handling. Exact byte positions are in `docs/BBVA_IMPLEMENTATION.md`. A structurally valid 20-digit CCI does not establish bank ownership, check-digit correctness or bank acceptance. Both currencies and interbank beneficiaries need bank-side acceptance tests. Do not upload the TEST-ONLY files: they reproduce reference instructions.

Accounting must approve professional-fee evidence/classification; SIRE document-type mapping, fiscal period/accounting-date basis, currency/tax-field treatment and the exact target RCE import layout; treatment of legacy records without voucher links; and whether repeat downloads are full-period exports or incremental submissions. The current SIRE CSV contains internal request/CXP references and performs no SUNAT submission. SUNAT invoice and FX gateway responses need actual integration acceptance, including invalid vouchers, outages and prior-publication fallback. No bank or tax certification was claimed or performed here.

## Final deployment checklist

- [ ] Resolve SIRE eligibility/linkage/history defects and professional-fee classification; add negative regressions and rerun the full suite.
- [ ] Secure or disable all demo accounts; provision named users and review custom permissions, approver areas/stages and Management recipients.
- [ ] Confirm five CeCo mappings and employee identity matches; approve real centers/budgets/accounts/periods and deactivate demo CeCos for new work.
- [ ] Build a staging replica set from a representative, access-controlled historical backup; compare snapshots, approvals, budget balances, journals, CXPs and payment/reconciliation evidence before and after migrations.
- [ ] Rehearse the applicable migration order, interruption recovery, indexes and rollback. Do not infer historical financial evidence.
- [ ] Obtain Treasury confirmation and BBVA acceptance for PEN/USD/internal/interbank files; approve fiscal/FX gateway and SIRE/RCE accounting contracts.
- [ ] Configure secrets, HTTPS/origins, persistent files, backups, process supervision and worker alerts. Verify restart behavior and transaction rollback under failure.
- [ ] Complete eight-role Finance UAT across A1/A2/B/C, including failed retry, over-budget approval, partial settlement and Track C refund/closure.
- [ ] Record Finance/IT release approval, deployment owner, maintenance window, monitoring and rollback criteria before opening production access.

## Final readiness decisions

| Intended use | Decision |
|---|---|
| Internal testing | **YES**, in a restricted test environment with synthetic data. Known defects should be explicit test cases. |
| Real historical-data testing | **CONDITIONAL YES**, only on an isolated, access-controlled restored copy. Do not apply unsafe legacy migration inference without review; current empty financial dataset did not validate history. |
| Controlled Finance UAT | **CONDITIONAL** for a scoped sandbox pilot. Full end-to-end acceptance is not ready until blocking flows/configuration are resolved. No actual bank uploads or tax submissions. |
| Production deployment | **NO.** Security, SIRE, professional-fee, CeCo, migration and operational gates remain open. |

Changes made in this review: browser regression fixture/selector maintenance only (`frontend/test/umaResponsive.browser.mjs`); review harnesses, logs and this report; generated TEST-ONLY verification artifacts. No frontend production code, backend application logic, database records, credentials or live configurations were changed.
