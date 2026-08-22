# UMA Financial Operations UI Design System

Version: 2026-08-11

## Purpose

This design system supports frequent CAPEX, OPEX, Accounts Payable, budget, Accounting, and Treasury work. It favors scan speed, clear control state, exact financial values, and predictable interaction over decorative presentation.

## Color Tokens

| Purpose | Token family | Usage |
|---|---|---|
| Navigation | Navy 800-950 | Sidebar, selected tabs, compact controls |
| Primary action | Teal 600-700 | Submit, apply, refresh emphasis, links and focus cues |
| Success | Green 100/700 | Approved, paid, reconciled, ready states |
| Pending | Amber 100/700 | Pending approvals, SLA warnings, exceptions |
| Error/destructive | Red 100/700 | Validation errors, rejection, annulment, permanent deletion |
| Work surfaces | White, gray 50-150 | Page background, tables, panels and grouped controls |
| Text/borders | Gray 300-950 | Borders, secondary text and primary text |

Red is reserved for errors and destructive commands. The interface uses no gradients or decorative background effects.

## Type and Spacing

- Use the application sans-serif stack and stable, non-viewport-scaled sizes.
- Page headings are 18-20px; panel headings are 12-14px; operational body text is 10-12px.
- Numeric table columns align right. PEN and USD values use the shared locale formatter.
- Spacing follows a compact 4/8px rhythm. Work panels normally use 12-16px padding.
- Border radius never exceeds 8px. Shadows are restrained and reserved for raised controls, menus, dialogs, and interactive panels.

## Layout

- Desktop uses the collapsible 264px navigation and dense multi-column work areas.
- At 900px and below, navigation becomes a focus-managed drawer and report/table filters become collapsible.
- At 680px and below, forms and page actions stack, controls use approximately 44px touch targets, and tables scroll only inside their container.
- Dashboard report summaries use two columns at 430/390px so the first analysis remains reachable.
- The document width must not exceed the viewport at 1440, 1280, 1024, 768, 430, or 390px.

## Shared Components

- `PageHeader`: title, breadcrumb context, last-updated metadata, and compact actions.
- `DataTable`: server paging, search, sort, filters, sticky headers, selection, saved views, density, result count, export, and empty/loading states.
- `RowActionMenu`: Floating UI portal at desktop and safe-area bottom sheet on mobile. It flips/shifts within the viewport and restores focus.
- `AnalyticsChart`: responsive bar, line, area, and donut charts with exact tooltips and an HTML data-table fallback.
- `ReportFilters`: period/date, currency, type, area, Cost Center, and project scope.
- `ConfirmDialog`, `Drawer`, `Toast`, `StatusBadge`, `StatCard`, `WorkflowStepper`: one shared behavior for operational feedback and status.
- `CommandPalette`: authorized page navigation and request-reference search with `Ctrl/Cmd+K` or `/`.

## Interaction Rules

- Motion lasts 120-220ms and uses opacity plus small translation/scale only.
- `prefers-reduced-motion` reduces nonessential animation to effectively zero.
- Every icon-only control has an accessible name and tooltip where needed.
- Disabled financial actions explain the unmet condition.
- Confirmations state the exact result; rejection/return requires comments when enforced by the backend.
- Menus and dialogs close on Escape, support expected arrow/Enter/Space behavior, and restore focus.

## Charts and Reports

- Charts always use transactional API data and never hard-coded samples.
- Tooltips show exact values; legends remain responsive; no 3D chart is allowed.
- Every chart has a disclosure containing the same values in a semantic table.
- Clicking supported chart elements opens the related filtered transactional list.
- Loading, empty, and error feedback must be understandable without reading the chart graphic.

## Print

Request Detail provides a print action. Print CSS removes navigation, actions, menus, and pagination while retaining the request header, workflow, accounting lines, evidence, approvals, CXP/payment data, reconciliation, and audit information.

## Localization and Security

All visible shared-component text is keyed through the English/Spanish language context. UI visibility improves usability only; Express RBAC, workflow services, accounting-period guards, and financial validation remain authoritative.
