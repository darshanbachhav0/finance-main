import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default || traverseModule;
const src = fileURLToPath(new URL("../src/", import.meta.url));
const parseFile = (file) => parse(fs.readFileSync(file, "utf8"), { sourceType: "module", plugins: ["jsx"] });
const keyOf = (prop) => prop.key.type === "StringLiteral" ? prop.key.value : prop.key.name;

// The Spanish dictionaries, in the order LanguageContext merges them.
const languageFile = path.join(src, "context/LanguageContext.jsx");
const language = parseFile(languageFile);
const dictionaries = new Map();
let mergeOrder = [];
let patches = 0;
const imports = new Map();
for (const node of language.program.body) {
  if (node.type === "ImportDeclaration" && node.source.value.startsWith(".")) for (const specifier of node.specifiers) imports.set(specifier.local.name, { file: path.resolve(path.dirname(languageFile), node.source.value), specifier });
  if (node.type === "VariableDeclaration") for (const declaration of node.declarations) {
    if (declaration.id.name === "spanishDictionary") mergeOrder = declaration.init.properties.map((prop) => prop.argument.name);
    else if (declaration.init?.type === "ObjectExpression" && /^spanish$|Spanish$/.test(declaration.id.name)) dictionaries.set(declaration.id.name, declaration.init);
  }
  if (node.type === "ExpressionStatement" && node.expression.callee?.property?.name === "assign" && node.expression.arguments[0]?.name === "spanishDictionary") dictionaries.set(`patch ${++patches}`, node.expression.arguments[1]);
}
for (const name of mergeOrder) {
  if (dictionaries.has(name)) continue;
  const { file, specifier } = imports.get(name);
  for (const item of parseFile(file).program.body) {
    const object = specifier.type === "ImportDefaultSpecifier" ? item.type === "ExportDefaultDeclaration" && item.declaration : item.type === "ExportNamedDeclaration" && item.declaration?.declarations?.find((d) => d.id.name === specifier.imported.name)?.init;
    if (object?.type === "ObjectExpression") dictionaries.set(name, object);
  }
  assert.ok(dictionaries.has(name), `dictionary ${name} found`);
}

// 1. Each English key has one Spanish entry. A second entry in another dictionary silently
//    overrides the first (or is dead), which is how the same word ended up translated two ways.
const owner = new Map();
const duplicates = [];
for (const [name, object] of dictionaries) {
  const seen = new Set();
  for (const prop of object.properties.filter((item) => item.type === "ObjectProperty")) {
    const key = keyOf(prop);
    if (seen.has(key)) duplicates.push(`"${key}" twice in ${name}`);
    seen.add(key);
    if (owner.has(key)) duplicates.push(`"${key}" in ${owner.get(key)} and ${name}`);
    else owner.set(key, name);
  }
}
assert.deepEqual(duplicates, [], "each translation key is defined once");

// 2. Every English string the screens pass to t() - directly or through the props the shared
//    components translate - has Spanish. Language-neutral text is listed explicitly.
const LANGUAGE_NEUTRAL = new Set(["IGV (18%)", "https://", "Universidad María Auxiliadora", "Recibo por Honorarios"]);
const TRANSLATED_PROPS = new Set(["title", "description", "label", "emptyTitle", "emptyDescription", "confirmLabel", "cancelLabel", "inputLabel", "searchPlaceholder", "allLabel", "actionLabel", "missingDescription", "clearLabel", "placeholder"]);
const TRANSLATED_KEYS = new Set(["label", "allLabel", "title", "description", "confirmLabel", "emptyTitle", "emptyDescription", "disabledReason", "actionLabel"]);
const CODE = /^[A-Z0-9]+(_[A-Z0-9]+)+$|^[A-Z0-9]{2,}$/;
const known = new Set(owner.keys());
for (const file of ["utils/umaPresentation.js", "context/i18n/interface.js"]) traverse(parseFile(path.join(src, file)), { ObjectProperty(p) { known.add(keyOf(p.node)); } });
const missing = [];
const screens = [];
(function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) { if (entry.name !== "i18n") walk(full); } else if (/\.jsx?$/.test(entry.name) && !/LanguageContext|Spanish\.js$|umaPresentation/.test(entry.name)) screens.push(full); } })(src);
for (const file of screens) {
  const check = (text, node) => { if (/[a-z]/i.test(text) && !CODE.test(text) && !known.has(text) && !LANGUAGE_NEUTRAL.has(text)) missing.push(`"${text}" (${path.relative(src, file)}:${node.loc.start.line})`); };
  traverse(parseFile(file), {
    CallExpression(p) { if (p.node.callee.name === "t" && p.node.arguments[0]?.type === "StringLiteral") check(p.node.arguments[0].value, p.node); },
    JSXAttribute(p) { if (TRANSLATED_PROPS.has(p.node.name.name) && p.node.value?.type === "StringLiteral") check(p.node.value.value, p.node); },
    ObjectProperty(p) { if (TRANSLATED_KEYS.has(keyOf(p.node)) && p.node.value.type === "StringLiteral") check(p.node.value.value, p.node); }
  });
}
assert.deepEqual(missing, [], "every visible English string has Spanish");

console.log(`PASS translations: ${owner.size} keys, each defined once, no visible string without Spanish`);
