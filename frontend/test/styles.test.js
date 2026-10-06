import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const src = fileURLToPath(new URL("../src/", import.meta.url));
const styleDir = path.join(src, "styles");
const styles = Object.fromEntries(fs.readdirSync(styleDir).filter((file) => file.endsWith(".css")).map((file) => [file, fs.readFileSync(path.join(styleDir, file), "utf8")]));
const css = Object.values(styles).join("\n");
let code = "";
(function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (/\.(jsx?|mjs)$/.test(entry.name)) code += fs.readFileSync(full, "utf8") + "\n"; } })(src);
code += fs.readFileSync(path.join(src, "../index.html"), "utf8");

// 1. Token names say what they are: the retired teal/navy names held UMA red and charcoal.
assert.doesNotMatch(css + code, /--(teal|navy)-\d/, "use --accent / --accent-strong / --accent-soft / --ink-*");

// 2. Every var(--x) without a fallback is defined, in CSS or as an inline style a component sets.
//    An undefined one silently drops the declaration (--navy-700 left rendition line numbers
//    white on nothing).
const defined = new Set([...css.matchAll(/(--[A-Za-z0-9-]+)\s*:/g), ...code.matchAll(/["'](--[A-Za-z0-9-]+)["']\s*:/g)].map((match) => match[1]));
const undefinedVars = [...new Set([...css.matchAll(/var\((--[A-Za-z0-9-]+)\)/g)].map((match) => match[1]))].filter((name) => !defined.has(name));
assert.deepEqual(undefinedVars, [], "every CSS variable used without a fallback is defined");

// 3. No rule styles only class names that nothing renders. Classes built at runtime
//    (`tone-${tone}`) count by prefix; Recharts generates its own recharts-* classes.
const dynamicPrefixes = new Set([...code.matchAll(/([a-z][a-z0-9-]*-)\$\{/g), ...code.matchAll(/["'`]([a-z][a-z0-9-]*-)["'`]\s*\+/g)].map((match) => match[1]));
const words = new Set(code.match(/[A-Za-z0-9_-]+/g));
const rendered = (name) => name.startsWith("recharts-") || words.has(name) || [...dynamicPrefixes].some((prefix) => name.startsWith(prefix));
const dead = [];
for (const [file, text] of Object.entries(styles)) {
  postcss.parse(text).walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes/.test(rule.parent.name)) return;
    for (const selector of rule.selectors) {
      const outer = selector.replace(/:(not|has|is|where)\((?:[^()]|\([^()]*\))*\)/g, "");
      const missing = [...outer.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((match) => match[1]).filter((name) => !rendered(name));
      if (missing.length) dead.push(`${file}: ${selector} (.${missing.join(", .")})`);
    }
  });
}
assert.deepEqual(dead, [], "no CSS for class names nothing renders");

// 4. Ratchets for global.css: lower these when cleaning up, never raise them. New styles use the
//    tokens (var(--...)) and page files (styles/<page>.css), not more hard-coded colours or !important.
const globalCss = styles["global.css"];
const hexColours = (globalCss.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
const important = (globalCss.match(/!important/g) || []).length;
assert.ok(hexColours <= 326, `global.css hard-coded colours: ${hexColours} (limit 326)`);
assert.ok(important <= 52, `global.css !important: ${important} (limit 52)`);

// 5. Scales. Font sizes come from the type scale (--font-2xs ... --font-4xl) or a fluid clamp();
//    radii from the radius scale (--radius-xs ... --radius-pill), 0 or 50% for circles; @media
//    widths from utils/breakpoints.js (max-width: step, min-width: step + 1). Print styles keep
//    their own sizes.
const { BREAKPOINTS } = await import("../src/utils/breakpoints.js");
const steps = Object.values(BREAKPOINTS);
const fontOk = /^(var\(--font-[a-z0-9]+\)|clamp\(.+\)|inherit)( !important)?$/;
const radiusOk = /^((var\(--radius-[a-z]+(, ?\d+px)?\)|0|50%)\s*)+( !important)?$/;
const offScale = [];
for (const [file, text] of Object.entries(styles)) {
  const root = postcss.parse(text);
  root.walkAtRules("media", (at) => {
    for (const [, kind, width] of at.params.matchAll(/\((max|min)-width:\s*(\d+)px\)/g)) {
      if (!steps.includes(kind === "max" ? Number(width) : Number(width) - 1)) offScale.push(`${file}: @media ${at.params}`);
    }
  });
  root.walkDecls((decl) => {
    if (decl.prop.startsWith("--")) return;
    for (let parent = decl.parent; parent; parent = parent.parent) if (parent.type === "atrule" && /print/.test(parent.params)) return;
    if (decl.prop === "font-size" && !fontOk.test(decl.value)) offScale.push(`${file}: ${decl.parent.selector} { font-size: ${decl.value} }`);
    if (/^border(-(top|bottom)-(left|right))?-radius$/.test(decl.prop) && !radiusOk.test(decl.value)) offScale.push(`${file}: ${decl.parent.selector} { ${decl.prop}: ${decl.value} }`);
  });
}
assert.deepEqual(offScale, [], "font sizes, radii and @media widths use the design scales");
for (const step of ["2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"]) assert.ok(defined.has(`--font-${step}`), `--font-${step} is defined`);
for (const step of ["xs", "sm", "md", "lg", "xl", "pill"]) assert.ok(defined.has(`--radius-${step}`), `--radius-${step} is defined`);
// JS media queries come from the same module instead of repeating pixel widths.
const jsWidths = code.replace(fs.readFileSync(path.join(src, "utils/breakpoints.js"), "utf8"), "").match(/\((max|min)-width:\s*\d+px\)/g) || [];
assert.deepEqual(jsWidths, [], "JS media queries use utils/breakpoints.js");

console.log(`PASS styles: semantic tokens, every variable defined, no dead selectors, ${hexColours} hex colours and ${important} !important in global.css (ratcheted), type/radius/breakpoint scales`);
