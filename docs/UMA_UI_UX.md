# UMA interface and responsive design

This update changes the presentation and interaction of the existing platform. It does not change finance APIs, approval rules, financial calculations, role permissions, official document structures, or the annual/monthly budget and quotation payment features.

## Coverage of the 19 requested areas

| Area | Implemented changes |
| --- | --- |
| UMA branding | Original supplied logo in sign-in and navigation; emblem in the collapsed sidebar and favicon; UMA page titles and print header. |
| Theme | Shared UMA crimson accents, charcoal text, white panels, pale backgrounds, and separate success/warning/error styles. |
| Readability | Larger legacy labels and supporting text; consistent headings, field text, and numeric alignment. |
| Layout and spacing | Shared panel spacing, headings, controls, content widths, and responsive grids across modules. |
| Navigation | Planning/reporting group reduces the Finance menu length; clear active states; tablet navigation drawer; keyboard-accessible main-content shortcut. |
| Dashboard | Role-specific next-action panel linking to each role's existing workspace; current metrics and attention items retained. |
| Tables | Readable column widths, sticky headings/actions, accurate visible result counts, horizontal-scroll hints, and keyboard activation of clickable rows. |
| Search and filters | Persistent visible filter summary, clear/reset actions, saved views, and consistent filter controls. |
| Request forms | Step/total summary, required-field guidance, focused validation errors, larger fields, and sticky save/continue actions. |
| Request details | Top-level amount/supplier/period/status summary, section links, collapsible supporting sections, and retained action/history panels. |
| Approvals and Treasury | Visible approval action, green approval confirmation, clearer decision summary, payment-stage navigation, and sticky selected-payment summary. |
| Budget workspace | Clearer annual/monthly selector, distribution meter and reserve labels, selected-month highlighting, larger month table and adjustment history. |
| Quotation comparison | Clear amount/currency presentation and recommended-supplier emphasis; readable payment summaries. |
| Documents and uploads | Required/optional/attached states, file counts, selected-file feedback, larger upload controls, and accessible file-field labels. |
| Messages and terminology | Practical explanations replacing implementation details; friendly status labels; message icons and alert/status announcements. |
| Loading and empty states | Existing skeletons retained; busy state on tables; distinct empty and filtered-out results with a clear-filter action. |
| Languages and formats | Spanish translations for new presentation text, consistent friendly status wording, translated chart legends, and calendar-only dates displayed without a time-zone day shift. |
| Mobile and accessibility | Navigation at tablet widths; phone card/table switch retaining every field; contained financial tables; larger touch targets; focus confinement/return in dialogs; reduced-motion support. |
| Reports and printing | Applied-filter context, keyboard-operable report tabs, UMA chart palette, report print action, branded print header, and expanded request sections when printing. |

## Implementation

- `frontend/src/styles/uma.css` holds the shared brand and responsive presentation rules, loaded after the existing stylesheet. Legacy small-text sizes are also increased in `global.css`.
- `frontend/src/components/UmaBrand.jsx` reuses the original JPG. The SVG icon embeds that same image and shows the emblem through its view box.
- `frontend/src/utils/umaPresentation.js` contains display-copy mappings and Spanish translations. Stored keys and submitted API values remain unchanged.
- Shared tables, navigation, dialogs, charts, request and budget workspaces apply the presentation across the existing pages.

Desktop tables keep meaningful column widths and scroll inside their own region. On phones, controlled tables default to cards and expose a switch back to the comparative table layout. No columns or row actions are removed. Financial tables inside budget and quotation workspaces remain horizontally scrollable for comparison.

## Verification

From the repository root:

```powershell
npm run test:frontend
npm run test:uma-ui --workspace frontend
npm run test:payment-terms-ui --workspace frontend
npm run test:budget-planning-ui --workspace frontend
npm run build
```

The UMA browser suite renders 23 routes at 1440, 1024, 768, 390 and 320 pixels and checks for page overflow and JavaScript failures. It also exercises login password visibility, mobile navigation, card/table switching, search/reset, saved views, approval dialogs, budget forms, focus confinement, Spanish, and print expansion. Its API fixtures are isolated: the suite does not submit financial actions to a real system. Screenshots and its result report are saved in `.tmp/uma-ui`.

The quotation regression suite verifies terms, validation, comparison, save/reopen and Spanish/mobile behavior. The budget regression suite uses real budget controllers and a disposable MongoDB database. Browser suites require local Playwright Chromium. The budget suite also requires MongoDB at `127.0.0.1:27017`.

The responsive sweep covers each main route. It is not an assertion of formal accessibility certification or every possible data/permission combination.
