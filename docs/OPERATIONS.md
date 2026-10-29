# Operations Runbook

Deployment, background workers, migrations, and day-to-day operational procedures. See
`docs/ARCHITECTURE.md` for how the system behaves; this document is about running it.

## 1. Environment variables

Copy `backend/.env.example` to `backend/.env` and set at minimum:

- `MONGODB_URI` — defaults to `mongodb://127.0.0.1:27017/erp_financial_system` if unset.
- `JWT_SECRET` — set a strong value before any shared/production use.
- `CLIENT_URLS` — every allowed frontend origin (CORS).
- `NODE_ENV=production` for any real deployment — this disables the dev seed and dev-reset scripts.

SUNAT integration (`backend/src/services/sunatService.js`):
- `SUNAT_PROVIDER_MODE` — `PADRON` (the default): supplier RUCs are read directly from SUNAT's
  official downloaded Padrón, updated at startup and daily at 03:00 America/Lima. Core lookup
  never waits for the public website or Chromium. `CONSULTA_RUC` explicitly selects the public
  website, `PRODUCTION` a contracted CPE API (requires
  the vars below) and `MANUAL` only the dedicated manual-override endpoint. `MOCK` is offline,
  used by the automated tests (`backend/test/isolateEnv.js`) and, for its own run, by the demo
  seed, whose fictional RUCs SUNAT does not have.
- `PLAYWRIGHT_EXECUTABLE_PATH` — optional: an installed Chromium-based browser for the Consulta
  RUC lookup (e.g. Edge on a Windows PC) instead of Playwright's Chromium
  (`npx playwright install chromium`).
- `SUNAT_API_BASE_URL`, `SUNAT_API_TOKEN`, and the per-endpoint env vars in
  `ProductionSunatProvider.js` — only needed if a real contracted SUNAT CPE API is available. Absent
  these, `PRODUCTION` mode safely degrades to a 503 "not configured" response for every
  taxpayer/voucher check, and the server now logs a clear warning about this at boot.
- `SUNAT_PADRON_DATA_DIR` — where the downloaded national RUC padrón is stored/indexed.

SIRE / RCE export (`backend/src/services/sireService.js`, screen Accounting → SIRE):
- `SIRE_TAXPAYER_RUC` — UMA's own RUC (field 1 and the file name). Required; the export is blocked
  and the preview shows a configuration error until it is set to a valid RUC.
- `SIRE_TAXPAYER_NAME` — UMA's legal name exactly as registered with SUNAT (field 2). Required.
- `SIRE_RCE_IGV_DESTINATION` — which Anexo 11 column pair receives the base/IGV of taxed purchases:
  `DG` (15/16, default), `DGNG` (17/18) or `DNG` (19/20). It depends on whether UMA's own
  operations are taxed with IGV; UMA's accounting confirmed **`DNG`**.

`render.yaml` sets UMA's values: RUC `20550807123`, name `UNIVERSIDAD MARIA AUXILIADORA S.A.C.`,
`DNG` and `PEN`.
- `SIRE_RCE_BOOK_CURRENCY` — `PEN` (default) or `USD`; sets the file name's currency indicator.

The export is SUNAT's RCE "reemplazo de la propuesta" TXT, structure **Anexo 11 of RS
000112-2021/SUNAT as replaced by Anexo F of RS 000040-2022/SUNAT** (tag `RCE_ANEXO11_RS040_2022`;
RS 000138-2023/SUNAT did not modify Anexo 11). 37 pipe-separated fields per voucher, dates
DD/MM/AAAA, amounts with 2 decimals and no thousands separator (credit notes negative), exchange
rate `#.###`, CRLF line endings, UTF-8, no header. File name per Tabla 13.1:
`LE<RUC><AAAA><MM>00080400021<I><M>2.TXT`, e.g. `LE2010000000920260800080400021112.TXT` for RUC 20100000009, August 2026, with data, in soles.
A voucher goes into the file when SUNAT verified it individually, or when Accounting accepted it
through the audited manual SUNAT exception (always the case in `PADRON` mode, which never verifies a
CPE); the latter is listed with a warning, and SUNAT still compares it with its proposal.
Cancelled CXPs and duplicate voucher links are excluded and listed; any other failing
voucher blocks the file and is listed with its errors. Upload to SUNAT is manual (SUNAT Operaciones
en Línea → SIRE → RCE → Propuesta → Reemplazar); SUNAT's API upload additionally requires zipping.
Sources:
- https://www.sunat.gob.pe/legislacion/superin/2022/anexo-040-2022.pdf (Anexo 1 tablas 11-13, Anexo 11)
- https://www.sunat.gob.pe/legislacion/superin/2022/040-2022.pdf
- https://www.sunat.gob.pe/legislacion/superin/2023/000138-2023.pdf
- https://cpe.sunat.gob.pe/sites/default/files/inline-files/Manual%20de%20servicios%20Web%20Api%20-%20SIRE_Compras%20v24.pdf

Rules not stated verbatim in those sources are marked `// VERIFY:` in `sireService.js` and should be
confirmed with UMA's accountant before the first filing (ideally by running the file through
SUNAT's PVSIRE validator).

Background workers (see §4 — in production they run inside the web service process):
- `BATCH_INVOICE_WORKER_ENABLED`, `SLA_WORKER_ENABLED`, `SUNAT_PADRON_WORKER_ENABLED` — start the
  A2 batch-invoice worker, the approval-SLA worker and the SUNAT Padrón refresh inside `npm start`.
  Each defaults to `true` when `NODE_ENV=production` and `false` otherwise; set one to `false` to
  host that worker separately. The Padrón refresh also requires `SUNAT_PROVIDER_MODE=PADRON`.
- `BATCH_INVOICE_INLINE_PROCESSING` — dev convenience only; must stay unset/false in production so
  the durable worker (not the request thread) processes uploads. While it is on, the in-process
  batch worker never starts.
- `BATCH_INVOICE_POLL_MS`, `BATCH_INVOICE_STALE_MINUTES`, `BATCH_INVOICE_WORKER_CONCURRENCY` —
  batch worker tuning; `SLA_POLL_MS`, `SLA_DUE_SOON_HOURS`, `APPROVAL_SLA_WORKING_DAYS`, `SLA_ESCALATION_WORKING_DAYS` (Peruvian working days; the dashboard and management-portal escalation counters use the same rule) — SLA worker
  tuning. All have safe defaults.
- `NOTIFICATION_EMAIL_MODE` (`OFF` | `LOG` | `SMTP`, default `OFF`), `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_TIMEOUT_MS` (default 10000), `NOTIFICATION_EMAIL_FROM`,
  `NOTIFICATION_EMAIL_REPLY_TO`, `APP_PUBLIC_URL`, `NOTIFICATION_EMAIL_ALLOWED_DOMAINS`,
  `NOTIFICATION_EMAIL_DELAY_MINUTES`, `NOTIFICATION_EMAIL_POLL_MS`,
  `NOTIFICATION_EMAIL_MAX_ATTEMPTS`, `NOTIFICATION_EMAIL_WORKER_ENABLED` — notification emails
  (see §4 "Notification emails"). `NOTIFICATION_EMAIL_FREQUENCY` (`DAILY` default | `IMMEDIATE`) and
  `NOTIFICATION_EMAIL_DIGEST_HOUR` (Lima, default 8) — one summary email a day per person (each
  person can choose "right away" in their account menu).
- `FOLLOW_UP_RETURNED_WORKING_DAYS` (default 2), `DRAFT_AUTO_CLOSE_DAYS` (default 30, `0` = never),
  `DRAFT_CLOSE_WARNING_DAYS` (default 5), `PAYMENT_RUN_NOTICE_WORKING_DAYS` (default 2) — automatic
  follow-ups run by the operations worker (see §4 "Automatic follow-ups and the weekly report").
- `WEEKLY_REPORT_ENABLED` (default on while emails are on), `WEEKLY_REPORT_DAY` (1 = Monday),
  `WEEKLY_REPORT_HOUR` (Lima, default 8), `WEEKLY_REPORT_ROLES` (default
  `Accounting,Treasury,Management`) — the weekly Excel report.

Authentication:
- Accounts never lock after failed sign-ins: the right password always signs in. The sign-in route
  only throttles by IP (10 failed attempts per 15 minutes, then "Too many failed sign-in attempts").
  Failed and successful sign-ins and sign-outs are written to the audit log (module `AUTH`). The
  first server start of this release clears any lock left on accounts by the removed per-account
  lockout (`platformSettingsService.removeSignInLockout`, once); `LOGIN_MAX_FAILED_ATTEMPTS` and
  `LOGIN_LOCKOUT_MINUTES` are no longer read and can be deleted from the environment.
- Administrator who cannot sign in (inactive, or lost the password) and no shell (Render free): from
  your own computer, with the production `MONGODB_URI` (Render → Environment) set in the terminal:
  `npm run account:recover -- --dni=<DNI>` shows the account's status (exists, active) and changes
  nothing; add `--apply --activate` to reactivate and/or `--apply --reset-password` for a temporary
  password (printed once; it must be changed at the next sign-in, and existing sessions end). Every
  recovery is audited (`ACCOUNT_RECOVERED`).
- Administrators (one ADMIN role; the Super Admin role was folded into it, see
  docs/ROLE_PERMISSIONS_GUIDE.md). Day to day, an administrator gives the Admin role from
  Administración > Empleados. Break-glass accounts from the server, against the target
  `MONGODB_URI` like `account:recover`: `npm run admin:create -- --dni=<DNI> --name="<Name>"
  [--email=<email>]` prints a temporary password once; `npm run admin:list` lists administrators;
  `npm run admin:reset-2fa -- --dni=<DNI>` removes the authenticator of someone who lost their phone.
- `TWO_FACTOR_ENCRYPTION_KEY` (optional, recommended in production) — encrypts the authenticator
  secrets. Without it the key derives from `JWT_SECRET`, so rotating `JWT_SECRET` means running
  `admin:reset-2fa` for each administrator who enrolled. `ADMIN_2FA_REQUIRED=true` makes the
  authenticator mandatory for every administrator account (accounts that enrolled always use it).
- Platform settings saved by an administrator (password minimum length and expiry, session length,
  maintenance mode, announcement) override `JWT_EXPIRES_IN`; an empty value falls back to the
  environment.
- `BACKUP_DIR` (default `backend/backups`) — where `npm run backup`, the migrations and Administración > Plataforma
  "Start backup" write. On a host without a persistent disk, copy each backup somewhere safe.

## 2. Local development

```powershell
npm install
Copy-Item backend\.env.example backend\.env
npm run seed
npm run dev
```

- Frontend: `http://localhost:5174`
- Backend: `http://localhost:5000`

`npm run seed` populates a fictional UMA demo dataset: faculties/cost centers and their budgets,
suppliers, expense types, approval, budget and document rules, accounting mappings and four staff
accounts. It creates no requests. The demo password is **not** a fixed value in source —
it comes from `SEED_DEMO_PASSWORD` if set, otherwise a random password is generated per run and
printed in the seed's final JSON summary (`password`/`passwordSource` fields). Capture it from that
output; it is not written anywhere else.

The seed runs offline: it stores its own USD selling rates for every day from the start of the
previous month through today in SUNAT's authoritative record shape (`sourceLabel` starts with
"DEMO"; a real rate already stored for a day is never overwritten), so it needs neither
`SUNAT_EXCHANGE_RATE_ENDPOINT` nor `EXCHANGE_RATE_ALLOW_REFERENCE_FALLBACK`. It also installs an
uncertified BBVA fixed-width configuration with a fictional debit account (notes say DEMO; a
configuration Treasury set up is left alone) so bank files can be generated outside production.
Demo accounts (all with the demo password):

| DNI | Account | Role |
| --- | --- | --- |
| 10000001 | Administración ERP UMA (Demo) | Admin |
| 10000005 | Contabilidad UMA (Demo) | Accounting |
| 10000006 | Tesorería UMA (Demo) | Treasury |
| 10000007 | Tesorería - Presupuesto UMA (Demo) | Treasury (budget plans and exceptions) |

Earlier seeds also created requesters, area directors, the Vice Rector, Management and
Procurement (DNI 10000002-10000004 and 10000008-10000013) and 21 demo requests made by them. Those
accounts and everything they own (their requests with each request's purchase order, invoices,
journals, budget commitment, payment batches and bank files, comments, notifications, drafts and
uploaded files) are removed by `npm run demo:remove-accounts`: it shows what would go and changes
nothing unless `-- --apply`, writes every removed record to an EJSON backup under `BACKUP_DIR`
first, gives the commitments' budget use back to the budget plans, unlinks anyone who reported to
a removed account and keeps the audit history. It stops for manual review when another request
still waits on one of those accounts' approval or shares a payment batch or bank file with their
requests. `npm run seed` runs it first on its own database; for the Render database run it from
your own computer with that `MONGODB_URI` (like `account:recover`). Re-running the seed reuses
what already exists. `backend/test/seedSmoke.test.js` runs the whole seed against a throwaway
database and storage directory.

To wipe and recreate (refuses to run outside a database whose name contains `erp_financial`,
`development`, or `dev`, and refuses to run at all when `NODE_ENV=production`):

```powershell
npm run seed:reset
npm run seed
```

## 3. Tests and build

```powershell
npm test          # backend (Node's built-in test runner, needs a local MongoDB) + frontend
npm run build      # frontend production build
npm run verify      # test + build
```

The backend suite (`backend/test/run.js`) is a full integration suite against a real, per-test-file,
uniquely-named MongoDB database (dropped on completion) — it needs a reachable MongoDB instance, not
a mock.

## 4. Production on Render and background workers

Production runs on **Render** from `render.yaml`: a single web service (`uma-finance`) with one
persistent disk mounted at `/var/data` (`UMA_STORAGE_ROOT=/var/data`,
`SUNAT_PADRON_DATA_DIR=/var/data/sunat-padron`). Render disks belong to exactly one service and
cannot be shared, so every background job that touches files runs **inside the web service
process**, started by `backend/server.js` (`backend/src/workers/inProcessWorkers.js`):

| Worker | Flag (default in production) | Purpose | Uses |
| --- | --- | --- | --- |
| A2 batch invoice | `BATCH_INVOICE_WORKER_ENABLED` (`true`) | Processes queued mass-invoice uploads | MongoDB + uploaded files on the disk |
| Approval SLA | `SLA_WORKER_ENABLED` (`true`) | Due-soon / overdue notifications and escalation | MongoDB |
| SUNAT Padrón refresh | `SUNAT_PADRON_WORKER_ENABLED` (`true`, PADRON mode only) | Keeps the local RUC registry fresh (daily 03:00 Lima) | `SUNAT_PADRON_DATA_DIR` on the disk |
| Notification email | `NOTIFICATION_EMAIL_WORKER_ENABLED` (`true`, only when `NOTIFICATION_EMAIL_MODE` is `LOG`/`SMTP`) | Emails new bell notifications to each person (see below) | MongoDB + SMTP server |

The boot log prints one line with the state of all of them
(`[WORKERS] In-process: batch-invoice=on, sla=on, sunat-padron=on, notification-email=on`). On `SIGTERM` (every Render
deploy) the server stops accepting requests and lets in-flight worker work finish (up to ~25s).

Running more than one copy is safe: the batch worker claims each `QUEUED` batch with an atomic
`QUEUED → PROCESSING` update; SLA notifications and audit rows are idempotent (unique `eventKey`);
the Padrón refresh holds a heartbeat lease file (`worker.lock`) in its data directory and a new
instance waits for a previous instance's lease to go stale (~1 minute) before taking over. Keep
the Render service at **one instance** anyway — its disk can only attach to one.

There are no separate Render worker services any more. If one was created from an older
`render.yaml`, delete it in the Render dashboard (and its separate `uma-finance-padron-data` disk).
If the batch worker is off and nothing else runs it, uploaded invoice batches sit `QUEUED`
indefinitely.

Standalone entry points still exist for local development or hosting a worker elsewhere (turn the
matching `*_WORKER_ENABLED` flag off on the web service first):
`npm run worker:batch`, `npm run worker:sla` (`npm run sla:check --workspace backend` for one
scan), `npm run sunat:padron:worker --workspace backend`. A standalone batch worker must see the
same `UMA_STORAGE_ROOT` files as the web service.

`backend/scripts/startPadronWorker.ps1` registers the padrón sync as a Windows Scheduled Task — for
**local Windows development and the demo launcher only**. `backend/Dockerfile.padron` /
`compose.padron.yml` remain an alternative self-contained Docker path for hosting the padrón worker
outside Render.

The four SUNAT padrón CLI scripts under `backend/scripts/` (`syncSunatPadron.js`, `padronWorker.js`,
`indexSunatPadron.js`, `padronStatus.js`) serve different one-off purposes (sync once, run as a
daemon, rebuild the search index only, or print status) — each has a short comment at its top saying
which of the other three to reach for instead.

### Time zone (Lima)

The platform works on **Lima time (UTC-5, no daylight saving)** everywhere, whatever the zone of the
server (Render runs in UTC) or of the user's device:
- Moments (created, approved, paid, audit) are stored as UTC instants and **shown in Lima** on every
  screen (`frontend/src/utils/formatters.js`); notification emails use Lima too.
- Date-only values (issue, invoice, accounting dates) are stored at 00:00 UTC of their day and shown on
  that same day (`calendarDateKey` in `shared/businessCalendar.mjs`).
- "Today" and the current period (new request, payment confirmation, accounting date, period pickers,
  dashboards, reports, sequence years) are the Lima date (`limaToday`), so work after 19:00 is not
  dated the next day.
- The backend process sets `TZ=America/Lima` at startup (`backend/src/config/timeZone.js`); business
  rules (SLA deadlines, working days, payment cycle 15/30, rendition deadlines) compute Lima dates
  explicitly.
- Advances to render are paid the same working day, not on the 15/30 cycle. Two Finance
  configurations (Settings → Finance Configurations, Admin/Accounting) tune it:
  `ADVANCE_PAYMENT_CUTOFF_HOUR` (Lima hour, default 15: an advance approved from then is paid the next
  working day) and `ADVANCE_RETURN_ACCOUNT` (write UMA's account for unspent advance money, bank,
  account number and CCI, in **Text value**, with Value 0). Without the second one employees are not
  told where to deposit leftovers.

### Automatic follow-ups and the weekly report

The operations worker (`OPERATIONS_WORKER_ENABLED`, on in production) runs every hour:

- **Requests sent back** (`OBSERVADO`, `DEVUELTO`, `OBSERVADO_MONTO_EXCEDIDO`) and not corrected: the
  requester is reminded after `FOLLOW_UP_RETURNED_WORKING_DAYS` working days and again after twice
  that (one notification per stage, never repeated).
- **Stale drafts**: a draft request not changed for `DRAFT_AUTO_CLOSE_DAYS` days is annulled
  (`DRAFT_AUTO_CLOSED` in its history and audit; nothing was committed yet, and "Repeat this request"
  starts it again); an unsaved form draft leaves "Continue your work". The owner is warned
  `DRAFT_CLOSE_WARNING_DAYS` days before. A draft whose accounting month is closed is left alone.
- **Next payment run**: `PAYMENT_RUN_NOTICE_WORKING_DAYS` working days before each 15th / 30th run,
  Treasury is told what falls into it, with a link (`/treasury?run=next`) that lists only that run
  and ticks every payable that can be paid. A payable joins the run its due date (payment terms)
  gives, or the date Treasury planned for it in its Excel payment schedule
  (`AccountsPayable.plannedPaymentDate`, from Payments > Import from Excel).
- **Weekly report**: on `WEEKLY_REPORT_DAY` from `WEEKLY_REPORT_HOUR` (Lima) one Excel workbook (summary,
  new requests, waiting for approval, paid this week, still to pay) is emailed once to the active users
  of `WEEKLY_REPORT_ROLES` (Bcc). Reports > "Weekly report (Excel)" downloads the same workbook at any
  time (`GET /api/reports/weekly.xlsx`).

Treasury reconciles paid payables in Payments > Reconciliation.

Excel imports (`POST /api/imports/:kind`, checked first with nothing saved, then imported):
`budget-plans` (Tesorería: new annual plans per Cost Center), `suppliers` (Tesorería: supplier
proposals, pending validation as usual) and `payment-schedule` (Tesorería: planned payment date and
priority of open payables). Each screen offers the template.

### Notification emails

Every bell notification (approval pending, request observed, payment bounced, SLA overdue…) can also
be emailed to the person it is for. `notifyUser()` queues a `NotificationDelivery` when a
notification is new or comes back unread, and the notification-email worker is woken at once: the
email goes out about a second after the request is submitted (the pause groups everything one action
raises into **one** email per person). Set `NOTIFICATION_EMAIL_DELAY_MINUTES` (default 0) to wait
some minutes instead, so alerts already read in the app are not emailed. Each email lists all
their news, in Spanish, greeting them by name, with an "Abrir en el sistema" button per item that
opens the exact record. An alert already read in the app, resolved meanwhile (someone else approved)
or for a person without an address, inactive or who turned emails off is skipped and recorded with
its `skipReason`. A failed send is retried (1, 5, 15, 60 minutes) up to
`NOTIFICATION_EMAIL_MAX_ATTEMPTS` (default 5) and never affects the business action. Emails carry
no bank data.

Setup (Render → Environment):

1. `NOTIFICATION_EMAIL_MODE=SMTP` (`OFF` disables everything; `LOG` prints emails instead of
   sending — local development).
2. SMTP account of a sender mailbox such as `notificaciones@uma.edu.pe`:
   - Microsoft 365: `SMTP_HOST=smtp.office365.com`, `SMTP_PORT=587`, `SMTP_USER`/`SMTP_PASSWORD`
     of the mailbox (IT must enable *Authenticated SMTP* for it).
   - Gmail / Google Workspace: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER` = the
     Gmail address and `SMTP_PASSWORD` = a 16-character **App Password**. Gmail rejects the normal
     account password: turn on 2-Step Verification, then create one at
     https://myaccount.google.com/apppasswords. `NOTIFICATION_EMAIL_FROM` must use that same
     address (Gmail rewrites any other sender). A free Gmail account sends to about 500 recipients a
     day; emails are grouped per person, so that covers UMA's roster, but an institutional mailbox
     is more trusted by recipients' spam filters.
   - A transactional provider (Amazon SES, Brevo, Resend…) works the same with its SMTP settings.
3. `NOTIFICATION_EMAIL_FROM="UMA Finanzas <notificaciones@uma.edu.pe>"` — the domain must have
   SPF/DKIM set up for that sender, or messages land in spam.
4. `APP_PUBLIC_URL=https://<the web app address>` for the links (defaults to the first
   `CLIENT_URLS` entry).
5. Optional: `NOTIFICATION_EMAIL_ALLOWED_DOMAINS=uma.edu.pe` only emails institutional addresses.
   Leave it unset to email whatever address is saved on each user (the contracts import already
   takes only `@uma.edu.pe` addresses).

**Render's free plan blocks outgoing SMTP on ports 25, 465 and 587** (since September 2025), so
Gmail and Microsoft 365 SMTP cannot be reached from a free instance. Either upgrade the instance,
or use an SMTP provider that also listens on port **2525**, e.g. Brevo: `SMTP_HOST=smtp-relay.brevo.com`,
`SMTP_PORT=2525`, `SMTP_SECURE=false`, Brevo's SMTP login and SMTP key as `SMTP_USER` /
`SMTP_PASSWORD`, and a sender verified in Brevo as `NOTIFICATION_EMAIL_FROM`. SMTP gives up after
`SMTP_TIMEOUT_MS` (default 10 s).

To check it, create a real request and look in **Render → Logs**: at startup
`Notification email: SMTP sign-in OK` (or `sign-in FAILED` with the reason and what to change), then
`Notification email sent to <name> (ab***@domain)` a second or two after the notification (or
`NOTIFICATION_EMAIL_DELAY_MINUTES` later, when set). An email that is not sent says why, e.g.
`Notification email to <name> skipped (1): NO_EMAIL - the user has no email address`, or
`… failed: <SMTP error>`.
If the log says "sent" but nothing arrives, check the provider's own log (Brevo: Transactional →
Logs) and the recipient's spam folder.

The boot log shows `notification-email=on`; an incomplete setup logs what is missing and sends
nothing. People turn emails on/off in their account menu ("Notificaciones por correo");
administrators can do it in User Administration. For one manual pass: `npm run email:send-due
--workspace backend`.

People's addresses come from the HR contracts master (`MAESTRO_CONTRATOS_<date>.xlsx`, column
"CORREO INSTITUCIONAL"), matched by DNI — see §5.

### Demo-only public links (not production)

`START_UMA_PUBLIC_FIXED.bat` (ngrok) and `npm run share` (`scripts/share-cloudflare.ps1`,
Cloudflare Quick Tunnel) expose **this PC's** copy with demo data through a temporary public URL,
for presentations only. They are never the production deployment and must not hold real university
data.

- The launcher runs MongoDB in Docker bound to `127.0.0.1:27018` only, with authentication. The
  admin password is generated on first run and kept in `.uma-local-mongo-password` (git-ignored,
  next to `.uma-local-jwt-secret`). An older unauthenticated `uma-finance-triple-mongo` container
  is migrated automatically (user added, container recreated on the same volume). If the password
  file is lost, the secured container cannot be opened; the launcher explains how to start over.
- Both start the demo server with `BATCH_INVOICE_WORKER_ENABLED=true` and `SLA_WORKER_ENABLED=true`,
  so A2 batches and SLA escalation work during a demo; the Padrón refresh stays with the scheduled
  task registered by `startPadronWorker.ps1`.
- The former `share:publish` / `link:publish` flow (rewriting a Render gateway to the tunnel) was
  removed: production now lives on Render itself, so there is nothing to publish.

## 5. Migrations & data operations

```powershell
npm run backup                          # dumps collections + uploads/generated files
npm run migrate:workflow                # dry run
npm run migrate:workflow:apply          # apply, after reviewing the dry-run report
npm run verify:data
```

**Retired roles.** The `Budget` role was folded into `Treasury`. Every server start moves users,
previous roles and approval rules still stored as `Budget` to `Treasury` (one audit entry each, and
a log line saying how many moved), so nothing has to be run on Render. To see or apply the same
change by hand, from `backend` with the target `MONGODB_URI`:

```powershell
npm run migrate:retired-roles           # dry run: what would move
npm run migrate:retired-roles:apply     # apply
```

**Request / supplier improvements (October 2026).** The new fields need no migration to work:
requests saved from now on carry priority rank, frequency, the chosen account and the receipt data,
and suppliers registered from now on get their PRV code and their requester's area. For existing
records, from `backend` with the target `MONGODB_URI` and after a backup:

```powershell
npm run migrate:platform-improvements                                   # dry run: what would change
npm run migrate:platform-improvements:apply                             # PRV codes, priority rank, frequency, DOC numbers
node scripts/migratePlatformImprovements.js --apply --assign-areas      # also give suppliers their areas
```

It only fills what is missing: suppliers without a PRV code get the next codes (oldest first, after
the highest code in use), requests get their priority rank and frequency, and generated files get a
`DOC-YYYY-#####` number in creation order. `--assign-areas` gives each supplier without areas the
areas of the requesters who used it and of its proposer — this changes what requesters see, so run
it deliberately; until then every existing supplier stays shared with every area. Running it again
changes nothing. A user's department is their area in Users (empty counts as "General"): set it
before people register suppliers, and give Tesorería and Contabilidad staff different areas if each
should keep its own supplier list.

Migration reports are written under `backend/migration-reports`. Every migration script no-ops if
its own key already exists in the `migrationruns` collection, so re-running an already-applied
migration is always safe. Back up first; ambiguous historical records are reported for manual review
rather than silently reinterpreted, and no collection is ever dropped.

People's emails (for notification emails) are imported from the HR contracts master. The workbook
holds personal data — keep it out of the repository and pass its path:

```powershell
npm run import:emails -- --file="C:\path\MAESTRO_CONTRATOS_2026-09-30.xlsx"         # dry run
npm run import:emails:apply -- --file="C:\path\MAESTRO_CONTRATOS_2026-09-30.xlsx"   # apply
```

Each active person is matched by DNI and gets the "CORREO INSTITUCIONAL" address; only
`@uma.edu.pe` addresses are taken unless `--allow-domains=uma.edu.pe,gmail.com` (or `--any-domain`)
says otherwise. Ceased employees (`CESADO`), cells that are not an address (e.g. a program name),
an address shared by two people, an address another user already has and DNIs with no user are
skipped and listed in the report (`data/reports/contract-email-import*.json`). Every change is
audited (`EMAIL_IMPORTED`, with the previous address). The email also works as a secondary sign-in
identifier, as before.

Other one-off/maintenance scripts under `backend/scripts/` (cost-center import, deployment password
rotation, demo-data cleanup) are documented individually at the top of each script. Presentation-only
demo scripts that duplicate the main seed for a "live demo" dataset are isolated under
`backend/scripts/tools/demo/` and are not part of the production path.

## 6. Storage & backup

- Request evidence: `backend/uploads/requests/{requestId}`
- Supplier evidence: `backend/uploads/suppliers/{supplierId}`
- Bank files: `backend/generated/bank-files`
- Reports / accounting exports: `backend/generated/reports`, `backend/generated/accounting`

`npm run backup` exports MongoDB collections as Extended JSON alongside both upload directories into
a timestamped `backend/backups` folder — a usable recovery point needs all of it, not just the
database dump.

## 7. Known external dependencies not yet in place

These require a real institutional decision or credential this codebase cannot supply on its own:

- **BBVA production certification** — `BankFormatConfiguration.certified` stays `false` until
  Treasury/BBVA formally accept the generated PEN/USD test files through the certification action
  (Admin or Treasury, `/configuration/bank-formats`, linked from Treasury's menu as "Bank Formats").
- **A contracted SUNAT CPE API** — if/when one exists, set `SUNAT_PROVIDER_MODE=PRODUCTION` and the
  associated env vars (or only `SUNAT_VOUCHER_ENDPOINT`, which `CONSULTA_RUC` and `PADRON` then use
  for vouchers); until then, production runs on `PADRON` (taxpayer verification only).
- **The organizational roster's manager-chain (`jefe`) data** — approval routing prefers this over
  configured rules; keeping it current is what keeps most requests off the "no configured rule for
  this dimension" error path (see `ARCHITECTURE.md` §3.3).


## Supplier automatic lookup

`SUNAT_PROVIDER_MODE=PADRON` is the default and the production configuration. RUC, legal name,
taxpayer status, domicile condition, ubigeo and fiscal address come directly from the indexed
official Padrón. The API returns the publication date with the source; it never labels it as a
live website check. The dataset does not contain legal representatives or bank accounts.
Representatives remain a separate optional website lookup, and manually entered fields remain editable.

If explicitly selected, `SUNAT_PROVIDER_MODE=CONSULTA_RUC` verifies every RUC on SUNAT's official public
Consulta RUC website, in headless Chromium, and on nothing else. The lookup reads the whole result
page: legal name, commercial name, taxpayer type, registration and start dates, status, domicile
condition, fiscal address, voucher issuing and accounting systems, foreign trade activity, economic
activities, vouchers authorized for printing, electronic issuing system, electronic issuer since,
electronic vouchers, PLE affiliation and SUNAT registries (padrones); the legal representatives come
from the page's own representatives button. That profile is shown on the supplier form and saved
with the supplier's taxpayer validation. A RUC SUNAT does not have ("El número de RUC ... no es
válido") is an official negative result. If the website times out, changes its layout, or requests
human verification, the lookup is unavailable (503) and the supplier's validation stays pending:
there is no fallback, no simulated answer, and human verification is never bypassed.

Padrón mode does not open Consulta RUC before looking up a RUC. An explicit website configuration
can optionally use `SUNAT_CONSULTA_RUC_PADRON_FALLBACK=true`. Negative taxpayer results are never
overridden with a positive fallback. These lookups are taxpayer evidence, not invoice validation
or bank ownership proof.

Explicit Consulta RUC deployments install Chromium (`npx playwright install chromium`) with
`PLAYWRIGHT_BROWSERS_PATH=0` at build and runtime, as configured in render.yaml. Existing
services managed outside the Blueprint need those settings applied in their dashboard too.
The host must supply Playwright Chromium system libraries for website lookups. Padrón core
lookups and daily updates have no browser dependency.
On a local Windows PC, `npx playwright install chromium` once, or set
`PLAYWRIGHT_EXECUTABLE_PATH` to the installed Edge (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`).

Keep `SUNAT_PADRON_WORKER_ENABLED=true` and `SUNAT_PADRON_DATA_DIR` on persistent storage.
The worker defaults on for both local and production Padrón servers. A legacy
`SUNAT_TAXPAYER_CACHE_MODE=MONGO` value cannot disable it while `SUNAT_PROVIDER_MODE=PADRON`.

The inline supplier form retries a preparing Padrón lookup every 15 seconds while it stays open.
When the dataset becomes ready, the legal name and account holder fill automatically; the fiscal
address, ubigeo and taxpayer status appear in the SUNAT evidence and are included in the proposal.
Manual entries are preserved. Changing the RUC cancels the previous lookup. The official file
does not contain legal representatives or bank accounts; representatives use a separate lookup.
If the dataset is missing or expired and `SUNAT_PADRON_WORKER_ENABLED=false`, the API reports a
configuration error instead of asking the browser to poll indefinitely. Enable the worker on the
same service and persistent disk before expecting automatic prefill. Both `render.yaml` and
`backend/.env.render.example` select `PADRON` with its updater enabled; existing Render services
must apply those environment values explicitly if they are managed outside the Blueprint.
The existing in-process worker checks at 03:00 America/Lima daily, checks on startup, retries
failures, and keeps the last usable generation. The service must be running for the scheduled
check; a suspended service cannot execute background work. Check worker-state.json and
server logs for the actual last refresh and next check; a schedule alone is not proof of success.
Updates use a file lease, validate the ZIP and indexes, and activate a complete generation
atomically. Failed downloads keep the last usable dataset and retry after 1 minute, 5 minutes,
15 minutes, then hourly. An unchanged ZIP is not indexed again. Historical supplier/request
snapshots are not rewritten.

Verify with `npm run sunat:padron:status --workspace backend`: check `worker.running`,
`worker.nextCheckAt`, `synchronization.lastSuccessAt`, `manifest.datasetDate` and `ready`.
Bootstrap immediately with `npm run sunat:padron:bootstrap --workspace backend` if needed.
Local launchers and `render.yaml` select `PADRON` and enable its worker. For a Render service
managed outside the Blueprint, set `SUNAT_PROVIDER_MODE=PADRON`,
`SUNAT_PADRON_WORKER_ENABLED=true` and `SUNAT_PADRON_DATA_DIR=/var/data/sunat-padron` in its
environment, mount a persistent disk at `/var/data`, then redeploy.

Only fields supplied by the source are autofilled. Legal name, commercial name, fiscal
address and taxpayer status come from the profile; representative lookup remains separate.
Location fields are filled when explicitly supplied, not inferred from ambiguous addresses.
Contact phone/email, banking details, payment terms and internal commercial information
remain user-provided when absent from SUNAT. Existing user edits are not overwritten.


### Render lookup deployment check

Use `npm ci && npm run build` for the service build. In explicit Consulta RUC mode the root build runs
`scripts/ensureSunatBrowser.js` on Render: it installs Chromium and verifies a
headless launch. A failed install or missing Linux library fails the build, instead
of silently deploying broken autofill. If PLAYWRIGHT_BROWSERS_PATH is not set, both
build and runtime use node_modules/.cache/uma-chromium in the project. An explicit
value (including 0 from the Blueprint) must stay identical during build and runtime.
Successful build logs contain `SUNAT Chromium launch check passed.`

Lookup logs expose sanitized CONSULTA_BROWSER_MISSING, CONSULTA_BROWSER_DEPENDENCIES,
CONSULTA_ACCESS_RESTRICTED, CONSULTA_TIMEOUT or CONSULTA_UNAVAILABLE diagnostics.
The API preserves the distinction if the Padron fallback also fails. Infrastructure
failures ask Administration to correct deployment, rather than retry indefinitely.
No missing profile is treated as valid taxpayer evidence. Browser launch validation
is not proof that SUNAT accepts traffic from the deployed host: verify a supplier
lookup on that host after deployment.


### Consulta RUC profile deadline and recovery

The company profile deadline defaults to 20 seconds; optionally configure
`SUNAT_CONSULTA_RUC_PROFILE_TIMEOUT_MS` (bounded to 10–25 seconds). The frontend
allows 35 seconds including browser startup. The previous eight-second deadline
was observed terminating Render lookups while representative lookups succeeded.
This limit is a ceiling, not a delay: available results return immediately.

Representative lookups now cache the verified company profile read on the same
SUNAT page. A recovered profile lookup also starts the representative lookup in
the open supplier form. Cached profiles retain their original query timestamp;
manual form edits remain protected. Successful lookup does not imply taxpayer
eligibility or verified bank ownership.


### Automatic supplier taxpayer validation

With `SUNAT_PROVIDER_MODE=PADRON`, saving a new 11-digit RUC proposal records official dataset
evidence. Explicit `CONSULTA_RUC` mode records website evidence. A result is
accepted only for ACTIVO/HABIDO and matching RUC/legal name. Unavailable lookups
leave the saved proposal pending. Treasury can retry from Supplier Detail
using "Validate automatically with SUNAT"; final homologation rechecks the same
control. The audit records source, evidence date, result and initiating user.
Manual and mock provider modes retain their distinct behavior. This taxpayer
check does not verify an invoice, bank account or Finance compliance review.
No migration is required; existing pending suppliers can use the retry action.


## Optional website cache mode (not the daily Padrón deployment)

The following is a legacy alternative for hosts without persistent dataset storage. It selects
website lookups and does not satisfy a guaranteed daily official-Padrón update. Use the Padrón
configuration above for the current deployment.

Set these variables in Render Environment, then deploy the updated code:

```env
SUNAT_PROVIDER_MODE=CONSULTA_RUC
SUNAT_TAXPAYER_CACHE_MODE=MONGO
SUNAT_PADRON_WORKER_ENABLED=false
```

`render.yaml` sets `PADRON`. To explicitly choose this website alternative, change
`SUNAT_PROVIDER_MODE` in the Render dashboard (Environment). Deleting it restores the Padrón default.

Keep the existing MONGODB_URI and browser build hook (`npm ci && npm run build`).
Keep the normal web-service start command. No PC, tunnel, additional paid worker,
or whole-Padrón import into Atlas is required. MONGO mode also suppresses implicit
lookup-triggered dataset downloads even if an old worker flag was left enabled.

The first RUC lookup uses official Consulta RUC. Successful official profiles are
stored in `taxpayerprofilecaches` in the existing database, keyed by RUC. This
collection contains public taxpayer evidence only. The built-in Mongo `_id` index
prevents duplicate RUC records; there is no financial-data migration. Supplier
registration and invoice taxpayer checks share this source in MONGO mode. Original
source and observation time are retained; cache reads never extend freshness.
Inactive/non-habido responses remain negative. Cache evidence expires after 24
hours; expired evidence cannot approve a taxpayer when an upstream refresh fails.
An existing local Padrón may still provide fallback, but its dataset evidence must
also meet that freshness limit. This is not a substitute for CPE verification.

The web process starts a serial refresh loop automatically: at startup and every
five minutes, refresh up to ten expired cached profiles; failed refreshes retry
in an hour. Interactive requests independently refresh expired entries immediately.
Render Free sleeps when idle: the worker cannot execute during sleep. Overdue
refreshes resume after wake; this is daily evidence expiration, not a guaranteed
03:00 daily job. A guaranteed clock-time schedule requires an independently hosted
scheduler/worker or an always-on service. The worker does not keep Render awake.

Deployment verification: confirm the `[WORKERS] SUNAT durable taxpayer cache
enabled` startup log, query a real RUC, verify source/queriedAt, then repeat after a
restart and confirm a fresh cached result is reused. Do not mark an invoice valid
merely because its taxpayer lookup succeeded. New or expired RUCs still depend on
SUNAT being reachable from Render; CAPTCHA/access restrictions are not bypassed.
No banking, contacts, or compliance declarations are invented from public data.

Rollback: unset SUNAT_TAXPAYER_CACHE_MODE to restore the existing disk-based
provider. Retain the cache collection or remove it separately if no longer needed;
no historical supplier/invoice evidence is rewritten by this feature.
