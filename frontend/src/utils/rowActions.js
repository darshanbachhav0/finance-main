// Row actions follow one pattern everywhere:
// - the action marked `primary` (the row's next step) is a visible button;
// - a row with a single action shows it as a button, without a menu;
// - everything else sits in a labelled "More (n)" menu, secondary actions first and
//   destructive ones (tone: "danger") last, after a separator.
export function splitRowActions(actions) {
  // `destructive: true` (used by some pages) is the same as tone "danger".
  const visible = (actions || []).filter((action) => action && !action.hidden).map((action) => (action.destructive && action.tone !== "danger" ? { ...action, tone: "danger" } : action));
  let primary = visible.find((action) => action.primary) || null;
  // Utility entries (e.g. the table's own "Details") don't count when deciding whether a row
  // has a single real action that can be shown directly as its button.
  const real = visible.filter((action) => !action.utility);
  if (!primary && real.length === 1 && real[0].tone !== "danger") primary = real[0];
  const rest = visible.filter((action) => action !== primary);
  const ordered = [...rest.filter((action) => action.tone !== "danger"), ...rest.filter((action) => action.tone === "danger")];
  return { primary, menu: ordered };
}
