import assert from "node:assert/strict";
import fs from "node:fs";
import interfaceSpanish, { interfaceCodeLabels } from "../src/context/i18n/interface.js";

const source = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const css = source("../src/styles/global.css");
const main = source("../src/main.jsx");
const layer = css.slice(css.indexOf("/* ==== design system (final layer)"));

// One stylesheet, loaded once, with the design-system layer last so it settles the older layers.
assert.deepEqual(main.match(/import "\.\/styles\/[^"]+";/g), ['import "./styles/global.css";']);
assert.ok(layer.length > 1000, "design-system layer is present at the end of global.css");
for (const token of ["--space-4", "--radius-md", "--control-height", "--touch-target", "--select-chevron"]) assert.ok(layer.includes(token), token);
// Descriptions wrap (the old one-line ellipsis cut every page description).
assert.match(layer, /\.page-header \.page-description \{[^}]*white-space: normal/);
// Every select shares the same chevron and ends long values with an ellipsis.
assert.match(layer, /select:not\(\[multiple\]\) \{[^}]*appearance: none[^}]*text-overflow: ellipsis/s);
// The open filter set is a grid even though an older layer forces flex with !important.
assert.match(layer, /\.table-filter-fields\.simplified-filters\.is-open \{[^}]*display: grid !important/);
// "More filters" is styled at every width, not only inside a small-screen media query.
assert.match(layer, /^\.table-filter-toggle \{/m);
// Phones get 40px touch targets.
assert.match(layer, /@media \(max-width: 768px\) \{[\s\S]*min-height: var\(--touch-target\)/);

// Workflow codes shown in charts and badges have an English label and a Spanish translation.
for (const [code, label] of Object.entries(interfaceCodeLabels)) {
  assert.ok(label && label !== code, `${code} has a readable English label`);
  const spanish = interfaceSpanish[label];
  const knownElsewhere = ["Scheduled", "Cancelled", "Low", "Medium", "High"].includes(label);
  assert.ok(spanish || knownElsewhere, `${label} has Spanish copy`);
}
const language = source("../src/context/LanguageContext.jsx");
assert.match(language, /interfaceCodeLabels\[text\]/, "codes resolve through interfaceCodeLabels");
assert.match(language, /sentenceCase\(result\)/, "all-caps code translations are shown in sentence case");

// Charts never display raw category codes or unformatted axis numbers.
const chart = source("../src/components/AnalyticsChart.jsx");
assert.match(chart, /\[LABEL_KEY\]: [^\n]*t\(String\(row\[xKey\]\)\)/);
assert.ok(!/dataKey=\{xKey\}/.test(chart), "axes use the translated label key");
assert.match(chart, /notation: "compact"/);

console.log("PASS single stylesheet with design tokens, wrapping headers, unified selects, filter grid, touch targets, translated chart codes");
