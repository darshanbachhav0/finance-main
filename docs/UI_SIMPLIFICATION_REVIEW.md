# UMA UI simplification

Date: 18 September 2026

This update changes frontend organization and presentation. No backend financial rules, permissions, models, historical records, or database data were changed. No migration is required.

## Screen changes

| Screen | Changes |
|---|---|
| Navigation | Primary menus follow each role's daily work. Director and Vice Rector retain the Approver menu and their existing stage-specific permissions. |
| Administration | New hub for Users & Roles, CeCos, approval/document rules, accounting mappings, BBVA formats, exchange rates, and audit. Other authorized workspaces remain available in a collapsed section. |
| Dashboard | At most four role-relevant KPIs, five recent queue items, essential alerts and charts. Removed repeated period/file/decision tables; operational screens retain those records. Reports link provides broader analysis. |
| Requests list | Compact status/progress, common filters, advanced filters on demand. Supplier proposals, employee banking and A2 batches remain reachable through Related tools. |
| Request creation | Four steps: information and items; supplier/quotations; documents; review and submit. Same payloads, autosave, calculations and validation. Expense categories use readable names. Optional documents are hidden until requested, unless already attached or in error. |
| Request detail | Compact identity/amount/requester/status header, six-stage indicator, on-demand workflow help, and focused General/Documents/Approvals/Budget/Accounting/Payment/History sections. Accounting section is shown to Accounting/Admin. Current document phase is the default; all phases remain inspectable. |
| Quick View | Request title, requester, amount, status/progress, stage and Open Request. Removed duplicate accounting lines, approval timeline, period/PEN-equivalent facts and edit-permission logic. |
| Approval Inbox | Removed track, type, priority, supplier/RUC and repeated request-status columns. Retains request, requester, area, stage, amount, SLA and permitted actions. |
| Budget Control | Separate Budget, Exceptions and Commitments views, retaining annual/monthly planning and existing actions. |
| Accounting | Separate Processing, Entries, Consolidation and History views. Four summary cards; detailed ledger figures remain in the financial tables. Finance configuration and supporting tools are contextual links. |
| Treasury | Focused pending-payment, confirmation, reconciliation and returned-payment views; separate Payment History route with downloads. New files still use BBVA only. Historical banks and interbank beneficiary accounts remain readable. |
| Invoices | New Accounting entry point for A2 batch invoices, observations and payables. |
| SIRE | Shared compact filters and on-demand export history. Voucher-level records and exports unchanged. |
| Management Reports | Common period/date/area filters stay visible; currency/type/CeCo/project filters are behind More filters. Export history is collapsed. Existing analysis tabs, financial matrix and charts remain. |
| Cost Centers, Users, Exchange Rates | Accessible through Administration or permitted Finance tools. Shared tables inherit the filter cleanup; organizational details and protected actions are preserved. |
| Master Configuration | Configuration navigation and technical SUNAT administration are collapsed; BBVA technical settings remain Admin-only. |

## Hidden, moved and removed

- Hidden from primary navigation: master maintenance, exchange-rate administration, audit, accounting mappings, BBVA settings and operational secondary tools.
- Moved: administrator settings into Administration; supplier/banking/batch tools into contextual links; Treasury history into its own route; detailed SUNAT evidence into Accounting/Admin disclosures.
- Simplified: stage presentation, multi-invoice progress, filters, creation steps, dashboard metrics and operational work areas.
- Removed from duplicate views: Quick View financial detail/timeline/edit action, repeated request identity fields, extra approval columns and dashboard secondary tables. Underlying records and capabilities remain available.
- Preserved: backend authority, action permissions, document rules, fiscal checks, budget/accounting controls, payment evidence, SIRE, SLA, audit, CeCo snapshots, historical banks, language support, drafts and UMA theme.

## Validation

- Frontend unit/contract suite: passed.
- Production frontend build: passed.
- Backend request API/action alignment tests: 4 passed.
- Backend role/permission tests: 6 passed.
- Item editor browser tests: passed, including IGV, rounding, budget preview, autosave, save/reopen, Spanish and responsive layout.
- Quotation payment terms browser tests: passed, including synchronized percentages, legacy terms, autosave and review.
- Responsive browser matrix: 27 pages at 1440, 1024, 768, 390 and 320 pixels; 135 layout checks. All passed, with no page overflow or runtime errors. Request section switching, Treasury history, all eight role profiles, keyboard focus, Spanish and print checks also passed.
- Browser tests use isolated mocked APIs; no production financial actions are submitted.

## Presentation limits

BBVA configuration JSON, complete rendition forms, accounting consolidation and the detailed reporting matrix remain information-dense when explicitly opened. They contain required financial or administrative information and have not been replaced with simplified business rules. The frontend continues to display metrics supplied by existing endpoints; it does not invent a Paid This Month metric from incomplete data.

## Changed frontend files

- App.jsx; layouts/AppLayout.jsx; utils/navigationAccess.js; utils/requestStage.js.
- New pages/WorkspaceHub.jsx and components/WorkspaceTools.jsx, RequestStageIndicator.jsx.
- Dashboard.jsx, RequestsList.jsx, RequestCreate.jsx, RequestDetail.jsx, ApprovalInbox.jsx, BudgetControl.jsx, AccountingEntries.jsx, TreasuryQueue.jsx, SireExport.jsx, ManagementReports.jsx, MasterConfiguration.jsx.
- DataTable.jsx, ReportFilters.jsx, RequestQuickView.jsx, WorkflowStatusLegend.jsx, FinancialProgressSummary.jsx, FinancialValidationSummary.jsx.
- context/LanguageContext.jsx; styles/uma.css.
- test/run.js, uiCleanup.test.js, umaResponsive.browser.mjs, requestItemAmounts.browser.mjs.

Existing demo-seeding files and the earlier chart changes were preserved; they are not part of this UI task.
