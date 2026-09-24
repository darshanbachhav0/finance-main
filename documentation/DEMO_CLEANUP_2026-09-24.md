# Demo cleanup and actionable validation messages

## Live database cleanup

On 24 September 2026, the user authorized removal of seeded demonstration data from the MongoDB database used by `uma-finance.onrender.com` (`uma_finance_demo`). No credentials are recorded here.

Removed 57 requests, 34 purchase orders, 52 payables, 95 journals, 50 fiscal vouchers, 32 reconciliations, 43 commitments, 1 budget exception, 2 payment batches, 12 suppliers, 6 supplier bank accounts, 20 demo budget allocations, 2 demo projects, 1 explicitly demo exchange rate, 1 explicitly demo employee bank account and 13 related/demo notifications.

Identification used known seed scenario keys, explicit DEMO supplier/project/rate labels, the six original demo CeCo codes, and verified relationships. The script refuses mixed real/demo payment batches, shared budgets and retained financial records referencing selected demo records. No database reset was performed.

Preserved:

- The user's PEN 20,000 budget and genuine supplier.
- All 279 users, 40 Cost Centers, 20 saved drafts and organizational information.
- All 87 existing audit records; appended one cleanup event.
- Approval/document rules, accounting mappings, period controls and banking configuration.
- Seed import provenance and counters, to preserve traceability and avoid identifier reuse.

The six old demo CeCos were already inactive. Demo-labelled login accounts remain because they provide operational role access and the only active Admin account. Replace these deliberately with institutional accounts before deactivating them. Historical audit entries can still mention removed demo records; audit history was not rewritten. Existing uploaded/generated physical files were not deleted from the Render filesystem because it is not mounted locally; their removed database records are no longer listed in the application.

Targeted BSON-preserving EJSON backup, with SHA-256 manifest:

`backend/backups/confirmed-demo-2026-09-24T20-09-30-277Z/`

This directory is ignored by Git and must be protected as a database backup. Restore only selected original `_id` records after checking conflicts; do not rerun the seed as a recovery mechanism. The backup excludes unrelated authentication/HR records.

Reusable maintenance script: `backend/scripts/removeConfirmedDemoData.js`. From the repository root, configure `backend/.env` privately and run `node backend/scripts/removeConfirmedDemoData.js` for a preview. `--apply` enables targeted backup and transactional removal. Stop application writers during planned maintenance. A replica set/Atlas is required for apply. Never run `seed:reset` against this deployment. Normal Render startup does not invoke the seed.

## Validation UX

Request Create now lists missing/invalid fields with readable names, item/quotation numbers and the actual reason. The message remains visible while the user fixes it. API errors are formatted centrally so supplied backend field errors and missing-document counts reach other screens too. Connectivity and generic internal-server failures receive actionable messages without exposing server details. English/Spanish translation and multiline mobile layout are retained.

These frontend changes require deployment; the MongoDB cleanup is already applied.

## Verification

- Frontend test suite: passed.
- Production frontend build: passed.
- Responsive browser suite: 145 page/viewport checks plus interactions, including invalid mobile request forms, passed.
- Isolated local cleanup regression tests: passed (scope, shared-reference blocking, mixed batches, genuine budget, users/audit preservation and dry-run safety).
- Live post-cleanup verification: zero remaining cleanup candidates; PEN 20,000 allocation, user/CeCo/draft counts and all original audit records preserved.

Rotate the database credential shared in chat and update the Render environment and local private configuration with its replacement.

## Follow-up: clear all drafts and simplify shared UI

The user clarified that real users and configuration must remain, and explicitly chose to keep the current Admin login. No user permissions were changed.

Cleared all 20 saved draft records: removed encrypted payloads and titles, closed the drafts, and incremented revisions. Deleted the one GridFS draft attachment and its chunk. Empty closed markers remain because the existing autosave service uses them to reject delayed writes; they are not restorable draft content or visible saved drafts. Verification found zero open drafts, zero payloads and zero draft attachments. A separate targeted backup is at `backend/backups/discard-drafts-1790281013583/`.

Removed two remaining employee bank profiles belonging to demo accounts after verifying there were no requests, payables or payment batches using them. Their targeted backup is at `backend/backups/demo-bank-profiles-1790281308710/`. Appended cleanup audit events; prior history and login accounts remain intact.

Shared UI changes cover pages using DataTable, PageHeader and SectionNavigation:

- Show search and one primary filter initially; keep additional filters behind the existing More filters button.
- Display filter labels and remove the duplicate Clear filters button.
- Replace the rows-per-page dropdown with direct buttons; preserve custom page sizes and server pagination.
- Replace the mobile section dropdown with wrapping direct links.
- Hide an empty saved-view selector until a view exists.
- Show page descriptions directly instead of a separate About this page expander.
- Improve control/text sizes, numeric readability, spacing and touch targets without changing financial rules.
- Fix desktop expanded table details overlapping adjacent content and correct SUNAT heading text encoding.

Frontend tests and production build pass. The private-draft backend regression confirms deletion markers reject stale writes. Browser coverage includes 29 pages at five widths, filters, pagination, saved views and direct section navigation at four widths. UI changes remain local until deployed to Render; database cleanup is live.

The login credentials subsequently pasted into chat should also be rotated. No passwords were copied into source code, reports or tool output.
