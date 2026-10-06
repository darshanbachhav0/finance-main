import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";
import postcss from "postcss";
import { REQUEST_LIFECYCLE, LEGACY_WORKFLOW_STATUSES, canonicalRequestStatus } from "../../shared/workflowStatus.mjs";
import { STATUS_TONE_GROUPS, STATUS_TONES, TONES, statusTone, toneOf } from "../src/utils/tones.js";

// WCAG contrast (the same formula as colorContrast.test.js, which runs its own checks on import).
const luminance = (hex) => { const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (high + 0.05) / (low + 0.05); };

const src = fileURLToPath(new URL("../src/", import.meta.url));
const read = (file) => fs.readFileSync(path.join(src, file), "utf8").replace(/\r\n/g, "\n");

// 1. Each status has exactly one tone, and every request lifecycle status (and legacy alias, through
//    its current status) has one on purpose rather than by falling back to neutral.
const listed = Object.values(STATUS_TONE_GROUPS).flat();
assert.equal(listed.length, new Set(listed).size, "no status is listed under two tones");
for (const tone of Object.keys(STATUS_TONE_GROUPS)) assert.ok(TONES.includes(tone), `${tone} is a tone`);
for (const status of [...REQUEST_LIFECYCLE, ...Object.keys(LEGACY_WORKFLOW_STATUSES)]) assert.ok(canonicalRequestStatus(status) in STATUS_TONES, `${status} has a tone`);
assert.equal(statusTone("SOMETHING_NEW"), "neutral");
assert.deepEqual(["amber", "red", "green", "teal", "navy", "blue", "warning", "nonsense"].map(toneOf), ["warning", "danger", "success", "accent", "neutral", "info", "warning", "neutral"]);

// 2. The same word always gets the same tone, and every badge shows words instead of its code:
//    "Aprobado" was blue for a request (APROBADO) and green for an approval step (APPROVED).
const bundle = buildSync({ entryPoints: [path.join(src, "context/LanguageContext.jsx")], bundle: true, format: "esm", platform: "node", external: ["react", "react-router-dom", "react/jsx-runtime"], jsx: "automatic", write: false, logLevel: "silent" });
const bundleFile = path.join(fileURLToPath(new URL(".", import.meta.url)), `.language-${process.pid}.mjs`);
fs.writeFileSync(bundleFile, bundle.outputFiles[0].text);
let translateMessage;
try { ({ translateMessage } = await import(pathToFileURL(bundleFile).href)); } finally { fs.unlinkSync(bundleFile); }
const codesShownAsIs = new Set(["A1", "A2", "B", "C"]);
for (const language of ["es", "en"]) {
  const toneByLabel = new Map();
  for (const [status, tone] of Object.entries(STATUS_TONES)) {
    const label = translateMessage(status, language);
    if (!codesShownAsIs.has(status)) assert.notEqual(label, status, `${status} has a ${language} label`);
    const key = label.toLowerCase();
    const previous = toneByLabel.get(key);
    assert.ok(!previous || previous.tone === tone, `"${label}" (${language}) is ${previous?.tone} for ${previous?.status} but ${tone} for ${status}`);
    toneByLabel.set(key, { status, tone });
  }
}

// 3. Tones are named by meaning everywhere: no colour-named tones in components, pages, the
//    dashboard API or the stylesheet.
let code = "";
(function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (/\.(jsx?|mjs|css)$/.test(entry.name)) code += fs.readFileSync(full, "utf8") + "\n"; } })(src);
code = code.replace(fs.readFileSync(path.join(src, "utils/tones.js"), "utf8"), "");
code += fs.readFileSync(new URL("../../backend/src/controllers/dashboardController.js", import.meta.url), "utf8");
const colourNames = "amber|navy|teal|red|green|gray|blue|indigo|dark";
assert.doesNotMatch(code, new RegExp(`\\b(badge|tone)-(${colourNames})\\b`), "badge-/tone- classes use tone names");
assert.doesNotMatch(code, new RegExp(`tone[=:]\\s*\\{?[^\\n,;]*["'](${colourNames})["']`), "tone props and API tones use tone names");
assert.match(read("components/StatusBadge.jsx"), /badge-\$\{statusTone\(status\)\}/, "StatusBadge takes its colour from utils/tones.js");

// 4. Badge text is readable on its tint (WCAG AA, 4.5:1) in both themes, and each tone has its own
//    marker shape so colour is never the only signal.
const css = read("styles/global.css");
const root = postcss.parse(css);
const tokens = { light: {}, dark: {} };
root.walkRules((rule) => {
  if (rule.parent.type !== "root") return;
  const theme = rule.selector === ":root" ? "light" : rule.selector === ':root[data-theme="dark"]' ? "dark" : null;
  if (theme) rule.walkDecls(/^--/, (decl) => { tokens[theme][decl.prop] = decl.value.trim(); });
});
tokens.dark = { ...tokens.light, ...tokens.dark };
const resolve = (theme, value) => {
  for (let depth = 0; depth < 10; depth += 1) {
    const reference = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(value?.trim());
    if (!reference) break;
    value = tokens[theme][reference[1]] ?? reference[2];
  }
  value = value?.trim();
  // The dark theme's tints are color-mix(in srgb, <a> <p>%, <b>).
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(.+)\)$/.exec(value || "");
  if (mix) {
    const [a, b] = [resolve(theme, mix[1]), resolve(theme, mix[3])];
    const share = Number(mix[2]) / 100;
    return a && b ? `#${[1, 3, 5].map((index) => Math.round(parseInt(a.slice(index, index + 2), 16) * share + parseInt(b.slice(index, index + 2), 16) * (1 - share)).toString(16).padStart(2, "0")).join("")}` : null;
  }
  return /^#[0-9a-f]{6}$/i.test(value) ? value : /^#[0-9a-f]{3}$/i.test(value) ? `#${[...value.slice(1)].map((digit) => digit + digit).join("")}` : null;
};
const badgeRules = (selector) => { const values = {}; root.walkRules((rule) => { if (rule.parent.type === "root" && rule.selector === selector) rule.walkDecls((decl) => { values[decl.prop] = decl.value; }); }); return values; };
const lowContrast = [];
for (const tone of ["neutral", "info", "success", "warning", "danger"]) {
  const light = badgeRules(`.badge-${tone}`);
  const dark = { ...light, ...badgeRules(`[data-theme="dark"] .badge-${tone}`) };
  for (const [theme, values] of [["light", light], ["dark", dark]]) {
    const foreground = resolve(theme, values.color);
    const background = resolve(theme, values.background);
    assert.ok(foreground && background, `${theme} .badge-${tone} has a resolvable colour and background`);
    const ratio = contrast(foreground, background);
    if (ratio < 4.5) lowContrast.push(`${theme} .badge-${tone}: ${ratio.toFixed(2)}`);
  }
  if (tone !== "info") assert.ok(["transform", "clip-path", "box-shadow"].some((prop) => badgeRules(`.badge-${tone}::before`)[prop]), `.badge-${tone} has its own marker shape (info keeps the plain dot)`);
}
assert.deepEqual(lowContrast, [], "badge text meets 4.5:1");

// 5. Empty parts of a page use the shared EmptyState (compact inside a record), not hand-made
//    "No ... recorded." paragraphs that each look different.
assert.doesNotMatch(code, /empty-inline|className="chart-state">\{t\(emptyLabel/, "use <EmptyState> (or <EmptyState compact>)");
assert.doesNotMatch(code, /<p[^>]*>\{t\("No [^"]*(recorded|added|available|stored)\.?"\)\}<\/p>/, "\"No ... recorded\" messages use <EmptyState compact>");

console.log("PASS tones: one tone per status, same word same tone, every badge labelled, tones named by meaning, badge contrast and marker shapes, shared empty states");
