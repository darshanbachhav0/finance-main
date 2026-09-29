import assert from "node:assert/strict";
import fs from "node:fs";

// WCAG 2.x contrast for the text tokens as the browser resolves them: every top-level `:root`
// block in global.css applies in order (last one wins) and the dark theme is layered on top.
const css = fs.readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");

function declarations(selectorPattern) {
  const values = {};
  const blocks = css.matchAll(new RegExp(`(?:^|\\n)${selectorPattern}\\s*\\{([^}]*)\\}`, "g"));
  for (const [, body] of blocks) {
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) values[name] = value.trim();
  }
  return values;
}

const light = declarations(":root");
const dark = { ...light, ...declarations(':root\\[data-theme="dark"\\]') };

function resolve(theme, value, depth = 0) {
  assert.ok(depth < 10, `circular token ${value}`);
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  if (reference) return resolve(theme, theme[reference[1]], depth + 1);
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value || "");
  assert.ok(hex, `token resolves to a hex colour (got ${value})`);
  return hex[1].length === 3 ? `#${[...hex[1]].map((digit) => digit + digit).join("")}` : `#${hex[1]}`;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(foreground, background) {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

// Sanity check of the formula against known values.
assert.equal(contrast("#000000", "#ffffff").toFixed(1), "21.0");
assert.equal(contrast("#777777", "#ffffff").toFixed(2), "4.48");

// Body, label and placeholder text (--gray-500 is the placeholder colour) on every surface it sits on.
const textTokens = ["--gray-500", "--gray-600", "--gray-700", "--gray-800", "--gray-950"];
const surfaces = ["--surface-panel", "--surface-work", "--gray-50", "--gray-100", "--gray-150"];
const failures = [];
for (const [themeName, theme] of [["light", light], ["dark", dark]]) {
  const extraSurfaces = themeName === "dark" ? ["--surface-raised"] : [];
  for (const text of textTokens) {
    for (const surface of [...surfaces, ...extraSurfaces]) {
      const ratio = contrast(resolve(theme, `var(${text})`), resolve(theme, `var(${surface})`));
      if (ratio < 4.5) failures.push(`${themeName}: ${text} on ${surface} is ${ratio.toFixed(2)}:1`);
    }
  }
}
assert.deepEqual(failures, [], "secondary text meets WCAG AA (4.5:1)");

// The ramp keeps its order, so secondary text stays lighter than body text.
for (const theme of [light, dark]) {
  const surface = resolve(theme, "var(--surface-panel)");
  const ratios = ["--gray-500", "--gray-600", "--gray-700", "--gray-950"].map((token) => contrast(resolve(theme, `var(${token})`), surface));
  assert.deepEqual([...ratios].sort((a, b) => a - b), ratios, "gray-500 < gray-600 < gray-700 < gray-950 in contrast");
}

// Sidebar section labels use the token (the old hard-coded #728da1 was 3.5:1 on white).
const labelColors = [...css.matchAll(/(?:^|\n)\.nav-group-label \{[^}]*?[^-]color: ([^;]+);/g)].map((match) => match[1].trim());
assert.ok(labelColors.length > 0);
assert.ok(labelColors.every((color) => color === "var(--gray-600)"), `nav-group-label colours: ${labelColors.join(", ")}`);
for (const retired of ["#728da1", "#7d8a94", "#667581"]) assert.equal(css.toLowerCase().includes(retired), false, `${retired} (below 4.5:1) is gone`);

// Menu counters: the tinted pill (light), its dark variant and the filled pill on icons.
assert.ok(contrast("#a90f39", resolve(light, "var(--surface-tint-f7e5ed)")) >= 4.5, "light counter");
assert.ok(contrast(resolve(dark, "var(--uma-primary)"), resolve(dark, "var(--uma-soft)")) >= 4.5, "dark counter");
for (const theme of [light, dark]) assert.ok(contrast("#ffffff", resolve(theme, "var(--action-fill)")) >= 4.5, "filled counter");

console.log("PASS text tokens meet WCAG AA contrast in light and dark themes (secondary text, placeholders, sidebar labels, counters)");
