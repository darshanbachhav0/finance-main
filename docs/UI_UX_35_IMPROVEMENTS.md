# UMA interactive UI update

This update adds the missing interaction features and extends existing UMA components. It does not introduce new financial decisions, database migrations, workers or environment variables.

## Where to find the improvements

| # | Improvement | Implementation |
|---|---|---|
| 1 | Animated workflow timeline | Request stages and approval history retain canonical backend statuses; current-stage transitions use short motion. |
| 2 | Role-based command center | Dashboard keeps role-specific metrics, priority work and the primary next action. |
| 3 | Interactive KPI cards | Cards link to the relevant work and animate numeric values briefly. Existing report comparisons use actual backend baselines; missing trends are not invented. |
| 4 | Chart drill-down | Existing chart clicks retained; exact-data tables now offer keyboard-accessible drill-down buttons. |
| 5 | Budget consumption bars | Dashboard, Budget Control and Management presentation show independent committed, executed, paid and available bars. Paid is never stacked onto executed. |
| 6 | Approval journey | Request Details and request help show the stored approval route, current stage, completion/due dates and SLA countdown. Existing approval history retains named sign-offs. |
| 7 | Page transitions | Existing short page, wizard and panel transitions retained and extended to the manual reduced-motion preference. Skeletons remain visible during loading. |
| 8 | Contextual sticky actions | Request Detail retains server-derived actions in a sticky desktop panel. |
| 9 | Notification center | Bell filters for all, unread, approvals, payments, SLA and other notifications. Existing mark-read actions and destination links remain. |
| 10 | Live activity feed | Optional Dashboard activity section shows the logged-in user's latest notifications; refreshes every 30 seconds while open and visible. |
| 11 | Financial attention indicators | Optional Dashboard section links to actual backend warnings and explains its scope. No invented financial-health score. |
| 12 | Global search | Federated, cancelable search across permitted requests, suppliers/RUC, CeCos, invoice/CXP references, active purchase orders and payment batches. Partial-source failures are visible. |
| 13 | Keyboard shortcuts | Ctrl/Command K and slash open Search; N opens New Request for eligible roles outside input fields; Escape closes panels. Arrow-key search navigation retained. |
| 14 | Saved views | Existing named filters, sorting and density retained; saved view keys are now scoped to the user. Search links populate table search. |
| 15 | Personalized dashboard | Reorder or hide the three secondary work/chart panels; restore defaults. Primary actions and warnings stay visible. Preferences are scoped to user and role. |
| 16 | Expandable rows | Existing row details retain secondary fields and now include compact request stages where applicable. |
| 17 | Document checklist | Request Detail displays phase completion progress alongside the backend-required, present and missing counts. |
| 18 | Document uploads | Request, invoice, batch and Treasury evidence controls support dropping files, allowed-type/count/empty-file feedback, local file details and safe image previews. Request Create/Edit shows actual upload progress and a separate saving phase. |
| 19 | Quotation comparison | Side-by-side comparison highlights the lowest positive price and price difference within each currency. It does not compare PEN directly with USD or select a supplier automatically. |
| 20 | First-use guidance | Dismissible Dashboard welcome links to a role-specific workspace tour. Tours can be restarted from Help. |
| 21 | Contextual help | Top-bar help follows the current workspace. Request-specific help uses actual document phases, requirements, approval snapshot and allowed actions. |
| 22 | Actionable empty states | Existing clear-filter actions retained; Dashboard empty work lists offer the role's next workspace action. |
| 23 | Success feedback | Existing success toasts and post-save navigation retained with restrained confirmation motion. No success is shown before server confirmation. |
| 24 | Progressive disclosure | Advanced fiscal information remains role-gated. Technical approval evidence is collapsed for Accounting/Admin; ordinary decision history stays readable. |
| 25 | Mobile actions | Request Detail uses a collapsible bottom action panel with the same server-derived controls and confirmation dialogs. |
| 26 | Resizable queue previews | Treasury and Accounting have desktop side-by-side request previews with a width control. Smaller screens use the existing accessible drawer. |
| 27 | Payment calendar | Treasury offers month/week views of pending payments. Scheduled date takes precedence over due date; all API pages are read and duplicate CXPs removed. Currency totals remain separate. |
| 28 | Budget heatmap | Management Reports offers cost-center allocation tiles showing availability and percentage with request drill-down. Annual-only records without a monthly limit are explicitly labeled. |
| 29 | SLA countdown | Dashboard approval rows, Approval Inbox and approval journey show time remaining/overdue. Resolved/terminal request statuses do not display countdowns. |
| 30 | Management presentation | Management/Admin can display filtered reports in a large panel or full screen, move between slides and optionally rotate every 12 seconds. Pause and reduced-motion controls are supported. |
| 31 | Data freshness | Dashboard, reports, calendar and presentation indicate data age. Existing refresh controls remain; failed fetches do not fabricate a fresh timestamp. |
| 32 | Safe undo | Clearing table filters or hiding dashboard widgets offers Undo. Financial submissions, approvals, postings and payments are not undone by this UI control. |
| 33 | Micro-interactions | Buttons, selected calendar dates, drop zones, budget bars, panels and notifications use consistent feedback. |
| 34 | UMA motion system | Short transitions use UMA styles. System and user reduced-motion preferences cover CSS, charts and Web Animations. |
| 35 | Accessibility | Keyboard-accessible charts, focus restoration between dialogs, large text, light/dark high contrast, reduced motion and responsive controls. English and Spanish labels are supported. |

## Operational notes

- Display preferences are saved on this browser/device, separately from server-backed financial drafts. Existing autosave is unchanged.
- Search only uses existing APIs permitted for the role. Purchase-order search covers active eligible orders; invoices are found through CXP references. It is not a new privileged database search API.
- The activity feed is the user's notification history, not an unrestricted institutional audit stream.
- The calendar shows pending obligations, not bank-confirmed historical payments. Payment History remains the source for completed payments. Any fetch failure blocks calendar totals rather than showing an incomplete result.
- Calendar reads are capped at 100 pages per source to avoid unlimited browser work. Very large queues must be reviewed in the normal paginated Treasury workspace.
- Document previews do not replace backend XML/fiscal verification. A selected file is explicitly marked local until the form is saved.
- Numeric animations end at the actual API value. They do not change calculations or finance evidence.
- These are frontend changes; existing financial validation, allowedActions checks, role restrictions, audit history and BBVA generation remain authoritative on the backend.

## Verification

Run `npm run test:frontend`, `npm run test:backend`, and `npm run build` from the repository root.

Run `node frontend/test/umaResponsive.browser.mjs` for the 28-page, five-viewport regression suite and the new interaction checks. The harness mocks every API request; it does not submit transactions to a live database. `UMA_ADVANCED_ONLY=1` runs only the new interactions for focused troubleshooting. Screenshots/results are written under `.tmp/uma-ui`.
