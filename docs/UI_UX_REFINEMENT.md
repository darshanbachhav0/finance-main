# UI/UX refinement

## Review and implementation

| Area | Finding | Change |
| --- | --- | --- |
| Shared headings | Several competing rules controlled title size, spacing, wrapping and subtitle truncation. | Consolidated the base header rules and made `PageHeader` a semantic header with a flexible copy column. Descriptions wrap and actions move below the title when needed. |
| Page copy | Generic descriptions repeated titles, actions and table columns. | Removed redundant descriptions from Requests, Accounts Payable, Accounting Entries, Budget Control, Users and Settings, plus the generic dashboard table instruction. Removed the visible “Related tools” label while keeping the navigation landmark's accessible name. Financial warnings, contextual instructions and confirmation text remain. |
| Visual hierarchy | Heavy uppercase labels and inconsistent panel spacing competed with data and primary actions. | Shared workspace styles use the existing spacing, typography, radius and theme tokens. Quieter card borders, sentence-case navigation/table labels and consistent panel gutters improve scanning. |
| Responsive layouts | Header actions, filter controls, popovers and long labels needed consistent constraints. | Added flexible action groups, wrapping table controls and pagination, shrinkable grid children, viewport-bounded account/notification popovers and larger mobile input text. Existing table-to-card layouts and bottom navigation remain in use. |
| Searchable selects | Absolutely positioned menus could be clipped inside scrolling form bodies; keyboard focus could remain outside the open menu. | Used the existing Floating UI dependency to portal menus outside scrolling bodies, flip above the trigger and size to available space. Popups inside dialogs stay within the dialog's focus boundary. Added combobox state, active option announcements, hint/error associations, focus return and local Escape handling. |
| Navigation | Account and notification panels lacked Escape dismissal; the mobile navigation trigger did not expose its controlled region. | Escape closes panels and restores focus to their trigger. The mobile menu exposes expanded state and its navigation target. |

## Style ownership

- `global.css` retains design tokens, shared primitives and domain layouts. Base page-header rules now have one definition.
- `workspace.css` owns shared workspace presentation and responsive refinements. It loads after `global.css`, uses existing tokens, and scopes workspace layout changes to screen media so print layouts remain independent.
- Feature styles, role permissions, route access, API contracts, calculations and backend code are unchanged.

## Validation

```powershell
npm run test:frontend
npm run build --workspace frontend
npm run test:uma-ui --workspace frontend
npm run test:search-select-ui --workspace frontend
```

Browser suites use local Vite servers and isolated fixtures. When Playwright's bundled Chromium is unavailable, set `PLAYWRIGHT_EXECUTABLE_PATH` to an installed Chromium-based browser executable before running them.

The platform suite covers 29 routes at 1440, 1024, 768, 390 and 320 pixels, plus navigation, filtering, dialogs, Spanish and print interactions. The selector suite checks viewport bounds and keyboard interaction inside a scrolling drawer at 320, 768 and 1440 pixels. Screenshots and matrix results are saved under `.tmp/uma-ui` and `.tmp/select-ui`.

These checks exercise presentation with mocked data; they do not replace real backend integration testing or physical-device testing with a mobile keyboard.
