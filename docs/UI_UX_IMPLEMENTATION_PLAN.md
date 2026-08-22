# UI/UX Implementation Plan

Date: 2026-08-11

Status: IMPLEMENTED AND VERIFIED

## Completion Record

- Phases 1-5 are implemented in shared frontend components, report aggregations, dashboards, responsive styles, and bilingual labels.
- Phase 6 completed with the full backend/frontend suite, a successful Vite production build, eight role-navigation checks, and browser checks at every required width.
- Representative screenshots are stored in `docs/screenshots/`.

## Principles

- Preserve the existing React/Vite, Express and MongoDB architecture.
- Keep backend RBAC, workflow, accounting, budget, Treasury and audit services authoritative.
- Extend shared components before touching individual pages.
- Use real transactional data and read-only reporting aggregations.
- Keep motion restrained and disable it through `prefers-reduced-motion`.

## Phase 1 - Shared Work Context

1. Extend `usePaginatedResource` with session-preserved search, filters, sorting, page and page size.
2. Extend `DataTable` with user density, named saved views, view deletion and optional export action.
3. Add shared money/date formatters and last-updated presentation.
4. Add a keyboard-accessible authorized command palette with page and request search.

## Phase 2 - Analytics Components

1. Add Recharts to the already route-lazy dashboard/reporting surfaces.
2. Build reusable chart panels with headings, legends, exact tooltips, empty/loading/error states and tabular fallback.
3. Build responsive report filters for period/date, currency, request type, area, Cost Center and project.
4. Add click-through/drill-down links that preserve relevant query filters.

## Phase 3 - Reporting Backend

1. Extend the existing management summary endpoint instead of creating a second reporting model.
2. Add real aggregations for prior-period comparison, AP ageing, approval SLA, Treasury schedule, supplier concentration, rendition backlog, lifecycle funnel and period-close readiness.
3. Apply all supported filters consistently to request-derived aggregations.
4. Preserve existing CSV generation/history and include active filter metadata.

## Phase 4 - Role Dashboards and Reports

1. Add concise role-appropriate visual summaries to the existing dashboard.
2. Redesign Management Reports as a dense operational analytics workspace with filters, charts, exact tables and exports.
3. Retain dashboard tables and contextual links for action-oriented work.
4. Add refresh timestamps and explicit loading/error/empty feedback.

## Phase 5 - Workflow and Responsive Polish

1. Add print-friendly Request Detail and approval-summary behavior.
2. Refine mobile filter stacking, chart height/legends, 44px touch targets and overflow containment.
3. Add first-use guidance that can be dismissed and remains unobtrusive.
4. Synchronize all new English/Spanish labels and test keyboard/reduced-motion behavior.

## Phase 6 - Verification

1. Run backend and frontend tests and the Vite production build.
2. Test all roles and authorized navigation/dashboard content.
3. Verify 1440, 1280, 1024, 768, 430 and 390 px layouts.
4. Exercise normal, empty, loading and error chart states without mutating financial data.
5. Test command palette, saved views, table density, row menus, mobile sheets, Escape and focus restoration.
6. Capture representative desktop, tablet and mobile screenshots and record remaining external limitations.
