// The breakpoint scale, shared by CSS (@media in styles/*.css) and JS (useMediaQuery).
// A max-width query uses the step; its min-width counterpart uses step + 1, so exactly one side
// matches. styles.test.js keeps every @media width in CSS on this scale.
export const BREAKPOINTS = Object.freeze({
  compactPhone: 360, // tighter page padding and smaller figures
  smallPhone: 400, // stats and form grids drop to one column
  phone: 640, // bottom navigation, row actions as a sheet, tables as cards
  tablet: 768, // two-column forms and panels stack
  sidebar: 1080, // the sidebar becomes a drawer; detail pages lose their side column
  wide: 1440
});

export const upTo = (name) => `(max-width: ${BREAKPOINTS[name]}px)`;
export const above = (name) => `(min-width: ${BREAKPOINTS[name] + 1}px)`;

export const PHONE_QUERY = upTo("phone");
export const SIDEBAR_DRAWER_QUERY = upTo("sidebar");
