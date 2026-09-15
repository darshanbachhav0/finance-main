# Automatic work drafts

UMA saves unfinished data to the signed-in user's account after a 700 ms typing pause. Closing an editor, changing request steps, switching away from the browser, or logging out flushes pending work. These are private work drafts, separate from official financial requests in BORRADOR status.

## Using drafts

- Reopen the same form to recover its latest unfinished draft. The dashboard's **Continue your work** section opens a specific draft, including its record and request step.
- **Start another draft** preserves the current new-record draft and opens another. Existing-record editors retain a draft for that specific record.
- **Discard draft** asks before deleting the unfinished work and its draft attachments. Closing/Cancel retains it.
- **Draft saved to your account** appears only after the server confirms the latest fields and attachments. During a connection failure, the editor reports that the work is not saved to the account and retries automatically, on reconnection, or through Retry.
- Conflicting edits from another tab/device produce an explicit conflict. Load the saved version or keep the current work as a separate draft; there is no silent overwrite.
- A changed original record is flagged for review. Existing submission, permission, validation, duplicate, budget, and payment controls still apply.

## Coverage

| Workspace | Progress retained |
| --- | --- |
| Supplier proposals and corrections | RUC, SUNAT lookup results/date, contact and declaration fields, optional bank details, documents; duplicate lookup rechecked on recovery, older Padrón results refreshed in the background without replacing recovered entries |
| Financial requests | Header, CAPEX/OPEX details, item rows, quotations/payment terms, document and quotation files, current/available/completed steps |
| Reimbursement and supplier banking | Unsubmitted bank fields; no verification or preferred-account action is triggered by autosave |
| Supplier reviews | Unsubmitted Finance/tax/bank review entries; decisions require the existing explicit action |
| Expense renditions | Accounting, mobility and unsupported expense rows, returns, destination selection, comments, evidence and settlement entry; beneficiary acknowledgment must be reconfirmed |
| Annual/monthly budgets | Plan dimensions, annual amount, all monthly distributions; adjustment fields and the existing retry operation identifier |
| Accounting | New accounting periods and unsubmitted fiscal processing fields |
| Treasury | Payment confirmation, bounced-payment report, reprogramming evidence and reconciliation entries, each tied to its original record |
| Invoice entry | Batch file/PO selection, invoice/conformity files and replacement files for observed invoices |
| Master-data editors | User, cost center, expense account, exchange rate, project, rule, allocation and configuration forms through ResourceManager; password fields are deliberately excluded |

Search filters, report exports, transient confirmation dialogs, login passwords, approvals, financial postings, and payment execution are not automatically performed or persisted as decisions. Successful data-entry submissions clear their work draft.

## Persistence and security

`WorkDraft` stores ownership, scope, record, route, revision and an AES-256-GCM encrypted payload. Draft attachment contents are also encrypted and stored in private MongoDB GridFS collections. All draft/file access requires an active authenticated owner and an allowed role; Accounting/Admin cannot read another user's private drafts through these endpoints. Attachments reuse the platform's extension, MIME and content-signature validation (50 MB/file, up to 100 stored attachments/draft). Draft JSON is limited to 1 MB.

Unsent changes also have an encrypted, account-scoped IndexedDB outbox in the current browser, with a non-extractable Web Crypto key. This protects against accidental plaintext storage; it is not a defense against compromised application JavaScript or a compromised browser profile. Confirmed snapshots are removed from the outbox. Other devices receive the last server-confirmed version. Clearing browser data, storage quotas, a sudden device failure before the local write, or lack of secure-context Web Crypto can prevent local recovery. The UI must not be treated as saved until server confirmation. A browser-close warning protects changes still awaiting server confirmation; logout waits for saves and asks before leaving if any remain unsynchronized.

Draft updates use atomic owner + revision comparison and retry identifiers. Deletion/completion retains an empty tombstone so delayed writes cannot recreate the draft. No draft endpoint calls workflow, notification, budget commitment, supplier activation or payment services. Autosave API calls also do not trigger notification-bell refreshes.

## Configuration and operations

No manual database migration is required; Mongoose/GridFS create the new collections. Restart the backend after deployment and serve the updated frontend build.

Set a strong, stable **DRAFT_ENCRYPTION_KEY** before first use and back it up securely alongside the database recovery process. If omitted, the implementation derives its key from JWT_SECRET (a development-only fallback is available outside production). Production refuses draft encryption when neither secret is configured. Changing the active secret without a data/key migration makes previously encrypted drafts unreadable. Do not casually change JWT_SECRET when relying on that fallback. The existing full-database backup includes WorkDraft and GridFS; the encryption secret must be backed up separately.

Drafts do not expire automatically. Discard removes their encrypted payload and associated files. Uploads interrupted after creation but before reference remain associated with that draft until it is discarded/completed; operators should monitor draft/GridFS storage. The dashboard currently lists the 200 most recent accessible drafts.

## Validation

- `npm run test:drafts --workspace backend`: authenticated API tests against a disposable MongoDB database: ownership, role restrictions, encryption, concurrent revision conflicts, idempotent replay, attachment access/content recovery, discard cleanup, delayed-write rejection and absence of workflow side effects.
- `npm run test:drafts-ui --workspace frontend`: real React forms with the real draft API and isolated business-data fixtures: supplier close/reopen, separate browser recovery with files, conflict copy, interrupted saves/browser outbox recovery, discard, request recovery and mobile layout.
- Existing item, quotation payment-term and annual/monthly budget browser suites cover their unchanged financial behavior with draft traffic isolated from the business fixtures.
- `npm run build --workspace frontend` and frontend contract tests validate production bundling and existing UI contracts.

New forms should integrate `useWorkDraft` with explicit React state, stable record identity, a guarded `DraftPanel`, a resume handler, and `complete()` only after a successful business operation. Do not implement drafts by scraping DOM controls or by autosubmitting business endpoints.
