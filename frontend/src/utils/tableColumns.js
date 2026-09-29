// Column sizing and placement rules shared by DataTable (plain JS so they can be unit tested).

// Column types size a column to its content. Checkbox, code, status and date columns take only
// the width they need (width: 1% plus no wrapping); names get room to stay on one or two lines;
// money is right-aligned and never wraps. A column's own width / minWidth / maxWidth win.
export const COLUMN_TYPES = {
  checkbox: { width: "44px" },
  code: { width: "1%" },
  status: { width: "1%" },
  date: { width: "1%" },
  money: { width: "1%", align: "right" },
  number: { width: "1%", align: "right" },
  name: { minWidth: "220px" },
  text: {}
};

// Columns without a type keep the browser's content-based width (and their own `align`).
export function columnLayout(column) {
  const type = column.type;
  const defaults = COLUMN_TYPES[type] || {};
  const align = column.align || defaults.align;
  const className = [type && `col-${type}`, type === "checkbox" && "checkbox-column", align && `align-${align}`].filter(Boolean).join(" ");
  const style = {};
  for (const property of ["width", "minWidth", "maxWidth"]) {
    const value = column[property] ?? defaults[property];
    if (value !== undefined) style[property] = value;
  }
  return { type, align, className: className || undefined, style: Object.keys(style).length ? style : undefined };
}

// Columns that stay in the row; the rest are shown in the row's "Details" side panel.
// `primary: true | false` on a column decides explicitly.
export function isPrimaryColumn(column, index) {
  if (typeof column.primary === "boolean") return column.primary;
  return index < 2 || ["checkbox", "money", "status"].includes(column.type) || /amount|total|status|action|supplier|beneficiary/i.test(column.key);
}
